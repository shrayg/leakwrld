#!/usr/bin/env node
/**
 * Lists R2 buckets and top-level prefixes for migration planning.
 * Loads .env from project root (same keys as server.js).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
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
const configuredBucket =
  process.env.CLOUDFLARE_R2_BUCKET_RAW || process.env.R2_BUCKET || '';

if (!accessKey || !secretKey || !endpoint) {
  console.error('Missing CLOUDFLARE_R2_* / R2_* credentials or endpoint in .env');
  process.exit(1);
}

const client = new S3Client({
  region: 'auto',
  endpoint,
  credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
});

async function listBucketPrefixes(bucket, prefix = '') {
  const prefixes = new Set();
  const keysSample = [];
  let keyCount = 0;
  let ContinuationToken;
  do {
    const out = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        Delimiter: '/',
        ContinuationToken,
        MaxKeys: 1000,
      }),
    );
    for (const cp of out.CommonPrefixes || []) {
      if (cp.Prefix) prefixes.add(cp.Prefix);
    }
    for (const o of out.Contents || []) {
      keyCount++;
      if (o.Key && keysSample.length < 15) keysSample.push(o.Key);
    }
    ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (ContinuationToken);

  return { prefixes: [...prefixes].sort(), keysSample, keyCount };
}

async function main() {
  console.log('Endpoint:', endpoint.replace(/\/\/[^.]+\./, '//***.'));
  console.log('');

  let buckets = [];
  try {
    const lb = await client.send(new ListBucketsCommand({}));
    buckets = (lb.Buckets || [])
      .map((b) => b.Name)
      .filter(Boolean)
      .sort();
  } catch (e) {
    console.warn(
      'ListBuckets failed (token may lack permission):',
      e.message || e,
    );
  }

  if (buckets.length) {
    console.log('Buckets:', buckets.join(', '));
  } else {
    console.log('Buckets: (using configured bucket only)');
  }
  console.log('');

  const toScan = buckets.length
    ? buckets.filter((n) => /pornyard|pornwrld/i.test(String(n)))
    : configuredBucket
      ? [configuredBucket]
      : [];

  if (!toScan.length) {
    console.error('No bucket names to scan (set CLOUDFLARE_R2_BUCKET_RAW or grant ListBuckets).');
    process.exit(1);
  }

  for (const bucket of toScan) {
    console.log('=== Bucket:', bucket, '===');
    const top = await listBucketPrefixes(bucket, '');
    console.log('Top-level prefixes:', top.prefixes.length ? top.prefixes.join('\n  ') : '(none)');
    if (top.keysSample.length) {
      console.log('Sample keys (up to 30 at root):');
      top.keysSample.forEach((k) => console.log(' ', k));
    }

    // Second level under common roots
    for (const p of top.prefixes.slice(0, 8)) {
      const sub = await listBucketPrefixes(bucket, p);
      if (sub.prefixes.length) {
        console.log('Under', p);
        sub.prefixes.slice(0, 40).forEach((sp) => console.log(' ', sp));
        if (sub.prefixes.length > 40) console.log('  ...', sub.prefixes.length - 40, 'more');
      }
    }

    // Canonical app path + legacy roots (migration map source)
    const deepRoots = [
      'pornwrld/videos/',
      'porn/',
      'tier 1/',
      'data/',
    ];
    const extraScans = [
      'porn/omegle/',
      'porn/onlyfans/',
      'tier 1/Omegle/',
      'thumbnails/',
    ];
    for (const root of deepRoots) {
      const sub = await listBucketPrefixes(bucket, root);
      if (!sub.prefixes.length && !sub.keysSample.length) continue;
      console.log('--- Deep:', root, '---');
      sub.prefixes.forEach((sp) => console.log(' ', sp));
      // Third level for videos tree only (categories → tier / layout)
      if (root === 'pornwrld/videos/') {
        for (const cat of sub.prefixes.slice(0, 20)) {
          const d3 = await listBucketPrefixes(bucket, cat);
          console.log(
            '  >>',
            cat,
            `(subfolders=${d3.prefixes.length}, looseKeys~=${d3.keyCount})`,
          );
          d3.prefixes.slice(0, 40).forEach((x) => console.log('    ', x));
          if (d3.prefixes.length > 40) console.log('     ...', d3.prefixes.length - 40, 'more');
          if (d3.keysSample.length) {
            console.log('     sample keys:', d3.keysSample.slice(0, 5).join(' | '));
          }
        }
      }
      console.log('');
    }

    for (const root of extraScans) {
      const sub = await listBucketPrefixes(bucket, root);
      if (!sub.prefixes.length && sub.keyCount === 0) continue;
      console.log('--- Deep:', root, '---');
      console.log('  subfolders:', sub.prefixes.length, 'keyCount~:', sub.keyCount);
      sub.prefixes.slice(0, 30).forEach((sp) => console.log(' ', sp));
      if (sub.keysSample.length) {
        console.log('  sample keys:', sub.keysSample.join(' | '));
      }
      console.log('');
    }
    console.log('');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
