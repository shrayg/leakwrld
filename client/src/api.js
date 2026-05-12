/**
 * @param {string} path
 * @param {unknown} fallback
 * @param {{ signal?: AbortSignal }} [opts]
 */
export async function apiGet(path, fallback, opts = {}) {
  try {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: opts.signal,
    });
    if (!response.ok) return fallback;
    return await response.json();
  } catch {
    return fallback;
  }
}

export async function apiPost(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body || {}),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const err = new Error(data?.error || 'Request failed');
    err.status = response.status;
    if (data?.retryAfterSeconds != null) {
      err.retryAfterSeconds = Number(data.retryAfterSeconds);
    }
    throw err;
  }
  return data;
}

export function money(cents) {
  return '$' + (Number(cents || 0) / 100).toFixed(2);
}
