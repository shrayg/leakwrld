-- One-time cleanup: clears synthetic views/likes/watch seeded from old catalog demo metrics.
-- Do NOT add this file to the chained db:migrate script — it would wipe real engagement on every run.
-- Run once after upgrading: npm run db:reset-seeded-media-metrics

update media_items
set views = 0,
    likes = 0,
    watch_seconds_total = 0,
    watch_sessions = 0,
    updated_at = now();
