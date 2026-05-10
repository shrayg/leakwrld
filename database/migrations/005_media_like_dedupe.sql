-- Prevent like-farming by allowing at most one persisted like per actor/media pair.
create table if not exists media_item_likes (
  media_item_id text not null references media_items (id) on delete cascade,
  actor_key text not null,
  created_at timestamptz not null default now(),
  primary key (media_item_id, actor_key)
);

create index if not exists media_item_likes_created_idx on media_item_likes (created_at desc);
