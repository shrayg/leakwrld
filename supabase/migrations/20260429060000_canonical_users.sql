create extension if not exists pgcrypto;

create table if not exists public.users (
  user_key text primary key,
  auth_user_id uuid references auth.users(id) on delete set null,
  username text not null,
  email text,
  provider text not null default 'local',
  tier integer not null default 0,
  password_hash text,
  password_salt text,
  discord_user_id text,
  discord_username text,
  google_user_id text,
  google_email text,
  signup_ip text,
  referral_code text,
  referred_by text,
  referred_users jsonb not null default '[]'::jsonb,
  referral_credit_ips jsonb not null default '[]'::jsonb,
  profile jsonb not null default '{}'::jsonb,
  purchase jsonb not null default '{}'::jsonb,
  flags jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_tier_check check (tier in (0, 1, 2))
);

create index if not exists users_username_idx on public.users(username);
create index if not exists users_email_idx on public.users(email);
create index if not exists users_discord_user_id_idx on public.users(discord_user_id);
create index if not exists users_google_email_idx on public.users(google_email);
create index if not exists users_updated_at_idx on public.users(updated_at desc);

alter table public.users enable row level security;

drop policy if exists "users_service_role_all" on public.users;
create policy "users_service_role_all"
  on public.users
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Backfill from account_profiles when present.
insert into public.users (
  user_key,
  username,
  provider,
  tier,
  profile,
  created_at,
  updated_at
)
select
  ap.user_key,
  coalesce(nullif(ap.username, ''), ap.user_key),
  'local',
  0,
  jsonb_build_object(
    'display_name', ap.display_name,
    'avatar_url', ap.avatar_url,
    'banner_url', ap.banner_url,
    'bio', ap.bio,
    'twitter_url', ap.twitter_url,
    'instagram_url', ap.instagram_url,
    'website_url', ap.website_url,
    'followers_count', ap.followers_count,
    'video_views', ap.video_views,
    'rank', ap.rank
  ),
  coalesce(ap.created_at, now()),
  coalesce(ap.updated_at, now())
from public.account_profiles ap
on conflict (user_key) do update
set
  username = excluded.username,
  profile = public.users.profile || excluded.profile,
  updated_at = greatest(public.users.updated_at, excluded.updated_at);

-- Backfill basic profile rows from legacy profiles table (if linked to auth).
insert into public.users (
  user_key,
  auth_user_id,
  username,
  email,
  provider,
  profile,
  created_at,
  updated_at
)
select
  p.id::text as user_key,
  p.id as auth_user_id,
  coalesce(nullif(p.handle, ''), p.id::text) as username,
  null as email,
  'local' as provider,
  jsonb_build_object(
    'display_name', p.display_name,
    'avatar_url', p.avatar_url,
    'bio', p.bio
  ) as profile,
  coalesce(p.created_at, now()),
  coalesce(p.updated_at, now())
from public.profiles p
on conflict (user_key) do update
set
  auth_user_id = coalesce(public.users.auth_user_id, excluded.auth_user_id),
  username = coalesce(nullif(public.users.username, ''), excluded.username),
  profile = public.users.profile || excluded.profile,
  updated_at = greatest(public.users.updated_at, excluded.updated_at);

do $$
begin
  if to_regclass('public.access_entitlements') is not null then
    execute $sql$
      update public.users u
      set
        tier = greatest(0, least(2, coalesce(a.tier, 0))),
        updated_at = greatest(u.updated_at, coalesce(a.updated_at, now()))
      from public.access_entitlements a
      where a.user_key = u.user_key
    $sql$;
  end if;

  if to_regclass('public.discord_account_links') is not null then
    execute $sql$
      update public.users u
      set
        discord_user_id = d.discord_user_id,
        discord_username = d.discord_username,
        updated_at = greatest(u.updated_at, coalesce(d.updated_at, now()))
      from public.discord_account_links d
      where d.user_key = u.user_key
    $sql$;
  end if;
end $$;
