const STORAGE_KEY = 'lw_visitor_key';

function validUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s || ''));
}

export function getVisitorKey() {
  try {
    let k = localStorage.getItem(STORAGE_KEY);
    if (!validUuid(k)) {
      k = crypto.randomUUID();
      localStorage.setItem(STORAGE_KEY, k);
    }
    return k;
  } catch {
    return null;
  }
}

/** Fire-and-forget page view for admin traffic charts (requires DATABASE_URL on server). */
export function recordPageView(path) {
  const visitorKey = getVisitorKey();
  const p = String(path || '/').slice(0, 512);
  fetch('/api/analytics/visit', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      path: p,
      visitorKey,
      referrer: typeof document !== 'undefined' ? document.referrer || null : null,
    }),
  }).catch(() => {});
}
