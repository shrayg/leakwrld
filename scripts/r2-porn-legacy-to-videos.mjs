#!/usr/bin/env node
/**
 * Copy objects from legacy `porn/<folder>/` into canonical `pornwrld/videos/<category>/`.
 *
 * Default mapping (matches site categories / slugs):
 *   feet          -> videos/feet/
 *   live slips    -> videos/nip-slips/
 *   omegle        -> videos/omegle/
 *   onlyfans      -> videos/of-leaks/
 *   snapchat      -> videos/nsfw-straight/snapchat/   (subfolder avoids name clashes with tiktok)
 *   tiktok        -> videos/nsfw-straight/tiktok/
 *
 * Dry-run by default. Same bucket: uses CopyObject (no download).
 *
 *   node scripts/r2-porn-legacy-to-videos.mjs
 *   node scripts/r2-porn-legacy-to-videos.mjs --execute
 *   node scripts/r2-porn-legacy-to-videos.mjs --execute --delete-after
 *
 * Override roots if your keys differ:
 *   --src-base=porn --dst-base=pornwrld/videos
 *
 * Loads .env: CLOUDFLARE_R2_* / R2_* + endpoint + bucket.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

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

/** Prefer value from project `.env` so a stale shell `CLOUDFLARE_R2_BUCKET_RAW` cannot break the script. */
function readEnvFromFile(key) {
  try {
    const raw = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').replace(/^\uFEFF/, '');
    for (const line of raw.split(/\r?\n/)) {
      const t = String(line || '').trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i <= 0) continue;
      const k = t.slice(0, i).trim();
      if (k !== key) continue;
      let v = t.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      return v;
    }
  } catch {
    /* ignore */
  }
  return '';
}

const accessKey =
  process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID || '';
const secretKey =
  process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY || '';
const endpoint = (
  process.env.CLOUDFLARE_R2_ENDPOINT || process.env.R2_ENDPOINT || ''
).replace(/\/+$/, '');
const defaultBucket =
  readEnvFromFile('CLOUDFLARE_R2_BUCKET_RAW').trim() ||
  (process.env.CLOUDFLARE_R2_BUCKET_RAW || process.env.R2_BUCKET || '').trim() ||
  'pornwrld';

function argVal(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
}

function joinPrefix(...parts) {
  const s = parts
    .filter(Boolean)
    .map((p) => String(p).replace(/^\/+|\/+$/g, ''))
    .join('/');
  return s ? `${s}/` : '';
}

function copySourceHeader(bucketName, objectKey) {
  return `${bucketName}/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
}

/** Built-in migration rows: legacy folder name under src-base -> destination under dst-base */
const ROWS = [
  { src: 'feet', dst: 'feet' },
  { src: 'live slips', dst: 'nip-slips' },
  { src: 'omegle', dst: 'omegle' },
  { src: 'onlyfans', dst: 'of-leaks' },
  { src: 'snapchat', dst: 'nsfw-straight/snapchat' },
  { src: 'tiktok', dst: 'nsfw-straight/tiktok' },
];

async function listAllKeys(client, bucket, prefix) {
  const keys = [];
  let ContinuationToken;
  do {
    const out = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken,
        MaxKeys: 1000,
      }),
    );
    for (const o of out.Contents || []) {
      const key = o.Key;
      if (!key || key.endsWith('/')) continue;
      keys.push(key);
    }
    ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return keys;
}

async function main() {
  const execute = process.argv.includes('--execute');
  const deleteAfter = process.argv.includes('--delete-after');
  const bucket = argVal('bucket') || defaultBucket;
  const srcBase = argVal('src-base') || 'porn';
  const dstBase = argVal('dst-base') || 'pornwrld/videos';
  const limitRaw = argVal('limit');
  const limit = limitRaw ? Math.max(1, parseInt(limitRaw, 10) || 0) : 0;

  if (!accessKey || !secretKey || !endpoint) {
    console.error('Missing CLOUDFLARE_R2_* / R2_* credentials or endpoint in .env');
    process.exit(1);
  }
  if (!bucket) {
    console.error('Set bucket in .env (CLOUDFLARE_R2_BUCKET_RAW / R2_BUCKET) or --bucket=');
    process.exit(1);
  }

  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });

  const plan = [];
  for (const row of ROWS) {
    const srcPrefix = joinPrefix(srcBase, row.src);
    const dstPrefix = joinPrefix(dstBase, row.dst);
    const keys = await listAllKeys(client, bucket, srcPrefix);
    for (const key of keys) {
      if (!key.startsWith(srcPrefix)) continue;
      const relative = key.slice(srcPrefix.length);
      const destKey = dstPrefix + relative;
      plan.push({ srcKey: key, destKey, label: `${row.src} → ${row.dst}` });
      if (limit && plan.length >= limit) break;
    }
    if (limit && plan.length >= limit) break;
  }

  console.log('Endpoint:', endpoint.replace(/\/\/[^.]+\./, '//***.'));
  console.log(`Bucket:   ${bucket}`);
  console.log(`Src base: ${joinPrefix(srcBase)}`);
  console.log(`Dst base: ${joinPrefix(dstBase)}`);
  console.log(`Planned copy operations: ${plan.length}${limit ? ` (stopped at --limit=${limit})` : ''}`);
  console.log('');

  for (const { srcKey, destKey, label } of plan) {
    console.log(`[${label}]`);
    console.log(`  ${srcKey}`);
    console.log(`  -> ${destKey}`);
  }

  if (!execute) {
    console.log('\nDry run. Add --execute to copy. Optional: --delete-after removes source after each successful copy.');
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const { srcKey, destKey } of plan) {
    try {
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: destKey,
          CopySource: copySourceHeader(bucket, srcKey),
        }),
      );
      ok++;
      console.log(`OK ${destKey}`);
      if (deleteAfter) {
        await client.send(
          DeleteObjectCommand({ Bucket: bucket, Key: srcKey }),
        );
        console.log(`  deleted ${srcKey}`);
      }
    } catch (e) {
      fail++;
      console.error(`FAIL ${srcKey}:`, e.message || e);
    }
  }
  console.log(`\nDone: ${ok} copied, ${fail} failed.${deleteAfter ? ' Sources deleted after copy.' : ''}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
