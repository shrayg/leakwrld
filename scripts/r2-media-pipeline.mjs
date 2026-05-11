#!/usr/bin/env node
/**
 * Full R2 media pipeline (no pre-existing rclone.conf required):
 *
 *  1. Rename legacy `videos/<Title Case>/` prefixes → `videos/<slug>/` via R2 S3 API.
 *  2. Inject `RCLONE_CONFIG_R2_*` so rclone can list the bucket.
 *  3. `npm run media:sync` — rebuild manifests + media-summary JSON.
 *  4. `npm run thumbs:gen` — thumbnails into client/public/thumbnails.
 *  5. `npm run r2:count` — refresh data/r2-stats.json (optional).
 *
 * Requires in `.env` (see `env.r2.example`):
 *   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID
 *   (or RCLONE_* equivalents + endpoint)
 *
 * Usage:
 *   node scripts/r2-media-pipeline.mjs
 *   node scripts/r2-media-pipeline.mjs --dry-run
 *   node scripts/r2-media-pipeline.mjs --skip-rename
 *   node scripts/r2-media-pipeline.mjs --skip-thumbs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

/** Legacy dashboard folder name → canonical slug under videos/ */
const PREFIX_RENAMES = [
  { from: 'Alice Rosenblum', to: 'alice-rosenblum' },
  { from: 'Jameliz', to: 'jameliz' },
  { from: 'Julia Filippo', to: 'julia-filippo' },
  { from: 'Katiana Kay', to: 'katiana-kay' },
  { from: 'Kira Pregiato', to: 'kira-pregiato' },
  { from: 'Summerxiris', to: 'summerxiris' },
  { from: 'Waifumia', to: 'waifumia' },
];

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    skipRename: argv.includes('--skip-rename'),
    skipThumbs: argv.includes('--skip-thumbs'),
    skipCount: argv.includes('--skip-count'),
  };
}

function copySourceHeader(bucket, key) {
  /** x-amz-copy-source: /bucket/key — encode key segments for spaces etc. */
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  return `${bucket}/${encodedKey}`;
}

function getCredentials() {
  loadEnvFile(join(repoRoot, '.env'));

  const accessKey =
    process.env.R2_ACCESS_KEY_ID || process.env.RCLONE_CONFIG_R2_ACCESS_KEY_ID || '';
  const secretKey =
    process.env.R2_SECRET_ACCESS_KEY || process.env.RCLONE_CONFIG_R2_SECRET_ACCESS_KEY || '';
  const accountId = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || '';
  let endpoint =
    process.env.RCLONE_CONFIG_R2_ENDPOINT || process.env.R2_ENDPOINT || '';
  if (!endpoint && accountId) {
    endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  }
  const bucket = process.env.R2_BUCKET || 'leakwrld';

  return { accessKey, secretKey, endpoint, bucket, accountId };
}

function validateCredentials({ accessKey, secretKey, endpoint }) {
  if (!accessKey || !secretKey) {
    console.error(`
[media:pipeline] Missing R2 S3 API credentials.

Cloudflare Dashboard → R2 → Manage R2 API Tokens → Create API token (Object Read & Write).

Add to ${join(repoRoot, '.env')}:

  R2_ACCESS_KEY_ID=<access_key_id>
  R2_SECRET_ACCESS_KEY=<secret_access_key>
  R2_ACCOUNT_ID=<your_account_id>

(Account ID: same as in Wrangler "wrangler whoami", or Cloudflare dashboard URL.)

Alternatively use RCLONE_CONFIG_R2_ACCESS_KEY_ID / RCLONE_CONFIG_R2_SECRET_ACCESS_KEY
plus RCLONE_CONFIG_R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com

See env.r2.example in the repo root.
`);
    process.exit(1);
  }
  if (!endpoint) {
    console.error('[media:pipeline] Set R2_ACCOUNT_ID or RCLONE_CONFIG_R2_ENDPOINT.');
    process.exit(1);
  }
}

