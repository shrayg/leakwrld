/** Mirrors script.js clean URL maps for React Router links and canonical URLs. */

export const FOLDER_TO_CLEAN = {
  'NSFW Straight': '/nsfw-straight',
  'Alt and Goth': '/alt-and-goth',
  Petitie: '/petitie',
  'Teen (18+ only)': '/teen-18-plus',
  MILF: '/milf',
  Asian: '/asian',
  Ebony: '/ebony',
  Hentai: '/hentai',
  Yuri: '/yuri',
  Yaoi: '/yaoi',
  'Nip Slips': '/nip-slips',
  Omegle: '/omegle',
  'OF Leaks': '/of-leaks',
  'Premium Leaks': '/premium-leaks',
};

export const CLEAN_TO_FOLDER = {
  '/nsfw-straight': 'NSFW Straight',
  '/alt-and-goth': 'Alt and Goth',
  '/petitie': 'Petitie',
  '/teen-18-plus': 'Teen (18+ only)',
  '/milf': 'MILF',
  '/asian': 'Asian',
  '/ebony': 'Ebony',
  '/hentai': 'Hentai',
  '/yuri': 'Yuri',
  '/yaoi': 'Yaoi',
  '/nip-slips': 'Nip Slips',
  '/omegle': 'Omegle',
  '/of-leaks': 'OF Leaks',
  '/premium-leaks': 'Premium Leaks',
};

export function folderToCleanPath(folder) {
  return FOLDER_TO_CLEAN[folder] || null;
}

export function folderToCleanUrl(folder) {
  const p = FOLDER_TO_CLEAN[folder];
  if (p) return p;
  return '/folder?folder=' + encodeURIComponent(folder);
}

export function cleanPathToFolder(pathname) {
  const n = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return CLEAN_TO_FOLDER[n] || '';
}
