-- Consolidation pass: remove unused product schema while preserving active table dependencies.

alter table if exists public.videos
  add column if not exists owner_user_key text,
  add column if not exists category_slug text;

update public.videos
set owner_user_key = coalesce(owner_user_key, owner_id::text)
where owner_user_key is null and owner_id is not null;

do $$
begin
  if to_regclass('public.categories') is not null then
    execute $sql$
      update public.videos v
      set category_slug = c.slug
      from public.categories c
      where v.category_id = c.id and (v.category_slug is null or v.category_slug = '')
    $sql$;
  end if;
end $$;

alter table if exists public.comments
  add column if not exists author_user_key text;

update public.comments
set author_user_key = coalesce(author_user_key, author_id::text)
where author_user_key is null and author_id is not null;

alter table if exists public.view_events_raw
  add column if not exists viewer_user_key text;
update public.view_events_raw
set viewer_user_key = coalesce(viewer_user_key, viewer_id::text)
where viewer_user_key is null and viewer_id is not null;

alter table if exists public.age_gate_events
  add column if not exists user_key text;
update public.age_gate_events
set user_key = coalesce(user_key, user_id::text)
where user_key is null and user_id is not null;

-- Single-asset strategy: no generated lower quality variants.
alter table if exists public.video_assets
  drop column if exists mp4_720_object_key;

-- Drop unused product tables.
drop table if exists public.channels cascade;
drop table if exists public.tags cascade;
drop table if exists public.video_tags cascade;
drop table if exists public.subscriptions cascade;
drop table if exists public.playlists cascade;
drop table if exists public.playlist_items cascade;
drop table if exists public.reports cascade;
drop table if exists public.moderation_flags cascade;
drop table if exists public.consent_preferences cascade;
drop table if exists public.copyright_claims cascade;
drop table if exists public.transcode_jobs cascade;
drop table if exists public.video_metrics_daily cascade;

-- Remove duplicate user/profile tables after cutover.
drop table if exists public.account_profiles cascade;
drop table if exists public.discord_account_links cascade;
drop table if exists public.access_entitlements cascade;
