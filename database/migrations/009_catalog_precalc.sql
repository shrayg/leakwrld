/**
 * Precalculated shorts catalog + ingest metadata + optional HLS master key.
 *
 *   psql "$DATABASE_URL" -f database/migrations/009_catalog_precalc.sql
 *
 * Idempotent: safe to re-run.
 */

create table if not exists catalog_ingest_state (
  id int primary key check (id = 1),
  catalog_version int not null default 0,
  ingest_seed text not null default '',
  manifest_fingerprint text not null default '',
  row_count int not null default 0,
  updated_at timestamptz not null default now()
);

insert into catalog_ingest_state (id, catalog_version, ingest_seed, manifest_fingerprint, row_count)
values (1, 0, '', '', 0)
on conflict (id) do nothing;

create table if not exists feed_categories (
  slug text primary key,
  name text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  rule_type text not null default 'algorithmic' check (rule_type in ('algorithmic', 'manual'))
);

insert into feed_categories (slug, name, sort_order, active, rule_type) values
  ('trending', 'Trending', 1, true, 'algorithmic'),
  ('top-videos', 'Top videos', 2, true, 'algorithmic'),
  ('featured', 'Featured', 3, true, 'algorithmic')
on conflict (slug) do nothing;

create table if not exists catalog_shorts (
  catalog_version int not null,
  storage_key text not null,
  creator_slug text not null,
  creator_name text not null,
  creator_thumbnail text,
  name text not null,
  title text not null,
  kind text not null,
  tier text not null,
  ext text not null default '',
  size_bytes bigint not null default 0,
  creator_rank int not null default 999,
  creator_heat int not null default 0,
  category_slugs text[] not null default array[]::text[],
  interleave_position int not null,
  shuffle_position int not null,
  trending_rank int not null,
  top_rank int not null,
  likes_rank int not null,
  featured_shuffle_position int,
  thumb_path text,
  views int not null default 0,
  likes int not null default 0,
  duration_seconds int not null default 0,
  hls_master_key text,
  primary key (catalog_version, storage_key)
);

create index if not exists catalog_shorts_version_shuffle_idx
  on catalog_shorts (catalog_version, shuffle_position);

create index if not exists catalog_shorts_version_creator_idx
  on catalog_shorts (catalog_version, creator_slug);

create index if not exists catalog_shorts_version_trending_idx
  on catalog_shorts (catalog_version, trending_rank);

create index if not exists catalog_shorts_version_top_idx
  on catalog_shorts (catalog_version, top_rank);

create index if not exists catalog_shorts_version_likes_idx
  on catalog_shorts (catalog_version, likes_rank);

create index if not exists catalog_shorts_categories_gin
  on catalog_shorts using gin (category_slugs);

create table if not exists catalog_category_counts (
  catalog_version int not null,
  category_slug text not null,
  count int not null default 0,
  primary key (catalog_version, category_slug)
);
