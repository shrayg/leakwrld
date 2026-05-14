#!/usr/bin/env node
/**
 * Build per-creator media manifests by listing R2 contents.
 *
 * For each creator slug (from server/catalog.js), walks
 *   r2:leakwrld/videos/<slug>/{free,tier1,tier2,tier3}
 * and writes:
 *   client/public/media/<slug>.json     -- shipped to the browser
 *   data/media-summary.json             -- aggregated counts (used by server)
 *
 * Manifest shape:
 *   {
 *     slug, name, generatedAt,
 *     totals: { count, bytes, byTier: { free: {count,bytes}, tier1: {...}, ... } },
 *     items: [
 *       { tier, name, key, sizeBytes, ext, kind: "image"|"video"|"other" },
 *       ...
 *     ]
 *   }
 *
 * Idempotent: skips creators with zero objects (so empty placeholders don't
 * create stub manifests).
 *
 * Usage:
 *   node scripts/r2-build-media-manifests.mjs                 # all creators in catalog
 *   node scripts/r2-build-media-manifests.mjs --slug=amouranth  # one creator
 *   node scripts/r2-build-media-manifests.mjs --include-empty  # also write empty manifests
 *
 * R2 access: loads `.env` from repo root and sets `RCLONE_CONFIG_R2_*` from
 * `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID` when needed (same as media pipeline).
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

const require = createRequire(import.meta.url);
const { creators } = require(join(repoRoot, 'server', 'catalog.js'));

const args = parseArgs(process.argv.slice(2));

const REMOTE = 'r2:leakwrld/videos';
const TIERS = ['free', 'tier1', 'tier2', 'tier3'];
const OUT_DIR = join(repoRoot, 'client', 'public', 'media');
const SUMMARY_PATH = join(repoRoot, 'data', 'media-summary.json');
const CLIENT_SUMMARY_PATH = join(repoRoot, 'client', 'src', 'data', 'media-summary.json');

let rcloneListErrorLogged = false;

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
      process.env[key] = value;
    }
  } catch {
    /* optional */
  }
}

