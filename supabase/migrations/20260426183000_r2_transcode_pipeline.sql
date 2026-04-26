alter table public.video_assets
  add column if not exists source_object_key text,
  add column if not exists mp4_1080_object_key text,
  add column if not exists mp4_720_object_key text;

create table if not exists public.transcode_jobs (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  category_slug text not null,
  source_object_key text not null,
  output_720_object_key text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists transcode_jobs_status_idx on public.transcode_jobs(status, created_at);

alter table public.transcode_jobs enable row level security;

create policy "service role manages transcode jobs"
on public.transcode_jobs
for all
using (auth.jwt() ->> 'role' = 'service_role')
with check (auth.jwt() ->> 'role' = 'service_role');

create or replace function public.claim_transcode_job()
returns setof public.transcode_jobs
language plpgsql
security definer
as $$
declare
  claimed_id uuid;
begin
  select tj.id
  into claimed_id
  from public.transcode_jobs tj
  where tj.status = 'pending'
  order by tj.created_at asc
  for update skip locked
  limit 1;

  if claimed_id is null then
    return;
  end if;

  update public.transcode_jobs
  set status = 'processing',
      attempts = attempts + 1,
      updated_at = now()
  where id = claimed_id;

  return query
  select *
  from public.transcode_jobs
  where id = claimed_id;
end;
$$;
