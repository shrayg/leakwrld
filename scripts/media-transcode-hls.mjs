#!/usr/bin/env node
/**
 * Offline HLS ladder (360p + 720p) next to each source MP4 in R2 key layout:
 *   <video_dir>/hls/master.m3u8
 *   <video_dir>/hls/360p/*.m4s
 *   <video_dir>/hls/720p/*.m4s
 *
 * Requires ffmpeg with libx264 + aac. Example (single file, local out dir):
 *
 *   OUT=./data/hls-out npm run media:transcode:hls -- --key="videos/slug/free/clip.mp4"
 *
 * Then upload `data/hls-out/videos/.../hls/` to R2 preserving keys, run `npm run catalog:rebuild -- --force`.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const argv = process.argv.slice(2);
const keyArg = argv.find((a) => a.startsWith('--key='));
const storageKey = keyArg ? keyArg.slice('--key='.length) : '';
const outRoot = process.env.OUT || path.join(ROOT, 'data', 'hls-out');

if (!storageKey || storageKey.includes('..')) {
  console.error('Usage: npm run media:transcode:hls -- --key=videos/creator/free/file.mp4');
  process.exit(1);
}

const baseDir = storageKey.slice(0, storageKey.lastIndexOf('/'));
const outDir = path.join(outRoot, baseDir, 'hls');
fs.mkdirSync(outDir, { recursive: true });

const r2Url = process.env.R2_SOURCE_URL;
if (!r2Url) {
  console.error('Set R2_SOURCE_URL to a presigned or local file URL for the source MP4 (dev only).');
  process.exit(1);
}

const args = [
  '-y',
  '-i',
  r2Url,
  '-filter_complex',
  '[0:v]split=2[v1][v2];[v1]scale=-2:360[v360];[v2]scale=-2:720[v720]',
  '-map',
  '[v360]',
  '-map',
  '0:a?',
  '-c:v:0',
  'libx264',
  '-b:v:0',
  '800k',
  '-map',
  '[v720]',
  '-map',
  '0:a?',
  '-c:v:1',
  'libx264',
  '-b:v:1',
  '2800k',
  '-c:a',
  'aac',
  '-b:a',
  '128k',
  '-f',
  'hls',
  '-hls_time',
  '4',
  '-hls_playlist_type',
  'vod',
  '-hls_segment_type',
  'fmp4',
  '-hls_flags',
  'independent_segments',
  '-hls_segment_filename',
  path.join(outDir, 'v%v', 'seg%d.m4s'),
  '-master_pl_name',
  'master.m3u8',
  '-var_stream_map',
  'v:0,a:0 v:1,a:1',
  path.join(outDir, 'stream_%v.m3u8'),
];

const ff = spawnSync('ffmpeg', args, { stdio: 'inherit' });
process.exit(ff.status === 0 ? 0 : 1);
