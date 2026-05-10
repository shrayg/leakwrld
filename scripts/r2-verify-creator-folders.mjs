#!/usr/bin/env node
/**
 * Verifies every creator slug from server/catalog.js has a videos/<slug>/.keep
 * object in the R2 bucket. Reports counts and any missing slugs.
 *
 * Usage:
 *   npm run r2:verify
 *   node scripts/r2-verify-creator-folders.mjs [--bucket leakwrld] [--prefix videos] [--parallel 8]
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { creators } = require('../server/catalog.js');

function parseArgs(argv) {
  const out = { bucket: 'leakwrld', prefix: 'videos', parallel: 8 };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--bucket') out.bucket = argv[++i];
    else if (arg === '--prefix') out.prefix = argv[++i];
    else if (arg === '--parallel') out.parallel = Math.max(1, Number(argv[++i]) || 8);
  }
  return out;
}

const args = parseArgs(process.argv);
const slugs = creators.map((c) => c.slug);

console.log(`Bucket:    ${args.bucket}`);
console.log(`Prefix:    ${args.prefix}/`);
console.log(`Creators:  ${slugs.length}`);
console.log(`Parallel:  ${args.parallel}`);
console.log('');

const tmp = mkdtempSync(join(tmpdir(), 'r2-verify-'));

function checkOne(slug) {
  const key = `${args.prefix}/${slug}/.keep`;
  const out = join(tmp, `${slug}.bin`);
  return new Promise((resolve) => {
    const proc = spawn(
      'npx',
      ['--yes', 'wrangler', 'r2', 'object', 'get', `${args.bucket}/${key}`, '--file', out, '--remote'],
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
      const tail = r.code === 0 ? '' : ` :: ${r.stderr.split('\n').slice(-2).join(' | ').trim()}`;
      console.log(`[${results.length.toString().padStart(3)}/${items.length}] ${status} ${r.key}${tail}`);
    }
  }
  return results;
}

const start = Date.now();
const results = await runBatched(slugs, args.parallel, checkOne);
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

const ok = results.filter((r) => r.code === 0).length;
const missing = results.filter((r) => r.code !== 0);

console.log('');
console.log(`Verified in ${elapsed}s -- ${ok} present, ${missing.length} missing`);

rmSync(tmp, { recursive: true, force: true });

if (missing.length) {
  console.log('');
  console.log('Missing slugs:');
  for (const m of missing) console.log(`  ${m.slug}`);
  process.exit(1);
}
