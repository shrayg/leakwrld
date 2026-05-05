/** Mirrors script.js clean URL maps for React Router links and canonical URLs. */

export const FOLDER_TO_CLEAN = {
  'NSFW Straight': '/nsfw-straight',
  'Alt and Goth': '/alt-and-goth',
  Petitie: '/petitie',
  'Teen (18+ only)': '/teen-18-plus',
  MILF: '/milf',
  Asian: '/asian',
  Ebony: '/ebony',
  Feet: '/feet',
  Hentai: '/hentai',
  Yuri: '/yuri',
  Yaoi: '/yaoi',
  'Nip Slips': '/nip-slips',
  Omegle: '/omegle',
  'OF Leaks': '/of-leaks',
};

/** Public label for category pages (API `folder` stays canonical, e.g. Yuri). */
const FOLDER_DISPLAY_NAME = {
  Yuri: 'Lesbian',
};

export function folderDisplayName(folder) {
  const f = String(folder || '');
  return FOLDER_DISPLAY_NAME[f] || f;
}

export const CLEAN_TO_FOLDER = {
  '/nsfw-straight': 'NSFW Straight',
  '/alt-and-goth': 'Alt and Goth',
  '/petitie': 'Petitie',
  '/teen-18-plus': 'Teen (18+ only)',
  '/milf': 'MILF',
  '/asian': 'Asian',
  '/ebony': 'Ebony',
  '/feet': 'Feet',
  '/hentai': 'Hentai',
  '/yuri': 'Yuri',
  '/yaoi': 'Yaoi',
  '/nip-slips': 'Nip Slips',
  '/omegle': 'Omegle',
  '/of-leaks': 'OF Leaks',
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
