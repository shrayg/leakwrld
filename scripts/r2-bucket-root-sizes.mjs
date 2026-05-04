#!/usr/bin/env node
/** Top-level prefixes in the R2 bucket + total bytes each (full bucket breakdown). */
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

if (!accessKey || !secretKey || !endpoint || !bucket) {
  console.error('Missing R2 env');
  process.exit(1);
}

const client = new S3Client({
  region: 'auto',
  endpoint,
  credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
});

async function topLevelPrefixes() {
  const out = [];
  let ContinuationToken;
  do {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
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

async function sumUnderPrefix(prefix) {
  const p = prefix.endsWith('/') ? prefix : prefix + '/';
  let bytes = 0;
  let objects = 0;
  let ContinuationToken;
  do {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: p,
        ContinuationToken,
        MaxKeys: 1000,
      }),
    );
    for (const o of resp.Contents || []) {
      bytes += Number(o.Size) || 0;
      objects++;
    }
    ContinuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return { bytes, objects };
}

async function sumEntireBucket() {
  let bytes = 0;
  let objects = 0;
  let ContinuationToken;
  do {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken,
        MaxKeys: 1000,
      }),
    );
    for (const o of resp.Contents || []) {
      bytes += Number(o.Size) || 0;
      objects++;
    }
    ContinuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return { bytes, objects };
}

async function main() {
  console.log('Bucket:', bucket);
  const whole = await sumEntireBucket();
  console.log(
    'Full bucket (all keys):',
    whole.objects,
    'objects,',
    (whole.bytes / 1024 ** 3).toFixed(3),
    'GiB,',
    (whole.bytes / 1e9).toFixed(3),
    'GB (decimal 1e9)',
  );
  console.log('');
  const prefixes = await topLevelPrefixes();
  if (!prefixes.length) {
    console.log('No common prefixes at bucket root (flat keys or empty).');
    const all = await sumUnderPrefix('');
    console.log('All objects:', all.objects, (all.bytes / 1024 ** 3).toFixed(3), 'GiB');
    return;
  }
  const rows = [];
  let tBytes = 0;
  let tObjs = 0;
  for (const pref of prefixes) {
    const { bytes, objects } = await sumUnderPrefix(pref);
    tBytes += bytes;
    tObjs += objects;
    rows.push({ pref, bytes, objects });
  }
  rows.sort((a, b) => b.bytes - a.bytes);
  const w = Math.max(20, ...rows.map((r) => r.pref.length));
  console.log(`${'Prefix'.padEnd(w)}  Objects    GiB`);
  console.log('-'.repeat(w + 22));
  for (const r of rows) {
    console.log(
      `${r.pref.padEnd(w)}  ${String(r.objects).padStart(7)}  ${(r.bytes / 1024 ** 3).toFixed(3)}`,
    );
  }
  console.log('-'.repeat(w + 22));
  console.log(
    `${'TOTAL'.padEnd(w)}  ${String(tObjs).padStart(7)}  ${(tBytes / 1024 ** 3).toFixed(3)}`,
  );
  console.log('');
  console.log(
    'Cloudflare dashboard "Bucket size" should match TOTAL (± small reporting delay / GiB vs GB).',
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
