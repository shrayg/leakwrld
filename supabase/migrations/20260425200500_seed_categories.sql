insert into public.categories (slug, label)
values
  ('nsfw-straight', 'NSFW Straight'),
  ('alt-and-goth', 'Alt and Goth'),
  ('petite', 'Petite'),
  ('teen-18-plus', 'Teen (18+ only)'),
  ('milf', 'MILF'),
  ('asian', 'Asian'),
  ('ebony', 'Ebony'),
  ('hentai', 'Hentai'),
  ('yuri', 'Yuri'),
  ('yaoi', 'Yaoi'),
  ('nip-slips', 'Nip Slips'),
  ('omegle', 'Omegle'),
  ('of-leaks', 'OF Leaks')
on conflict (slug) do update
set label = excluded.label;
