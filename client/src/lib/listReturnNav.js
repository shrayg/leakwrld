/** React Router `location.state` key: full path to reopen the list/grid the user came from */
export const PW_RETURN_LIST_PATH = 'pwReturnListPath';

function isSafeInternalPath(path) {
  const s = String(path || '').trim();
  return s.startsWith('/') && !s.startsWith('//');
}

/** @param {string | undefined} pathnameSearch pathname + optional search (e.g. `/teen-18-plus?page=3`) */
export function listReturnNavState(pathnameSearch) {
  if (pathnameSearch == null) return undefined;
  const s = String(pathnameSearch).trim();
  if (!isSafeInternalPath(s)) return undefined;
  return { [PW_RETURN_LIST_PATH]: s };
}

/** Video page Back targets stored list URL when present, otherwise category/home fallback */
export function resolveBackToListHref(locationState, fallbackHref) {
  const raw =
    locationState && typeof locationState[PW_RETURN_LIST_PATH] === 'string'
      ? locationState[PW_RETURN_LIST_PATH].trim()
      : '';
  if (isSafeInternalPath(raw)) return raw;
  return fallbackHref || '/';
}
