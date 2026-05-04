#!/usr/bin/env node
/**
 * Copy all objects from one R2 bucket prefix to another bucket/prefix with a NEW key layout.
 * Use when the dashboard migration UI cannot place files under `pornwrld/videos/feet/...`.
 *
 * Requirements: API token must allow ListBucket on source + PutObject on destination (same endpoint).
 *
 * Usage (dry-run prints planned copies):
 *   node scripts/r2-migrate-prefix.mjs ^
 *     --src-bucket=tbw-media ^
 *     --src-prefix=porn/feet/previews/ ^
 *     --dst-bucket=pornwrld ^
 *     --dst-prefix=pornwrld/videos/feet/free/previews/
 *
 * Apply copies:
 *   node scripts/r2-migrate-prefix.mjs ...same args... --execute
 *
 * Test first N keys only:
 *   node scripts/r2-migrate-prefix.mjs ... --limit=5
 *
 * Loads .env from project root (CLOUDFLARE_R2_* / R2_* + endpoint).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, ListObjectsV2Command, CopyObjectCommand } from '@aws-sdk/client-s3';

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

function argVal(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
}

function normalizePrefix(p) {
  const s = String(p || '').replace(/^\/+/, '').replace(/\/+$/, '');
  return s ? `${s}/` : '';
}

/** S3 CopySource header: bucket/key with per-segment encoding. */
function copySourceHeader(bucketName, objectKey) {
  return `${bucketName}/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
}

async function main() {
  const execute = process.argv.includes('--execute');
  const srcBucket = argVal('src-bucket');
  const dstBucket = argVal('dst-bucket');
  const srcPrefix = normalizePrefix(argVal('src-prefix'));
  const dstPrefix = normalizePrefix(argVal('dst-prefix'));
  const limitRaw = argVal('limit');
  const limit = limitRaw ? Math.max(1, parseInt(limitRaw, 10) || 0) : 0;

  if (!accessKey || !secretKey || !endpoint) {
    console.error('Missing CLOUDFLARE_R2_* / R2_* credentials or endpoint in .env');
    process.exit(1);
  }
  if (!srcBucket || !dstBucket || !srcPrefix || !dstPrefix) {
    console.error(
      'Required: --src-bucket= --dst-bucket= --src-prefix=path/ --dst-prefix=path/',
    );
    console.error(
      'Example: --src-bucket=tbw-media --src-prefix=porn/feet/previews/ --dst-bucket=pornwrld --dst-prefix=pornwrld/videos/feet/free/previews/',
    );
    process.exit(1);
  }

  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });

  const plan = [];
  let ContinuationToken;
  list: do {
    const out = await client.send(
      new ListObjectsV2Command({
        Bucket: srcBucket,
        Prefix: srcPrefix,
        ContinuationToken,
        MaxKeys: 1000,
      }),
    );
    for (const o of out.Contents || []) {
      const key = o.Key;
      if (!key || key.endsWith('/')) continue;
      if (!key.startsWith(srcPrefix)) continue;
      const relative = key.slice(srcPrefix.length);
      const destKey = dstPrefix + relative;
      plan.push({ srcKey: key, destKey });
      if (limit && plan.length >= limit) break list;
    }
    ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (ContinuationToken);

  console.log('Endpoint:', endpoint.replace(/\/\/[^.]+\./, '//***.'));
  console.log(`Source:      ${srcBucket} / ${srcPrefix}`);
  console.log(`Destination: ${dstBucket} / ${dstPrefix}`);
  console.log(`Objects:     ${plan.length}${limit ? ` (limit ${limit})` : ''}`);
  console.log('');

  for (const { srcKey, destKey } of plan) {
    console.log(`${srcKey}`);
    console.log(`  -> ${destKey}`);
  }

  if (!execute) {
    console.log('\nDry run. Add --execute to perform CopyObject for each line.');
    return;
  }

  for (const { srcKey, destKey } of plan) {
    await client.send(
      new CopyObjectCommand({
        Bucket: dstBucket,
        Key: destKey,
        CopySource: copySourceHeader(srcBucket, srcKey),
      }),
    );
    console.log(`OK ${destKey}`);
  }
  console.log('\nDone (copy only; source objects unchanged). Delete source manually if desired.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
