#!/usr/bin/env node
// Media folder normalization per Windows file-ops spec.
// Phases: 0 consolidate sources, 1 safety scan, 2 ffmpeg compression,
// 3 optional cap trim, 4 flatten + tier layout, 5 verification report.

import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { cpus } from 'node:os';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';

const DANGEROUS_EXTS = new Set([
  '.exe', '.bat', '.cmd', '.scr', '.com', '.pif', '.vbs', '.vbe',
  '.js', '.jse', '.wsf', '.wsh', '.msi', '.msp', '.hta', '.cpl',
  '.msc', '.reg', '.ps1', '.psm1', '.lnk', '.dll', '.jar',
]);
const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.mov', '.webm', '.avi']);
const TARGET_BYTES = 35 * 1024 * 1024;
const AUDIO_BPS = 96000;
const RESERVED_DIRS = new Set(['_quarantine', '_sort_stage', 'free', 'tier1', 'tier2', 'tier3']);

function parseArgs(argv) {
  const out = {
    root: null,
    sources: [],
    threshold: 40,
    action: 'delete',
    cap: 0,
    seed: 42,
    parallel: 1,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') out.root = argv[++i];
    else if (a === '--sources') out.sources = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--threshold') out.threshold = Number(argv[++i]);
    else if (a === '--action') out.action = argv[++i];
    else if (a === '--cap') out.cap = Number(argv[++i]);
    else if (a === '--seed') out.seed = Number(argv[++i]);
    else if (a === '--parallel') out.parallel = Math.max(1, Number(argv[++i]) || 1);
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else throw new Error('unknown arg: ' + a);
  }
  if (!out.root) throw new Error('--root is required');
  if (!['delete', 'quarantine'].includes(out.action)) throw new Error('--action must be delete|quarantine');
  out.root = resolve(out.root);
  out.sources = out.sources.map(s => resolve(s));
  return out;
}
function printHelp() {
  console.log(`Usage: node normalize-media-folder.mjs --root <path> [--sources a,b,c] [--threshold 40] [--action delete|quarantine] [--cap 0] [--seed 42] [--parallel 1]`);
}

const args = parseArgs(process.argv);

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else if (ent.isFile()) yield p;
  }
}

function uniquePath(targetDir, name) {
  let dest = join(targetDir, name);
  if (!existsSync(dest)) return dest;
  const ext = extname(name);
  const stem = basename(name, ext);
  for (let i = 1; ; i++) {
    dest = join(targetDir, `${stem}_dup${i}${ext}`);
    if (!existsSync(dest)) return dest;
  }
}

function moveFileSafe(src, destDir) {
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  const dest = uniquePath(destDir, basename(src));
  try {
    renameSync(src, dest);
  } catch (e) {
    if (e.code === 'EXDEV') {
      cpSync(src, dest, { errorOnExist: true });
      unlinkSync(src);
    } else throw e;
  }
  return dest;
}

function samePhysicalPath(a, b) {
  try {
    return realpathSync.native(a).toLowerCase() === realpathSync.native(b).toLowerCase();
  } catch {
    return resolve(a).toLowerCase() === resolve(b).toLowerCase();
  }
}

function rmEmptyDirsRecursive(root, options = {}) {
  const { protect = new Set() } = options;
  if (!existsSync(root)) return;
  const ents = readdirSync(root, { withFileTypes: true });
  for (const ent of ents) {
    if (ent.isDirectory()) rmEmptyDirsRecursive(join(root, ent.name), options);
  }
  if (samePhysicalPath(root, args.root)) return;
  if (protect.has(basename(root))) return;
  if (readdirSync(root).length === 0) {
    try { rmSync(root, { recursive: false }); } catch {}
  }
}

