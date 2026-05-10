/**
 * Upgrade existing Leak World databases created from the older baseline schema.
 * Run: psql "$DATABASE_URL" -f database/migrations/001_platform_analytics.sql
 * Then: npm run db:backfill-referrals
 *
 * Requires PostgreSQL 11+ (ADD COLUMN IF NOT EXISTS).
 */

create extension if not exists pgcrypto;

-- Users: widen identity + referrals + engagement totals
alter table users alter column email drop not null;

alter table users add column if not exists auth_provider text not null default 'local';
alter table users add column if not exists referral_code text;
alter table users add column if not exists referred_by_user_id uuid references users (id) on delete set null;
alter table users add column if not exists referral_signups_count integer not null default 0;
alter table users add column if not exists signup_ip text;
alter table users add column if not exists last_ip text;
alter table users add column if not exists last_active_at timestamptz;
alter table users add column if not exists watch_time_seconds bigint not null default 0;
alter table users add column if not exists site_time_seconds bigint not null default 0;
alter table users add column if not exists plan_label text;
alter table users add column if not exists banned_at timestamptz;
alter table users add column if not exists ban_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_auth_provider_check'
  ) then
    alter table users add constraint users_auth_provider_check
      check (auth_provider in ('local', 'google', 'discord', 'other'));
  end if;
exception when others then null;
end $$;

create index if not exists users_email_lower_idx on users (lower(email));
create index if not exists users_username_lower_idx on users (lower(username));
create index if not exists users_referred_by_idx on users (referred_by_user_id);
create index if not exists users_last_active_idx on users (last_active_at desc);
create index if not exists users_created_at_idx on users (created_at desc);

-- Sessions: observability
alter table sessions add column if not exists ip text;
alter table sessions add column if not exists user_agent text;

-- Media: aggregate watch stats (no per-user linkage here)
alter table media_items add column if not exists watch_seconds_total bigint not null default 0;
alter table media_items add column if not exists watch_sessions integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'media_items_watch_seconds_total_nonneg'
  ) then
    alter table media_items add constraint media_items_watch_seconds_total_nonneg
      check (watch_seconds_total >= 0);
  end if;
exception when others then null;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'media_items_watch_sessions_nonneg'
  ) then
    alter table media_items add constraint media_items_watch_sessions_nonneg
      check (watch_sessions >= 0);
  end if;
exception when others then null;
end $$;

-- Referral ledger
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

-- Append-only analytics
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

-- Payments
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references users (id) on delete cascade,
  provider text not null,
  amount_cents integer not null,
  currency text not null default 'USD',
  plan_label text not null,
  tier_granted text not null,
  screenshot_url text,
  notes text
);

create index if not exists payments_user_idx on payments (user_id);
create index if not exists payments_created_idx on payments (created_at desc);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_amount_nonneg') then
    alter table payments add constraint payments_amount_nonneg check (amount_cents >= 0);
  end if;
exception when others then null;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_tier_granted_check') then
    alter table payments add constraint payments_tier_granted_check
      check (tier_granted in ('free', 'basic', 'premium', 'ultimate', 'admin'));
  end if;
exception when others then null;
end $$;
