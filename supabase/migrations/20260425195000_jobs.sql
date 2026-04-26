create extension if not exists pgmq;
create extension if not exists pg_cron;

select pgmq.create('video_jobs');

create or replace function public.enqueue_video_aggregation()
returns void
language sql
security definer
as $$
  select pgmq.send(
    'video_jobs',
    '{"type":"aggregate_daily_metrics"}'::jsonb
  );
$$;

select cron.schedule(
  'daily-video-rollup',
  '*/15 * * * *',
  $$select public.enqueue_video_aggregation();$$
);