function fmtMB(bytes) { return (bytes / (1024 * 1024)).toFixed(1); }

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// PHASE 0
function consolidate() {
  if (!args.sources.length) return 0;
  if (!existsSync(args.root)) mkdirSync(args.root, { recursive: true });
  const rootRealLower = (() => {
    try { return realpathSync.native(args.root).toLowerCase(); }
    catch { return args.root.toLowerCase(); }
  })();
  let moved = 0;
  for (const src of args.sources) {
    if (!existsSync(src)) {
      console.log(`  skip (missing): ${src}`);
      continue;
    }
    const sameAsRoot = samePhysicalPath(src, args.root);
    if (sameAsRoot) {
      console.log(`  source resolves to same physical dir as root, flattening in place: ${src}`);
    }
    const files = [...walk(src)];
    for (const f of files) {
      // If src and root are the same dir, files already directly in root need no move.
      if (sameAsRoot && dirname(f).toLowerCase() === rootRealLower) continue;
      moveFileSafe(f, args.root);
      moved++;
    }
    // Remove empty subdirs (rmEmptyDirsRecursive already protects the root path).
    rmEmptyDirsRecursive(src, { protect: RESERVED_DIRS });
    // Only remove the source DIRECTORY itself if it's actually empty AND not the same as root.
    if (!sameAsRoot && existsSync(src)) {
      try {
        if (readdirSync(src).length === 0) rmSync(src, { recursive: false });
      } catch {}
    }
  }
  return moved;
}

// PHASE 1
function isDangerous(file) {
  return DANGEROUS_EXTS.has(extname(file).toLowerCase());
}
function safetyScan() {
  const flagged = [];
  for (const f of walk(args.root)) {
    if (f.includes(`${sep}_quarantine${sep}`)) continue;
    if (isDangerous(f)) flagged.push(f);
  }
  for (const f of flagged) {
    if (args.action === 'delete') {
      try { unlinkSync(f); } catch (e) { console.log(`  delete fail: ${f} (${e.message})`); }
    } else {
      const qDir = join(args.root, '_quarantine');
      moveFileSafe(f, qDir);
    }
  }
  return flagged.length;
}

// PHASE 2
function ffprobeDuration(file) {
  // First pass: default probe.
  let r = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ], { encoding: 'utf8' });
  let stderr = r.stderr || '';
  if (r.status === 0) {
    const d = parseFloat(r.stdout.trim());
    if (Number.isFinite(d) && d > 0) return { duration: d, brokenContainer: false };
  }
  // Second pass: deep probe (handles late moov / large probesize needs).
  r = spawnSync('ffprobe', [
    '-v', 'error', '-analyzeduration', '200M', '-probesize', '200M',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ], { encoding: 'utf8' });
  stderr += '\n' + (r.stderr || '');
  if (r.status === 0) {
    const d = parseFloat(r.stdout.trim());
    if (Number.isFinite(d) && d > 0) return { duration: d, brokenContainer: false };
  }
  const broken = /moov atom not found|Invalid data found|truncated/i.test(stderr);
  return { duration: null, brokenContainer: broken };
}

function spawnAsync(cmd, cmdArgs, opts = {}) {
  return new Promise(resolve => {
    const child = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', d => { stdout += d.toString(); });
    child.stderr?.on('data', d => { stderr += d.toString(); });
    child.on('error', err => resolve({ status: -1, stdout, stderr: String(err) }));
    child.on('close', code => resolve({ status: code, stdout, stderr }));
  });
}

