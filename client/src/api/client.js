/**
 * Central API client — same-origin, credentials included (tbw_session cookie).
 * When Supabase session exists, adds Authorization: Bearer for /api/* auth.
 */
const JSON_HEADERS = { 'Content-Type': 'application/json' };

let accessTokenGetter = () => null;

/** Wired by SupabaseAuthProvider when env keys are present. */
export function setApiAccessTokenGetter(fn) {
  accessTokenGetter = typeof fn === 'function' ? fn : () => null;
}

function authHeaders() {
  const t = accessTokenGetter();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function apiGet(path, opts = {}) {
  const { headers: hdr = {}, ...rest } = opts;
  const r = await fetch(path, {
    cache: rest.cache ?? 'no-store',
    credentials: 'same-origin',
    headers: { ...authHeaders(), ...hdr },
    ...rest,
  });
  return r;
}

export async function apiJson(path, opts = {}) {
  const r = await apiGet(path, opts);
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: r.ok, status: r.status, data };
}

/**
 * Retry transient read failures (network/5xx) for homepage rails and similar UX-critical reads.
 * Keeps behavior deterministic for 4xx (auth/tier) responses.
 */
async function apiJsonWithRetry(path, opts = {}) {
  const retries = Number.isFinite(opts.retries) ? opts.retries : 1;
  const retryDelayMs = Number.isFinite(opts.retryDelayMs) ? opts.retryDelayMs : 250;
  const cleanOpts = { ...opts };
  delete cleanOpts.retries;
  delete cleanOpts.retryDelayMs;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await apiJson(path, cleanOpts);
      if (res.ok) return res;
      if (res.status < 500 || attempt >= retries) return res;
    } catch (err) {
      if (attempt >= retries) throw err;
    }
    await sleep(retryDelayMs * (attempt + 1));
  }
  return apiJson(path, cleanOpts);
}

export async function apiPost(path, body, opts = {}) {
  const { headers: hdr = {}, ...rest } = opts;
  const r = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { ...JSON_HEADERS, ...authHeaders(), ...hdr },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...rest,
  });
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: r.ok, status: r.status, data };
}

export async function fetchMe() {
  return apiJson('/api/me');
}

export async function fetchAccount() {
  return apiJson('/api/account');
}

export async function updateAccount(payload) {
  return apiPost('/api/account', payload);
}

export async function fetchConnectUrl(provider) {
  return apiJson('/api/account/connect?provider=' + encodeURIComponent(provider));
}

export async function disconnectProvider(provider) {
  return apiPost('/api/account/disconnect', { provider });
}

export async function fetchRandomVideos(params) {
  const q = new URLSearchParams(params || {});
  return apiJsonWithRetry('/api/random-videos?' + q.toString(), { retries: 2, retryDelayMs: 300 });
}

export async function fetchFolderCounts() {
  return apiJson('/api/folder-counts');
}

export async function fetchTrending(limit = 8) {
  return apiJson('/api/trending?limit=' + encodeURIComponent(String(limit)));
}

export async function fetchNewest(limit = 8) {
  return apiJsonWithRetry('/api/newest?limit=' + encodeURIComponent(String(limit)), {
    retries: 2,
    retryDelayMs: 300,
  });
}

export async function fetchRecommendations(limit = 8, opts = {}) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (opts.surface) q.set('surface', String(opts.surface));
  if (opts.contextVideoId) q.set('contextVideoId', String(opts.contextVideoId));
  if (opts.contextFolder) q.set('contextFolder', String(opts.contextFolder));
  return apiJsonWithRetry('/api/recommendations?' + q.toString(), {
    retries: 2,
    retryDelayMs: 300,
  });
}

export async function fetchRelatedRecommendations(videoId, limit = 8) {
  const q = new URLSearchParams({ videoId: String(videoId || ''), limit: String(limit) });
  return apiJson('/api/recommendations/related?' + q.toString());
}

export async function postTelemetryEvent(payload) {
  return apiPost('/api/telemetry/event', payload);
}

export async function fetchVideos(query) {
  const q = typeof query === 'string' ? query : new URLSearchParams(query).toString();
  return apiJson('/api/videos?' + q);
}

export async function fetchPreviewList(folder) {
  return apiJson('/api/preview/list?folder=' + encodeURIComponent(folder));
}

export async function fetchList(folder, subfolder) {
  const q = new URLSearchParams({ folder });
  if (subfolder) q.set('subfolder', subfolder);
  return apiJson('/api/list?' + q.toString());
}

export async function fetchVideoStats(key) {
  return apiJson('/api/video/stats?key=' + encodeURIComponent(key));
}

export async function postVideoStats(body) {
  return apiPost('/api/video/stats', body);
}

export async function fetchComments(key) {
  return apiJson('/api/comments?key=' + encodeURIComponent(key));
}

export async function postComment(key, text) {
  return apiPost('/api/comments', { key, text });
}

export async function fetchVideoUploaderMeta(params) {
  const q = new URLSearchParams();
  q.set('folder', String(params?.folder || ''));
  q.set('name', String(params?.name || ''));
  if (params?.subfolder) q.set('subfolder', String(params.subfolder));
  return apiJson('/api/video/uploader?' + q.toString());
}

export async function fetchVideoRenameStatus(params) {
  const q = new URLSearchParams();
  q.set('folder', String(params?.folder || ''));
  q.set('name', String(params?.name || ''));
  if (params?.subfolder) q.set('subfolder', String(params.subfolder));
  if (params?.vault) q.set('vault', String(params.vault));
  return apiJson('/api/video-rename/status?' + q.toString());
}

export async function requestVideoRename(body) {
  return apiPost('/api/video-rename/request', body);
}

export async function cancelVideoRename(body) {
  return apiPost('/api/video-rename/cancel', body);
}

export async function toggleCreatorFollow(targetUserKey, follow) {
  return apiPost('/api/creator/follow', { targetUserKey, follow });
}

export async function uploadUserAssets(formData) {
  const r = await fetch('/api/userassets/upload', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { ...authHeaders() },
    body: formData,
  });
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: r.ok, status: r.status, data };
}

export async function resolveCleanVideo(categorySlug, videoSlug) {
  const q = new URLSearchParams({ category: categorySlug, video: videoSlug });
  return apiJson('/api/resolve-clean-video?' + q.toString());
}

export async function fetchReferralStatus() {
  return apiJson('/api/referral/status');
}

export async function logout() {
  return apiPost('/api/logout', {});
}

export async function login(body) {
  return apiPost('/api/login', body);
}

export async function signup(body) {
  return apiPost('/api/signup', body);
}

/** Tier 1+ search / library (auth + tier required). Same as GET /api/videos. */
export async function fetchVideoLibrary(params) {
  const q =
    typeof params === 'string'
      ? params
      : new URLSearchParams(
          params && typeof params === 'object' ? params : {},
        ).toString();
  return apiJson('/api/videos?' + q);
}

export async function fetchShortsStats() {
  return apiJson('/api/shorts/stats');
}

export async function postShortsView(key) {
  return apiPost('/api/shorts/view', { key });
}

export async function postShortsLike(key, liked) {
  return apiPost('/api/shorts/like', { key, liked });
}

export async function fetchCams(limit = 5) {
  return apiJson('/api/cams?limit=' + encodeURIComponent(String(limit)));
}

export async function fetchLiveActivity() {
  return apiJson('/api/live-activity');
}

export async function redeemAccessKey(accessKey) {
  return apiPost('/api/redeem-key', { accessKey });
}
