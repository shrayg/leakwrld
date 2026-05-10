#!/usr/bin/env node
/**
 * Idempotent state-reconciling sync for R2 creator folders.
 *
 * - Reads desired slugs from server/catalog.js
 * - Reads previously-applied slugs from data/.r2-creator-state.json (or seeds via --previous-file)
 * - Computes diff: deletes obsolete videos/<slug>/.keep, creates new ones, leaves overlap untouched
 * - Persists the new state for the next run
 *
 * Usage:
 *   node scripts/r2-sync-creator-folders.mjs              # uses state file
 *   node scripts/r2-sync-creator-folders.mjs --dry-run    # show plan only
 *   node scripts/r2-sync-creator-folders.mjs --previous-file path/to/old-slugs.txt
 *   npm run r2:sync
 *   npm run r2:sync:dry
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { creators } = require('../server/catalog.js');

function parseArgs(argv) {
  const out = {
    bucket: 'leakwrld',
    prefix: 'videos',
    parallel: 8,
    statePath: 'data/.r2-creator-state.json',
    previousSlugs: null,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--bucket') out.bucket = argv[++i];
    else if (arg === '--prefix') out.prefix = argv[++i];
    else if (arg === '--parallel') out.parallel = Math.max(1, Number(argv[++i]) || 8);
    else if (arg === '--state') out.statePath = argv[++i];
    else if (arg === '--previous-slugs') {
      out.previousSlugs = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--previous-file') {
      out.previousSlugs = readFileSync(argv[++i], 'utf8').split(/\s+/).map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--dry-run') out.dryRun = true;
  }
  return out;
}

const args = parseArgs(process.argv);
const newSlugs = new Set(creators.map((c) => c.slug));

let oldSlugs = new Set();
let stateSource = 'empty';
if (args.previousSlugs) {
  oldSlugs = new Set(args.previousSlugs);
  stateSource = `--previous (${oldSlugs.size} entries)`;
} else if (existsSync(args.statePath)) {
  const state = JSON.parse(readFileSync(args.statePath, 'utf8'));
  oldSlugs = new Set(state.slugs || []);
  stateSource = `${args.statePath} (last updated ${state.updatedAt || 'unknown'})`;
}

const toDelete = [...oldSlugs].filter((s) => !newSlugs.has(s)).sort();
const toCreate = [...newSlugs].filter((s) => !oldSlugs.has(s)).sort();
const unchanged = [...newSlugs].filter((s) => oldSlugs.has(s)).sort();

console.log(`Bucket:       ${args.bucket}`);
console.log(`Prefix:       ${args.prefix}/`);
console.log(`State source: ${stateSource}`);
console.log(`Parallel:     ${args.parallel}`);
console.log('');
console.log(`Previous:  ${oldSlugs.size}`);
console.log(`Desired:   ${newSlugs.size}`);
console.log(`Unchanged: ${unchanged.length}`);
console.log(`To delete: ${toDelete.length}`);
console.log(`To create: ${toCreate.length}`);
console.log('');

if (args.dryRun) {
  if (toDelete.length) {
    console.log('Would DELETE:');
    for (const s of toDelete) console.log(`  ${args.prefix}/${s}/.keep`);
    console.log('');
  }
  if (toCreate.length) {
    console.log('Would CREATE:');
    for (const s of toCreate) console.log(`  ${args.prefix}/${s}/.keep`);
    console.log('');
  }
  process.exit(0);
}

if (toDelete.length === 0 && toCreate.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), 'r2-sync-'));
const placeholder = join(tmp, '.keep');
writeFileSync(placeholder, '');

function runWrangler(action, slug) {
  const key = `${args.prefix}/${slug}/.keep`;
  const argv =
    action === 'put'
      ? ['--yes', 'wrangler', 'r2', 'object', 'put', `${args.bucket}/${key}`, '--file', placeholder, '--remote']
      : ['--yes', 'wrangler', 'r2', 'object', 'delete', `${args.bucket}/${key}`, '--remote'];
  return new Promise((resolve) => {
    const proc = spawn('npx', argv, { shell: true, windowsHide: true });
    let stderr = '';
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('close', (code) => {
      const okIfMissing = action === 'delete' && /not found|does not exist|404/i.test(stderr);
      resolve({ action, slug, key, code: code ?? 1, ok: code === 0 || okIfMissing, stderr });
    });
  });
}

async function runBatched(jobs, size) {
  const results = [];
  for (let i = 0; i < jobs.length; i += size) {
    const batch = jobs.slice(i, i + size);
    const settled = await Promise.all(batch.map(({ action, slug }) => runWrangler(action, slug)));
    for (const r of settled) {
      results.push(r);
      const status = r.ok ? 'ok ' : 'FAIL';
      const verb = r.action === 'put' ? 'CREATE' : 'DELETE';
      const tail = r.ok ? '' : ` :: ${r.stderr.split('\n').slice(-2).join(' | ').trim()}`;
      console.log(`[${results.length.toString().padStart(3)}/${jobs.length}] ${status} ${verb} ${r.key}${tail}`);
    }
  }
  return results;
}

const jobs = [
  ...toDelete.map((slug) => ({ action: 'delete', slug })),
  ...toCreate.map((slug) => ({ action: 'put', slug })),
];

const start = Date.now();
const results = await runBatched(jobs, args.parallel);
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

const failed = results.filter((r) => !r.ok);
const ok = results.length - failed.length;

console.log('');
console.log(`Done in ${elapsed}s -- ${ok} succeeded, ${failed.length} failed`);

rmSync(tmp, { recursive: true, force: true });

mkdirSync(dirname(args.statePath), { recursive: true });
writeFileSync(
  args.statePath,
  JSON.stringify(
    {
      bucket: args.bucket,
      prefix: args.prefix,
      slugs: [...newSlugs].sort(),
      updatedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(`State saved: ${args.statePath}`);

if (failed.length) {
  console.log('');
  console.log('Failures:');
  for (const f of failed) {
    console.log(`  ${f.action} ${f.slug}  ::  ${f.stderr.split('\n').slice(-3).join(' | ').trim()}`);
  }
  process.exit(1);
}