async function compressOne(file, threadsPerJob) {
  const beforeBytes = statSync(file).size;
  const beforeMB = beforeBytes / (1024 * 1024);
  const probe = ffprobeDuration(file);
  if (!probe.duration) {
    if (probe.brokenContainer) {
      try { unlinkSync(file); return { ok: false, reason: 'broken-container-deleted', beforeMB, deleted: true }; }
      catch (e) { return { ok: false, reason: `broken-container-delete-failed:${e.message}`, beforeMB }; }
    }
    return { ok: false, reason: 'no-duration', beforeMB };
  }
  const dur = probe.duration;
  const totalBps = (TARGET_BYTES * 8) / dur;
  const videoBps = Math.max(200000, Math.round(totalBps - AUDIO_BPS));
  const dir = dirname(file);
  const stem = basename(file, extname(file));
  const tmp = join(dir, `${stem}.compressed.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp.mp4`);
  const ffArgs = [
    '-y', '-loglevel', 'error', '-nostats',
    '-i', file,
    '-vf', `scale='min(1280,iw)':-2`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-b:v', String(videoBps), '-maxrate', String(videoBps), '-bufsize', String(2 * videoBps),
    '-c:a', 'aac', '-b:a', String(AUDIO_BPS),
    '-movflags', '+faststart', '-threads', String(threadsPerJob),
    tmp,
  ];
  const r = await spawnAsync('ffmpeg', ffArgs);
  if (r.status !== 0 || !existsSync(tmp)) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch {}
    return { ok: false, reason: 'ffmpeg-failed', beforeMB, stderr: r.stderr.slice(-400) };
  }
  const afterBytes = statSync(tmp).size;
  const afterMB = afterBytes / (1024 * 1024);
  if (afterBytes >= beforeBytes) {
    try { unlinkSync(tmp); } catch {}
    return { ok: false, reason: 'no-savings', beforeMB, afterMB };
  }
  try {
    unlinkSync(file);
    const dest = uniquePath(dir, `${stem}.mp4`);
    renameSync(tmp, dest);
    return { ok: true, before: beforeMB, after: afterMB, dest };
  } catch (e) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch {}
    return { ok: false, reason: e.message, beforeMB };
  }
}

async function compressOversized() {
  const candidates = [];
  for (const f of walk(args.root)) {
    if (f.includes(`${sep}_quarantine${sep}`)) continue;
    const ext = extname(f).toLowerCase();
    if (!VIDEO_EXTS.has(ext)) continue;
    const sz = statSync(f).size;
    if (sz > args.threshold * 1024 * 1024) candidates.push({ file: f, sizeMB: sz / (1024 * 1024) });
  }
  // Process largest first so total wall time is dominated by big files getting started early.
  candidates.sort((a, b) => b.sizeMB - a.sizeMB);
  const total = candidates.length;
  const cores = Math.max(1, cpus().length);
  const concurrency = Math.min(args.parallel, Math.max(1, total));
  const threadsPerJob = Math.max(2, Math.floor(cores / concurrency));
  console.log(`  ${total} videos > ${args.threshold} MiB  (parallel=${concurrency}, ${threadsPerJob} threads/job, ${cores} cores total)`);
  if (total === 0) return [];

  const results = new Array(total);
  let next = 0;
  let completed = 0;

  async function worker(workerId) {
    while (true) {
      const idx = next++;
      if (idx >= total) return;
      const c = candidates[idx];
      const t0 = Date.now();
      const r = await compressOne(c.file, threadsPerJob);
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      completed++;
      const tag = `[${String(completed).padStart(String(total).length)}/${total}]`;
      const name = basename(c.file);
      let line;
      if (r.ok) line = `  ${tag} ${name} (${c.sizeMB.toFixed(1)} MB) -> ${r.after.toFixed(1)} MB in ${sec}s`;
      else if (r.deleted) line = `  ${tag} ${name} (${c.sizeMB.toFixed(1)} MB) -> BROKEN deleted (${r.reason}) in ${sec}s`;
      else line = `  ${tag} ${name} (${c.sizeMB.toFixed(1)} MB) -> FAIL (${r.reason}) in ${sec}s -- original kept`;
      console.log(line);
      results[idx] = { ...c, ...r };
    }
  }

  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
  return results;
}

