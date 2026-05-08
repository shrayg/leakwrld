create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  username text not null unique,
  password_hash text not null,
  tier text not null default 'free' check (tier in ('free', 'basic', 'premium', 'ultimate', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists sessions_user_id_idx on sessions(user_id);
create index if not exists sessions_last_seen_idx on sessions(last_seen_at);

create table if not exists creators (
  id uuid primary key default gen_random_uuid(),
  rank integer not null unique,
  name text not null,
  slug text not null unique,
  category text not null,
  tagline text not null default '',
  media_count integer not null default 0,
  free_count integer not null default 0,
  premium_count integer not null default 0,
  heat integer not null default 0,
  accent text not null default 'pink',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creators_category_idx on creators(category);
create index if not exists creators_rank_idx on creators(rank);

create table if not exists media_items (
  id text primary key,
  creator_slug text not null references creators(slug) on delete cascade,
  title text not null,
  media_type text not null check (media_type in ('short', 'video', 'photo')),
  tier text not null default 'free' check (tier in ('free', 'basic', 'premium', 'ultimate')),
  duration_seconds integer not null default 0,
  storage_path text,
  poster_path text,
  views integer not null default 0,
  likes integer not null default 0,
  status text not null default 'draft' check (status in ('draft', 'published', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists media_items_creator_idx on media_items(creator_slug);
create index if not exists media_items_type_status_idx on media_items(media_type, status);

create table if not exists queue_entries (
  id uuid primary key default gen_random_uuid(),
  session_token_hash text,
  user_id uuid references users(id) on delete set null,
  status text not null default 'waiting' check (status in ('waiting', 'admitted', 'expired', 'skipped')),
  skip_paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists queue_entries_status_created_idx on queue_entries(status, created_at);
