#!/usr/bin/env node
/**
 * Upload a local directory tree into an R2 category prefix (same layout as server /api/list).
 *
 * Maps common Discord export folder names to server paths:
 *   free   -> free/
 *   tier1  -> tier 1/   (space after "tier"; matches server /api/list)
 *   tier2  -> tier 2/
 *   tier3  -> tier 3/   (Ultimate-only; server also resolves flat `ultimate/` for older keys)
 *
 * Usage:
 *   node scripts/r2-upload-local-category.mjs --local="C:\path\to\nsfwstraight" --category=nsfw-straight
 *   Flat folder (all videos/images -> one vault), keeps nested paths under the vault:
 *   node scripts/r2-upload-local-category.mjs --local="C:\path\to\legal-teens" --category=teen-18-plus --flat-vault=free
 *   node scripts/r2-upload-local-category.mjs ... --dry-run
 *
 * Loads .env from project root (same keys as server.js).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function loadDotEnv(dotEnvPath) {
  try {
    if (!fs.existsSync(dotEnvPath)) return;
    const raw = fs.readFileSync(dotEnvPath, 'utf8').replace(/^\uFEFF/, '');
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = String(line || '').trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const normalized = trimmed.startsWith('export ')
        ? trimmed.slice('export '.length).trim()
        : trimmed;
      const eq = normalized.indexOf('=');
      if (eq <= 0) return;
      const key = normalized.slice(0, eq).trim();
      let val = normalized.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined || process.env[key] === '') {
        process.env[key] = val;
      }
    });
  } catch {
    /* ignore */
  }
}

loadDotEnv(path.join(ROOT, '.env'));

const accessKey =
  process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID || '';
const secretKey =
  process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY || '';
const endpoint = (
  process.env.CLOUDFLARE_R2_ENDPOINT || process.env.R2_ENDPOINT || ''
).replace(/\/+$/, '');
const bucket =
  process.env.CLOUDFLARE_R2_BUCKET_RAW || process.env.R2_BUCKET || '';
const R2_ROOT_PREFIX = String(
  process.env.CLOUDFLARE_R2_ROOT_PREFIX || 'pornwrld',
).replace(/^\/+|\/+$/g, '');
const R2_VIDEOS_PREFIX = String(
  process.env.CLOUDFLARE_R2_VIDEOS_PREFIX || `${R2_ROOT_PREFIX}/videos`,
).replace(/^\/+|\/+$/g, '');

const imageExts = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
]);
const videoExts = new Set([
  '.mp4',
  '.webm',
  '.mov',
  '.avi',
  '.mkv',
  '.wmv',
  '.flv',
  '.m4v',
  '.3gp',
  '.3g2',
  '.ts',
  '.mts',
  '.m2ts',
  '.vob',
  '.ogv',
  '.mpg',
  '.mpeg',
  '.divx',
  '.asf',
  '.rm',
  '.rmvb',
  '.f4v',
]);

function isAllowedMediaFile(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return imageExts.has(ext) || videoExts.has(ext);
}

function contentTypeFor(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.bmp':
      return 'image/bmp';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mov':
      return 'video/quicktime';
    case '.avi':
      return 'video/x-msvideo';
    case '.mkv':
      return 'video/x-matroska';
    case '.wmv':
      return 'video/x-ms-wmv';
    case '.flv':
      return 'video/x-flv';
    default:
      return 'application/octet-stream';
  }
}

/** Map first path segment (local subfolder name) -> R2 path segment under category (with trailing slash for prefix join). */
function remoteSegmentForLocalDir(name) {
  const n = String(name || '').trim().toLowerCase();
  if (n === 'free') return 'free/';
  if (n === 'previews') return 'previews/';
  if (n === 'tier1' || n === 'tier 1') return 'tier 1/';
  if (n === 'tier2' || n === 'tier 2') return 'tier 2/';
  if (n === 'tier3' || n === 'tier 3') return 'tier 3/';
  // Allow already-canonical vault folder names
  const vaults = new Set(['basic', 'premium', 'ultimate', 'elite']);
  if (vaults.has(n)) return `${n}/`;
  return null;
}

/** For --flat-vault=: segment under category matching server /api/list (no trailing slash). */
function vaultKeySegmentFromFlatArg(raw) {
  const n = String(raw || '').trim().toLowerCase();
  if (!n) return '';
  if (n === 'tier1' || n === 'tier_1') return 'tier 1';
  if (n === 'tier2' || n === 'tier_2') return 'tier 2';
  if (n === 'tier3' || n === 'tier_3') return 'tier 3';
  if (/^tier [123]$/.test(n)) return n;
  const vaults = new Set(['free', 'previews', 'basic', 'premium', 'ultimate', 'elite']);
  if (vaults.has(n)) return n;
  return '';
}

function argVal(name) {
  const a = process.argv.find((x) => x.startsWith(name + '='));
  return a ? a.slice(name.length + 1) : '';
}

