#!/usr/bin/env node
/**
 * List each "folder" (common prefix) under the configured videos root with total byte size + object count.
 * Loads .env like server.js (CLOUDFLARE_R2_*).
 *
 * Usage:
 *   node scripts/r2-folder-sizes.mjs
 *   node scripts/r2-folder-sizes.mjs --prefix=pornwrld/videos/
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

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

function argVal(name) {
  const a = process.argv.find((x) => x.startsWith(name + '='));
  return a ? a.slice(name.length + 1) : '';
}

async function listCommonPrefixes(client, bucketName, prefix) {
  const p = prefix.endsWith('/') ? prefix : prefix + '/';
  const out = [];
  let ContinuationToken;
  do {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: p,
        Delimiter: '/',
        ContinuationToken,
        MaxKeys: 1000,
      }),
    );
    for (const cp of resp.CommonPrefixes || []) {
      if (cp.Prefix) out.push(cp.Prefix);
    }
    ContinuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return out.sort();
}

async function sumUnderPrefix(client, bucketName, prefix) {
  let bytes = 0;
  let objects = 0;
  let ContinuationToken;
  const p = prefix.endsWith('/') ? prefix : prefix + '/';
  do {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: p,
        ContinuationToken,
        MaxKeys: 1000,
      }),
    );
    for (const o of resp.Contents || []) {
      if (!o.Key) continue;
      bytes += Number(o.Size) || 0;
      objects++;
    }
    ContinuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return { bytes, objects };
}

async function main() {
  const rootArg = argVal('--prefix');
  if (!accessKey || !secretKey || !endpoint || !bucket) {
    console.error('Missing R2 credentials or bucket in .env');
    process.exit(1);
  }

  const videosRoot = (rootArg || `${R2_VIDEOS_PREFIX}/`).replace(/\/+/g, '/');
  const root = videosRoot.endsWith('/') ? videosRoot : videosRoot + '/';

  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });

  console.log('Bucket:', bucket);
  console.log('Scan root:', root);
  console.log('');

  const prefixes = await listCommonPrefixes(client, bucket, root.replace(/\/$/, ''));
  if (!prefixes.length) {
    console.log('No subfolders under this prefix (or empty bucket path).');
    const direct = await sumUnderPrefix(client, bucket, root);
    console.log('Objects directly under prefix:', direct.objects, 'size:', formatSize(direct.bytes));
    return;
  }

  const rows = [];
  let grandBytes = 0;
  let grandObjects = 0;
  for (const pref of prefixes) {
    const { bytes, objects } = await sumUnderPrefix(client, bucket, pref);
    grandBytes += bytes;
    grandObjects += objects;
    const short = pref.slice(root.length).replace(/\/$/, '') || '(root)';
    rows.push({ folder: short, objects, ...formatParts(bytes) });
  }

  rows.sort((a, b) => b.bytes - a.bytes);
  const colW = Math.max(...rows.map((r) => r.folder.length), 6);
  console.log(
    `${'Folder'.padEnd(colW)}  ${'Objects'.padStart(8)}  ${'Size GB'.padStart(10)}  ${'Size MB'.padStart(12)}`,
  );
  console.log('-'.repeat(colW + 36));
  for (const r of rows) {
    console.log(
      `${r.folder.padEnd(colW)}  ${String(r.objects).padStart(8)}  ${r.gb.padStart(10)}  ${r.mb.padStart(12)}`,
    );
  }
  console.log('-'.repeat(colW + 36));
  const g = formatParts(grandBytes);
  console.log(
    `${'TOTAL'.padEnd(colW)}  ${String(grandObjects).padStart(8)}  ${g.gb.padStart(10)}  ${g.mb.padStart(12)}`,
  );
}

function formatParts(bytes) {
  return {
    bytes,
    gb: (bytes / 1024 ** 3).toFixed(3),
    mb: (bytes / 1024 ** 2).toFixed(1),
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