function ensureRcloneEnvFromR2() {
  if (String(process.env.RCLONE_CONFIG_R2_ACCESS_KEY_ID || '').trim()) return;
  const accessKey = String(process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const accountId = String(process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const endpoint = String(
    process.env.RCLONE_CONFIG_R2_ENDPOINT || process.env.R2_ENDPOINT || '',
  ).trim() || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
  if (!accessKey || !secretKey || !endpoint) return;
  process.env.RCLONE_CONFIG_R2_TYPE = process.env.RCLONE_CONFIG_R2_TYPE || 's3';
  process.env.RCLONE_CONFIG_R2_PROVIDER = process.env.RCLONE_CONFIG_R2_PROVIDER || 'Cloudflare';
  process.env.RCLONE_CONFIG_R2_ACCESS_KEY_ID = accessKey;
  process.env.RCLONE_CONFIG_R2_SECRET_ACCESS_KEY = secretKey;
  process.env.RCLONE_CONFIG_R2_ENDPOINT = endpoint;
}

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v']);

function parseArgs(argv) {
  const out = { slug: null, includeEmpty: false };
  for (const a of argv) {
    if (a === '--include-empty') out.includeEmpty = true;
    else if (a.startsWith('--slug=')) out.slug = a.slice(7);
  }
  return out;
}

function rcloneListWithSize(prefix) {
  const r = spawnSync('rclone', ['lsl', `${REMOTE}/${prefix}`], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) {
    if (!rcloneListErrorLogged) {
      rcloneListErrorLogged = true;
      const err = String(r.stderr || r.stdout || '').trim().slice(0, 500);
      const sig = r.error ? r.error.message : `exit ${r.status}`;
      console.error(
        `[media:sync] rclone lsl failed (${sig}). Install rclone on PATH, and set R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY + R2_ACCOUNT_ID in .env (or RCLONE_CONFIG_R2_*). stderr: ${err || '(empty)'}`,
      );
    }
    return [];
  }
  /** rclone lsl format: "    <size> YYYY-MM-DD HH:MM:SS.fff <name>" */
  return r.stdout
    .split(/\r?\n/)
    .map((line) => {
      const m = /^\s*(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+(.+)$/.exec(line);
      if (!m) return null;
      return { sizeBytes: Number(m[1]), name: m[2] };
    })
    .filter(Boolean);
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

function buildManifestFor(creator) {
  const items = [];
  const totals = { count: 0, bytes: 0, byTier: { free: emptyTier(), tier1: emptyTier(), tier2: emptyTier(), tier3: emptyTier() } };
  let realObjects = 0;

  for (const tier of TIERS) {
    const listed = rcloneListWithSize(`${creator.slug}/${tier}`);
    for (const obj of listed) {
      /** Skip the .keep placeholder objects that mark empty folders. */
      if (obj.name === '.keep' || obj.name.endsWith('/.keep')) continue;
      const ext = getExt(obj.name);
      const kind = classifyKind(obj.name);
      const item = {
        tier,
        name: obj.name,
        key: `videos/${creator.slug}/${tier}/${obj.name}`,
        sizeBytes: obj.sizeBytes,
        ext,
        kind,
      };
      items.push(item);
      totals.byTier[tier].count += 1;
      totals.byTier[tier].bytes += obj.sizeBytes;
      totals.count += 1;
      totals.bytes += obj.sizeBytes;
      realObjects += 1;
    }
  }

  return { items, totals, realObjects };
}

function shuffleStable(arr, seed) {
  /** Deterministic shuffle so re-runs produce identical manifests (good for diffing). */
  const out = arr.slice();
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
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
  ensureRcloneEnvFromR2();
  if (!String(process.env.RCLONE_CONFIG_R2_ACCESS_KEY_ID || '').trim()) {
    console.error(
      '[media:sync] Missing R2 credentials. Add to .env: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID (or set RCLONE_CONFIG_R2_*). Repo .env is loaded automatically.',
    );
    process.exit(1);
  }

  const targets = args.slug ? creators.filter((c) => c.slug === args.slug) : creators;
  if (targets.length === 0) {
    console.error(`No creators matched ${args.slug ? `slug=${args.slug}` : '(empty)'}`);
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(dirname(SUMMARY_PATH), { recursive: true });

  console.log(`Building media manifests for ${targets.length} creator(s)`);
  console.log(`Output:  ${OUT_DIR}`);
  console.log(`Summary: ${SUMMARY_PATH}`);
  console.log('');

  const summaryEntries = [];
  let totalManifests = 0;
  let totalSkipped = 0;

  for (const creator of targets) {
    const t0 = Date.now();
    const built = buildManifestFor(creator);
    const sec = ((Date.now() - t0) / 1000).toFixed(1);

    if (built.realObjects === 0 && !args.includeEmpty) {
      console.log(
        `  ${creator.slug.padEnd(20)} skip  (no media under ${REMOTE}/${creator.slug}/{{free..tier3}} — empty tiers, or rclone could not list; see errors above) in ${sec}s`,
      );
      totalSkipped += 1;
      continue;
    }

    /** Deterministic shuffle within tier so the gallery feels "fresh" without
     *  randomness flipping every page load. */
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
    console.log(`  ${creator.slug.padEnd(20)} ok    ${String(built.totals.count).padStart(5)} files  ${(built.totals.bytes/1024/1024).toFixed(1).padStart(8)} MB  manifest=${sizeKb} KB  in ${sec}s`);
  }

  /** Aggregate summary read by the server to know which creators are "ready". */
  summaryEntries.sort((a, b) => a.rank - b.rank);
  const summaryDoc = {
    generatedAt: new Date().toISOString(),
    creators: summaryEntries,
  };
  writeFileSync(SUMMARY_PATH, JSON.stringify(summaryDoc, null, 2) + '\n');

  /** Lean version bundled into the client (catalog uses it to mark creators
   *  as ready and to expose real counts). Drop the per-tier breakdown to keep
   *  the bundle small. */
  const clientSummary = summaryEntries.map((e) => ({
    slug: e.slug,
    count: e.count,
    bytes: e.bytes,
    free: e.byTier?.free?.count || 0,
  }));
  writeFileSync(CLIENT_SUMMARY_PATH, JSON.stringify(clientSummary, null, 2) + '\n');

  console.log('');
  console.log(`=== Summary ===`);
  console.log(`  manifests written: ${totalManifests}`);
  console.log(`  skipped (empty):   ${totalSkipped}`);
  console.log(`  summary:           ${SUMMARY_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
