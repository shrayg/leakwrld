# Schema + RLS Summary

## Core tables
- Profiles/social: `profiles`, `channels`, `subscriptions`
- Video graph: `videos`, `video_assets`, `categories`, `tags`, `video_tags`
- Engagement: `comments`, `comment_reactions`, `video_reactions`
- Library: `playlists`, `playlist_items`
- Analytics: `view_events_raw`, `video_metrics_daily`
- Trust/safety: `reports`, `moderation_flags`, `copyright_claims`
- Compliance/preferences: `consent_preferences`, `age_gate_events`

## RLS policies
- `profiles`: public read, owner write.
- `channels`: public read, owner write.
- `videos`: public read only when `visibility='public' and status='ready'`; owner write.
- `comments`: public read non-deleted; author write.
- `reports`: reporter can insert.
- `moderation_flags`: service-role read boundary.

## Index and scale guidance
- Primary keys are UUIDs for global-write friendliness.
- Daily aggregates separate from raw events for write/read optimization.
- Status columns (`videos.status`, `reports.status`) support async queue transitions.

## Migration files
- `supabase/migrations/20260425194000_mvp_schema.sql`
- `supabase/migrations/20260425195000_jobs.sql`
