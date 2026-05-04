#!/usr/bin/env node
/**
 * Collapses legacy path segment video|photo|gif before tier folders into flat layout:
 *   .../(video|photo|gif)/(free|basic|premium|ultimate|elite)/...  ->  .../<tier>/...
 *
 * Default: dry-run (prints Copy source → destination). Use --execute to CopyObject + DeleteObject.
 *
 * Loads .env from project root (same keys as server.js).
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

const accessKey =
  process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID || '';
const secretKey =
  process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY || '';
const endpoint = (
  process.env.CLOUDFLARE_R2_ENDPOINT || process.env.R2_ENDPOINT || ''
).replace(/\/+$/, '');
const bucket =
  process.env.CLOUDFLARE_R2_BUCKET_RAW || process.env.R2_BUCKET || '';

const LEGACY_CT_RE = /\/(video|photo|gif)\/(free|basic|premium|ultimate|elite)\//g;

function targetKeyForLegacyLayout(sourceKey) {
  const next = sourceKey.replace(LEGACY_CT_RE, '/$2/');
  return next === sourceKey ? null : next;
}

/** S3 CopySource: bucket/key with each path segment encoded (required for spaces/special chars). */
function copySourceHeader(bucketName, objectKey) {
  return `${bucketName}/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const prefixArg = args.find((a) => a.startsWith('--prefix='));
  const prefix = prefixArg ? prefixArg.slice('--prefix='.length) : 'pornwrld/videos/';

  if (!accessKey || !secretKey || !endpoint || !bucket) {
    console.error('Missing R2 credentials, endpoint, or bucket in .env');
    process.exit(1);
  }

  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });

  const moves = [];
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
      const dst = targetKeyForLegacyLayout(key);
      if (dst) moves.push({ src: key, dst });
    }
    ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (ContinuationToken);

  console.log(`Bucket: ${bucket}`);
  console.log(`Prefix: ${prefix}`);
  console.log(`Planned moves (legacy video|photo|gif/<tier>/ → /<tier>/): ${moves.length}`);
  for (const { src, dst } of moves) {
    console.log(`  COPY ${src}`);
    console.log(`    → ${dst}`);
  }

  if (!execute) {
    console.log('\nDry run only. Re-run with --execute to copy + delete sources.');
    return;
  }

  for (const { src, dst } of moves) {
    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: copySourceHeader(bucket, src),
        Key: dst,
      }),
    );
    await client.send(
      DeleteObjectCommand({
        Bucket: bucket,
        Key: src,
      }),
    );
    console.log(`OK ${src} → ${dst}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
