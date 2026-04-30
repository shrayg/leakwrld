# Schema + RLS Summary

## Canonical model
- Users: `users` (single source of truth for identity, profile JSON, auth/provider fields, tier, referrals)
- Video graph: `videos`, `video_assets`
- Engagement: `comments`, `comment_reactions`, `video_reactions`
- Analytics/events: `view_events_raw`, `admin_events`, `app_state`

Legacy duplicate profile storage (`profiles`, `account_profiles`) and age verification persistence (`age_gate_events`) are removed in consolidation migrations.

## RLS policies
- `users`: service-role policy for backend writes/reads.
- Additional table policies depend on active app usage and are managed by migrations.

## Migration files (key)
- `supabase/migrations/20260429060000_canonical_users.sql`
- `supabase/migrations/20260429070000_drop_unused_schema.sql`
- `supabase/migrations/20260429190000_merge_profiles_drop_age_gate.sql`
