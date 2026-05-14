let cache = null;
let inflight = null;

/**
 * Public site + media delivery flags (no secrets).
 * Cached for the session — hard refresh picks up new deploy config.
 */
export async function getSiteConfig() {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = fetch('/api/site-config', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : {}))
    .then((j) => {
      cache = {
        mediaPublicOrigin: String(j.mediaPublicOrigin || ''),
        mediaSigningEnabled: Boolean(j.mediaSigningEnabled),
        catalogPrecalc: Boolean(j.catalogPrecalc),
        catalogVersion: Number(j.catalogVersion || 0),
      };
      return cache;
    })
    .catch(() => {
      cache = {
        mediaPublicOrigin: '',
        mediaSigningEnabled: false,
        catalogPrecalc: false,
        catalogVersion: 0,
      };
      return cache;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function clearSiteConfigCache() {
  cache = null;
}
