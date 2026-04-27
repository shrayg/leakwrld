# R2 + FFmpeg Pipeline

## Flow
1. Client submits upload metadata to `/api/videos/upload` with category slug.
2. Server validates payload and issues presigned PUT URL to R2 raw bucket.
3. Source file is uploaded to `content/<category-slug>/<video-id>/videos/source.<ext>`.
4. Server inserts a `transcode_jobs` row (`pending`).
5. Worker (`npm run worker:transcode`) claims jobs via `claim_transcode_job()`.
6. Worker downloads source, runs FFmpeg scale pipeline, uploads low-res sibling output (`content/<category-slug>/<video-id>/videos/low-res/720p.mp4`).
7. Worker updates `video_assets` and marks `videos.status = ready`.
8. Clients fetch presigned playback URLs from `/api/videos/[id]/playback`.

## Required keys
- `CLOUDFLARE_R2_ENDPOINT`
- `CLOUDFLARE_R2_ACCESS_KEY_ID`
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY`
- `CLOUDFLARE_R2_BUCKET_RAW`

## Retry/idempotency baseline
- `video_id` is the pipeline identity key across upload + transcode.
- Jobs are claimed serially using DB-level lock (`FOR UPDATE SKIP LOCKED`).
- Failed jobs persist `last_error` and can be re-queued by setting status back to `pending`.

## UX states
- `draft`: record created
- `uploaded`: source object present in raw bucket
- `processing`: worker transcode in progress
- `ready`: playable
- `failed`: transcode failed; retry flow required
