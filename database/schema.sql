/**
 * Leak World — single Postgres database (VPS).
 * Sections: identity & referrals, catalog, media aggregates, sessions,
 * traffic/events (admin analytics), payments.
 *
 * Fresh install: psql "$DATABASE_URL" -f database/schema.sql
 * Existing DB:  psql "$DATABASE_URL" -f database/migrations/001_platform_analytics.sql
 *                then npm run db:backfill-referrals
 */

create extension if not exists pgcrypto;

-- ─── Users & referrals ─────────────────────────────────────────────────────

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  phone text,
  username text not null unique,
  password_hash text,
  auth_provider text not null default 'local' check (auth_provider in ('local', 'google', 'discord', 'other')),
  tier text not null default 'free' check (tier in ('free', 'basic', 'premium', 'ultimate', 'admin')),
  referral_code text not null unique
    check (referral_code ~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$'),
  referred_by_user_id uuid references users (id) on delete set null,
  referral_signups_count integer not null default 0 check (referral_signups_count >= 0),
  signup_ip text,
  last_ip text,
  last_active_at timestamptz,
  watch_time_seconds bigint not null default 0 check (watch_time_seconds >= 0),
  site_time_seconds bigint not null default 0 check (site_time_seconds >= 0),
  plan_label text,
  banned_at timestamptz,
  ban_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists users_phone_unique_idx on users (phone) where phone is not null;

create index if not exists users_email_lower_idx on users (lower(email));
create index if not exists users_username_lower_idx on users (lower(username));
create index if not exists users_referred_by_idx on users (referred_by_user_id);
create index if not exists users_last_active_idx on users (last_active_at desc);
create index if not exists users_created_at_idx on users (created_at desc);

create table if not exists referral_signups (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references users (id) on delete cascade,
  referred_user_id uuid not null unique references users (id) on delete cascade,
  referral_code_used text not null,
  created_at timestamptz not null default now()
);

create index if not exists referral_signups_referrer_idx on referral_signups (referrer_user_id);
create index if not exists referral_signups_created_idx on referral_signups (created_at desc);

create or replace function bump_referrer_signups_count()
returns trigger as $$
begin
  update users
     set referral_signups_count = referral_signups_count + 1,
         updated_at = now()
   where id = new.referrer_user_id;
  return new;
end;
$$ language plpgsql;

drop trigger if exists tr_referral_signups_insert on referral_signups;
create trigger tr_referral_signups_insert
  after insert on referral_signups
  for each row execute procedure bump_referrer_signups_count();

-- ─── Sessions ───────────────────────────────────────────────────────────────

create table if not exists sessions (
  token_hash text primary key,
  user_id uuid not null references users (id) on delete cascade,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  ip text,
  user_agent text
);

create index if not exists sessions_user_id_idx on sessions (user_id);
create index if not exists sessions_last_seen_idx on sessions (last_seen_at);

-- ─── Catalog ────────────────────────────────────────────────────────────────

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

create index if not exists creators_category_idx on creators (category);
create index if not exists creators_rank_idx on creators (rank);

create table if not exists media_items (
  id text primary key,
  creator_slug text not null references creators (slug) on delete cascade,
  title text not null,
  media_type text not null check (media_type in ('short', 'video', 'photo')),
  tier text not null default 'free' check (tier in ('free', 'basic', 'premium', 'ultimate')),
  duration_seconds integer not null default 0,
  storage_path text,
  poster_path text,
  views integer not null default 0,
  likes integer not null default 0,
  watch_seconds_total bigint not null default 0 check (watch_seconds_total >= 0),
  watch_sessions integer not null default 0 check (watch_sessions >= 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists media_items_creator_idx on media_items (creator_slug);
create index if not exists media_items_type_status_idx on media_items (media_type, status);

-- ─── Traffic & admin-facing analytics (append-heavy) ─────────────────────────

create table if not exists analytics_visits (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  user_id uuid references users (id) on delete set null,
  visitor_key uuid,
  path text not null default '/',
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  country_code char(2),
  ip text,
  user_agent text
);

create index if not exists analytics_visits_created_idx on analytics_visits (created_at desc);
create index if not exists analytics_visits_user_idx on analytics_visits (user_id);
create index if not exists analytics_visits_visitor_idx on analytics_visits (visitor_key);

create table if not exists analytics_events (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  user_id uuid references users (id) on delete set null,
  visitor_key uuid,
  event_type text not null,
  path text,
  category text,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists analytics_events_created_idx on analytics_events (created_at desc);
create index if not exists analytics_events_type_idx on analytics_events (event_type);
create index if not exists analytics_events_user_idx on analytics_events (user_id);

-- ─── Payments (manual gateway rows until billing API lands) ─────────────────

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references users (id) on delete cascade,
  provider text not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'USD',
  plan_label text not null,
  tier_granted text not null check (tier_granted in ('free', 'basic', 'premium', 'ultimate', 'admin')),
  screenshot_url text,
  notes text
);

create index if not exists payments_user_idx on payments (user_id);
create index if not exists payments_created_idx on payments (created_at desc);

-- ─── Queue placeholders ──────────────────────────────────────────────────────

create table if not exists queue_entries (
  id uuid primary key default gen_random_uuid(),
  session_token_hash text,
  user_id uuid references users (id) on delete set null,
  status text not null default 'waiting' check (status in ('waiting', 'admitted', 'expired', 'skipped')),
  skip_paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists queue_entries_status_created_idx on queue_entries (status, created_at);
