#!/usr/bin/env node
/**
 * Pick one image per creator from R2 (videos/<slug>/free/ first, then tier1/),
 * download it, resize+center-crop to 600x375 (16:10) via ffmpeg (libwebp), and save to
 * client/public/thumbnails/<slug>.webp.
 *
 * Idempotent: skips creators whose thumbnail already exists unless --force is passed.
 *
 * R2 access uses RCLONE_CONFIG_R2_* env vars (see Shell session).
 *
 * Usage:
 *   node scripts/generate-thumbnails.mjs           # only missing
 *   node scripts/generate-thumbnails.mjs --force   # regenerate all
 *   node scripts/generate-thumbnails.mjs --slug=amouranth  # single creator
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

const require = createRequire(import.meta.url);
const { creators } = require(join(repoRoot, 'server', 'catalog.js'));

const args = parseArgs(process.argv.slice(2));

const REMOTE = 'r2:leakwrld/videos';
const OUT_DIR = join(repoRoot, 'client', 'public', 'thumbnails');
const OUT_EXT = '.webp';
const WIDTH = 600;
const HEIGHT = 375;
const TIER_PRIORITY = ['free', 'tier1', 'tier2', 'tier3'];
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v']);

mkdirSync(OUT_DIR, { recursive: true });

function parseArgs(argv) {
  const out = { force: false, slug: null };
  for (const a of argv) {
    if (a === '--force') out.force = true;
    else if (a.startsWith('--slug=')) out.slug = a.slice(7);
  }
  return out;
}

function rcloneList(prefix) {
  const r = spawnSync('rclone', ['lsf', `${REMOTE}/${prefix}`, '--files-only'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
  });
  if (r.status !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Returns [{ name, sizeBytes }] for the prefix. */
