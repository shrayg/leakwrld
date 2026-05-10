import { getVisitorKey } from './analytics';

/** Avoid duplicate session_start when React Strict Mode remounts quickly (same storage key). */
const lastManifestSessionAt = new Map();

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `lw-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Fire-and-forget media engagement (views / sessions / watch time / likes). */
export function postMediaAnalytics(payload) {
  const visitorKey = getVisitorKey();
  fetch('/api/analytics/media', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      ...payload,
      ...(visitorKey ? { visitorKey } : {}),
    }),
  }).catch(() => {});
}

/** Parse UI duration like `1:05` into seconds (catalog shorts / hero chips). */
export function parseCatalogDurationSeconds(value) {
  const parts = String(value || '0:00').split(':').map((p) => Number(p) || 0);
  if (parts.length === 2) return Math.min(3600, parts[0] * 60 + parts[1]);
  return 0;
}

/**
 * Starts a catalog playback session (`short-*` media_items row). Returns `playbackSessionId`
 * — pass it to `catalogMediaWatchProgress` so watch time aggregates in admin Media stats.
 */
export function catalogMediaSession(mediaItemId, opts = {}) {
  const playbackSessionId = opts.playbackSessionId || uuid();
  const durationSeconds = Math.min(86400, Math.max(0, Math.floor(Number(opts.durationSeconds ?? 0) || 0)));
  postMediaAnalytics({
    action: 'session_start',
    mediaItemId,
    playbackSessionId,
    durationSeconds,
  });
  return playbackSessionId;
}

/** Adds watched seconds for a catalog item (must reuse the same playback session id when possible). */
export function catalogMediaWatchProgress(mediaItemId, playbackSessionId, secondsDelta, durationSeconds = 0) {
  const d = Math.min(120, Math.max(0, Math.floor(Number(secondsDelta) || 0)));
  const dur = Math.min(86400, Math.max(0, Math.floor(Number(durationSeconds) || 0)));
  if (d <= 0 && dur <= 0) return;
  postMediaAnalytics({
    action: 'progress',
    mediaItemId,
    playbackSessionId,
    secondsDelta: d,
    durationSeconds: dur,
  });
}

export function catalogMediaLike(mediaItemId) {
  postMediaAnalytics({
    action: 'like',
    mediaItemId,
  });
}

export function manifestMediaSessionStart({
  storageKey,
  creatorSlug,
  kind,
  playbackSessionId,
  durationSeconds = 0,
}) {
  const now = Date.now();
  const prev = lastManifestSessionAt.get(storageKey) || 0;
  if (now - prev < 900) return;
  lastManifestSessionAt.set(storageKey, now);
  postMediaAnalytics({
    action: 'session_start',
    storageKey,
    creatorSlug,
    kind,
    playbackSessionId,
    durationSeconds,
  });
}

export function manifestMediaProgress({
  storageKey,
  creatorSlug,
  kind,
  playbackSessionId,
  secondsDelta,
  durationSeconds = 0,
}) {
  postMediaAnalytics({
    action: 'progress',
    storageKey,
    creatorSlug,
    kind,
    playbackSessionId,
    secondsDelta,
    durationSeconds,
  });
}

export function manifestMediaLike({ storageKey, creatorSlug, kind }) {
  postMediaAnalytics({
    action: 'like',
    storageKey,
    creatorSlug,
    kind,
  });
}

export { uuid as mediaPlaybackSessionId };
