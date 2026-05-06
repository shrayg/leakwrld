#!/usr/bin/env node
/**
 * Upload a single file to R2 under the site assets prefix (served at /assets/<relKey>).
 *
 * Example (category thumbnail):
 *   node scripts/r2-upload-site-asset.mjs --local="./thumbnails/nsfw-straight.png" --key="thumbnails/nsfw-straight.png"
 *
 * Object key: {CLOUDFLARE_R2_ROOT_PREFIX}/assets/{key}   (default pornwrld/assets/...)
 *
 * Loads .env from project root (same keys as server.js).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

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
const R2_ASSETS_PREFIX = String(
  process.env.CLOUDFLARE_R2_ASSETS_PREFIX || `${R2_ROOT_PREFIX}/assets`,
).replace(/^\/+|\/+$/g, '');

function argVal(name) {
  const a = process.argv.find((x) => x.startsWith(name + '='));
  return a ? a.slice(name.length + 1) : '';
}

const EXTS_CT = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
]);

async function main() {
  const local = argVal('--local');
  const relKey = (argVal('--key') || '').replace(/^\/+/, '').replace(/\\/g, '/');
  const dryRun = process.argv.includes('--dry-run');

  if (!local) {
    console.error('Missing --local=path to file');
    process.exit(1);
  }
  if (!relKey || relKey.includes('..')) {
    console.error('Missing or invalid --key=path/under/assets (no leading slash, no ..)');
    process.exit(1);
  }
  const prefix = /^thumbnails\/|^images\/|^onlyfans\/|^branding\//;
  if (!prefix.test(relKey)) {
    console.error('Refusing --key: must start with thumbnails/, images/, onlyfans/, or branding/');
    process.exit(1);
  }

  const absLocal = path.resolve(local);
  if (!fs.existsSync(absLocal)) {
    console.error('Local file missing:', absLocal);
    process.exit(1);
  }

  const objectKey = `${R2_ASSETS_PREFIX}/${relKey}`.replace(/\/+/g, '/');
  const ext = path.extname(relKey).toLowerCase();
  const contentType = EXTS_CT.get(ext) || 'application/octet-stream';

  console.log('Bucket:', bucket);
  console.log('Object key:', objectKey);
  console.log('Local:', absLocal);
  console.log('Dry run:', dryRun);

  if (!accessKey || !secretKey || !endpoint || !bucket) {
    console.error('Missing R2 credentials or bucket in .env');
    process.exit(1);
  }

  if (dryRun) {
    console.log('[dry-run] OK');
    return;
  }

  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });
  const body = fs.readFileSync(absLocal);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
    }),
  );
  console.log('Uploaded. Site URL: /assets/' + relKey);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