function rcloneListWithSize(prefix) {
  const r = spawnSync('rclone', ['lsl', `${REMOTE}/${prefix}`], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
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

function ffprobeDuration(filePath) {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) return null;
  const d = parseFloat(r.stdout.trim());
  return Number.isFinite(d) && d > 0 ? d : null;
}

function getExt(name) {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

function pickThumbnailFile(slug) {
  /** First pass: prefer images. */
  for (const tier of TIER_PRIORITY) {
    const files = rcloneList(`${slug}/${tier}`);
    const images = files.filter((f) => IMAGE_EXTS.has(getExt(f)));
    if (images.length === 0) continue;
    const scored = images.map((name) => {
      const m = name.match(/(\d{3,5})x(\d{3,5})/);
      let score = 0;
      let resolution = null;
      if (m) {
        const w = Number(m[1]);
        const h = Number(m[2]);
        resolution = { w, h };
        const aspect = w / h;
        const targetAspect = WIDTH / HEIGHT;
        const aspectDelta = Math.abs(aspect - targetAspect);
        const minSide = Math.min(w, h);
        score = (minSide >= HEIGHT ? 1000 : minSide) - aspectDelta * 100;
      }
      return { name, score, resolution };
    });
    scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const pick = scored[0];
    return {
      kind: 'image',
      tier,
      file: pick.name,
      resolution: pick.resolution,
      total: images.length,
    };
  }
  /** Fallback: pick a video for keyframe extraction.
   *  Strategy: choose the smallest video that's >= 5 MB to skip tiny teaser/banner clips
   *  that often show title cards instead of real content. Fall back to smallest if all
   *  are tiny. */
  const MIN_REAL_BYTES = 5 * 1024 * 1024;
  for (const tier of TIER_PRIORITY) {
    const items = rcloneListWithSize(`${slug}/${tier}`);
    const videos = items.filter((it) => VIDEO_EXTS.has(getExt(it.name)));
    if (videos.length === 0) continue;
    videos.sort((a, b) => a.sizeBytes - b.sizeBytes || a.name.localeCompare(b.name));
    const realContent = videos.filter((v) => v.sizeBytes >= MIN_REAL_BYTES);
    const pick = realContent.length > 0 ? realContent[0] : videos[0];
    return {
      kind: 'video',
      tier,
      file: pick.name,
      sizeBytes: pick.sizeBytes,
      total: videos.length,
    };
  }
  return null;
}

/** Cover-fit + center-crop to WIDTHxHEIGHT, encode WebP (smaller than JPEG at similar quality). */
const COVER_VF = `scale=if(gt(a\\,${WIDTH}/${HEIGHT})\\,-2\\,${WIDTH}):if(gt(a\\,${WIDTH}/${HEIGHT})\\,${HEIGHT}\\,-2),crop=${WIDTH}:${HEIGHT}`;
/** ffmpeg must be built with libwebp (standard builds include it). */
const WEBP_QUALITY = '82';

function ffmpegResizeImage(inputPath, outputPath) {
  const ffArgs = [
    '-y',
    '-loglevel', 'error',
    '-i', inputPath,
    '-vf', COVER_VF,
    '-c:v', 'libwebp',
    '-quality', WEBP_QUALITY,
    outputPath,
  ];
  const r = spawnSync('ffmpeg', ffArgs, { encoding: 'utf8' });
  if (r.status !== 0) return { ok: false, stderr: r.stderr.slice(-500) };
  return { ok: true };
}

function ffmpegVideoKeyframe(inputPath, outputPath) {
  /** Pick a keyframe ~25% into the video to skip title cards / fades. Falls back to a
   *  fixed 5s offset if duration probe fails. */
  const dur = ffprobeDuration(inputPath);
  const offsetSec = dur ? Math.max(1, Math.min(dur * 0.25, dur - 1)) : 5;
  const ffArgs = [
    '-y',
    '-loglevel', 'error',
    '-ss', String(offsetSec.toFixed(2)),
    '-i', inputPath,
    '-frames:v', '1',
    '-vf', COVER_VF,
    '-c:v', 'libwebp',
    '-quality', WEBP_QUALITY,
    outputPath,
  ];
  const r = spawnSync('ffmpeg', ffArgs, { encoding: 'utf8' });
  if (r.status !== 0 || !existsSync(outputPath)) {
    return { ok: false, stderr: r.stderr.slice(-500) };
  }
  return { ok: true, offsetSec };
}

async function processCreator(creator) {
  const slug = creator.slug;
  const outPath = join(OUT_DIR, `${slug}${OUT_EXT}`);
  const legacyJpg = join(OUT_DIR, `${slug}.jpg`);

  if (!args.force && existsSync(outPath)) {
    return { slug, status: 'exists', size: statSync(outPath).size };
  }

  const pick = pickThumbnailFile(slug);
  if (!pick) {
    return { slug, status: 'no-image' };
  }

  const tmpFile = join(tmpdir(), `lw-thumb-${slug}-${Date.now()}.${pick.file.split('.').pop()}`);
  const dl = spawnSync(
    'rclone',
    ['copyto', `${REMOTE}/${slug}/${pick.tier}/${pick.file}`, tmpFile, '--retries', '2'],
    { encoding: 'utf8' },
  );
  if (dl.status !== 0 || !existsSync(tmpFile)) {
    return { slug, status: 'download-failed', stderr: dl.stderr?.slice(-300) };
  }

  const r = pick.kind === 'video'
    ? ffmpegVideoKeyframe(tmpFile, outPath)
    : ffmpegResizeImage(tmpFile, outPath);
  try { rmSync(tmpFile, { force: true }); } catch {}

  if (!r.ok) {
    return { slug, status: 'ffmpeg-failed', stderr: r.stderr };
  }
  try {
    if (existsSync(legacyJpg)) rmSync(legacyJpg, { force: true });
  } catch {}
  return {
    slug,
    status: 'ok',
    sourceKind: pick.kind,
    source: pick.file,
    sourceTier: pick.tier,
    sourceResolution: pick.resolution,
    sourceSizeBytes: pick.sizeBytes,
    keyframeOffsetSec: r.offsetSec,
    candidates: pick.total,
    size: statSync(outPath).size,
  };
}

async function main() {
  const targets = args.slug ? creators.filter((c) => c.slug === args.slug) : creators;
  if (targets.length === 0) {
    console.error(`No creators matched ${args.slug ? `slug=${args.slug}` : '(empty)'}`);
    process.exit(1);
  }

  console.log(`Generating ${WIDTH}x${HEIGHT} thumbnails for ${targets.length} creator(s)`);
  console.log(`Output: ${OUT_DIR}`);
  console.log(`Force: ${args.force}`);
  console.log('');

  const results = [];
  let ok = 0;
  let failed = 0;
  let exists = 0;

  /** Run with parallelism = 4 (download is I/O-bound, ffmpeg resize is fast for single images). */
  const PARALLEL = 4;
  let next = 0;
  async function worker() {
    while (true) {
      const idx = next++;
      if (idx >= targets.length) return;
      const c = targets[idx];
      const t0 = Date.now();
      const result = await processCreator(c);
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      const tag = `[${String(idx + 1).padStart(2)}/${targets.length}]`;
      results.push(result);
      if (result.status === 'ok') {
        ok++;
        const meta = result.sourceKind === 'video'
          ? `video@${result.keyframeOffsetSec?.toFixed?.(1) ?? '?'}s, ${(result.sourceSizeBytes/1024/1024).toFixed(1)}MB src, ${result.candidates} candidates`
          : `${result.sourceResolution ? `${result.sourceResolution.w}x${result.sourceResolution.h}` : '?'}, ${result.candidates} candidates`;
        console.log(`  ${tag} ${c.slug.padEnd(20)} ok  src=${result.sourceTier}/${result.source} (${meta}) -> ${(result.size/1024).toFixed(1)} KB in ${sec}s`);
      } else if (result.status === 'exists') {
        exists++;
        console.log(`  ${tag} ${c.slug.padEnd(20)} exists  ${(result.size/1024).toFixed(1)} KB (use --force to regenerate)`);
      } else {
        failed++;
        console.log(`  ${tag} ${c.slug.padEnd(20)} FAIL  ${result.status}${result.stderr ? ` -- ${result.stderr.slice(0, 200)}` : ''}`);
      }
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, () => worker()));

  console.log('');
  console.log(`=== Summary ===`);
  console.log(`  ok:     ${ok}`);
  console.log(`  exists: ${exists}`);
  console.log(`  failed: ${failed}`);

  /** Two manifests:
   *   - client/public/thumbnails/_manifest.json: human-readable, served at /thumbnails/_manifest.json
   *   - client/src/data/thumbnails.json: bundled into the client + read by server catalog,
   *     used to gate the thumbnail field on each creator. */
  const dataManifestPath = join(repoRoot, 'client', 'src', 'data', 'thumbnails.json');
  let previousSlugs = [];
  try {
    previousSlugs = JSON.parse(readFileSync(dataManifestPath, 'utf8'));
  } catch {
    previousSlugs = [];
  }
  const batchSlugs = results
    .filter((r) => r.status === 'ok' || r.status === 'exists')
    .map((r) => r.slug);
  const ready = [...new Set([...(Array.isArray(previousSlugs) ? previousSlugs : []), ...batchSlugs])].sort();

  const publicManifest = ready.map((slug) => ({ slug, file: `${slug}${OUT_EXT}` }));
  const publicManifestPath = join(OUT_DIR, '_manifest.json');
  writeFileSync(publicManifestPath, JSON.stringify(publicManifest, null, 2));

  writeFileSync(dataManifestPath, JSON.stringify(ready, null, 2) + '\n');

  console.log(`  manifest: ${ready.length} entries`);
  console.log(`    public: ${publicManifestPath}`);
  console.log(`    data:   ${dataManifestPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
