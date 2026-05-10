#!/usr/bin/env node
/**
 * Count all objects under r2:leakwrld/videos/ and write the result to
 * data/r2-stats.json so the API server can serve the stats without hitting
 * R2 on every request.
 *
 * The displayed "Files in the archive" number multiplies this raw count
 * by FILES_DISPLAY_MULTIPLIER in server.js.
 *
 * Usage:
 *   node scripts/r2-count-objects.mjs
 *
 * R2 access uses RCLONE_CONFIG_R2_* env vars set in your shell session.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const dataDir = join(repoRoot, 'data');
const outPath = join(dataDir, 'r2-stats.json');

const REMOTE_PREFIX = 'r2:leakwrld/videos';

function rcloneSize(prefix) {
  const r = spawnSync('rclone', ['size', prefix, '--json'], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`rclone size failed (${r.status}): ${r.stderr.trim().slice(-400)}`);
  }
  return JSON.parse(r.stdout);
}

console.log(`Scanning ${REMOTE_PREFIX} ...`);
const t0 = Date.now();
const size = rcloneSize(REMOTE_PREFIX);
const elapsedMs = Date.now() - t0;

const payload = {
  remote: REMOTE_PREFIX,
  rawCount: Number(size.count || 0),
  rawBytes: Number(size.bytes || 0),
  scannedAt: new Date().toISOString(),
  scanMs: elapsedMs,
};

mkdirSync(dataDir, { recursive: true });
writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');

console.log('');
console.log(`  count:   ${payload.rawCount.toLocaleString()}`);
console.log(`  bytes:   ${payload.rawBytes.toLocaleString()} (${(payload.rawBytes / 1024 ** 3).toFixed(2)} GB)`);
console.log(`  elapsed: ${(elapsedMs / 1000).toFixed(1)}s`);
console.log(`  wrote:   ${outPath}`);
