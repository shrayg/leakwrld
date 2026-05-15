#!/usr/bin/env node
/**
 * Build per-creator media manifests by listing R2 contents.
 *
 * For each creator slug (from server/catalog.js), walks
 *   videos/<slug>/{free,tier1,tier2,tier3}/...
 * and writes:
 *   client/public/media/<slug>.json     -- shipped to the browser
 *   data/media-summary.json             -- aggregated counts (used by server)
 *
 * Listing uses the R2 S3 API (paginated ListObjectsV2) — much faster than
 * rclone lsl on large vaults (e.g. thousands of objects per creator).
 *
 * Usage:
 *   node scripts/r2-build-media-manifests.mjs                 # all creators in catalog
 *   node scripts/r2-build-media-manifests.mjs --slug=amouranth  # one creator
 *   node scripts/r2-build-media-manifests.mjs --include-empty  # also write empty manifests
 *
 * Requires in `.env`: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

const require = createRequire(import.meta.url);
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { creators } = require(join(repoRoot, 'server', 'catalog.js'));

const args = parseArgs(process.argv.slice(2));

const TIERS = ['free', 'tier1', 'tier2', 'tier3'];
const TIER_SET = new Set(TIERS);
const OUT_DIR = join(repoRoot, 'client', 'public', 'media');
const SUMMARY_PATH = join(repoRoot, 'data', 'media-summary.json');
const CLIENT_SUMMARY_PATH = join(repoRoot, 'client', 'src', 'data', 'media-summary.json');

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v']);

function loadLocalEnv(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] != null) continue;
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      const ci = value.search(/\s#/);
      if (ci >= 0) value = value.slice(0, ci).trim();
      process.env[key] = value;
    }
  } catch {
    /* optional */
  }
}

