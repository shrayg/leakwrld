-- Final consolidation: keep canonical public.users only.
-- Also remove any persisted age verification storage.

-- Merge any remaining legacy profile rows into users.profile before dropping.
do $$
begin
  if to_regclass('public.profiles') is not null then
    execute $sql$
      insert into public.users (
        user_key,
        auth_user_id,
        username,
        provider,
        profile,
        created_at,
        updated_at
      )
      select
        p.id::text as user_key,
        p.id as auth_user_id,
        coalesce(nullif(p.handle, ''), p.id::text) as username,
        'local' as provider,
        jsonb_build_object(
          'display_name', p.display_name,
          'avatar_url', p.avatar_url,
          'bio', p.bio
        ) as profile,
        coalesce(p.created_at, now()),
        coalesce(p.updated_at, now())
      from public.profiles p
      on conflict (user_key) do update
      set
        auth_user_id = coalesce(public.users.auth_user_id, excluded.auth_user_id),
        username = coalesce(nullif(public.users.username, ''), excluded.username),
        profile = public.users.profile || excluded.profile,
        updated_at = greatest(public.users.updated_at, excluded.updated_at)
    $sql$;
  end if;
end $$;

-- Ensure no age verification data persists in users either.
alter table if exists public.users
  drop column if exists age_verified_at;

-- Drop persisted age gate event storage.
drop table if exists public.age_gate_events cascade;

-- Drop duplicate legacy profile table.
drop table if exists public.profiles cascade;
