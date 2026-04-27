create table if not exists public.app_state (
  state_key text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists app_state_updated_at_idx
  on public.app_state(updated_at desc);

alter table public.app_state enable row level security;

drop policy if exists "app_state_service_role_all" on public.app_state;
create policy "app_state_service_role_all"
  on public.app_state
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