// PHASE 3
function capTrim(rng) {
  if (!args.cap || args.cap <= 0) return { skipped: true };
  const files = [...walk(args.root)].filter(f => !f.includes(`${sep}_quarantine${sep}`));
  if (files.length <= args.cap) return { skipped: true, total: files.length, cap: args.cap };
  const groups = new Map();
  for (const f of files) {
    const ext = extname(f).toLowerCase() || '(none)';
    if (!groups.has(ext)) groups.set(ext, []);
    groups.get(ext).push(f);
  }
  const total = files.length;
  const allocations = [];
  for (const [ext, list] of groups) {
    const exact = (args.cap * list.length) / total;
    const floor = Math.floor(exact);
    allocations.push({ ext, list, floor, frac: exact - floor });
  }
  let assigned = allocations.reduce((s, a) => s + a.floor, 0);
  let leftover = args.cap - assigned;
  const sortedFracs = [...allocations].sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < leftover; k++) sortedFracs[k].floor++;
  let deleted = 0;
  for (const a of allocations) {
    shuffleInPlace(a.list, rng);
    const surplus = a.list.slice(a.floor);
    for (const f of surplus) { try { unlinkSync(f); deleted++; } catch {} }
  }
  return { skipped: false, deleted, kept: args.cap, total };
}

// PHASE 4
function computeTiers(total) {
  const free = Math.min(50, total);
  const S = total - free;
  if (S <= 0) return { free, t1: 0, t2: 0, t3: 0 };
  let t1 = Math.floor(S * 380 / 1405);
  let t2 = Math.floor(S * 460 / 1405);
  let t3 = S - t1 - t2;
  let safety = 100;
  while (safety-- > 0 && !(t1 < t2 && t2 < t3)) {
    if (t1 >= t2 && t3 > t2) { t1--; t2++; }
    else if (t2 >= t3 && t1 > 0) { t2--; t3++; }
    else break;
  }
  return { free, t1, t2, t3 };
}

function rebalanceColumns(allocations, tierTargets) {
  // 2D rebalance so per-extension row sums (preserved) and per-tier column sums match targets.
  let safety = 10000;
  while (safety-- > 0) {
    const colSums = [0, 0, 0, 0];
    for (const a of allocations) for (let c = 0; c < 4; c++) colSums[c] += a.alloc[c];
    let over = -1, under = -1;
    for (let c = 0; c < 4; c++) {
      if (colSums[c] > tierTargets[c] && over === -1) over = c;
      if (colSums[c] < tierTargets[c] && under === -1) under = c;
    }
    if (over === -1 && under === -1) return;
    if (over === -1 || under === -1) return;
    const donor = allocations.find(a => a.alloc[over] > 0);
    if (!donor) return;
    donor.alloc[over]--;
    donor.alloc[under]++;
  }
}

function tierLayout(rng) {
  const stage = join(args.root, '_sort_stage');
  if (!existsSync(stage)) mkdirSync(stage, { recursive: true });
  const filesToStage = [];
  for (const f of walk(args.root)) {
    if (f.includes(`${sep}_quarantine${sep}`)) continue;
    if (f.startsWith(stage + sep) || f === stage) continue;
    filesToStage.push(f);
  }
  for (const f of filesToStage) moveFileSafe(f, stage);
  rmEmptyDirsRecursive(args.root, { protect: RESERVED_DIRS });

  const staged = [...walk(stage)];
  const total = staged.length;
  const tiers = computeTiers(total);
  const tierDirs = ['free', 'tier1', 'tier2', 'tier3'];
  const tierTargets = [tiers.free, tiers.t1, tiers.t2, tiers.t3];
  for (const t of tierDirs) mkdirSync(join(args.root, t), { recursive: true });

  if (total === 0) {
    try { rmSync(stage, { recursive: true, force: true }); } catch {}
    return { total, tiers, tierTargets };
  }

  const groups = new Map();
  for (const f of staged) {
    const ext = extname(f).toLowerCase() || '(none)';
    if (!groups.has(ext)) groups.set(ext, []);
    groups.get(ext).push(f);
  }

  const allocations = [];
  for (const [ext, list] of groups) {
    const counts = list.length;
    const exact = tierTargets.map(t => (counts * t) / total);
    const floors = exact.map(v => Math.floor(v));
    const fracs = exact.map((v, i) => ({ i, frac: v - floors[i] }));
    let leftover = counts - floors.reduce((s, v) => s + v, 0);
    fracs.sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < leftover; k++) floors[fracs[k].i]++;
    allocations.push({ ext, list, alloc: floors });
  }

  rebalanceColumns(allocations, tierTargets);

  for (const e of allocations) {
    shuffleInPlace(e.list, rng);
    let idx = 0;
    for (let col = 0; col < 4; col++) {
      const targetDir = join(args.root, tierDirs[col]);
      for (let k = 0; k < e.alloc[col]; k++) {
        const src = e.list[idx++];
        moveFileSafe(src, targetDir);
      }
    }
  }

  try { rmSync(stage, { recursive: true, force: true }); } catch {}
  return { total, tiers, tierTargets };
}