async function main() {
  const localRoot = argVal('--local');
  const category = (argVal('--category') || 'nsfw-straight').replace(/^\/+|\/+$/g, '');
  const dryRun = process.argv.includes('--dry-run');
  const skipExisting = process.argv.includes('--skip-existing');
  const flatVaultRaw = argVal('--flat-vault');
  const flatVaultSeg = vaultKeySegmentFromFlatArg(flatVaultRaw);
  const concurrency = Math.max(
    1,
    Math.min(16, parseInt(argVal('--concurrency') || '6', 10) || 6),
  );

  if (!localRoot) {
    console.error('Missing --local=path to folder (e.g. ...\\nsfwstraight)');
    process.exit(1);
  }
  if (!accessKey || !secretKey || !endpoint || !bucket) {
    console.error('Missing R2 credentials or bucket in .env');
    process.exit(1);
  }

  const resolvedLocal = path.resolve(localRoot);
  if (!fs.existsSync(resolvedLocal)) {
    console.error('Local path does not exist:', resolvedLocal);
    process.exit(1);
  }

  const basePrefix = `${R2_VIDEOS_PREFIX}/${category}`.replace(/\/+/g, '/');
  console.log('Bucket:', bucket);
  console.log('Base R2 prefix:', basePrefix + '/');
  console.log('Local:', resolvedLocal);
  console.log('Dry run:', dryRun);
  if (flatVaultRaw && !flatVaultSeg) {
    console.error(
      'Invalid --flat-vault= value:',
      flatVaultRaw,
      '(use free, previews, basic, premium, ultimate, elite, or tier1|tier2|tier3)',
    );
    process.exit(1);
  }
  if (flatVaultSeg) {
    console.log('Flat mode: all media under local root ->', flatVaultSeg + '/');
  }
  console.log('');

  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });

  const jobs = [];

  if (flatVaultSeg) {
    const stack = [resolvedLocal];
    while (stack.length) {
      const cur = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(cur, { withFileTypes: true });
      } catch (e) {
        console.warn('Cannot read:', cur, e.message);
        continue;
      }
      for (const ent of entries) {
        const full = path.join(cur, ent.name);
        if (ent.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (!ent.isFile() || !isAllowedMediaFile(ent.name)) continue;
        const rel = path.relative(resolvedLocal, full);
        const posixRel = rel.split(path.sep).join('/');
        const key = `${basePrefix}/${flatVaultSeg}/${posixRel}`.replace(/\/+/g, '/');
        jobs.push({ full, key, name: ent.name });
      }
    }
  } else {
    const top = fs.readdirSync(resolvedLocal, { withFileTypes: true });
    for (const d of top) {
      if (!d.isDirectory()) continue;
      const seg = remoteSegmentForLocalDir(d.name);
      if (!seg) {
        console.warn('Skip unknown subfolder:', d.name);
        continue;
      }
      const dirPath = path.join(resolvedLocal, d.name);
      const stack = [dirPath];
      while (stack.length) {
        const cur = stack.pop();
        let entries;
        try {
          entries = fs.readdirSync(cur, { withFileTypes: true });
        } catch (e) {
          console.warn('Cannot read:', cur, e.message);
          continue;
        }
        for (const ent of entries) {
          const full = path.join(cur, ent.name);
          if (ent.isDirectory()) {
            stack.push(full);
            continue;
          }
          if (!ent.isFile() || !isAllowedMediaFile(ent.name)) continue;
          const rel = path.relative(path.join(resolvedLocal, d.name), full);
          const posixRel = rel.split(path.sep).join('/');
          const key = `${basePrefix}/${seg}${posixRel}`.replace(/\/+/g, '/');
          jobs.push({ full, key, name: ent.name });
        }
      }
    }
  }

  console.log('Files to upload:', jobs.length);
  if (!jobs.length) process.exit(0);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  let idx = 0;

  async function worker() {
    for (;;) {
      const i = idx++;
      if (i >= jobs.length) return;
      const { full, key } = jobs[i];
      try {
        if (skipExisting && !dryRun) {
          try {
            await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
            skipped++;
            continue;
          } catch {
            /* not found */
          }
        }
        if (dryRun) {
          console.log('[dry-run]', key);
          uploaded++;
          continue;
        }
        const body = fs.readFileSync(full);
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: contentTypeFor(full),
          }),
        );
        uploaded++;
        if (uploaded % 50 === 0 || uploaded === jobs.length) {
          console.log(`Progress: ${uploaded}/${jobs.length} (${skipped} skipped)`);
        }
      } catch (e) {
        failed++;
        console.error('FAIL', key, e.message || e);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  console.log('');
  console.log('Done. uploaded:', uploaded, 'skipped:', skipped, 'failed:', failed);
  if (!dryRun && uploaded > 0 && !failed) {
    console.log(
      '\nTip: Restart the Node server (or wait for /api/list cache TTL) so category + Shorts pick up new objects immediately.',
    );
  }
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
