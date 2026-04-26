create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text unique not null,
  display_name text not null,
  avatar_url text,
  bio text,
  age_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  slug text unique not null,
  title text not null,
  description text,
  is_verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  label text not null
);

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null
);

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  channel_id uuid references public.channels(id) on delete set null,
  title text not null,
  description text,
  visibility text not null default 'public',
  status text not null default 'draft',
  category_id uuid references public.categories(id),
  duration_seconds integer default 0,
  playback_id text,
  thumbnail_url text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.video_assets (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  cloudflare_uid text,
  hls_url text,
  dash_url text,
  poster_url text,
  sprite_url text,
  ingest_status text not null default 'queued',
  created_at timestamptz not null default now()
);

create table if not exists public.video_tags (
  video_id uuid not null references public.videos(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (video_id, tag_id)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.comment_reactions (
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null default 'like',
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id, reaction)
);

create table if not exists public.video_reactions (
  video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null default 'like',
  created_at timestamptz not null default now(),
  primary key (video_id, user_id, reaction)
);

create table if not exists public.subscriptions (
  channel_id uuid not null references public.channels(id) on delete cascade,
  subscriber_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (channel_id, subscriber_id)
);

create table if not exists public.playlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  visibility text not null default 'private',
  created_at timestamptz not null default now()
);

create table if not exists public.playlist_items (
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  position integer not null default 0,
  primary key (playlist_id, video_id)
);

create table if not exists public.view_events_raw (
  id bigserial primary key,
  video_id uuid not null references public.videos(id) on delete cascade,
  viewer_id uuid references public.profiles(id),
  watch_ms integer not null,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.video_metrics_daily (
  metric_date date not null,
  video_id uuid not null references public.videos(id) on delete cascade,
  views bigint not null default 0,
  likes bigint not null default 0,
  comments bigint not null default 0,
  watch_ms bigint not null default 0,
  primary key (metric_date, video_id)
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles(id),
  entity_type text not null,
  entity_id uuid,
  reason text not null,
  status text not null default 'queued',
  created_at timestamptz not null default now()
);

create table if not exists public.moderation_flags (
  id uuid primary key default gen_random_uuid(),
  video_id uuid references public.videos(id) on delete cascade,
  source text not null,
  severity text not null default 'medium',
  details jsonb not null default '{}'::jsonb,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.copyright_claims (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  claimant_name text not null,
  claimant_email text not null,
  notice_text text not null,
  status text not null default 'submitted',
  created_at timestamptz not null default now()
);

create table if not exists public.consent_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  essential boolean not null default true,
  analytics boolean not null default false,
  personalization boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.age_gate_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  accepted boolean not null,
  region text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.channels enable row level security;
alter table public.videos enable row level security;
alter table public.video_assets enable row level security;
alter table public.comments enable row level security;
alter table public.reports enable row level security;
alter table public.moderation_flags enable row level security;

create policy "public profiles readable" on public.profiles
for select using (true);

create policy "profile owner writes" on public.profiles
for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "public channels readable" on public.channels
for select using (true);

create policy "owner manages channels" on public.channels
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "published videos readable" on public.videos
for select using (visibility = 'public' and status = 'ready');

create policy "owner manages videos" on public.videos
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "public comments readable" on public.comments
for select using (not is_deleted);

create policy "author writes comments" on public.comments
for all using (auth.uid() = author_id) with check (auth.uid() = author_id);

create policy "reporters can insert reports" on public.reports
for insert with check (auth.uid() = reporter_id);

create policy "service role reads moderation flags" on public.moderation_flags
for select using (auth.jwt() ->> 'role' = 'service_role');
