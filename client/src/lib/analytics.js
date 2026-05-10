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

async function postVisitOnce(path) {
  const visitorKey = getVisitorKey();
  const p = String(path || '/').slice(0, 512);
  const res = await fetch('/api/analytics/visit', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      path: p,
      visitorKey,
      referrer: typeof document !== 'undefined' ? document.referrer || null : null,
    }),
  });
  return res.ok;
}

/** Page-view beacon → `analytics_visits` + `page_view` in `analytics_events`. Retries once on failure. */
export function recordPageView(path) {
  postVisitOnce(path)
    .then((ok) => {
      if (ok) return;
      return new Promise((r) => setTimeout(r, 500)).then(() => postVisitOnce(path));
    })
    .catch(() => {});
}

/**
 * Structured product events → `analytics_events` only (see Admin → Events).
 * @param {string} eventType — short snake_case name, e.g. `creator_profile_view`
 * @param {{ path?: string, category?: string|null, payload?: Record<string, unknown> }} [opts]
 */
export function recordEvent(eventType, opts = {}) {
  const et = String(eventType || '').trim().slice(0, 96);
  if (!et) return;

  const visitorKey = getVisitorKey();
  const path =
    opts.path != null
      ? String(opts.path).slice(0, 512)
      : typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.search || ''}`
        : '/';
  const category = opts.category != null ? String(opts.category).slice(0, 128) : null;
  const payload = opts.payload && typeof opts.payload === 'object' ? opts.payload : {};

  const body = JSON.stringify({
    eventType: et,
    path,
    category,
    payload,
    visitorKey,
  });

  function postOnce() {
    return fetch('/api/analytics/event', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    }).then((r) => r.ok);
  }

  postOnce()
    .then((ok) => {
      if (ok) return;
      return new Promise((r) => setTimeout(r, 400)).then(postOnce);
    })
    .catch(() => {});
}
