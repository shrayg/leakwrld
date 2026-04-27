create table if not exists public.account_profiles (
  user_key text primary key,
  username text not null,
  display_name text not null,
  avatar_url text,
  banner_url text,
  bio text,
  twitter_url text,
  instagram_url text,
  website_url text,
  followers_count bigint not null default 0,
  video_views bigint not null default 0,
  rank integer not null default 0,
  videos jsonb not null default '[]'::jsonb,
  photos jsonb not null default '[]'::jsonb,
  gifs jsonb not null default '[]'::jsonb,
  username_changed_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists account_profiles_username_idx on public.account_profiles(username);
create index if not exists account_profiles_updated_idx on public.account_profiles(updated_at desc);

alter table public.account_profiles enable row level security;

drop policy if exists "account_profiles_service_role_all" on public.account_profiles;
create policy "account_profiles_service_role_all"
  on public.account_profiles
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
