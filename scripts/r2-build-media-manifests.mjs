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
 * R2 access uses RCLONE_CONFIG_R2_* env vars set in your shell session.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

const require = createRequire(import.meta.url);
const { creators, r2VideoFolderSegment } = require(join(repoRoot, 'server', 'catalog.js'));

const args = parseArgs(process.argv.slice(2));

const REMOTE = 'r2:leakwrld/videos';
const TIERS = ['free', 'tier1', 'tier2', 'tier3'];
const OUT_DIR = join(repoRoot, 'client', 'public', 'media');
const SUMMARY_PATH = join(repoRoot, 'data', 'media-summary.json');
const CLIENT_SUMMARY_PATH = join(repoRoot, 'client', 'src', 'data', 'media-summary.json');

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
  if (r.status !== 0) return [];
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
  const folder = r2VideoFolderSegment(creator.slug);

  for (const tier of TIERS) {
    const listed = rcloneListWithSize(`${folder}/${tier}`);
    for (const obj of listed) {
      /** Skip the .keep placeholder objects that mark empty folders. */
      if (obj.name === '.keep' || obj.name.endsWith('/.keep')) continue;
      const ext = getExt(obj.name);
      const kind = classifyKind(obj.name);
      const item = {
        tier,
        name: obj.name,
        key: `videos/${folder}/${tier}/${obj.name}`,
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
      console.log(`  ${creator.slug.padEnd(20)} skip  (no real objects, only .keep) in ${sec}s`);
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