function injectRcloneEnv({ accessKey, secretKey, endpoint }) {
  process.env.RCLONE_CONFIG_R2_TYPE = process.env.RCLONE_CONFIG_R2_TYPE || 's3';
  process.env.RCLONE_CONFIG_R2_PROVIDER = process.env.RCLONE_CONFIG_R2_PROVIDER || 'Cloudflare';
  process.env.RCLONE_CONFIG_R2_ACCESS_KEY_ID = accessKey;
  process.env.RCLONE_CONFIG_R2_SECRET_ACCESS_KEY = secretKey;
  process.env.RCLONE_CONFIG_R2_ENDPOINT = endpoint;
}

async function prefixHasObjects(client, bucket, prefix) {
  const r = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1 }),
  );
  return (r.KeyCount || 0) > 0;
}

async function moveVideoPrefix(client, bucket, fromFolder, toSlug, dryRun) {
  const fromPrefix = `videos/${fromFolder}/`;
  const toPrefix = `videos/${toSlug}/`;

  if (!(await prefixHasObjects(client, bucket, fromPrefix))) {
    console.log(`  skip  ${fromFolder} → ${toSlug}  (no objects under ${fromPrefix})`);
    return;
  }

  const keysToDelete = [];
  let copied = 0;
  let continuationToken;

  do {
    const listResp = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: fromPrefix,
        ContinuationToken: continuationToken,
      }),
    );
    const contents = listResp.Contents || [];

    for (const obj of contents) {
      const oldKey = obj.Key;
      if (!oldKey || !oldKey.startsWith(fromPrefix)) continue;
      const relative = oldKey.slice(fromPrefix.length);
      const newKey = toPrefix + relative;

      if (dryRun) {
        copied += 1;
        keysToDelete.push(oldKey);
        continue;
      }

      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: copySourceHeader(bucket, oldKey),
          Key: newKey,
        }),
      );
      copied += 1;
      keysToDelete.push(oldKey);
    }

    continuationToken = listResp.IsTruncated ? listResp.NextContinuationToken : undefined;
  } while (continuationToken);

  if (dryRun) {
    console.log(`  [dry-run] would move ${copied} objects: ${fromFolder}/ → ${toSlug}/`);
    return;
  }

  for (let i = 0; i < keysToDelete.length; i += 1000) {
    const batch = keysToDelete.slice(i, i + 1000);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  }

  console.log(`  ok    moved ${copied} objects: ${fromFolder}/ → ${toSlug}/`);
}

function runNpmScript(script) {
  const r = spawnSync('npm', ['run', script], {
    cwd: repoRoot,
    env: { ...process.env },
    stdio: 'inherit',
    shell: true,
  });
  if (r.status !== 0) {
    console.error(`[media:pipeline] "${script}" failed with exit ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cred = getCredentials();
  validateCredentials(cred);
  injectRcloneEnv(cred);

  const client = new S3Client({
    region: 'auto',
    endpoint: cred.endpoint,
    credentials: {
      accessKeyId: cred.accessKey,
      secretAccessKey: cred.secretKey,
    },
  });

  console.log(`Bucket:   ${cred.bucket}`);
  console.log(`Endpoint: ${cred.endpoint}`);
  console.log('');

  if (!args.skipRename) {
    console.log('=== Rename legacy video prefixes (S3 API) ===');
    for (const { from, to } of PREFIX_RENAMES) {
      await moveVideoPrefix(client, cred.bucket, from, to, args.dryRun);
    }
    console.log('');
    if (args.dryRun) {
      console.log('Dry run only — no copies/deletes. Re-run without --dry-run after review.\n');
      process.exit(0);
    }
  }

  console.log('=== media:sync (rclone + manifests) ===');
  runNpmScript('media:sync');

  if (!args.skipThumbs) {
    console.log('\n=== thumbs:gen ===');
    runNpmScript('thumbs:gen');
  }

  if (!args.skipCount) {
    console.log('\n=== r2:count ===');
    runNpmScript('r2:count');
  }

  console.log('\n=== Done ===');
  console.log('Commit updated JSON/thumbnails, then npm run build && deploy.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
