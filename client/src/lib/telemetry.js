function safeNow() {
  return Date.now();
}

function safeString(value, max = 128) {
  return String(value || '').slice(0, max);
}

/** Matches server `canonicalVideoId` — vault tier folder only (no video/photo/gif segment). */
export function buildVideoId(folder, subfolder, name, vault) {
  const v = safeString(vault || '', 32).trim().toLowerCase();
  if (!v) {
    return [safeString(folder, 80), safeString(subfolder, 80), safeString(name, 180)].join('|');
  }
  return [safeString(folder, 80), safeString(subfolder, 80), v, safeString(name, 180)].join('|');
}

export function sendTelemetry(eventType, payload = {}) {
  const body = JSON.stringify({
    eventType: safeString(eventType, 48),
    ts: safeNow(),
    ...payload,
  });
  const url = '/api/telemetry/event';
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(url, blob)) return;
    }
  } catch {}
  fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}

