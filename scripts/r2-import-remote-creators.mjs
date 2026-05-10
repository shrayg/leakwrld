#!/usr/bin/env node
/**
 * List top-level creator folders under `r2:leakwrld/videos/` and merge any new
 * slugs into `client/src/data/extra-creators.json` so they participate in the catalog,
 * `npm run media:sync`, and `npm run thumbs:gen`.
 *
 * Requires **rclone** configured for `r2:leakwrld` (same as other R2 scripts).
 *
 * Usage:
 *   node scripts/r2-import-remote-creators.mjs
 *   node scripts/r2-import-remote-creators.mjs --dry-run
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const { creatorNames, slugify } = require(join(repoRoot, 'server', 'catalog.js'));

const EXTRA_PATH = join(repoRoot, 'client', 'src', 'data', 'extra-creators.json');
const REMOTE = 'r2:leakwrld/videos';

function parseArgs(argv) {
  return { dryRun: argv.includes('--dry-run') };
}

function titleCaseFromSlug(slug) {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .trim();
}

function rcloneListTopLevelSlugs() {
  const r = spawnSync('rclone', ['lsf', REMOTE, '--dirs-only'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
  });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || '').trim();
    throw new Error(
      `rclone lsf failed (${r.status}). Install rclone and configure r2:leakwrld.\n${err.slice(-800)}`,
    );
  }
  const slugs = (r.stdout || '')
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/\/+$/, ''))
    .filter((s) => /^[a-z0-9-]+$/.test(s));
  return [...new Set(slugs)].sort();
}

function loadExtraFile() {
  try {
    const raw = readFileSync(EXTRA_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseSlugs = new Set(creatorNames.map((n) => slugify(n)));
  const remoteSlugs = rcloneListTopLevelSlugs();

  const existing = loadExtraFile();
  const bySlug = new Map();
  for (const e of existing) {
    if (e && typeof e.slug === 'string' && typeof e.name === 'string') {
      bySlug.set(e.slug, { slug: e.slug, name: e.name.trim() });
    }
  }

  const known = new Set([...baseSlugs, ...bySlug.keys()]);
  const additions = [];
  for (const slug of remoteSlugs) {
    if (known.has(slug)) continue;
    additions.push({ slug, name: titleCaseFromSlug(slug) });
    known.add(slug);
  }

  console.log(`Remote prefix: ${REMOTE}`);
  console.log(`Folders found: ${remoteSlugs.length}`);
  console.log(`New slugs to add: ${additions.length}`);
  if (additions.length) {
    for (const a of additions) console.log(`  + ${a.slug}  (${a.name})`);
  }

  if (args.dryRun) {
    console.log('\nDry run — no file written.');
    return;
  }

  if (additions.length === 0) {
    console.log('\nNo changes to client/src/data/extra-creators.json');
    return;
  }

  const merged = [...bySlug.values(), ...additions].sort((a, b) => a.slug.localeCompare(b.slug));
  writeFileSync(EXTRA_PATH, JSON.stringify(merged, null, 2) + '\n');
  console.log(`\nWrote ${merged.length} entr(y|ies) → ${EXTRA_PATH}`);
  console.log('Next: npm run media:sync && npm run thumbs:gen');
}

try {
  main();
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
