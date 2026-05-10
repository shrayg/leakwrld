-- Speed lookups when correlating R2 manifest keys to media_items.storage_path
create index if not exists media_items_storage_path_idx on media_items (storage_path)
  where storage_path is not null and storage_path <> '';
