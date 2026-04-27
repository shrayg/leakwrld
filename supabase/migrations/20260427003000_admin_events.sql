create table if not exists public.admin_events (
  id bigserial primary key,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_events_type_created_idx
  on public.admin_events(event_type, created_at desc);

create index if not exists admin_events_created_idx
  on public.admin_events(created_at desc);

alter table public.admin_events enable row level security;

drop policy if exists "admin_events_service_role_all" on public.admin_events;
create policy "admin_events_service_role_all"
  on public.admin_events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
