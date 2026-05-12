/**
 * Leak World referral program — schema additions.
 *
 *  - Lifetime tier grants (3 / 15 / 30 signups → T1 / T2 / T3 for life).
 *  - Cash kickback unlock at 10 signups (10% revshare; 20% at 30+).
 *  - Per-IP credit tracking so the same physical user can't pump multiple
 *    free signups for one referrer.
 *  - Referral rewards ledger (every reward / payout is a row).
 *  - Telegram payout link surfaced from config.
 *
 *  Run on existing DB:
 *    psql "$DATABASE_URL" -f database/migrations/007_referral_program.sql
 *
 *  Idempotent: safe to re-run.
 */

create extension if not exists pgcrypto;

-- ─── Users: lifetime grants + revshare + Telegram link ─────────────────────────

alter table users
  add column if not exists lifetime_tier text
    check (lifetime_tier in ('free', 'basic', 'premium', 'ultimate'));

alter table users
  add column if not exists tier_granted_at timestamptz;

alter table users
  add column if not exists revshare_unlocked_at timestamptz;

alter table users
  add column if not exists revshare_rate_bps integer not null default 0
    check (revshare_rate_bps >= 0 and revshare_rate_bps <= 10000);

-- Cash already earned + paid out by the operator (in cents, USD).
alter table users
  add column if not exists referral_earned_cents bigint not null default 0
    check (referral_earned_cents >= 0);

alter table users
  add column if not exists referral_paid_cents bigint not null default 0
    check (referral_paid_cents >= 0);

alter table users
  add column if not exists referral_payout_handle text;

-- One-credit-per-IP guard. Stored as a small jsonb array so the row stays a
-- single update; the referral pipeline filters duplicates client-side and
-- never lets it grow unbounded (capped at 256 IPs in the application code).
alter table users
  add column if not exists referral_credit_ips jsonb not null default '[]'::jsonb;

create index if not exists users_lifetime_tier_idx on users (lifetime_tier);
create index if not exists users_revshare_unlocked_idx on users (revshare_unlocked_at)
  where revshare_unlocked_at is not null;

-- ─── Referral signups: tag whether the row counted (post-fraud-check) ─────────

alter table referral_signups
  add column if not exists counted boolean not null default true;

alter table referral_signups
  add column if not exists fraud_reason text;

create index if not exists referral_signups_counted_idx on referral_signups (counted, referrer_user_id);

-- The `referral_signups_count` denormalization needs to only count `counted`
-- rows from here on. Replace the trigger function accordingly.
create or replace function bump_referrer_signups_count()
returns trigger as $$
begin
  if new.counted then
    update users
       set referral_signups_count = referral_signups_count + 1,
           updated_at = now()
     where id = new.referrer_user_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists tr_referral_signups_insert on referral_signups;
create trigger tr_referral_signups_insert
  after insert on referral_signups
  for each row execute procedure bump_referrer_signups_count();

-- ─── Reward ledger ─────────────────────────────────────────────────────────────

create table if not exists referral_rewards (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  referrer_user_id uuid not null references users (id) on delete cascade,
  referred_user_id uuid references users (id) on delete set null,
  source_payment_id uuid references payments (id) on delete set null,
  reward_type text not null check (reward_type in (
    'lifetime_tier_grant',
    'revshare_unlocked',
    'revshare_accrual',
    'cash_payout'
  )),
  tier_granted text check (tier_granted in ('basic', 'premium', 'ultimate')),
  revshare_rate_bps integer check (revshare_rate_bps >= 0 and revshare_rate_bps <= 10000),
  amount_cents integer check (amount_cents >= 0),
  status text not null default 'granted' check (status in (
    'granted', 'pending_payout', 'paid', 'revoked'
  )),
  notes text
);

create index if not exists referral_rewards_referrer_idx on referral_rewards (referrer_user_id, created_at desc);
create index if not exists referral_rewards_type_idx on referral_rewards (reward_type);
create index if not exists referral_rewards_status_idx on referral_rewards (status, created_at desc);
create index if not exists referral_rewards_payment_idx on referral_rewards (source_payment_id);

-- ─── Cached leaderboards (weekly + all-time) ───────────────────────────────────
--
-- A materialized view would be cleaner but we avoid the operational overhead
-- (manual refresh) — instead the leaderboard query is computed live with
-- limit/offset; an index on counted signups + created_at keeps it cheap.

create index if not exists referral_signups_recent_idx
  on referral_signups (created_at desc)
  where counted = true;