async function main() {
  const start = Date.now();
  const rng = mulberry32(args.seed);
  console.log('=== Media Folder Normalization ===');
  console.log(`Root:       ${args.root}`);
  console.log(`Sources:    ${args.sources.length ? args.sources.join(' | ') : '(none)'}`);
  console.log(`Threshold:  ${args.threshold} MiB`);
  console.log(`Action:     ${args.action}`);
  console.log(`Cap:        ${args.cap || 'NONE'}`);
  console.log(`Parallel:   ${args.parallel}`);
  console.log(`Seed:       ${args.seed}`);
  console.log('');

  console.log('--- Phase 0: Consolidate sources ---');
  const moved = consolidate();
  console.log(`  moved ${moved} files into root`);
  console.log('');

  console.log('--- Phase 1: Safety scan ---');
  const flagged = safetyScan();
  console.log(`  ${flagged} dangerous file(s) ${args.action === 'delete' ? 'DELETED' : 'QUARANTINED'}`);
  console.log('');

  console.log('--- Phase 2: Compression ---');
  const compressed = await compressOversized();
  const okCount = compressed.filter(c => c.ok).length;
  console.log(`  ${okCount}/${compressed.length} videos successfully compressed`);
  console.log('');

  console.log('--- Phase 3: Cap trim ---');
  const trim = capTrim(rng);
  if (trim.skipped) console.log('  skipped (no cap or under cap)');
  else console.log(`  deleted ${trim.deleted}; kept ${trim.kept} of ${trim.total}`);
  console.log('');

  console.log('--- Phase 4: Tier layout ---');
  const layout = tierLayout(rng);
  console.log(`  total=${layout.total}  planned: free=${layout.tiers.free} tier1=${layout.tiers.t1} tier2=${layout.tiers.t2} tier3=${layout.tiers.t3}`);
  console.log('');

  console.log('=== Final Verification Report ===');
  console.log(`Root processed:     ${args.root}`);
  console.log(`Safety scan:        ${flagged} dangerous (${args.action})`);
  console.log(`Compression:        ${okCount}/${compressed.length} succeeded`);
  if (compressed.length) {
    const examples = compressed.filter(c => c.ok).slice(0, 5);
    for (const ex of examples) console.log(`  e.g.  ${ex.before.toFixed(1)} MB -> ${ex.after.toFixed(1)} MB  (${basename(ex.dest || ex.file)})`);
  }
  const tierDirs = ['free', 'tier1', 'tier2', 'tier3'];
  let totalFinal = 0;
  const tierActual = {};
  for (const t of tierDirs) {
    const c = [...walk(join(args.root, t))].length;
    tierActual[t] = c;
    totalFinal += c;
  }
  console.log(`Tier counts (actual):`);
  for (const t of tierDirs) console.log(`  ${t.padEnd(8)} : ${tierActual[t]}`);
  console.log(`  TOTAL    : ${totalFinal}`);
  let oversize = 0;
  for (const t of tierDirs) {
    for (const f of walk(join(args.root, t))) {
      if (VIDEO_EXTS.has(extname(f).toLowerCase()) && statSync(f).size > args.threshold * 1024 * 1024) oversize++;
    }
  }
  console.log(`Oversized (>${args.threshold} MiB) remaining: ${oversize}`);
  const top = readdirSync(args.root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
  console.log(`Top-level directories: ${top.join(', ')}`);
  const sec = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Elapsed: ${sec}s`);
}

main().catch(e => { console.error(e); process.exit(1); });
