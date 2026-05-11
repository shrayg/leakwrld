#!/usr/bin/env node
/**
 * Creates a placeholder object at videos/<creator-slug>/.keep for every creator
 * in server/catalog.js. R2 has no real folders -- a placeholder object is what
 * makes a "folder" appear in the dashboard UI.
 *
 * Usage:
 *   npx wrangler login            (one-time, interactive OAuth in browser)
 *   node scripts/r2-create-creator-folders.mjs [--bucket leakwrld] [--prefix videos] [--parallel 8]
 *
 * Or via package.json:
 *   npm run r2:create-folders
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { creators, r2VideoFolderSegment } = require('../server/catalog.js');

function parseArgs(argv) {
  const out = { bucket: 'leakwrld', prefix: 'videos', parallel: 8, dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--bucket') out.bucket = argv[++i];
    else if (arg === '--prefix') out.prefix = argv[++i];
    else if (arg === '--parallel') out.parallel = Math.max(1, Number(argv[++i]) || 8);
    else if (arg === '--dry-run') out.dryRun = true;
  }
  return out;
}

const args = parseArgs(process.argv);
const slugs = creators.map((c) => c.slug);

console.log(`Bucket:    ${args.bucket}`);
console.log(`Prefix:    ${args.prefix}/`);
console.log(`Creators:  ${slugs.length}`);
console.log(`Parallel:  ${args.parallel}`);
console.log(`Dry run:   ${args.dryRun}`);
console.log('');

if (args.dryRun) {
  for (const slug of slugs) {
    const folder = r2VideoFolderSegment(slug);
    console.log(`would PUT ${args.bucket}/${args.prefix}/${folder}/.keep`);
  }
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), 'r2-keep-'));
const placeholder = join(tmp, '.keep');
writeFileSync(placeholder, '');

function runWrangler(slug) {
  const folder = r2VideoFolderSegment(slug);
  const key = `${args.prefix}/${folder}/.keep`;
  return new Promise((resolve) => {
    const proc = spawn(
      'npx',
      ['--yes', 'wrangler', 'r2', 'object', 'put', `${args.bucket}/${key}`, '--file', placeholder, '--remote'],
      { shell: true, windowsHide: true },
    );
    let stderr = '';
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('close', (code) => {
      resolve({ slug, key, code: code ?? 1, stderr });
    });
  });
}

async function runBatched(items, size, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    const settled = await Promise.all(batch.map(fn));
    for (const r of settled) {
      results.push(r);
      const status = r.code === 0 ? 'ok ' : 'FAIL';
      const tail = r.code === 0 ? '' : ` :: ${r.stderr.split('\n').slice(-3).join(' | ').trim()}`;
      console.log(`[${results.length.toString().padStart(3)}/${items.length}] ${status} ${r.key}${tail}`);
    }
  }
  return results;
}

const start = Date.now();
const results = await runBatched(slugs, args.parallel, runWrangler);
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

const success = results.filter((r) => r.code === 0).length;
const failed = results.filter((r) => r.code !== 0);

console.log('');
console.log(`Done in ${elapsed}s -- ${success} created, ${failed.length} failed`);

rmSync(tmp, { recursive: true, force: true });

if (failed.length) {
  console.log('');
  console.log('Failed slugs:');
  for (const f of failed) console.log(`  ${f.slug}  ::  ${f.stderr.split('\n').slice(-3).join(' | ').trim()}`);
  process.exit(1);
}
