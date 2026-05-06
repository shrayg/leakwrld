-- UI label only; API folder + R2 prefix stay "Hentai" / hentai.
update public.categories
set label = 'Hentai/Cosplay'
where slug = 'hentai';
