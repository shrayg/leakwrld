#!/usr/bin/env node
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
    // ignore
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

const files = ['onlyfans.png', 'feet.png', 'tiktok.png'];

async function main() {
  if (!accessKey || !secretKey || !endpoint || !bucket) {
    throw new Error('Missing R2 credentials/bucket in .env');
  }
  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });

  for (const file of files) {
    const local = path.join(ROOT, 'thumbnails', file);
    if (!fs.existsSync(local)) {
      throw new Error(`Missing local file: ${local}`);
    }
    const key = `${R2_ASSETS_PREFIX}/thumbnails/${file}`.replace(/\/+/g, '/');
    const body = fs.readFileSync(local);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: 'image/png',
      }),
    );
    console.log(`uploaded ${key}`);
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
