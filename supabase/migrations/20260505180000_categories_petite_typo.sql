-- Rename slug/label typo petitie/Petitie → petite/Petite (matches app + R2 category folder spelling)
update public.categories
set slug = 'petite',
    label = 'Petite'
where slug = 'petitie';
