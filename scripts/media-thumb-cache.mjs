#!/usr/bin/env node
/**
 * Generate per-video WebP posters under data/thumb-cache/ (or THUMB_CACHE_DIR).
 * Filenames match media analytics ids: `${rowIdFromStorageKey(key)}.webp`
 * so `npm run catalog:rebuild` can set catalog_shorts.thumb_path and feeds stop
 * reusing the same creator thumbnail for every clip.
 *
 * Requires on PATH: rclone, ffmpeg (libwebp in ffmpeg recommended).
 * Requires R2 credentials in `.env` — same as `media:sync`:
 *   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`
 * or explicit `RCLONE_CONFIG_R2_*` (see env.r2.example).
 *
 *   npm run media:thumbs:cache
 *   npm run media:thumbs:cache -- --force
 *   npm run media:thumbs:cache -- --slug=some-creator
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomBytes } from 'crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const { readyCreators } = require('../server/catalog.js');
const { loadMediaManifest, isShortsFeedMedia } = require('../server/catalogRebuildCore.js');
const { rowIdFromStorageKey } = require('../server/mediaAnalytics.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const MEDIA_DIR = path.join(ROOT, 'client', 'public', 'media');
const REMOTE_BASE = String(process.env.R2_MEDIA_REMOTE || 'r2:leakwrld').replace(/\/+$/, '');

function loadLocalEnv(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
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

function parseArgs(argv) {
  let slug = null;
  let force = false;
  for (const a of argv) {
    if (a === '--force') force = true;
    else if (a.startsWith('--slug=')) slug = a.slice(7);
  }
  return { force, slug };
}

function thumbDestPath(cacheDir, storageKey) {
  return path.join(cacheDir, `${rowIdFromStorageKey(storageKey)}.webp`);
}

function ffmpegWebpFromVideo(videoPath, outWebp) {
  const r = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      '2',
      '-i',
      videoPath,
      '-frames:v',
      '1',
      '-vf',
      'scale=480:-1:force_original_aspect_ratio=decrease',
      '-c:v',
      'libwebp',
      '-quality',
      '82',
      outWebp,
    ],
    { encoding: 'utf8' },
  );
  return r.status === 0 && fs.existsSync(outWebp) && fs.statSync(outWebp).size > 32;
}

function ffmpegPngFromVideo(videoPath, outPng) {
  const r = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      '2',
      '-i',
      videoPath,
      '-frames:v',
      '1',
      '-vf',
      'scale=480:-1:force_original_aspect_ratio=decrease',
      outPng,
    ],
    { encoding: 'utf8' },
  );
  return r.status === 0 && fs.existsSync(outPng) && fs.statSync(outPng).size > 32;
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

async function main() {
  loadLocalEnv(path.join(ROOT, '.env'));
  ensureRcloneEnvFromR2();
  const { force, slug } = parseArgs(process.argv.slice(2));

  if (!process.env.RCLONE_CONFIG_R2_ACCESS_KEY_ID) {
    console.error(
      '[media:thumbs:cache] Set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID (or RCLONE_CONFIG_R2_*) in .env — same as media:sync.',
    );
    process.exit(1);
  }

  const cacheDir = process.env.THUMB_CACHE_DIR
    ? path.resolve(String(process.env.THUMB_CACHE_DIR))
    : path.join(ROOT, 'data', 'thumb-cache');
  fs.mkdirSync(cacheDir, { recursive: true });

  const creators = slug ? readyCreators.filter((c) => c.slug === slug) : readyCreators;
  if (slug && !creators.length) {
    console.error(`[media:thumbs:cache] Unknown slug: ${slug}`);
    process.exit(1);
  }

  const keys = [];
  for (const c of creators) {
    const m = loadMediaManifest(MEDIA_DIR, c.slug);
    if (!m?.items) continue;
    for (const item of m.items) {
      if (!isShortsFeedMedia(item) || !item.key) continue;
      keys.push(item.key);
    }
  }

  const unique = [...new Set(keys)];
  const total = unique.length;
  console.log(`[media:thumbs:cache] ${total} media object(s) → ${cacheDir}`);
  console.log(
    '[media:thumbs:cache] Progress prints every 25 items (and first/last). Failures log immediately. Large files can take minutes each.',
  );

  let ok = 0;
  let skip = 0;
  let fail = 0;
  const t0 = Date.now();
  let idx = 0;

  for (const key of unique) {
    idx += 1;
    if (idx === 1 || idx % 25 === 0 || idx === total) {
      const elapsedSec = Math.round((Date.now() - t0) / 1000);
      console.log(
        `[media:thumbs:cache] ${idx}/${total} wrote=${ok} skipped=${skip} failed=${fail} (${elapsedSec}s)`,
      );
    }
    const dest = thumbDestPath(cacheDir, key);
    if (!force && fs.existsSync(dest) && fs.statSync(dest).size > 32) {
      skip += 1;
      continue;
    }

    const tmpBase = path.join(os.tmpdir(), `lw-vthumb-${randomBytes(8).toString('hex')}`);
    const tmpVideo = `${tmpBase}-src`;
    const tmpPng = `${tmpBase}.png`;
    let success = false;

    try {
      const rclone = spawnSync('rclone', ['copyto', `${REMOTE_BASE}/${key}`, tmpVideo], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      });
      if (rclone.status !== 0 || !fs.existsSync(tmpVideo)) {
        console.warn(`[media:thumbs:cache] rclone failed (${rclone.status}): ${key.slice(0, 80)}`);
        fail += 1;
        continue;
      }

      let wrote = ffmpegWebpFromVideo(tmpVideo, dest);
      if (!wrote) {
        if (ffmpegPngFromVideo(tmpVideo, tmpPng)) {
          await sharp(tmpPng).webp({ quality: 82 }).toFile(dest);
          wrote = fs.existsSync(dest) && fs.statSync(dest).size > 32;
        }
      }

      if (!wrote) {
        console.warn(`[media:thumbs:cache] ffmpeg/sharp failed: ${key.slice(0, 80)}`);
        fail += 1;
      } else {
        ok += 1;
        success = true;
      }
    } catch (e) {
      console.warn(`[media:thumbs:cache] ${key.slice(0, 80)}:`, e.message || e);
      fail += 1;
    } finally {
      for (const p of [tmpVideo, tmpPng]) {
        try {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch {
          /* ignore */
        }
      }
      if (!success) {
        try {
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
        } catch {
          /* ignore */
        }
      }
    }
  }

  console.log(`[media:thumbs:cache] done wrote=${ok} skipped=${skip} failed=${fail}`);
  if (ok > 0 || fail > 0) {
    console.log('[media:thumbs:cache] Run: npm run catalog:rebuild   (or --force if manifests unchanged)');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
