import { recordEvent } from './analytics';

/** @type {Map<string, number>} */
const lastSent = new Map();
const DEDupe_MS = 25_000;

/**
 * Reads the latest PerformanceResourceTiming for an absolute or same-origin URL (e.g. `/r2/...`).
 * @param {string} url
 * @returns {object | null}
 */
export function pickR2ResourceTiming(url) {
  if (typeof performance === 'undefined' || !url || !performance.getEntriesByName) return null;
  const entries = performance.getEntriesByName(url, 'resource');
  if (!entries || !entries.length) return null;
  const e = entries[entries.length - 1];
  const responseStart = Number(e.responseStart);
  const duration = Number(e.duration);
  const out = {};
  if (Number.isFinite(responseStart) && responseStart > 0) out.responseStart = Math.round(responseStart);
  if (Number.isFinite(duration) && duration > 0) out.duration = Math.round(duration);
  return Object.keys(out).length ? out : null;
}

/**
 * Fire-and-forget `media_load_timing` → `analytics_events` (throttled per surface+key).
 * @param {Record<string, unknown>} payload
 */
export function recordMediaLoadTiming(payload) {
  const surface = String(payload.surface || 'unknown').slice(0, 64);
  const key = String(payload.storageKey || payload.url || 'none').slice(0, 200);
  const dedupeKey = `${surface}:${key}`;
  const now = Date.now();
  const prev = lastSent.get(dedupeKey) || 0;
  if (now - prev < DEDupe_MS) return;
  lastSent.set(dedupeKey, now);
  if (lastSent.size > 400) {
    for (const k of lastSent.keys()) {
      lastSent.delete(k);
      if (lastSent.size < 200) break;
    }
  }
  recordEvent('media_load_timing', {
    category: 'media_perf',
    path: typeof window !== 'undefined' ? window.location.pathname : '/',
    payload: {
      ...payload,
      at: now,
    },
  });
}