function getR2Config() {
  const accessKey = String(process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const accountId = String(process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const endpoint = String(process.env.R2_ENDPOINT || process.env.RCLONE_CONFIG_R2_ENDPOINT || '').trim()
    || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
  const bucket = String(process.env.R2_BUCKET || 'leakwrld').trim();
  return { accessKey, secretKey, endpoint, bucket };
}

function parseArgs(argv) {
  const out = { slug: null, includeEmpty: false };
  for (const a of argv) {
    if (a === '--include-empty') out.includeEmpty = true;
    else if (a.startsWith('--slug=')) out.slug = a.slice(7);
  }
  return out;
}

function getExt(name) {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

function classifyKind(name) {
  const ext = getExt(name);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return 'other';
}

function emptyTier() {
  return { count: 0, bytes: 0 };
}

/**
 * List all objects under videos/<slug>/ via S3 API (paginated).
 * @param {import('@aws-sdk/client-s3').S3Client} client
 */
async function listCreatorObjects(client, bucket, slug, onProgress) {
  const prefix = `videos/${slug}/`;
  const out = [];
  let token;
  let pages = 0;
  do {
    const r = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    for (const o of r.Contents || []) {
      if (!o.Key || o.Key.endsWith('/')) continue;
      out.push({ key: o.Key, sizeBytes: Number(o.Size || 0) });
    }
    pages += 1;
    if (onProgress) onProgress(pages, out.length);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

/** @returns {{ tier: string, name: string } | null} */
function parseTierAndName(slug, objectKey) {
  const base = `videos/${slug}/`;
  if (!objectKey.startsWith(base)) return null;
  const rel = objectKey.slice(base.length);
  const slash = rel.indexOf('/');
  if (slash <= 0) return null;
  const tier = rel.slice(0, slash);
  const name = rel.slice(slash + 1);
  if (!TIER_SET.has(tier) || !name) return null;
  return { tier, name };
}

async function buildManifestFor(client, bucket, creator) {
  const items = [];
  const totals = { count: 0, bytes: 0, byTier: { free: emptyTier(), tier1: emptyTier(), tier2: emptyTier(), tier3: emptyTier() } };
  let realObjects = 0;
  let listMs = 0;

  const listT0 = Date.now();
  let lastLog = 0;
  const listed = await listCreatorObjects(client, bucket, creator.slug, (pages, n) => {
    const now = Date.now();
    if (now - lastLog >= 2500 || pages === 1) {
      lastLog = now;
      process.stdout.write(`\r  ${creator.slug.padEnd(20)} listing… ${n} objects (${pages} page(s))   `);
    }
  });
  listMs = Date.now() - listT0;
  if (listed.length > 0) process.stdout.write('\n');

  for (const obj of listed) {
    const parsed = parseTierAndName(creator.slug, obj.key);
    if (!parsed) continue;
    const { tier, name } = parsed;
    if (name === '.keep' || name.endsWith('/.keep')) continue;
    const ext = getExt(name);
    const kind = classifyKind(name);
    items.push({
      tier,
      name,
      key: obj.key,
      sizeBytes: obj.sizeBytes,
      ext,
      kind,
    });
    totals.byTier[tier].count += 1;
    totals.byTier[tier].bytes += obj.sizeBytes;
    totals.count += 1;
    totals.bytes += obj.sizeBytes;
    realObjects += 1;
  }

  return { items, totals, realObjects, listMs };
}

function shuffleStable(arr, seed) {
  const out = arr.slice();
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (Math.imul(s, 0x5bd1e995) ^ (s >>> 15)) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return h >>> 0;
}

async function main() {
  loadLocalEnv(join(repoRoot, '.env'));
  const { accessKey, secretKey, endpoint, bucket } = getR2Config();
  if (!accessKey || !secretKey || !endpoint) {
    console.error(
      '[media:sync] Missing R2 credentials. Add to .env: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID',
    );
    process.exit(1);
  }

  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });

  const targets = args.slug ? creators.filter((c) => c.slug === args.slug) : creators;
  if (targets.length === 0) {
    console.error(`No creators matched ${args.slug ? `slug=${args.slug}` : '(empty)'}`);
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(dirname(SUMMARY_PATH), { recursive: true });

  console.log(`Building media manifests for ${targets.length} creator(s) (R2 S3 list, bucket=${bucket})`);
  console.log(`Output:  ${OUT_DIR}`);
  console.log(`Summary: ${SUMMARY_PATH}`);
  console.log('');

  const summaryEntries = [];
  let totalManifests = 0;
  let totalSkipped = 0;

  for (const creator of targets) {
    const t0 = Date.now();
    const built = await buildManifestFor(client, bucket, creator);
    const sec = ((Date.now() - t0) / 1000).toFixed(1);

    if (built.realObjects === 0 && !args.includeEmpty) {
      console.log(
        `  ${creator.slug.padEnd(20)} skip  (no media under videos/${creator.slug}/{{free..tier3}}) in ${sec}s`,
      );
      totalSkipped += 1;
      continue;
    }

    const seed = djb2(creator.slug);
    const itemsByTier = TIERS.reduce((acc, tier) => {
      acc[tier] = shuffleStable(built.items.filter((it) => it.tier === tier), seed);
      return acc;
    }, {});
    const orderedItems = TIERS.flatMap((t) => itemsByTier[t]);

    const manifest = {
      slug: creator.slug,
      name: creator.name,
      rank: creator.rank,
      generatedAt: new Date().toISOString(),
      totals: built.totals,
      items: orderedItems,
    };

    const outPath = join(OUT_DIR, `${creator.slug}.json`);
    writeFileSync(outPath, JSON.stringify(manifest));
    totalManifests += 1;

    summaryEntries.push({
      slug: creator.slug,
      name: creator.name,
      rank: creator.rank,
      count: built.totals.count,
      bytes: built.totals.bytes,
      byTier: built.totals.byTier,
    });

    const sizeKb = (JSON.stringify(manifest).length / 1024).toFixed(1);
    const listSec = (built.listMs / 1000).toFixed(1);
    console.log(
      `  ${creator.slug.padEnd(20)} ok    ${String(built.totals.count).padStart(5)} files  ${(built.totals.bytes / 1024 / 1024).toFixed(1).padStart(8)} MB  manifest=${sizeKb} KB  list=${listSec}s total=${sec}s`,
    );
  }

  summaryEntries.sort((a, b) => a.rank - b.rank);
  const summaryDoc = {
    generatedAt: new Date().toISOString(),
    creators: summaryEntries,
  };
  writeFileSync(SUMMARY_PATH, JSON.stringify(summaryDoc, null, 2) + '\n');

  const clientSummary = summaryEntries.map((e) => ({
    slug: e.slug,
    count: e.count,
    bytes: e.bytes,
    free: e.byTier?.free?.count || 0,
  }));
  writeFileSync(CLIENT_SUMMARY_PATH, JSON.stringify(clientSummary, null, 2) + '\n');

  console.log('');
  console.log('=== Summary ===');
  console.log(`  manifests written: ${totalManifests}`);
  console.log(`  skipped (empty):   ${totalSkipped}`);
  console.log(`  summary:           ${SUMMARY_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
