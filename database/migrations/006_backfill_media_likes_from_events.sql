-- Backfill unique media likes from historical analytics events.
-- This de-duplicates repeated like clicks from the same user/visitor.

insert into media_item_likes (media_item_id, actor_key, created_at)
select
  coalesce(mi.id, e.path) as media_item_id,
  coalesce(
    case when e.user_id is not null then 'u:' || e.user_id::text else null end,
    case when e.visitor_key is not null then 'v:' || e.visitor_key::text else null end
  ) as actor_key,
  min(e.created_at) as created_at
from analytics_events e
left join media_items mi
  on mi.id = e.path
  or mi.storage_path = e.path
where e.event_type = 'media_like'
  and coalesce(
    case when e.user_id is not null then 'u:' || e.user_id::text else null end,
    case when e.visitor_key is not null then 'v:' || e.visitor_key::text else null end
  ) is not null
group by coalesce(mi.id, e.path),
  coalesce(
    case when e.user_id is not null then 'u:' || e.user_id::text else null end,
    case when e.visitor_key is not null then 'v:' || e.visitor_key::text else null end
  )
on conflict do nothing;

update media_items m
set likes = coalesce(x.like_count, 0),
  updated_at = now()
from (
  select media_item_id, count(*)::int as like_count
  from media_item_likes
  group by media_item_id
) x
where x.media_item_id = m.id;
