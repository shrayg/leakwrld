-- Optional phone on users (nullable unique — multiple NULLs allowed).
alter table users add column if not exists phone text;
create unique index if not exists users_phone_unique_idx on users (phone) where phone is not null;
