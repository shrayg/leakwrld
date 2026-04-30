-- Allow Patreon tiers 3–4 on users.tier (canonical monthly ladder).

alter table public.users drop constraint if exists users_tier_check;

alter table public.users
  add constraint users_tier_check check (tier in (0, 1, 2, 3, 4));
