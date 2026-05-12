#!/usr/bin/env node
/**
 * Convert creator thumbnails in client/public/thumbnails from JPG/JPEG to WebP.
 * Deletes originals after success. Updates _manifest.json "file" entries.
 *
 *   node scripts/convert-public-thumbnails-to-webp.mjs
 *   node scripts/convert-public-thumbnails-to-webp.mjs --force
 *   node scripts/convert-public-thumbnails-to-webp.mjs --dry-run
 *
 * Requires: sharp (npm i). No R2, ffmpeg, or rclone.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.join(process.cwd(), 'client', 'public', 'thumbnails');
const MANIFEST = path.join(ROOT, '_manifest.json');

function parseArgs(argv) {
  let force = false;
  let dryRun = false;
  for (const a of argv) {
    if (a === '--force') force = true;
    if (a === '--dry-run') dryRun = true;
  }
  return { force, dryRun };
}

async function main() {
  const { force, dryRun } = parseArgs(process.argv.slice(2));

  let sharp;
  try {
    ({ default: sharp } = await import('sharp'));
  } catch {
    console.error('[thumbs:convert] Install sharp: npm install sharp --save-dev');
    process.exit(1);
  }

  let entries;
  try {
    entries = await fs.readdir(ROOT, { withFileTypes: true });
  } catch (e) {
    console.error('[thumbs:convert] Cannot read', ROOT, e.message);
    process.exit(1);
  }

  const jpgs = entries
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((name) => /\.jpe?g$/i.test(name));

  if (jpgs.length === 0) {
    console.log('[thumbs:convert] No .jpg/.jpeg files in', ROOT);
    await patchManifest({ dryRun });
    return;
  }

  console.log(`[thumbs:convert] Found ${jpgs.length} JPEG(s) → WebP${dryRun ? ' (dry-run)' : ''}`);

  for (const name of jpgs) {
    const from = path.join(ROOT, name);
    const base = path.basename(name, path.extname(name));
    const to = path.join(ROOT, `${base}.webp`);

    try {
      const webpExists = await fileExists(to);
      if (webpExists && !force) {
        console.log(`[thumbs:convert] Skip ${name} (${base}.webp exists, use --force to overwrite)`);
        continue;
      }
      if (dryRun) {
        console.log(`[thumbs:convert] Would write ${base}.webp from ${name}`);
        continue;
      }
      await sharp(from).webp({ quality: 82, effort: 4 }).toFile(to);
      await fs.unlink(from);
      console.log(`[thumbs:convert] ${name} → ${base}.webp`);
    } catch (e) {
      console.error(`[thumbs:convert] Failed ${name}:`, e.message);
      process.exitCode = 1;
    }
  }

  await patchManifest({ dryRun });
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function patchManifest({ dryRun }) {
  let raw;
  try {
    raw = await fs.readFile(MANIFEST, 'utf8');
  } catch {
    return;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.warn('[thumbs:convert] _manifest.json parse error — skip manifest patch');
    return;
  }
  if (!Array.isArray(data)) return;

  let changed = false;
  for (const row of data) {
    if (!row || typeof row.file !== 'string') continue;
    const lower = row.file.toLowerCase();
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
      row.file = `${path.basename(row.file, path.extname(row.file))}.webp`;
      changed = true;
    }
  }
  if (!changed) return;
  const out = `${JSON.stringify(data, null, 2)}\n`;
  if (dryRun) {
    console.log('[thumbs:convert] Would patch _manifest.json (.jpg → .webp names)');
    return;
  }
  await fs.writeFile(MANIFEST, out, 'utf8');
  console.log('[thumbs:convert] Updated _manifest.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
