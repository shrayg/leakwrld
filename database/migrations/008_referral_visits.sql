/**
 * Leak World referral program — IP→code tracking.
 *
 *  Records every time an IP visits the site with a referral code, so signup
 *  attribution survives:
 *    - cleared cookies
 *    - the user opening a new browser / different device on the same network
 *    - the user landing on the site, browsing for days, then signing up
 *
 *  Attribution priority at signup time:
 *     1. explicit `referralCode` form field
 *     2. `lw_ref` cookie (set on first visit, 30-day TTL)
 *     3. `referral_visits` lookup by signup IP (LAST code seen wins)
 *
 *  We keep only the most recent code per IP — repeated clicks on the same
 *  referrer's link refresh `last_seen_at`; clicks on a different referrer's
 *  link overwrite the code so the latest click attributes.
 *
 *  Run on existing DB:
 *    psql "$DATABASE_URL" -f database/migrations/008_referral_visits.sql
 *
 *  Idempotent: safe to re-run.
 */

create table if not exists referral_visits (
  ip text primary key,
  code text not null check (code ~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists referral_visits_last_seen_idx on referral_visits (last_seen_at desc);
create index if not exists referral_visits_code_idx on referral_visits (code);
