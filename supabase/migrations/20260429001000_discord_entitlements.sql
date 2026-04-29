create table if not exists public.discord_account_links (
  user_key text primary key,
  discord_user_id text unique,
  discord_username text,
  linked_at timestamptz,
  unlinked_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists discord_account_links_discord_user_id_idx
  on public.discord_account_links(discord_user_id);

create index if not exists discord_account_links_updated_at_idx
  on public.discord_account_links(updated_at desc);

create table if not exists public.access_entitlements (
  user_key text primary key,
  tier integer not null default 0,
  status text not null default 'inactive',
  source text not null default 'system',
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint access_entitlements_tier_check check (tier in (0, 1, 2)),
  constraint access_entitlements_status_check check (status in ('active', 'inactive', 'revoked', 'expired'))
);

create index if not exists access_entitlements_status_tier_idx
  on public.access_entitlements(status, tier, updated_at desc);

create table if not exists public.discord_role_sync_jobs (
  id bigserial primary key,
  user_key text not null,
  discord_user_id text not null,
  guild_id text not null,
  desired_tier integer not null default 0,
  desired_role_ids jsonb not null default '[]'::jsonb,
  status text not null default 'pending',
  reason text,
  attempts integer not null default 0,
  last_error text,
  queued_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint discord_role_sync_jobs_status_check check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled'))
);

create index if not exists discord_role_sync_jobs_status_queued_idx
  on public.discord_role_sync_jobs(status, queued_at asc);

create index if not exists discord_role_sync_jobs_user_key_idx
  on public.discord_role_sync_jobs(user_key, queued_at desc);

alter table public.discord_account_links enable row level security;
alter table public.access_entitlements enable row level security;
alter table public.discord_role_sync_jobs enable row level security;

drop policy if exists "discord_account_links_service_role_all" on public.discord_account_links;
create policy "discord_account_links_service_role_all"
  on public.discord_account_links
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "access_entitlements_service_role_all" on public.access_entitlements;
create policy "access_entitlements_service_role_all"
  on public.access_entitlements
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "discord_role_sync_jobs_service_role_all" on public.discord_role_sync_jobs;
create policy "discord_role_sync_jobs_service_role_all"
  on public.discord_role_sync_jobs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
