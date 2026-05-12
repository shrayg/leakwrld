#!/usr/bin/env node
/**
 * Move R2 objects from Title Case / legacy folder names under videos/ to
 * canonical slug prefixes (matches URLs and manifests).
 *
 * Run ONCE after configuring rclone remote `r2:leakwrld`, BEFORE deploying code
 * that assumes slug-only paths (or immediately before pulling latest).
 *
 * Usage:
 *   node scripts/r2-rename-video-prefixes.mjs --dry-run
 *   node scripts/r2-rename-video-prefixes.mjs
 *
 * Env / remote same as media:sync — typically `rclone` remote pointing at bucket leakwrld.
 */

import { spawnSync } from 'node:child_process';

const REMOTE_ROOT = 'r2:leakwrld/videos';

/** Source folder segment exactly as it appears under videos/ in R2 → canonical slug folder name */
const RENAMES = [
  { from: 'Alice Rosenblum', to: 'alice-rosenblum' },
  { from: 'Jameliz', to: 'jameliz' },
  { from: 'Julia Filippo', to: 'julia-filippo' },
  { from: 'Katiana Kay', to: 'katiana-kay' },
  { from: 'Kira Pregiato', to: 'kira-pregiato' },
  { from: 'Summerxiris', to: 'summerxiris' },
  { from: 'Waifumia', to: 'waifumia' },
];

function parseArgs(argv) {
  return { dryRun: argv.includes('--dry-run') };
}

function pathExists(prefix) {
  const r = spawnSync('rclone', ['lsf', prefix, '--max-depth', '1'], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  return r.status === 0;
}

function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));

  console.log(`Remote: ${REMOTE_ROOT}`);
  console.log(`Dry run: ${dryRun}`);
  console.log('');

  for (const { from, to } of RENAMES) {
    const src = `${REMOTE_ROOT}/${from}`;
    const dst = `${REMOTE_ROOT}/${to}`;

    if (!pathExists(src)) {
      console.log(`skip  ${from} → ${to}  (source prefix empty or missing)`);
      continue;
    }

    if (dryRun) {
      console.log(`would rclone move "${src}" "${dst}"`);
      continue;
    }

    console.log(`move  ${from} → ${to}`);
    const r = spawnSync(
      'rclone',
      ['move', src, dst, '--stats', '1s', '--retries', '3'],
      {
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        stdio: ['inherit', 'inherit', 'inherit'],
      },
    );
    if (r.status !== 0) {
      console.error(`FAIL  ${from} → ${to}  (exit ${r.status})`);
      process.exit(r.status ?? 1);
    }
  }

  console.log('');
  console.log('Done. Next: npm run media:sync && npm run thumbs:convert  (then deploy)');
}

main();
