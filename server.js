const http = require('http');
const fs = require('fs');
const https = require('https');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const { URL } = require('url');
const { execFile } = require('child_process');
const { normalizeAccessKey, planFromProductSlug, tierForPaidPlan } = require('./lib/xyzpurchase');
const {
  planAmountCents,
  planKeyForTier,
  displayLabelForTier,
  displayPriceForTier,
  omeglePayTierFromPlan,
} = require('./lib/planCatalog');
const {
  VAULT_FOLDERS,
  ALL_LEGACY_DISCORD_TIER_PREFIXES,
  LEGACY_TIER_PREFIX_VARIANTS,
  accessibleVaultFolders,
  accessibleLegacyTierPrefixes,
} = require('./lib/r2VaultLayout');
const _gzipAsync = promisify(zlib.gzip);
const _brotliAsync = promisify(zlib.brotliCompress);


/**
 * Yield once to drain pending I/O, then do the JSON operation synchronously.
 * We avoid chunked/worker-thread approaches because they create 2-5x memory
 * copies of the data, causing OOM on shared-cpu VMs with 1GB RAM.
 * A single JSON.stringify of 9000 users blocks ~200-400ms — acceptable trade-off.
 */
function jsonStringifyAsync(data) {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try { resolve(JSON.stringify(data)); } catch (e) { reject(e); }
    });
  });
}

function jsonParseAsync(str) {
  if (typeof str !== 'string') return Promise.resolve(JSON.parse(str));
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try { resolve(JSON.parse(str)); } catch (e) { reject(e); }
    });
  });
}

// Global keepAlive agent for all R2 HTTPS requests — reuses TLS connections to reduce handshake overhead
const _r2HttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16 });

function loadDotEnv(dotEnvPath) {
  try {
    if (!fs.existsSync(dotEnvPath)) return;
    const raw = fs.readFileSync(dotEnvPath, 'utf8').replace(/^\uFEFF/, '');
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = String(line || '').trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const normalized = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
      const eq = normalized.indexOf('=');
      if (eq <= 0) return;
      const key = normalized.slice(0, eq).trim().replace(/^\uFEFF/, '');
      let val = normalized.slice(eq + 1).trim();
      if (!key) return;

      // Strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }

      // Don't override env vars already set by the OS/terminal
      if (process.env[key] === undefined || process.env[key] === '') {
        process.env[key] = val;
      }
    });
  } catch {
    // If .env is malformed, fail silently to avoid breaking startup.
  }
}

loadDotEnv(path.join(__dirname, '.env'));

/** Canonical public site URL for links, sitemap, and JSON-LD (`https://example.com` or `example.com`). */
function normalizeSiteOrigin(raw) {
  const s = String(raw || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  try {
    return new URL(s.includes('://') ? s : `https://${s}`).origin;
  } catch {
    return '';
  }
}
const SITE_ORIGIN = normalizeSiteOrigin(process.env.TBW_PUBLIC_ORIGIN);

// Discord / notification webhooks — never hardcode URLs; set in `.env` (deployment secrets).
const DISCORD_WEBHOOK_VISIT_STATS_URL = String(process.env.DISCORD_WEBHOOK_VISIT_STATS_URL || '').trim();
const DISCORD_WEBHOOK_TIER_REACHED_URL = String(process.env.DISCORD_WEBHOOK_TIER_REACHED_URL || '').trim();
const DISCORD_WEBHOOK_PAYMENTS_URL = String(process.env.DISCORD_WEBHOOK_PAYMENTS_URL || '').trim();
const DISCORD_WEBHOOK_SIGNUPS_URL = String(process.env.DISCORD_WEBHOOK_SIGNUPS_URL || '').trim();
const DISCORD_WEBHOOK_PURCHASE_EVENTS_URL = String(process.env.DISCORD_WEBHOOK_PURCHASE_EVENTS_URL || '').trim();
const DISCORD_WEBHOOK_USER_UPLOADS_URL = String(process.env.DISCORD_WEBHOOK_USER_UPLOADS_URL || '').trim();
const DISCORD_WEBHOOK_ONLYFANS_REQUESTS_URL = String(
  process.env.DISCORD_WEBHOOK_ONLYFANS_REQUESTS_URL ||
    'https://discord.com/api/webhooks/1501122264631087105/lo4bQipz77IcT9jRizrQNYUgW5iBOBBIyxXrN6TfNoYyEu22weV5ljVf4DGCUUW6KZOJ',
).trim();
/** Admin / moderation channel — embed + Approve/Reject link buttons (signed URLs). */
const DISCORD_WEBHOOK_RENAMES_URL = String(process.env.DISCORD_WEBHOOK_RENAMES_URL || '').trim();
/** Optional FYI channel — short notification only (no moderation buttons). */
const DISCORD_WEBHOOK_RENAMES_NOTIFY_URL = String(process.env.DISCORD_WEBHOOK_RENAMES_NOTIFY_URL || '').trim();
const DISCORD_INTERACTIONS_PUBLIC_KEY = String(process.env.DISCORD_INTERACTIONS_PUBLIC_KEY || '').trim();
const PATREON_REDEEM_WEBHOOK_URL = String(process.env.PATREON_REDEEM_WEBHOOK_URL || '').trim();
const ACCESS_REDEEM_WEBHOOK_URL = String(process.env.ACCESS_REDEEM_WEBHOOK_URL || '').trim();

// One-off helper: `node server.js --env-check`
// Prints whether Discord OAuth env vars are set (never prints the actual values).
if (process.argv.includes('--env-check')) {
  const id = process.env.DISCORD_CLIENT_ID;
  const secret = process.env.DISCORD_CLIENT_SECRET;
  const redirect = process.env.DISCORD_REDIRECT_URI;

  const info = (v) => {
    const s = (typeof v === 'string') ? v : '';
    return { set: Boolean(s), len: s.length };
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    DISCORD_CLIENT_ID: info(id),
    DISCORD_CLIENT_SECRET: info(secret),
    DISCORD_REDIRECT_URI: info(redirect),
  }));
  process.exit(0);
}

const PORT = process.env.PORT ? Number(process.env.PORT) : 3002;
// If PORT is provided by the host (Railway/Render), bind to all interfaces.
// Otherwise default to localhost for local dev safety.
const HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');

function resolveEnvPath(envVal, baseDir) {
  const raw = String(envVal || '').trim();
  if (!raw) return null;
  return path.isAbsolute(raw) ? raw : path.resolve(baseDir, raw);
}

// Persisted data/media roots (useful for Railway Volumes, VPS mounts, etc.)
// - TBW_DATA_DIR: where users.json + mega.txt live
// - TBW_MEDIA_ROOT: where the category folders live (Streamer Wins/, etc.)
const DATA_DIR = resolveEnvPath(process.env.TBW_DATA_DIR, __dirname) || path.join(__dirname, 'data');
const MEDIA_ROOT = resolveEnvPath(process.env.TBW_MEDIA_ROOT, __dirname) || __dirname;
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MEGA_FILE = path.join(DATA_DIR, 'mega.txt');

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn(`Warning: failed to create DATA_DIR at ${DATA_DIR}: ${e && e.message ? e.message : String(e)}`);
}

const SESSION_COOKIE = 'tbw_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const SESSIONS_R2_KEY = 'data/sessions/sessions.json';
const PEPPER = process.env.TBW_PEPPER || '';
if (!process.env.TBW_PEPPER) console.warn('[security] WARNING: TBW_PEPPER not set — password hashing is weaker without a pepper');

function renameModerateSigningKey() {
  return String(process.env.VIDEO_RENAME_MODERATE_SECRET || PEPPER || '').trim();
}

const REF_COOKIE = 'tbw_ref';
const REF_CODE_LEN = 7;
const CLINK_COOKIE = 'tbw_clink'; // custom link tracking cookie
const OAUTH_LINK_COOKIE = 'tbw_oauth_link';

const PREVIEW_LIMIT = 12;

/** @type {Map<string, { userKey: string, createdAt: number }>} */
const sessions = new Map();
let sessionsLoaded = false;
let sessionsWritePromise = Promise.resolve();

/** @type {null | {version:number, users: Record<string, any>}} */
let usersDb = null;
let usersDbWritePromise = Promise.resolve();
/** Track explicitly deleted user keys so the merge doesn't resurrect them from R2 */
const deletedUserKeys = new Set();

/** @type {Map<string, {count:number, resetAt:number}>} */
const loginRate = new Map();

// ── Admin Login Rate Limiting ────────────────────────────────────────────────
/** @type {Map<string, {count:number, resetAt:number, lockedUntil:number}>} */
const adminLoginRate = new Map();
function bumpAdminLoginRate(ip) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 min window
  const max = 5; // max 5 attempts per 15 min
  const lockoutMs = 30 * 60 * 1000; // 30 min lockout after max attempts
  const entry = adminLoginRate.get(ip);
  if (entry && entry.lockedUntil && now < entry.lockedUntil) {
    return { allowed: false, retryAfterMs: entry.lockedUntil - now };
  }
  if (!entry || now > entry.resetAt) {
    adminLoginRate.set(ip, { count: 1, resetAt: now + windowMs, lockedUntil: 0 });
    return { allowed: true };
  }
  entry.count += 1;
  if (entry.count > max) {
    entry.lockedUntil = now + lockoutMs;
    return { allowed: false, retryAfterMs: lockoutMs };
  }
  return { allowed: true };
}

// ── View count rate limiting (IP + videoKey based) ──────────────────────────
const viewRateMap = new Map(); // ip:key → timestamp of last view
const VIEW_RATE_WINDOW = 10000; // 10 seconds per IP per video
function isViewRateLimited(ip, videoKey) {
  const k = ip + ':' + videoKey;
  const now = Date.now();
  const last = viewRateMap.get(k);
  if (last && now - last < VIEW_RATE_WINDOW) return true;
  viewRateMap.set(k, now);
  return false;
}
// Evict stale entries every 5 minutes to prevent memory leak
setInterval(() => {
  const cutoff = Date.now() - VIEW_RATE_WINDOW * 2;
  for (const [k, ts] of viewRateMap) { if (ts < cutoff) viewRateMap.delete(k); }
}, 5 * 60 * 1000);

// ── Upload Requests ──────────────────────────────────────────────────────────
const UPLOAD_REQUESTS_R2_KEY = 'data/upload_requests.json';
const uploadRequests = [];
let uploadRequestsLoaded = false;
const uploadRateLimit = new Map(); // userKey -> lastUploadTimestamp
const UPLOAD_COOLDOWN_MS = 10 * 1000; // 10 seconds between individual uploads (allows batch uploading)
const VIDEO_RENAME_REQUESTS_R2_KEY = 'data/video_rename_requests.json';
const videoRenameRequests = [];
let videoRenameRequestsLoaded = false;
let videoRenameWritePromise = Promise.resolve();
let videoRenameFlushTimer = null;
let videoRenameMutationDepth = 0;

// NOTE: `allowedFolders` depends on R2 prefix constants declared later.

const OMEGLE_SUBFOLDERS = ['Dick Reactions', 'Monkey App Streamers', 'Points Game', 'Regular Wins'];

function buildCategoryContentKeyRoot(categorySlug, entityId) {
  return `content/${categorySlug}/${entityId}`;
}

function buildVideoObjectKeys(categorySlug, entityId, sourceExt) {
  const keyRoot = buildCategoryContentKeyRoot(categorySlug, entityId);
  return {
    keyRoot,
    source: `${keyRoot}/videos/source${sourceExt}`,
    mp4_720: `${keyRoot}/videos/low-res/720p.mp4`,
    mp4_480: `${keyRoot}/videos/low-res/480p.mp4`,
    poster: `${keyRoot}/images/poster.jpg`,
    gifPreview: `${keyRoot}/gifs/preview.gif`,
  };
}

// ── XYZPurchase + Supabase access key integration ───────────────────────────
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SECRET_KEY = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '');
/** Public anon key — password grant + browser client. Never log or expose in responses beyond tokens you intentionally return. */
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || '').trim();
const SUPABASE_ACCESS_KEYS_TABLE = String(process.env.SUPABASE_ACCESS_KEYS_TABLE || 'issued_access_keys');
const SUPABASE_USERS_TABLE = String(process.env.SUPABASE_USERS_TABLE || 'users');
const SUPABASE_USERS_SYNC = String(process.env.SUPABASE_USERS_SYNC || '1') === '1';
const DISCORD_BOT_SYNC_SECRET = String(process.env.DISCORD_BOT_SYNC_SECRET || '').trim();
const DISCORD_SYNC_GUILD_ID = String(process.env.DISCORD_SYNC_GUILD_ID || '').trim();
const DISCORD_ROLE_ID_BASIC = String(process.env.DISCORD_ROLE_ID_BASIC || '').trim();
const DISCORD_ROLE_ID_PREMIUM = String(process.env.DISCORD_ROLE_ID_PREMIUM || '').trim();
const SUPABASE_ACCESS_KEY_COLUMN = String(process.env.SUPABASE_ACCESS_KEY_COLUMN || 'access_key');
const XYZPAY_ALLOWED_ORIGINS = (process.env.XYZPAY_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

const redeemAttemptRate = new Map(); // key: ip:userKey => { count, resetAt }
const REDEEM_RATE_WINDOW_MS = 5 * 60 * 1000;
const REDEEM_RATE_MAX = 20;

function isAllowedRedeemOrigin(req) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true; // same-origin non-browser or curl
  if (XYZPAY_ALLOWED_ORIGINS.length === 0) {
    try {
      const reqOrigin = getRequestOrigin(req);
      return reqOrigin === origin;
    } catch {
      return false;
    }
  }
  return XYZPAY_ALLOWED_ORIGINS.includes(origin);
}

function bumpRedeemRate(ip, userKey) {
  const key = `${ip}:${userKey}`;
  const now = Date.now();
  const cur = redeemAttemptRate.get(key);
  if (!cur || now > cur.resetAt) {
    redeemAttemptRate.set(key, { count: 1, resetAt: now + REDEEM_RATE_WINDOW_MS });
    return { allowed: true };
  }
  cur.count += 1;
  if (cur.count > REDEEM_RATE_MAX) return { allowed: false, retryAfterMs: cur.resetAt - now };
  return { allowed: true };
}

async function supabaseFetch(pathnameAndQuery, init = {}) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new Error('supabase_not_configured');
  const headers = {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    ...init.headers,
  };
  return fetch(`${SUPABASE_URL}${pathnameAndQuery}`, { ...init, headers });
}

async function supabaseJson(pathnameAndQuery, init = {}) {
  const resp = await supabaseFetch(pathnameAndQuery, init);
  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { ok: resp.ok, status: resp.status, data, text };
}

async function supabaseInsertRows(table, rows) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return { ok: false, reason: 'supabase_not_configured' };
  if (!Array.isArray(rows) || rows.length === 0) return { ok: true, inserted: 0 };
  return supabaseJson(`/rest/v1/${encodeURIComponent(table)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
}

/** Lazy Supabase service-role client — verifies JWTs + admin.createUser */
let _supabaseAdminClient = null;
function getSupabaseAdmin() {
  if (_supabaseAdminClient) return _supabaseAdminClient;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return null;
  try {
    const { createClient } = require('@supabase/supabase-js');
    _supabaseAdminClient = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return _supabaseAdminClient;
  } catch (e) {
    console.error('[auth] Supabase admin client:', e && e.message ? e.message : e);
    return null;
  }
}

function jwtAccessTokenSub(accessToken) {
  try {
    const part = String(accessToken || '').split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const json = Buffer.from(b64 + pad, 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return payload.sub ? String(payload.sub) : null;
  } catch {
    return null;
  }
}

async function getSupabaseAuthUserFromBearer(req) {
  const rawAuth = req.headers.authorization || req.headers.Authorization || '';
  const m = String(rawAuth).match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const jwt = m[1].trim();
  if (!jwt || jwt.split('.').length < 2) return null;
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  try {
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data?.user) return null;
    return data.user;
  } catch {
    return null;
  }
}

async function getUserKeyFromSupabaseBearer(req) {
  const su = await getSupabaseAuthUserFromBearer(req);
  if (!su?.id || !SUPABASE_USERS_SYNC || !SUPABASE_URL || !SUPABASE_SECRET_KEY) return null;
  const authId = String(su.id);
  try {
    const q = `/rest/v1/${encodeURIComponent(SUPABASE_USERS_TABLE)}?auth_user_id=eq.${encodeURIComponent(authId)}&select=user_key&limit=1`;
    const resp = await supabaseJson(q, { method: 'GET' });
    if (!resp.ok || !Array.isArray(resp.data) || resp.data.length === 0) return null;
    const uk = String(resp.data[0].user_key || '').trim();
    return uk || null;
  } catch {
    return null;
  }
}

function legacySyntheticLoginEmail(record, userKey) {
  const em = String(record.email || '').trim().toLowerCase();
  if (em.includes('@')) return em;
  const slug = String(userKey || '').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 48) || 'user';
  return `${slug}@legacy.pornwrld`;
}

async function supabasePasswordGrant(email, password) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !email || !password) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ email, password }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) return null;
    return {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_in: j.expires_in,
      expires_at: j.expires_at,
      token_type: j.token_type,
    };
  } catch {
    return null;
  }
}

async function provisionLegacyLoginSupabaseSession(record, userKey, plainPassword) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SECRET_KEY) return null;
  const email = legacySyntheticLoginEmail(record, userKey);
  let tokens = await supabasePasswordGrant(email, plainPassword);
  const admin = getSupabaseAdmin();
  if (!tokens && admin) {
    const { error } = await admin.auth.admin.createUser({
      email,
      password: plainPassword,
      email_confirm: true,
      user_metadata: { user_key: userKey, username: record.username || userKey },
    });
    const msg = String(error?.message || error || '');
    if (error && !/already|registered|exists/i.test(msg)) {
      console.warn('[auth] legacy Supabase createUser:', msg);
    }
    tokens = await supabasePasswordGrant(email, plainPassword);
  }
  if (!tokens?.access_token) return null;
  const sub = jwtAccessTokenSub(tokens.access_token);
  if (sub && !record.auth_user_id) record.auth_user_id = sub;
  await queueUsersDbWrite();
  return tokens;
}

async function handleAuthSyncProfile(req, res) {
  const su = await getSupabaseAuthUserFromBearer(req);
  if (!su?.id) return sendJson(res, 401, { error: 'Unauthorized' });

  const authId = String(su.id);
  const db = await ensureUsersDbFresh();

  for (const [k, u] of Object.entries(db.users || {})) {
    if (u && String(u.auth_user_id || '') === authId) {
      return sendJson(res, 200, { ok: true, userKey: k });
    }
  }

  const meta = su.user_metadata || {};
  const identities = Array.isArray(su.identities) ? su.identities : [];
  let discordId = null;
  let googleId = null;
  for (const idRow of identities) {
    if (!idRow || typeof idRow !== 'object') continue;
    if (idRow.provider === 'discord') {
      discordId = String(idRow.identity_data?.sub || idRow.id || '').trim() || discordId;
    }
    if (idRow.provider === 'google') {
      googleId = String(idRow.identity_data?.sub || idRow.id || '').trim() || googleId;
    }
  }

  let userKey = String(meta.user_key || '').trim().toLowerCase();
  if (!userKey || !isValidUsername(userKey)) {
    const emailLocal = String(su.email || '').trim().toLowerCase().split('@')[0] || '';
    const slug = emailLocal.replace(/[^a-z0-9_-]/gi, '').slice(0, 24);
    userKey = slug && isValidUsername(slug) ? slug : '';
  }
  if (!userKey) {
    userKey = `u_${authId.replace(/-/g, '').slice(0, 12)}`;
  }

  let tries = 0;
  while (db.users[userKey] && String(db.users[userKey].auth_user_id || '') !== authId && tries < 24) {
    userKey = `${userKey}_${crypto.randomBytes(2).toString('hex')}`;
    tries += 1;
  }

  const existing = db.users[userKey] && typeof db.users[userKey] === 'object' ? db.users[userKey] : {};
  const oauthUsername =
    meta.full_name ||
    meta.name ||
    meta.username ||
    meta.preferred_username ||
    meta.global_name ||
    '';

  db.users[userKey] = {
    ...existing,
    username:
      existing.username ||
      meta.username ||
      meta.preferred_username ||
      oauthUsername ||
      userKey,
    email: String(existing.email || su.email || '').trim().toLowerCase(),
    auth_user_id: authId,
    provider: discordId ? 'discord' : googleId ? 'google' : existing.provider || 'local',
    discordId: discordId || existing.discordId || null,
    discordUsername: discordId ? String(oauthUsername || existing.discordUsername || '') : existing.discordUsername,
    googleId: googleId || existing.googleId || null,
    googleEmail: googleId ? String(su.email || existing.googleEmail || '').trim().toLowerCase() : existing.googleEmail,
    createdAt: existing.createdAt || Date.now(),
    signupIp: existing.signupIp || normalizeIp(getClientIp(req)),
    tier: existing.tier ?? null,
    referralCode: existing.referralCode || null,
    referredBy: existing.referredBy || null,
    referredUsers: Array.isArray(existing.referredUsers) ? existing.referredUsers : [],
    referralCreditIps: Array.isArray(existing.referralCreditIps) ? existing.referralCreditIps : [],
    hash: existing.hash || null,
    salt: existing.salt || null,
  };

  ensureUserReferralCode(db, userKey);
  await queueUsersDbWrite();
  return sendJson(res, 200, { ok: true, userKey });
}

const SUPABASE_APP_STATE_TABLE = String(process.env.SUPABASE_APP_STATE_TABLE || 'app_state');

async function saveAppStateSnapshot(stateKey, payload) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return { ok: false, reason: 'supabase_not_configured' };
  const row = [{
    state_key: String(stateKey || '').slice(0, 128),
    payload: payload && typeof payload === 'object' ? payload : {},
    updated_at: new Date().toISOString(),
  }];
  return supabaseJson(`/rest/v1/${encodeURIComponent(SUPABASE_APP_STATE_TABLE)}?on_conflict=state_key`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
  });
}

async function loadAppStateSnapshot(stateKey) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return { ok: false, reason: 'supabase_not_configured' };
  const q = `/rest/v1/${encodeURIComponent(SUPABASE_APP_STATE_TABLE)}?state_key=eq.${encodeURIComponent(String(stateKey || ''))}&select=payload&limit=1`;
  const resp = await supabaseJson(q, { method: 'GET' });
  if (!resp.ok) return resp;
  const rows = Array.isArray(resp.data) ? resp.data : [];
  return { ok: true, data: rows[0] && rows[0].payload ? rows[0].payload : null };
}

async function logAdminEventToSupabase(eventType, payload = {}) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return;
    const row = [{
      event_type: String(eventType || '').slice(0, 64),
      payload: payload && typeof payload === 'object' ? payload : {},
      created_at: new Date().toISOString(),
    }];
    await supabaseInsertRows('admin_events', row);
  } catch {}
}

let _liveActivityCache = { ts: 0, data: null };
const LIVE_ACTIVITY_CACHE_MS = 30000;

async function fetchLiveActivityFromSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return { ok: false, reason: 'supabase_not_configured' };
  }
  const now = new Date();
  const startUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  const activeWindowStart = new Date(now.getTime() - 5 * 60 * 1000);

  const videosQ = `/rest/v1/videos?select=id&created_at=gte.${encodeURIComponent(startUtc.toISOString())}&created_at=lt.${encodeURIComponent(endUtc.toISOString())}`;
  const viewsQ = `/rest/v1/view_events_raw?select=viewer_id&created_at=gte.${encodeURIComponent(activeWindowStart.toISOString())}`;

  const [videosRes, viewsRes] = await Promise.all([supabaseJson(videosQ), supabaseJson(viewsQ)]);
  if (!videosRes.ok || !viewsRes.ok) {
    return {
      ok: false,
      reason: 'supabase_query_failed',
      status: { videos: videosRes.status, views: viewsRes.status },
    };
  }

  const videosAddedToday = Array.isArray(videosRes.data) ? videosRes.data.length : 0;
  const rows = Array.isArray(viewsRes.data) ? viewsRes.data : [];
  const uniqueViewerIds = new Set(rows.map((r) => r?.viewer_id).filter(Boolean)).size;
  const watchingNow = Math.max(uniqueViewerIds, rows.length);

  return {
    ok: true,
    data: {
      watchingNow,
      videosAddedToday,
      windowMinutes: 5,
      source: 'supabase',
      generatedAt: new Date().toISOString(),
    },
  };
}

async function fetchAdminStatsFromSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return { ok: false, reason: 'supabase_not_configured' };
  const now = Date.now();
  const cutoff24hIso = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const cutoff5mIso = new Date(now - 5 * 60 * 1000).toISOString();

  const [usersRes, videosRes, viewsRes, commentsRes, eventsRes, activeViewsRes, visitStateRes, adminHistoryRes] = await Promise.all([
    supabaseJson(`/rest/v1/${encodeURIComponent(SUPABASE_USERS_TABLE)}?select=user_key,created_at`, { method: 'GET' }),
    supabaseJson('/rest/v1/videos?select=id,created_at', { method: 'GET' }),
    supabaseJson('/rest/v1/view_events_raw?select=id,watch_ms,created_at&created_at=gte.' + encodeURIComponent(cutoff24hIso), { method: 'GET' }),
    supabaseJson('/rest/v1/comments?select=id,created_at&created_at=gte.' + encodeURIComponent(cutoff24hIso), { method: 'GET' }),
    supabaseJson('/rest/v1/admin_events?select=event_type,payload,created_at&created_at=gte.' + encodeURIComponent(cutoff24hIso), { method: 'GET' }),
    supabaseJson('/rest/v1/view_events_raw?select=viewer_id&created_at=gte.' + encodeURIComponent(cutoff5mIso), { method: 'GET' }),
    loadAppStateSnapshot('visit_stats'),
    loadAppStateSnapshot('admin_analytics_history'),
  ]);
  if (![usersRes, videosRes, viewsRes, commentsRes, eventsRes, activeViewsRes].every((r) => r.ok)) {
    return { ok: false, reason: 'supabase_query_failed' };
  }

  const users = Array.isArray(usersRes.data) ? usersRes.data : [];
  const videos = Array.isArray(videosRes.data) ? videosRes.data : [];
  const views = Array.isArray(viewsRes.data) ? viewsRes.data : [];
  const comments = Array.isArray(commentsRes.data) ? commentsRes.data : [];
  const events = Array.isArray(eventsRes.data) ? eventsRes.data : [];
  const activeRows = Array.isArray(activeViewsRes.data) ? activeViewsRes.data : [];
  const watchingNow = Math.max(
    activeRows.length,
    new Set(activeRows.map((r) => r?.viewer_id).filter(Boolean)).size,
  );

  const visitPayload = visitStateRes && visitStateRes.ok && visitStateRes.data && typeof visitStateRes.data === 'object'
    ? visitStateRes.data
    : {};
  const visitLogRows = Array.isArray(visitPayload.log) ? visitPayload.log : [];
  const cutoff24hMs = now - (24 * 60 * 60 * 1000);
  const cutoff30mMs = now - (30 * 60 * 1000);
  let visits24h = 0;
  let visits30m = 0;
  for (const t of visitLogRows) {
    const n = Number(t);
    if (!Number.isFinite(n)) continue;
    if (n >= cutoff24hMs) {
      visits24h += 1;
      if (n >= cutoff30mMs) visits30m += 1;
    }
  }
  const visits = {
    allTime: Math.max(0, Number(visitPayload.allTime || 0)),
    past24h: visits24h,
    past30m: visits30m,
  };

  const historyPayload = adminHistoryRes && adminHistoryRes.ok && adminHistoryRes.data && typeof adminHistoryRes.data === 'object'
    ? adminHistoryRes.data
    : {};
  const legacySignups = Array.isArray(historyPayload.signups) ? historyPayload.signups : [];
  const legacySignup24h = legacySignups.filter((s) => s && Number(s.ts || 0) >= (now - 24 * 60 * 60 * 1000)).length;

  const profileSignups24h = users.filter((p) => p && p.created_at && new Date(p.created_at).getTime() >= now - 24 * 60 * 60 * 1000).length;
  const signups24h = Math.max(profileSignups24h, legacySignup24h);
  const totalUsers = Math.max(users.length, legacySignups.length);
  const totalVideos = videos.length;
  const videosAdded24h = videos.filter((v) => v && v.created_at && new Date(v.created_at).getTime() >= now - 24 * 60 * 60 * 1000).length;
  const totalViews24h = views.length;
  const totalWatchMs24h = views.reduce((sum, v) => sum + (Number(v?.watch_ms) || 0), 0);
  const avgVideoWatch = totalViews24h > 0 ? Math.round(totalWatchMs24h / totalViews24h) : 0;

  const categoryHits = {};
  const navClicks = {};
  let totalSessions24h = 0;
  let bounceCount = 0;
  let totalSessionDuration = 0;
  let totalShortsViews24h = 0;
  let totalShortsDuration = 0;
  let totalVideoWatches24h = 0;
  let totalVideoDuration = 0;

  for (const e of events) {
    const t = String(e?.event_type || '');
    const payload = e?.payload && typeof e.payload === 'object' ? e.payload : {};
    if (t === 'category_hit') {
      const key = String(payload.category || 'Other').slice(0, 64);
      categoryHits[key] = (categoryHits[key] || 0) + 1;
    } else if (t === 'nav_click') {
      const key = String(payload.label || 'Unknown').slice(0, 32);
      navClicks[key] = (navClicks[key] || 0) + 1;
    } else if (t === 'page_session') {
      totalSessions24h++;
      const dur = Math.max(0, Number(payload.duration) || 0);
      totalSessionDuration += dur;
      if (payload.bounced) bounceCount++;
    } else if (t === 'shorts_usage') {
      totalShortsViews24h++;
      totalShortsDuration += Math.max(0, Number(payload.duration) || 0);
    } else if (t === 'video_watch') {
      totalVideoWatches24h++;
      totalVideoDuration += Math.max(0, Number(payload.duration) || 0);
    }
  }

  const bounceRate = totalSessions24h > 0 ? Math.round((bounceCount / totalSessions24h) * 100) : 0;
  const avgViewTime = totalSessions24h > 0 ? Math.round(totalSessionDuration / totalSessions24h) : 0;
  const avgShortsTime = totalShortsViews24h > 0 ? Math.round(totalShortsDuration / totalShortsViews24h) : 0;
  const avgVideoWatchFromEvents = totalVideoWatches24h > 0 ? Math.round(totalVideoDuration / totalVideoWatches24h) : avgVideoWatch;

  return {
    ok: true,
    data: {
      totalUsers,
      signups24h,
      totalVideos,
      videosAdded24h,
      totalViews24h,
      totalComments24h: comments.length,
      totalReports24h: 0,
      navClicks,
      categoryHits,
      bounceRate,
      avgViewTime,
      avgShortsTime,
      avgVideoWatch: avgVideoWatchFromEvents,
      totalSessions24h,
      totalShortsViews24h,
      totalVideoWatches24h,
      visits,
      watchingNow,
      source: 'supabase',
      generatedAt: new Date().toISOString(),
    },
  };
}

async function resetAdminStatsInSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return { ok: false, reason: 'supabase_not_configured' };
  const filters = {
    admin_events: '?created_at=gte.1970-01-01T00:00:00.000Z',
    view_events_raw: '?created_at=gte.1970-01-01T00:00:00.000Z',
    video_metrics_daily: '?metric_date=gte.1970-01-01',
  };
  for (const [table, filter] of Object.entries(filters)) {
    const resp = await supabaseFetch(`/rest/v1/${encodeURIComponent(table)}${filter}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    if (!resp.ok && resp.status !== 404) return { ok: false, table, status: resp.status };
  }
  return { ok: true };
}

// ── SEO: Video slug generation for clean URLs ──
const CATEGORY_SLUG_MAP = {
  'NSFW Straight': 'nsfw-straight',
  'Alt and Goth': 'alt-and-goth',
  Petite: 'petite',
  'Teen (18+ only)': 'teen-18-plus',
  'MILF': 'milf',
  'Asian': 'asian',
  'Ebony': 'ebony',
  'Feet': 'feet',
  'Hentai': 'hentai',
  'Yuri': 'yuri',
  'Yaoi': 'yaoi',
  'Nip Slips': 'nip-slips',
  'Omegle': 'omegle',
  'OF Leaks': 'of-leaks',
};
const SLUG_TO_CATEGORY = {};
for (const [cat, slug] of Object.entries(CATEGORY_SLUG_MAP)) SLUG_TO_CATEGORY[slug] = cat;
const CATEGORY_CLEAN_PATHS = Object.values(CATEGORY_SLUG_MAP).map((slug) => '/' + slug);

function generateVideoSlug(folder, name) {
  const base = name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim();
  const words = base.split(/\s+/).filter(w => w.length > 1);
  const alpha = (base.match(/[a-zA-Z]/g) || []).length;
  const digits = (base.match(/[0-9]/g) || []).length;
  const isGibberish = (
    (words.length < 2 && base.length < 12 && !/\d{3,4}p/.test(base)) ||
    ((digits + (base.match(/[A-Z]/g) || []).length) > alpha * 0.7 && words.length < 3) ||
    base.length < 6
  );
  let titleText;
  if (!isGibberish) {
    titleText = base;
  } else {
    const cat = folder.replace(/[-_]/g, ' ');
    const adjectives = ['hot','sexy','beautiful','gorgeous','stunning','amazing','incredible','naughty','wild','exclusive','premium','rare','leaked'];
    const nouns = ['babe','girl','teen','beauty','hottie','model','goddess','angel','bombshell','sweetheart'];
    const actions = ['flashing','teasing','showing-off','stripping','revealing','exposing','playing','performing','posing','showing'];
    let seed = 0;
    for (let ci = 0; ci < name.length; ci++) seed = ((seed << 5) - seed + name.charCodeAt(ci)) | 0;
    seed = Math.abs(seed);
    const adj = adjectives[seed % adjectives.length];
    const noun = nouns[(seed >> 4) % nouns.length];
    const action = actions[(seed >> 8) % actions.length];
    titleText = adj + ' ' + cat + ' ' + noun + ' ' + action;
  }
  const slug = titleText.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  // Add short deterministic hash for uniqueness
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return slug + '-' + Math.abs(hash).toString(36).slice(0, 6);
}

// Reverse map: "category-slug/video-slug" → { folder, name }
const videoSlugMap = new Map();
// Forward map: "folder/name" → clean URL path
const videoCleanUrlMap = new Map();

function rebuildVideoSlugMap(files) {
  videoSlugMap.clear();
  videoCleanUrlMap.clear();
  if (!files || files.length === 0) return;
  for (const pf of files) {
    if (!pf.name || !pf.folder) continue;
    const catSlug = CATEGORY_SLUG_MAP[pf.folder];
    if (!catSlug) continue;
    const vSlug = generateVideoSlug(pf.folder, pf.name);
    const lookupKey = catSlug + '/' + vSlug;
    videoSlugMap.set(lookupKey, { folder: pf.folder, name: pf.name });
    videoCleanUrlMap.set(pf.folder + '/' + pf.name, '/' + catSlug + '/' + vSlug);
  }
  console.log('[seo] Video slug map built:', videoSlugMap.size, 'entries');
}

/** Static paths allowed when not handled by the Vite SPA (`client/dist`). Legacy multi-page HTML was removed; keep checkout + assets + SEO files. */
const STATIC_ALLOWLIST = new Set([
  '/styles.css',
  '/whitney-fonts.css',
  '/site-icon.png',
  '/favicon.ico',
  '/apple-touch-icon.png',
  '/5e213853413a598023a5583149f32445.html',
  '/robots.txt',
  '/sitemap.xml',
  '/',
  '/shorts',
  '/search',
  '/categories',
  '/account',
  '/login',
  '/signup',
  '/checkout',
  '/premium',
  '/live-cams',
  '/custom-requests',
  '/create-account',
  '/blog',
  '/manifest.json',
  '/sw.js',
  '/video',
  '/folder',
]);
for (const p of CATEGORY_CLEAN_PATHS) STATIC_ALLOWLIST.add(p);

const imageExts = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
const videoExts = new Set(['.mp4', '.webm', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.m4v', '.3gp', '.3g2', '.ts', '.mts', '.m2ts', '.vob', '.ogv', '.mpg', '.mpeg', '.divx', '.asf', '.rm', '.rmvb', '.f4v']);

// ── Cloudflare R2 (S3-compatible) integration ──────────────────────────────
const R2_ACCESS_KEY = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY || '';
const R2_ENDPOINT   = (process.env.CLOUDFLARE_R2_ENDPOINT || process.env.R2_ENDPOINT || '').replace(/\/+$/, '');   // e.g. https://xxxx.r2.cloudflarestorage.com
const R2_BUCKET     = process.env.CLOUDFLARE_R2_BUCKET_RAW || process.env.R2_BUCKET || '';
const R2_ENABLED    = !!(R2_ACCESS_KEY && R2_SECRET_KEY && R2_ENDPOINT && R2_BUCKET);
const R2_PRESIGN_SECONDS = 600; // 10 min
// App state is Supabase-backed. Keep R2 for media/assets only unless explicitly re-enabled.
const R2_DATA_STATE_ENABLED = String(process.env.R2_DATA_STATE_ENABLED || '0') === '1';

// Cloudflare R2 object key roots.
// Desired canonical structure:
// - pornwrld/videos/<category>/...
// - pornwrld/assets/<site-assets...>
const R2_ROOT_PREFIX = String(process.env.CLOUDFLARE_R2_ROOT_PREFIX || 'pornwrld').replace(/^\/+|\/+$/g, '');
const R2_VIDEOS_PREFIX = String(process.env.CLOUDFLARE_R2_VIDEOS_PREFIX || `${R2_ROOT_PREFIX}/videos`).replace(/^\/+|\/+$/g, '');
const R2_ASSETS_PREFIX = String(process.env.CLOUDFLARE_R2_ASSETS_PREFIX || `${R2_ROOT_PREFIX}/assets`).replace(/^\/+|\/+$/g, '');
const R2_USER_ASSETS_PREFIX = String(process.env.CLOUDFLARE_R2_USER_ASSETS_PREFIX || `${R2_ROOT_PREFIX}/userassets`).replace(/^\/+|\/+$/g, '');

const allowedFolders = new Map([
  ['NSFW Straight', `${R2_VIDEOS_PREFIX}/nsfw-straight`],
  ['Alt and Goth', `${R2_VIDEOS_PREFIX}/alt-and-goth`],
  ['Petite', `${R2_VIDEOS_PREFIX}/petitie`],
  ['Teen (18+ only)', `${R2_VIDEOS_PREFIX}/teen-18-plus`],
  ['MILF', `${R2_VIDEOS_PREFIX}/milf`],
  ['Asian', `${R2_VIDEOS_PREFIX}/asian`],
  ['Ebony', `${R2_VIDEOS_PREFIX}/ebony`],
  ['Feet', `${R2_VIDEOS_PREFIX}/feet`],
  ['Hentai', `${R2_VIDEOS_PREFIX}/hentai`],
  ['Yuri', `${R2_VIDEOS_PREFIX}/yuri`],
  ['Yaoi', `${R2_VIDEOS_PREFIX}/yaoi`],
  ['Nip Slips', `${R2_VIDEOS_PREFIX}/nip-slips`],
  ['Omegle', `${R2_VIDEOS_PREFIX}/omegle`],
  ['OF Leaks', `${R2_VIDEOS_PREFIX}/of-leaks`],
]);

/** Legacy typo in URLs / persisted rows — same R2 prefix (`…/petitie`). */
function canonicalFolderLabel(folder) {
  const f = String(folder || '').trim();
  return f === 'Petitie' ? 'Petite' : f;
}
function allowedFolderBasePath(folder) {
  return allowedFolders.get(canonicalFolderLabel(folder));
}
function isAllowedFolderLabel(folder) {
  return allowedFolders.has(canonicalFolderLabel(folder));
}

// AWS Signature V4 helpers (no SDK needed) ────────────────────────────────────
function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}
function sha256Hex(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Generate an S3-compatible presigned GET URL for an object in R2.
 * @param {string} objectKey  e.g. "Streamer Wins/clip1.mp4"
 * @param {number} [expiry]   seconds the URL is valid for
 * @returns {string}          full presigned URL
 */
function s3UriEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function isR2DataStateKey(objectKey) {
  return String(objectKey || '').startsWith('data/');
}
function r2PresignedUrl(objectKey, expiry = R2_PRESIGN_SECONDS) {
  const now = new Date();
  const datestamp = now.toISOString().replace(/[-:]/g, '').slice(0, 8);            // 20260205
  const amzDate  = datestamp + 'T' + now.toISOString().replace(/[-:]/g, '').slice(9, 15) + 'Z'; // 20260205T…Z
  const region   = 'auto';
  const service  = 's3';
  const credScope = `${datestamp}/${region}/${service}/aws4_request`;

  const endpointUrl = new URL(R2_ENDPOINT);
  // Avoid generating http:// presigned URLs in production (causes mixed content).
  if (endpointUrl.protocol !== 'https:') {
    const hn = String(endpointUrl.hostname || '').toLowerCase();
    const isLocal = hn === 'localhost' || hn === '127.0.0.1' || hn === '::1';
    if (!isLocal) endpointUrl.protocol = 'https:';
  }
  const host = endpointUrl.host;
  const encodedKey = objectKey.split('/').map(s => s3UriEncode(s)).join('/');
  const canonicalUri = `/${R2_BUCKET}/${encodedKey}`;

  const queryParams = new Map([
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${R2_ACCESS_KEY}/${credScope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiry)],
    ['X-Amz-SignedHeaders', 'host'],
  ]);
  const sortedQs = [...queryParams.entries()]
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const canonicalRequest = [
    'GET',
    canonicalUri,
    sortedQs,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  let signingKey = hmacSha256('AWS4' + R2_SECRET_KEY, datestamp);
  signingKey = hmacSha256(signingKey, region);
  signingKey = hmacSha256(signingKey, service);
  signingKey = hmacSha256(signingKey, 'aws4_request');
  const signature = hmacSha256(signingKey, stringToSign).toString('hex');

  return `${endpointUrl.protocol}//${host}${canonicalUri}?${sortedQs}&X-Amz-Signature=${signature}`;
}

// ── R2 data persistence helpers (GET / PUT small objects like users.json) ────

/**
 * Build an S3v4-signed request to R2 and execute it.
 * Returns a Promise that resolves to { status, headers, body: Buffer }.
 */
function r2Request(method, objectKey, bodyBuf, extraHeaders) {
  return new Promise((resolve, reject) => {
    const now = new Date();
    const datestamp = now.toISOString().replace(/[-:]/g, '').slice(0, 8);
    const amzDate = datestamp + 'T' + now.toISOString().replace(/[-:]/g, '').slice(9, 15) + 'Z';
    const region = 'auto';
    const service = 's3';
    const credScope = `${datestamp}/${region}/${service}/aws4_request`;

    const endpointUrl = new URL(R2_ENDPOINT);
    const host = endpointUrl.host;
    const encodedKey = objectKey.split('/').map(s => s3UriEncode(s)).join('/');
    const canonicalUri = `/${R2_BUCKET}/${encodedKey}`;

    const payloadHash = bodyBuf ? sha256Hex(bodyBuf) : sha256Hex('');

    const hdrs = Object.assign({}, extraHeaders || {});
    hdrs['host'] = host;
    hdrs['x-amz-content-sha256'] = payloadHash;
    hdrs['x-amz-date'] = amzDate;
    if (bodyBuf) hdrs['content-length'] = String(bodyBuf.length);

    const signedHeaderKeys = Object.keys(hdrs).map(k => k.toLowerCase()).sort();
    const signedHeaders = signedHeaderKeys.join(';');
    const canonicalHeaders = signedHeaderKeys.map(k => `${k}:${hdrs[k]}\n`).join('');

    const canonicalRequest = [
      method,
      canonicalUri,
      '',              // no query string
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credScope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    let signingKey = hmacSha256('AWS4' + R2_SECRET_KEY, datestamp);
    signingKey = hmacSha256(signingKey, region);
    signingKey = hmacSha256(signingKey, service);
    signingKey = hmacSha256(signingKey, 'aws4_request');
    const signature = hmacSha256(signingKey, stringToSign).toString('hex');

    const authHeader = `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const outHeaders = {};
    for (const k of Object.keys(hdrs)) outHeaders[k] = hdrs[k];
    outHeaders['Authorization'] = authHeader;

    const reqOptions = {
      hostname: host,
      port: 443,
      path: canonicalUri,
      method,
      headers: outHeaders,
      agent: _r2HttpsAgent,
    };

    const httpReq = https.request(reqOptions, (httpRes) => {
      const chunks = [];
      httpRes.on('data', (c) => chunks.push(c));
      httpRes.on('end', () => {
        resolve({ status: httpRes.statusCode || 0, headers: httpRes.headers, body: Buffer.concat(chunks) });
      });
    });
    httpReq.on('error', reject);
    // 10-second timeout to prevent R2 hangs from stalling requests
    httpReq.setTimeout(10000, () => { httpReq.destroy(new Error('R2 request timeout after 10s')); });
    if (bodyBuf) httpReq.write(bodyBuf);
    httpReq.end();
  });
}

/**
 * S3v4-signed LIST request to R2 (ListObjectsV2).
 * Returns array of { key, size, lastModified }.
 */
async function _r2ListObjectsPage(prefix, maxKeys, continuationToken) {
  return new Promise((resolve, reject) => {
    const now = new Date();
    const datestamp = now.toISOString().replace(/[-:]/g, '').slice(0, 8);
    const amzDate = datestamp + 'T' + now.toISOString().replace(/[-:]/g, '').slice(9, 15) + 'Z';
    const region = 'auto';
    const service = 's3';
    const credScope = `${datestamp}/${region}/${service}/aws4_request`;

    const endpointUrl = new URL(R2_ENDPOINT);
    const host = endpointUrl.host;
    const canonicalUri = `/${R2_BUCKET}`;

    const qParams = new Map();
    qParams.set('list-type', '2');
    qParams.set('max-keys', String(maxKeys));
    if (prefix) qParams.set('prefix', prefix);
    if (continuationToken) qParams.set('continuation-token', continuationToken);
    // Build canonical query string (sorted by key)
    const sortedKeys = [...qParams.keys()].sort();
    const canonicalQS = sortedKeys.map(k => `${s3UriEncode(k)}=${s3UriEncode(qParams.get(k))}`).join('&');

    const payloadHash = sha256Hex('');
    const hdrs = {};
    hdrs['host'] = host;
    hdrs['x-amz-content-sha256'] = payloadHash;
    hdrs['x-amz-date'] = amzDate;

    const signedHeaderKeys = Object.keys(hdrs).map(k => k.toLowerCase()).sort();
    const signedHeaders = signedHeaderKeys.join(';');
    const canonicalHeaders = signedHeaderKeys.map(k => `${k}:${hdrs[k]}\n`).join('');

    const canonicalRequest = [
      'GET',
      canonicalUri,
      canonicalQS,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credScope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    let signingKey = hmacSha256('AWS4' + R2_SECRET_KEY, datestamp);
    signingKey = hmacSha256(signingKey, region);
    signingKey = hmacSha256(signingKey, service);
    signingKey = hmacSha256(signingKey, 'aws4_request');
    const signature = hmacSha256(signingKey, stringToSign).toString('hex');

    const authHeader = `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const outHeaders = {};
    for (const k of Object.keys(hdrs)) outHeaders[k] = hdrs[k];
    outHeaders['Authorization'] = authHeader;

    const reqOptions = {
      hostname: host,
      port: 443,
      path: `${canonicalUri}?${canonicalQS}`,
      method: 'GET',
      headers: outHeaders,
      agent: _r2HttpsAgent,
    };

    const httpReq = https.request(reqOptions, (httpRes) => {
      const chunks = [];
      httpRes.on('data', (c) => chunks.push(c));
      httpRes.on('end', () => {
        const xml = Buffer.concat(chunks).toString('utf8');
        // Simple XML parse for <Contents>
        const results = [];
        const regex = /<Contents>[\s\S]*?<Key>([\s\S]*?)<\/Key>[\s\S]*?<Size>(\d+)<\/Size>[\s\S]*?<LastModified>([\s\S]*?)<\/LastModified>[\s\S]*?<\/Contents>/g;
        let m;
        while ((m = regex.exec(xml)) !== null) {
          results.push({ key: m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'), size: parseInt(m[2], 10), lastModified: m[3] });
        }
        // Check for truncation — if <IsTruncated>true</IsTruncated>, extract continuation token
        const isTruncated = /<IsTruncated>true<\/IsTruncated>/i.test(xml);
        let nextToken = null;
        if (isTruncated) {
          const tokenMatch = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/);
          if (tokenMatch) nextToken = tokenMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        }
        resolve({ results, nextToken });
      });
    });
    httpReq.on('error', reject);
    // 8-second timeout to prevent R2 hangs from stalling the entire request
    httpReq.setTimeout(8000, () => { httpReq.destroy(new Error('R2 ListObjects timeout after 8s')); });
    httpReq.end();
  });
}

async function r2ListObjects(prefix, maxKeys) {
  maxKeys = maxKeys || 1000;
  const allResults = [];
  let continuationToken = null;
  do {
    let page;
    try {
      page = await _r2ListObjectsPage(prefix, maxKeys, continuationToken);
    } catch (e) {
      // Retry once on timeout/network error
      console.warn('[r2ListObjects] Retrying after error:', e.message, 'prefix:', prefix);
      page = await _r2ListObjectsPage(prefix, maxKeys, continuationToken);
    }
    allResults.push(...page.results);
    continuationToken = page.nextToken;
  } while (continuationToken);
  return allResults;
}

/**
 * DELETE an object from R2.
 */
async function r2DeleteObject(objectKey) {
  const resp = await r2Request('DELETE', objectKey, null, {});
  return resp.status >= 200 && resp.status < 300;
}

/**
 * GET an object from R2.  Returns the body as a UTF-8 string, or null if 404.
 */
async function r2HeadObjectMeta(objectKey) {
  try {
    const resp = await r2Request('HEAD', objectKey, null, {});
    if (resp.status !== 200) return null;
    return {
      size: Math.max(0, Number(resp.headers['content-length'] || 0) || 0),
      contentType: String(resp.headers['content-type'] || ''),
      etag: String(resp.headers.etag || ''),
      lastModified: String(resp.headers['last-modified'] || ''),
    };
  } catch { return null; }
}

async function r2HeadObject(objectKey) {
  return !!(await r2HeadObjectMeta(objectKey));
}

async function r2GetObject(objectKey) {
  if (!R2_DATA_STATE_ENABLED && isR2DataStateKey(objectKey)) return null;
  const resp = await r2Request('GET', objectKey, null, {});
  if (resp.status === 404 || resp.status === 403) return null;
  if (resp.status !== 200) throw new Error(`R2 GET ${objectKey} → ${resp.status}`);
  return resp.body.toString('utf8');
}

async function r2GetObjectBytes(objectKey) {
  if (!R2_DATA_STATE_ENABLED && isR2DataStateKey(objectKey)) return null;
  const resp = await r2Request('GET', objectKey, null, {});
  if (resp.status === 404 || resp.status === 403) return null;
  if (resp.status !== 200) throw new Error(`R2 GET ${objectKey} → ${resp.status}`);
  return resp.body; // raw Buffer, not utf8
}

/**
 * PUT an object to R2.
 */
async function r2PutObject(objectKey, content, contentType) {
  if (!R2_DATA_STATE_ENABLED && isR2DataStateKey(objectKey)) return;
  const buf = Buffer.from(content, 'utf8');
  const resp = await r2Request('PUT', objectKey, buf, { 'content-type': contentType || 'application/octet-stream' });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`R2 PUT ${objectKey} → ${resp.status}: ${resp.body.toString('utf8').slice(0, 200)}`);
  }
}

/**
 * PUT raw bytes to R2 (for images, etc.)
 * @param {string} objectKey
 * @param {Buffer} buf
 * @param {string} contentType
 */
async function r2PutObjectBytes(objectKey, buf, contentType) {
  if (!R2_DATA_STATE_ENABLED && isR2DataStateKey(objectKey)) return;
  const resp = await r2Request('PUT', objectKey, buf, { 'content-type': contentType || 'application/octet-stream' });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`R2 PUT(bytes) ${objectKey} → ${resp.status}: ${resp.body.toString('utf8').slice(0, 200)}`);
  }
}

async function loadUploadRequests(forceRefresh) {
  if (uploadRequestsLoaded && !forceRefresh) return;
  try {
    if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
      const stateResp = await loadAppStateSnapshot('upload_requests');
      if (stateResp && stateResp.ok && Array.isArray(stateResp.data)) {
        uploadRequests.length = 0;
        uploadRequests.push(...stateResp.data);
        uploadRequestsLoaded = true;
        return;
      }
    }
    if (R2_ENABLED) {
      const raw = await r2GetObject(UPLOAD_REQUESTS_R2_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          uploadRequests.length = 0;
          uploadRequests.push(...arr);
        }
      }
    }
  } catch (e) { console.error('[upload-requests] load error:', e.message); }
  uploadRequestsLoaded = true;
}

async function persistUploadRequestsNow() {
  if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
    const stateResp = await saveAppStateSnapshot('upload_requests', uploadRequests);
    if (!stateResp.ok) {
      throw new Error(`Supabase state write failed: ${stateResp.status || stateResp.reason || 'unknown'}`);
    }
  }
  if (R2_ENABLED) await r2PutObject(UPLOAD_REQUESTS_R2_KEY, JSON.stringify(uploadRequests), 'application/json');
}

let _uploadPersistTimer = null;
function scheduleUploadPersist() {
  if (_uploadPersistTimer) return;
  _uploadPersistTimer = setTimeout(async () => {
    _uploadPersistTimer = null;
    try {
      await persistUploadRequestsNow();
    } catch (e) { console.error('[upload-requests] persist error:', e.message); }
  }, 3000);
}

async function loadVideoRenameRequests(forceRefresh) {
  if (videoRenameRequestsLoaded && !forceRefresh) return;
  if (forceRefresh && (videoRenameMutationDepth > 0 || videoRenameFlushTimer)) return;
  try {
    if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
      const stateResp = await loadAppStateSnapshot('video_rename_requests');
      if (stateResp && stateResp.ok && Array.isArray(stateResp.data)) {
        videoRenameRequests.length = 0;
        videoRenameRequests.push(...stateResp.data);
        videoRenameRequestsLoaded = true;
        return;
      }
    }
    if (R2_ENABLED) {
      const raw = await r2GetObject(VIDEO_RENAME_REQUESTS_R2_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          videoRenameRequests.length = 0;
          videoRenameRequests.push(...arr);
        }
      }
    }
  } catch (e) {
    console.error('[video-rename] load error:', e && e.message ? e.message : e);
  }
  for (const r of videoRenameRequests) {
    if (!r || typeof r !== 'object') continue;
    r.vault = normalizeVaultParam(String(r.vault || '').trim());
    if ((!r.finalized || r.status === 'pending' || r.status === 'error') && r.folder && r.oldName) {
      const expectedIdentity = videoRenameIdentity(r.folder, r.subfolder || '', r.oldName, r.vault);
      if (String(r.videoIdentity || '') !== expectedIdentity) r.videoIdentity = expectedIdentity;
    }
  }
  videoRenameRequestsLoaded = true;
}

async function persistVideoRenameRequestsNow() {
  if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
    const stateResp = await saveAppStateSnapshot('video_rename_requests', videoRenameRequests);
    if (!stateResp.ok) {
      throw new Error(`Supabase state write failed: ${stateResp.status || stateResp.reason || 'unknown'}`);
    }
  }
  if (R2_ENABLED) {
    await r2PutObject(VIDEO_RENAME_REQUESTS_R2_KEY, JSON.stringify(videoRenameRequests), 'application/json');
  }
}

async function flushVideoRenameRequestsNow() {
  if (videoRenameFlushTimer) {
    clearTimeout(videoRenameFlushTimer);
    videoRenameFlushTimer = null;
  }
  videoRenameWritePromise = videoRenameWritePromise
    .catch((e) => {
      console.error('[video-rename] previous persist error:', e && e.message ? e.message : e);
    })
    .then(persistVideoRenameRequestsNow);
  return videoRenameWritePromise;
}

function scheduleVideoRenamePersist() {
  if (videoRenameFlushTimer) return;
  videoRenameFlushTimer = setTimeout(() => {
    videoRenameFlushTimer = null;
    videoRenameWritePromise = videoRenameWritePromise.then(persistVideoRenameRequestsNow).catch((e) => {
      console.error('[video-rename] persist error:', e && e.message ? e.message : e);
    });
  }, 2000);
}

/**
 * List media file names from an R2 prefix.
 * Returns items with name, size, lastModified (ms).
 */
// Cache R2 listing results to avoid hammering R2 on every page load
const _r2ListCache = {};
const _R2_LIST_CACHE_TTL = 120000; // 2 minutes

async function r2ListMediaFilesFromPrefix(prefix) {
  try {
    // Check cache first
    const cached = _r2ListCache[prefix];
    if (cached && (Date.now() - cached.ts < _R2_LIST_CACHE_TTL)) {
      return cached.items;
    }
    const entries = await r2ListObjects(prefix);
    const items = entries
      .map((e) => ({
        name: e.key.slice(prefix.length),
        size: e.size,
        lastModified: e.lastModified || 0,
      }))
      .filter((e) => e.name && !e.name.includes('/') && isAllowedMediaFile(e.name));
    items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    _r2ListCache[prefix] = { items, ts: Date.now() };
    return items;
  } catch (e) {
    console.error(`R2 list error for prefix ${prefix}:`, e && e.message ? e.message : e);
    return [];
  }
}

/**
 * List media file names for a folder, from R2 if enabled, otherwise local disk.
 */
async function r2ListMediaFiles(folder) {
  const folderDirName = allowedFolderBasePath(folder);
  if (!folderDirName) return [];
  const prefix = folderDirName + '/';
  return r2ListMediaFilesFromPrefix(prefix);
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.bmp': return 'image/bmp';
    case '.mp4': return 'video/mp4';
    case '.webm': return 'video/webm';
    case '.mov': return 'video/quicktime';
    case '.avi': return 'video/x-msvideo';
    case '.mkv': return 'video/x-matroska';
    case '.wmv': return 'video/x-ms-wmv';
    case '.flv': return 'video/x-flv';
    case '.txt': return 'text/plain; charset=utf-8';
    case '.xml': return 'application/xml; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
  const buf = Buffer.from(body);
  const accept = String((res._gzReq && res._gzReq.headers['accept-encoding']) || '');
  if (buf.length > 1024 && accept.includes('gzip')) {
    // Async gzip to avoid blocking the event loop (prevents health check timeouts)
    zlib.gzip(buf, { level: 6 }, (err, compressed) => {
      if (err) {
        headers['Content-Length'] = buf.length;
        res.writeHead(status, headers);
        res.end(buf);
        return;
      }
      headers['Content-Encoding'] = 'gzip';
      headers['Content-Length'] = compressed.length;
      headers['Vary'] = 'Accept-Encoding';
      res.writeHead(status, headers);
      res.end(compressed);
    });
  } else {
    headers['Content-Length'] = buf.length;
    res.writeHead(status, headers);
    res.end(buf);
  }
}

// HTML-escape for safe injection into HTML attributes/content (prevents XSS in SSR)
function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

function sendText(res, status, text) {
  const body = String(text || '');
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  });
  res.end(body);
}

function readRawBody(req, res, maxBytes = 1024 * 1024) {
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        sendJson(res, 413, { error: 'Payload too large' });
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => {
      sendJson(res, 400, { error: 'Bad request' });
      resolve(null);
    });
  });
}

function getRequestOrigin(req) {
  const host = String(req.headers.host || '').trim();
  if (!host) return `http://${HOST}:${PORT}`;
  const hostname = host.split(':')[0].toLowerCase();
  if (SITE_ORIGIN) {
    try {
      const canon = new URL(SITE_ORIGIN);
      const ch = canon.hostname.replace(/^www\./, '').toLowerCase();
      const rh = hostname.replace(/^www\./, '').toLowerCase();
      if (rh === ch) return canon.origin;
    } catch {
      /* ignore */
    }
  }
  const xfProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  // Railway/Cloudflare usually set x-forwarded-proto; if it's missing, default to https
  // for non-local hosts to avoid mixed-content (Chrome shows "Not secure" even with a valid cert).
  let proto;
  if (xfProto === 'https' || xfProto === 'http') {
    proto = xfProto;
  } else {
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    proto = isLocal ? 'http' : 'https';
  }
  return `${proto}://${host}`;
}

function verifyStripeSignature(payloadBuf, signatureHeader, webhookSecret, toleranceSeconds = 300) {
  const header = String(signatureHeader || '');
  const secret = String(webhookSecret || '');
  if (!header || !secret) return false;

  // Format: t=timestamp,v1=signature[,v1=signature2...]
  const parts = header.split(',').map((p) => p.trim()).filter(Boolean);
  const tPart = parts.find((p) => p.startsWith('t='));
  if (!tPart) return false;
  const t = Number(tPart.slice(2));
  if (!Number.isFinite(t) || t <= 0) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > toleranceSeconds) return false;

  const v1s = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!v1s.length) return false;

  const signedPayload = `${t}.${payloadBuf.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');

  for (const sig of v1s) {
    if (!sig || sig.length !== expected.length) continue;
    try {
      const sigBuf = Buffer.from(sig, 'hex');
      if (sigBuf.length !== expectedBuf.length) continue;
      if (crypto.timingSafeEqual(sigBuf, expectedBuf)) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

function parseCookies(req) {
  const header = String(req.headers.cookie || '');
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key) return;
    out[key] = decodeURIComponent(val);
  });
  return out;
}

function getClientIp(req) {
  // Always read forwarded headers — proxied through Fly.io / Cloudflare / Railway.
  const flyIp = req.headers['fly-client-ip'];
  if (flyIp) return String(flyIp).split(',')[0].trim();

  const cf = req.headers['cf-connecting-ip'];
  if (cf) return String(cf).split(',')[0].trim();

  const real = req.headers['x-real-ip'];
  if (real) return String(real).split(',')[0].trim();

  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();

  return (req.socket && req.socket.remoteAddress) ? String(req.socket.remoteAddress) : 'unknown';
}

function normalizeIp(ip) {
  const raw = String(ip || '').trim();
  if (!raw) return 'unknown';
  if (raw === '::1') return '127.0.0.1';
  if (raw.startsWith('::ffff:')) return raw.slice('::ffff:'.length);
  return raw;
}

function appendSetCookie(res, cookie) {
  const prev = res.getHeader('Set-Cookie');
  if (!prev) {
    res.setHeader('Set-Cookie', cookie);
    return;
  }
  if (Array.isArray(prev)) {
    res.setHeader('Set-Cookie', prev.concat(cookie));
    return;
  }
  res.setHeader('Set-Cookie', [String(prev), cookie]);
}

function setReferralCookie(res, code) {
  const cookie = [
    `${REF_COOKIE}=${encodeURIComponent(String(code || ''))}`,
    'Path=/',
    'SameSite=Lax',
    'Max-Age=86400',
  ].join('; ');
  appendSetCookie(res, cookie);
}

function clearReferralCookie(res) {
  appendSetCookie(res, `${REF_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`);
}

function setSessionCookie(res, token) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  // Secure cookies require HTTPS. Prefer NODE_ENV / TBW_SECURE_COOKIES — not PORT alone (PORT breaks plain-http dev).
  const envSecure = String(process.env.TBW_SECURE_COOKIES || '').trim() === '1';
  const prodSecure = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  if (envSecure || prodSecure) parts.push('Secure');
  const cookie = parts.join('; ');
  appendSetCookie(res, cookie);
}

function clearSessionCookie(res) {
  appendSetCookie(res, `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function createOAuthLinkCookieValue(provider, userKey) {
  const base = `${String(provider || '').toLowerCase()}:${String(userKey || '')}`;
  const sig = crypto.createHmac('sha256', PEPPER || 'tbw_oauth_link').update(base).digest('hex');
  return `${base}:${sig}`;
}

function parseOAuthLinkCookieValue(rawValue) {
  const raw = String(rawValue || '');
  const parts = raw.split(':');
  if (parts.length < 3) return null;
  const sig = parts.pop();
  const provider = String(parts.shift() || '').toLowerCase();
  const userKey = parts.join(':');
  if (!provider || !userKey || !sig) return null;
  const base = `${provider}:${userKey}`;
  const expected = crypto.createHmac('sha256', PEPPER || 'tbw_oauth_link').update(base).digest('hex');
  const a = Buffer.from(String(sig), 'hex');
  const b = Buffer.from(expected, 'hex');
  if (!a.length || a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  return { provider, userKey };
}

function setOAuthLinkCookie(res, provider, userKey) {
  const val = encodeURIComponent(createOAuthLinkCookieValue(provider, userKey));
  appendSetCookie(res, `${OAUTH_LINK_COOKIE}=${val}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);
}

function clearOAuthLinkCookie(res) {
  appendSetCookie(res, `${OAUTH_LINK_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function getAuthedUserKey(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const sess = sessions.get(token);
  if (!sess) return null;
  const ageSeconds = (Date.now() - sess.createdAt) / 1000;
  if (ageSeconds > SESSION_TTL_SECONDS) {
    sessions.delete(token);
    persistSessionsToR2();
    return null;
  }
  return sess.userKey;
}

// Re-fetch sessions from R2 when a token is not found locally (multi-machine sync)
async function getAuthedUserKeyWithRefresh(req) {
  try {
    const jwKey = await getUserKeyFromSupabaseBearer(req);
    if (jwKey) return jwKey;
  } catch (e) {
    console.warn('[auth] bearer user lookup:', e && e.message ? e.message : e);
  }
  const key = getAuthedUserKey(req);
  if (key) return key;
  // Token exists in cookie but not in local sessions — another machine may have created it
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token || !R2_ENABLED) return null;
  try {
    const raw = await r2GetObject(SESSIONS_R2_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const now = Date.now();
      if (parsed && typeof parsed === 'object') {
        for (const [tok, sess] of Object.entries(parsed)) {
          if (sess && sess.userKey && sess.createdAt) {
            const ageSec = (now - sess.createdAt) / 1000;
            if (ageSec < SESSION_TTL_SECONDS) {
              sessions.set(tok, { userKey: sess.userKey, createdAt: sess.createdAt });
            }
          }
        }
      }
    }
  } catch {}
  return getAuthedUserKey(req);
}

async function ensureSessionsLoaded() {
  if (sessionsLoaded || !R2_ENABLED) return;
  await loadSessionsOnceFromR2(usersDb || null);
}

function isValidReferralCode(code) {
  return typeof code === 'string' && new RegExp(`^[a-zA-Z0-9]{${REF_CODE_LEN}}$`).test(code);
}

function findUserKeyByReferralCode(db, code) {
  if (!db || !db.users || !code) return null;
  const target = String(code);
  for (const [userKey, u] of Object.entries(db.users)) {
    if (u && typeof u === 'object' && String(u.referralCode || '') === target) return userKey;
  }
  return null;
}

function userExistsByUsername(db, username) {
  if (!db || !db.users) return false;
  const target = String(username || '').trim().toLowerCase();
  if (!target) return false;
  for (const [userKey, u] of Object.entries(db.users)) {
    if (String(userKey || '').toLowerCase() === target) return true;
    if (u && typeof u === 'object' && String(u.username || '').toLowerCase() === target) return true;
  }
  return false;
}

function findUserKeyByUsername(db, username) {
  if (!db || !db.users) return null;
  const target = String(username || '').trim().toLowerCase();
  if (!target) return null;
  for (const [userKey, u] of Object.entries(db.users)) {
    if (String(userKey || '').toLowerCase() === target) return userKey;
    if (u && typeof u === 'object' && String(u.username || '').toLowerCase() === target) return userKey;
  }
  return null;
}

function randomReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < REF_CODE_LEN; i++) {
    out += chars[crypto.randomInt(0, chars.length)];
  }
  return out;
}

function ensureUserReferralCode(db, userKey) {
  const u = db.users[userKey];
  if (u && isValidReferralCode(u.referralCode)) return u.referralCode;

  let code = randomReferralCode();
  let tries = 0;
  while (findUserKeyByReferralCode(db, code) && tries < 50) {
    code = randomReferralCode();
    tries += 1;
  }
  if (!isValidReferralCode(code) || findUserKeyByReferralCode(db, code)) {
    // extremely unlikely; fall back to crypto bytes base64-ish
    code = crypto.randomBytes(8).toString('hex').slice(0, REF_CODE_LEN);
  }
  u.referralCode = code;
  return code;
}

function tierLabelFromCount(count) {
  const n = Number(count || 0);
  if (n >= 1) return 'TIER 1';
  return 'NO TIER';
}

function tierFromCount(count) {
  const n = Number(count || 0);
  if (n >= 1) return 1;
  return 0;
}

function tierLabelFromTier(tier) {
  const t = Number(tier || 0);
  if (t >= 3) return 'TIER 3';
  if (t >= 2) return 'TIER 2';
  if (t >= 1) return 'TIER 1';
  return 'NO TIER';
}

function normalizeManualTier(value) {
  if (value === undefined || value === null || value === 0) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const t = Math.floor(n);
  if (t >= 1 && t <= 4) return t;
  return null;
}

function tierMinCount(tier) {
  const t = Number(tier || 0);
  if (t >= 1) return 1;
  return 0;
}

function getEffectiveTierForUser(u) {
  const manual = normalizeManualTier(u && u.tier);
  if (manual !== null) return Math.min(manual, 3);
  const count = (u && Array.isArray(u.referredUsers)) ? u.referredUsers.length : 0;
  return tierFromCount(count);
}

function referralGoalFromCount(count) {
  return 1;
}

function stripDiscordPrefix(name) {
  const s = String(name || '');
  return s.startsWith('discord:') ? s.slice('discord:'.length) : s;
}

function buildReferralLeaderboard(db, page, perPage) {
  if (!db || !db.users) return { entries: [], page: 0, totalPages: 0 };
  const list = [];
  for (const [userKey, u] of Object.entries(db.users)) {
    if (!u || typeof u !== 'object') continue;
    const count = Array.isArray(u.referredUsers) ? u.referredUsers.length : 0;
    if (count <= 0) continue;
    list.push({ username: stripDiscordPrefix(u.username || userKey), count });
  }
  list.sort((a, b) => b.count - a.count || a.username.localeCompare(b.username));
  const totalPages = Math.max(1, Math.ceil(list.length / perPage));
  const p = Math.max(0, Math.min(page, totalPages - 1));
  const entries = list.slice(p * perPage, (p + 1) * perPage).map((e, i) => ({
    rank: p * perPage + i + 1,
    username: e.username,
    count: e.count,
  }));
  return { entries, page: p, totalPages };
}

// ── Visit tracking ──────────────────────────────────────────────────────────
const visitLog = [];  // array of timestamps
let visitAllTime = 0;
const VISIT_STATS_FILE = path.join(DATA_DIR, 'visit_stats.json');
const VISIT_STATS_R2_KEY = 'data/visit_stats.json';
let visitStatsWritePromise = Promise.resolve();
let visitStatsFlushTimer = null;
let visitStatsLoaded = false; // guard: don't write until R2 load completes

// ── Short stats (views + likes) ─────────────────────────────────────────────
const SHORT_STATS_R2_KEY = 'data/shorts/short_stats.json';
const SHORT_STATS_FILE = path.join(DATA_DIR, 'short_stats.json');
let shortStats = {}; // { "videoKey": { views: N, likes: N } }
let shortStatsWritePromise = Promise.resolve();
let shortStatsFlushTimer = null;
let shortStatsLoaded = false; // guard: don't write until R2 load completes
let _shortStatsLastFetchTs = 0;
const _SHORT_STATS_CACHE_TTL = 15000; // refresh from R2 every 15s for multi-machine sync

// ── OnlyFans creator stats (views/clicks) ───────────────────────────────────
let onlyfansCreatorStats = {}; // { "slug": { views: N } }
let onlyfansCreatorStatsLoaded = false;
let onlyfansCreatorStatsWritePromise = Promise.resolve();
let onlyfansCreatorStatsFlushTimer = null;
const ONLYFANS_CREATOR_STATS_STATE_KEY = 'onlyfans_creator_stats';

async function loadOnlyfansCreatorStats() {
  try {
    let state = null;
    if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
      const stateResp = await loadAppStateSnapshot(ONLYFANS_CREATOR_STATS_STATE_KEY);
      if (stateResp && stateResp.ok && stateResp.data && typeof stateResp.data === 'object') {
        state = stateResp.data;
      }
    }
    const next = {};
    for (const [slug, val] of Object.entries(state || {})) {
      if (!slug || typeof val !== 'object' || !val) continue;
      next[String(slug).toLowerCase()] = { views: Math.max(0, Number(val.views || 0) || 0) };
    }
    onlyfansCreatorStats = next;
  } catch (e) {
    console.error('[onlyfans-stats] load error:', e && e.message ? e.message : e);
  } finally {
    onlyfansCreatorStatsLoaded = true;
  }
}

async function queueOnlyfansCreatorStatsWrite() {
  if (!onlyfansCreatorStatsLoaded) return;
  const snapshot = {};
  for (const [slug, val] of Object.entries(onlyfansCreatorStats || {})) {
    snapshot[slug] = { views: Math.max(0, Number(val?.views || 0) || 0) };
  }
  onlyfansCreatorStatsWritePromise = onlyfansCreatorStatsWritePromise.then(async () => {
    if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
      const stateResp = await saveAppStateSnapshot(ONLYFANS_CREATOR_STATS_STATE_KEY, snapshot);
      if (!stateResp.ok) {
        console.error('[onlyfans-stats] Supabase state write failed:', stateResp.status || stateResp.reason || 'unknown');
      }
    }
  }).catch((e) => {
    console.error('[onlyfans-stats] write error:', e && e.message ? e.message : e);
  });
  return onlyfansCreatorStatsWritePromise;
}

function scheduleOnlyfansCreatorStatsPersist() {
  if (!onlyfansCreatorStatsLoaded) return;
  if (onlyfansCreatorStatsFlushTimer) return;
  onlyfansCreatorStatsFlushTimer = setTimeout(() => {
    onlyfansCreatorStatsFlushTimer = null;
    void queueOnlyfansCreatorStatsWrite();
  }, 3000);
}

// Extract filename from old URL-style keys ("/media?folder=X&name=file.mp4" → "file.mp4")
function _migrateStatsKey(key) {
  if (!key || typeof key !== 'string') return key;
  // Old keys look like "/media?folder=...&name=encoded.mp4" or "/preview-media?folder=...&name=encoded.mp4"
  const m = key.match(/[?&]name=([^&]+)/);
  if (m) return decodeURIComponent(m[1]);
  return key; // already a filename
}

/** Merge legacy `Petitie|…` short_stats keys into `Petite|…`. */
function _migratePetitieFolderInStatsKeys(obj) {
  if (!obj || typeof obj !== 'object') return;
  const keys = Object.keys(obj);
  for (const k of keys) {
    if (typeof k !== 'string' || !k.startsWith('Petitie|')) continue;
    const nk = `Petite|${k.slice('Petitie|'.length)}`;
    const src = obj[k];
    const dst = obj[nk] || { views: 0, likes: 0, dislikes: 0 };
    obj[nk] = {
      views: Math.max(dst.views || 0, (src && src.views) || 0),
      likes: Math.max(dst.likes || 0, (src && src.likes) || 0),
      dislikes: Math.max(dst.dislikes || 0, (src && src.dislikes) || 0),
      _votes: { ...(dst._votes || {}), ...((src && src._votes) || {}) },
    };
    delete obj[k];
  }
}

// Merge stats from src into dst, ONLY increasing counts (never decreasing)
function _mergeStatsMonotonic(dst, src) {
  if (!src || typeof src !== 'object') return;
  for (const [rawKey, val] of Object.entries(src)) {
    if (!val || typeof val !== 'object') continue;
    const key = _migrateStatsKey(rawKey);
    const existing = dst[key] || { views: 0, likes: 0, dislikes: 0 };
    dst[key] = {
      views: Math.max(existing.views || 0, val.views || 0),
      likes: Math.max(existing.likes || 0, val.likes || 0),
      dislikes: Math.max(existing.dislikes || 0, val.dislikes || 0),
      _votes: { ...(existing._votes || {}), ...(val._votes || {}) },
    };
  }
}

async function loadShortStats() {
  try {
    let r2Data = null;
    let localData = null;
    let supabaseData = null;
    if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
      const stateResp = await loadAppStateSnapshot('short_stats');
      if (stateResp && stateResp.ok && stateResp.data && typeof stateResp.data === 'object') {
        supabaseData = stateResp.data;
      }
    }
    if (R2_ENABLED) {
      const raw = await r2GetObject(SHORT_STATS_R2_KEY);
      if (raw) r2Data = JSON.parse(raw);
    }
    if (fs.existsSync(SHORT_STATS_FILE)) {
      localData = JSON.parse(fs.readFileSync(SHORT_STATS_FILE, 'utf8'));
    }
    // Merge all sources into existing shortStats — counts can ONLY go up, never down
    const prev = { ...shortStats }; // preserve in-memory counts
    const merged = {};
    _mergeStatsMonotonic(merged, prev);      // keep whatever we had in memory
    _mergeStatsMonotonic(merged, localData);    // merge local file (migrates old URL keys)
    _mergeStatsMonotonic(merged, r2Data);       // merge R2 data (migrates old URL keys)
    _mergeStatsMonotonic(merged, supabaseData); // merge Supabase app_state source

    // Debug: log what was loaded so we can diagnose merge issues
    const _prevKeys = Object.keys(prev).length;
    const _r2Keys = r2Data ? Object.keys(r2Data).length : 0;
    const _localKeys = localData ? Object.keys(localData).length : 0;
    const _mergedKeys = Object.keys(merged).length;
    let _mergedViews = 0;
    for (const v of Object.values(merged)) _mergedViews += (v && v.views) || 0;
    let _r2Views = 0;
    if (r2Data) for (const v of Object.values(r2Data)) _r2Views += (v && v.views) || 0;
    console.log(`[shortStats] Loaded: prev=${_prevKeys} keys, r2=${_r2Keys} keys (${_r2Views} views), local=${_localKeys} keys → merged=${_mergedKeys} keys (${_mergedViews} views)`);

    _migratePetitieFolderInStatsKeys(merged);
    shortStats = merged;
    _shortStatsLastFetchTs = Date.now();
    shortStatsLoaded = true;
  } catch (e) {
    console.error('[shortStats] loadShortStats error:', e && e.message ? e.message : e);
    /* don't wipe shortStats on error — keep what we have */ shortStatsLoaded = true;
  }
}

async function ensureShortStatsFresh() {
  if (Date.now() - _shortStatsLastFetchTs < _SHORT_STATS_CACHE_TTL) return;
  if (shortStatsFlushTimer) return; // don't reload while a write is pending
  try { await loadShortStats(); } catch {}
}

function queueShortStatsWrite() {
  let _writeViews = 0;
  for (const v of Object.values(shortStats)) _writeViews += (v && v.views) || 0;
  console.log(`[shortStats] Writing: ${Object.keys(shortStats).length} keys, ${_writeViews} total views`);
  // Storage minimization: persist only aggregated counters.
  // `_votes` is per-user toggle state (large) and is only needed in-memory for immediate UX.
  const snapshotObj = {};
  for (const [k, v] of Object.entries(shortStats)) {
    snapshotObj[k] = {
      views: (v && typeof v.views === 'number') ? v.views : 0,
      likes: (v && typeof v.likes === 'number') ? v.likes : 0,
      dislikes: (v && typeof v.dislikes === 'number') ? v.dislikes : 0,
    };
  }
  const snapshot = JSON.stringify(snapshotObj, null, 2);
  shortStatsWritePromise = shortStatsWritePromise.then(async () => {
    if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
      const stateResp = await saveAppStateSnapshot('short_stats', snapshotObj);
      if (!stateResp.ok) {
        console.error('[shortStats] Supabase state write failed:', stateResp.status || stateResp.reason || 'unknown');
      }
    }
    if (R2_ENABLED) await r2PutObject(SHORT_STATS_R2_KEY, snapshot, 'application/json');
  }).catch(e => {
    console.error('shortStats write error:', e && e.message ? e.message : e);
  });
  return shortStatsWritePromise;
}

function scheduleShortStatsPersist() {
  if (!shortStatsLoaded) return; // don't write until R2 data has been loaded
  if (shortStatsFlushTimer) return;
  shortStatsFlushTimer = setTimeout(() => {
    shortStatsFlushTimer = null;
    queueShortStatsWrite();
  }, 5000); // batch writes every 5s
}

// ── Recommendation telemetry/profile stores ──────────────────────────────────
// (Not Supabase `public.profiles` — that legacy table is dropped after merge into `public.users`; see supabase/migrations/20260429190000_merge_profiles_drop_age_gate.sql.)
const RECO_EVENTS_FILE = path.join(DATA_DIR, 'reco_events.json');
const RECO_PROFILES_FILE = path.join(DATA_DIR, 'user_profiles.json');
const RECO_PROGRESS_FILE = path.join(DATA_DIR, 'user_video_progress.json');
const RECO_GLOBAL_FILE = path.join(DATA_DIR, 'reco_global_stats.json');
const RECO_EVENTS_R2_KEY = 'data/reco_events.json';
const RECO_PROFILES_R2_KEY = 'data/user_profiles.json';
const RECO_PROGRESS_R2_KEY = 'data/user_video_progress.json';
const RECO_GLOBAL_R2_KEY = 'data/reco_global_stats.json';
const RECO_SID_COOKIE = 'py_sid';
const RECO_RETENTION_DAYS = Math.max(7, Math.min(90, Number(process.env.RECO_RETENTION_DAYS || 30)));
const RECO_MAX_EVENTS = Math.max(5000, Math.min(500000, Number(process.env.RECO_MAX_EVENTS || 120000)));
const RECO_MAX_PROGRESS = Math.max(2000, Math.min(200000, Number(process.env.RECO_MAX_PROGRESS || 60000)));
const RECO_MAX_PROFILES = Math.max(1000, Math.min(150000, Number(process.env.RECO_MAX_PROFILES || 50000)));
const RECO_PROFILE_REBUILD_MS = Math.max(20000, Math.min(10 * 60 * 1000, Number(process.env.RECO_PROFILE_REBUILD_MS || 90000)));

let recoEvents = []; // [{ eventType, identityKey, ts, ... }]
let userProfiles = {}; // { identityKey: { ...feature vectors } }
let userVideoProgress = {}; // { identity|videoId: { ...progress } }
let recoGlobalStats = { topVideos: [], topShorts: [], updatedAt: 0 };
let recoLoaded = false;
let recoWritePromise = Promise.resolve();
let recoFlushTimer = null;
let recoLastRebuildTs = 0;

function canonicalVideoId(folder, subfolder, name, vault) {
  const f = canonicalFolderLabel(folder);
  const v = String(vault || '').trim().toLowerCase();
  if (!v) {
    return [f, String(subfolder || ''), String(name || '')].join('|');
  }
  return [f, String(subfolder || ''), v, String(name || '')].join('|');
}

function parseCanonicalVideoId(videoId) {
  const parts = String(videoId || '').split('|');
  if (parts.length >= 4) {
    return {
      folder: parts[0] || '',
      subfolder: parts[1] || '',
      vault: parts[2] || '',
      name: parts.slice(3).join('|') || '',
    };
  }
  return {
    folder: parts[0] || '',
    subfolder: parts[1] || '',
    vault: '',
    name: parts.slice(2).join('|') || '',
  };
}

function videoRenameIdentity(folder, subfolder, name, vault) {
  return canonicalVideoId(folder || '', subfolder || '', name || '', vault || '');
}

function getVideoRenameRecordByIdentity(identity) {
  let latest = null;
  for (const r of videoRenameRequests) {
    if (!r || (r.videoIdentity !== identity && r.newVideoIdentity !== identity)) continue;
    if (!latest || Number(r.updatedAt || r.requestedAt || 0) > Number(latest.updatedAt || latest.requestedAt || 0)) {
      latest = r;
    }
  }
  return latest;
}

function getVideoRenameStatus(identity) {
  const rec = getVideoRenameRecordByIdentity(identity);
  if (!rec) return { state: 'none', record: null };
  if (rec.finalized || rec.status === 'approved') return { state: 'finalized', record: rec };
  if (rec.status === 'pending' || rec.status === 'error') return { state: 'pending', record: rec };
  return { state: 'none', record: rec };
}

function buildRenamedFileName(requestedTitle, oldName) {
  const ext = path.extname(String(oldName || '')).toLowerCase() || '.mp4';
  const rawBase = String(requestedTitle || '').trim();
  const sanitizedBase = sanitizeObjectKeySegment(rawBase, 96);
  if (!sanitizedBase) return '';
  return sanitizedBase + ext;
}

function migrateVideoKeyedStateAfterRename(folder, subfolder, oldName, newName, vaultHint) {
  const sf = String(subfolder || '');
  const vNorm = normalizeVaultParam(vaultHint);
  const oldBase = canonicalVideoId(folder, sf, oldName, vNorm);
  const newBase = canonicalVideoId(folder, sf, newName, vNorm);

  // shortStats
  const oldStatKeys = Object.keys(shortStats || {});
  const folderCanon = canonicalFolderLabel(folder);
  for (const k of oldStatKeys) {
    const parsed = parseCanonicalVideoId(k);
    if (canonicalFolderLabel(parsed.folder) !== folderCanon || parsed.subfolder !== sf || parsed.name !== oldName) continue;
    const nextKey = canonicalVideoId(folder, sf, newName, parsed.vault || '');
    const cur = shortStats[k] || {};
    const dst = shortStats[nextKey] || { views: 0, likes: 0, dislikes: 0 };
    shortStats[nextKey] = {
      views: Math.max(Number(dst.views || 0), Number(cur.views || 0)),
      likes: Math.max(Number(dst.likes || 0), Number(cur.likes || 0)),
      dislikes: Math.max(Number(dst.dislikes || 0), Number(cur.dislikes || 0)),
      _votes: dst._votes || cur._votes || {},
    };
    delete shortStats[k];
  }

  // Handle simple legacy keys that are just filename-based.
  if (shortStats[oldName]) {
    const cur = shortStats[oldName] || {};
    const dst = shortStats[newName] || { views: 0, likes: 0, dislikes: 0 };
    shortStats[newName] = {
      views: Math.max(Number(dst.views || 0), Number(cur.views || 0)),
      likes: Math.max(Number(dst.likes || 0), Number(cur.likes || 0)),
      dislikes: Math.max(Number(dst.dislikes || 0), Number(cur.dislikes || 0)),
      _votes: dst._votes || cur._votes || {},
    };
    delete shortStats[oldName];
  }
  if (shortStats[oldBase]) {
    const cur = shortStats[oldBase] || {};
    const dst = shortStats[newBase] || { views: 0, likes: 0, dislikes: 0 };
    shortStats[newBase] = {
      views: Math.max(Number(dst.views || 0), Number(cur.views || 0)),
      likes: Math.max(Number(dst.likes || 0), Number(cur.likes || 0)),
      dislikes: Math.max(Number(dst.dislikes || 0), Number(cur.dislikes || 0)),
      _votes: dst._votes || cur._votes || {},
    };
    delete shortStats[oldBase];
  }
  scheduleShortStatsPersist();

  // comments
  const oldCommentKeys = Object.keys(videoComments || {});
  for (const k of oldCommentKeys) {
    const parsed = parseCanonicalVideoId(k);
    if (canonicalFolderLabel(parsed.folder) !== folderCanon || parsed.subfolder !== sf || parsed.name !== oldName) continue;
    const nextKey = canonicalVideoId(folder, sf, newName, parsed.vault || '');
    const dst = Array.isArray(videoComments[nextKey]) ? videoComments[nextKey] : [];
    const cur = Array.isArray(videoComments[k]) ? videoComments[k] : [];
    videoComments[nextKey] = [...dst, ...cur];
    delete videoComments[k];
  }
  if (Array.isArray(videoComments[oldName])) {
    const dst = Array.isArray(videoComments[newName]) ? videoComments[newName] : [];
    videoComments[newName] = [...dst, ...videoComments[oldName]];
    delete videoComments[oldName];
  }
  if (Array.isArray(videoComments[oldBase])) {
    const dst = Array.isArray(videoComments[newBase]) ? videoComments[newBase] : [];
    videoComments[newBase] = [...dst, ...videoComments[oldBase]];
    delete videoComments[oldBase];
  }
  scheduleCommentsPersist();
}

function migrateUploadRequestStateAfterRename(folder, subfolder, oldName, newName, sourceKey, destKey) {
  const folderCanon = canonicalFolderLabel(folder);
  const sf = String(subfolder || '');
  let changed = false;
  for (const req of uploadRequests) {
    if (!req || req.status !== 'approved') continue;
    if (canonicalFolderLabel(req.category || '') !== folderCanon) continue;
    if (String(req.subfolder || '') !== sf) continue;
    const finalKey = String(req.r2FinalKey || '');
    const tempKey = String(req.r2TempKey || '');
    const finalMatches = finalKey && (finalKey === sourceKey || finalKey.endsWith('/' + oldName));
    const tempMatches = tempKey && (tempKey === sourceKey || tempKey.endsWith('/' + oldName));
    if (!finalMatches && !tempMatches) continue;
    if (destKey) {
      if (finalMatches) req.r2FinalKey = destKey;
      if (tempMatches) req.r2TempKey = destKey;
    } else {
      if (finalMatches) req.r2FinalKey = finalKey.replace(/\/[^/]+$/, '/' + newName);
      if (tempMatches) req.r2TempKey = tempKey.replace(/\/[^/]+$/, '/' + newName);
    }
    req.videoName = path.basename(newName, path.extname(newName));
    changed = true;
  }
  if (changed) scheduleUploadPersist();
}

function clearMediaCachesAfterRename() {
  Object.keys(_r2ListCache).forEach((k) => delete _r2ListCache[k]);
  if (global._listCache) Object.keys(global._listCache).forEach((k) => delete global._listCache[k]);
  if (global._videoListCache) Object.keys(global._videoListCache).forEach((k) => delete global._videoListCache[k]);
  if (global._mediaKeyCache) Object.keys(global._mediaKeyCache).forEach((k) => delete global._mediaKeyCache[k]);
  if (global._tierLookupCache) Object.keys(global._tierLookupCache).forEach((k) => delete global._tierLookupCache[k]);
  Object.keys(previewUrlMap).forEach((k) => delete previewUrlMap[k]);
  previewFileList = [];
  ensurePreviewCacheReady(true).catch(() => {});
}

function discordPublicKeyToSpki(hexKey) {
  const raw = Buffer.from(String(hexKey || ''), 'hex');
  if (raw.length !== 32) return null;
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  return Buffer.concat([prefix, raw]);
}

function verifyDiscordInteractionSignature(req, rawBody) {
  try {
    if (!DISCORD_INTERACTIONS_PUBLIC_KEY) return false;
    const sigHex = String(req.headers['x-signature-ed25519'] || '');
    const ts = String(req.headers['x-signature-timestamp'] || '');
    if (!sigHex || !ts || !rawBody) return false;
    const sig = Buffer.from(sigHex, 'hex');
    if (sig.length !== 64) return false;
    const msg = Buffer.concat([Buffer.from(ts, 'utf8'), rawBody]);
    const spki = discordPublicKeyToSpki(DISCORD_INTERACTIONS_PUBLIC_KEY);
    if (!spki) return false;
    const keyObj = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
    return crypto.verify(null, msg, keyObj, sig);
  } catch {
    return false;
  }
}

function discordRenameEmbedField(val, maxLen = 1010) {
  const s = String(val ?? '');
  if (s.length <= maxLen) return s;
  return s.slice(0, Math.max(0, maxLen - 1)) + '…';
}

async function postDiscordWebhookExecute(webhookUrlStr, payloadObj) {
  const target = new URL(webhookUrlStr);
  const data = Buffer.from(JSON.stringify(payloadObj), 'utf8');
  return httpsRequest(webhookUrlStr, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(data.length),
      Host: target.host,
    },
  }, data);
}

function buildRenameModerateLink(publicOrigin, requestId, action, secret) {
  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  const payload = `${requestId}|${action}|${exp}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const base = String(publicOrigin || '').replace(/\/$/, '');
  const u = new URL('/api/video-rename/moderate', base);
  u.searchParams.set('requestId', requestId);
  u.searchParams.set('action', action);
  u.searchParams.set('exp', String(exp));
  u.searchParams.set('sig', sig);
  return u.toString();
}

function verifyRenameModerateSignature(requestId, action, expRaw, sigHex, secret) {
  const exp = Number(expRaw);
  if (!secret || !requestId || (action !== 'approve' && action !== 'reject')) return false;
  if (!Number.isFinite(exp) || exp <= 0) return false;
  if (Math.floor(Date.now() / 1000) > exp) return false;
  const payload = `${requestId}|${action}|${exp}`;
  const expectedHex = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    const a = Buffer.from(String(sigHex || ''), 'hex');
    const b = Buffer.from(expectedHex, 'hex');
    return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function htmlEscapeRenameModerate(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sendRenameModerateResultPage(res, ok, title, message) {
  const html =
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${htmlEscapeRenameModerate(title)}</title>` +
    '<style>body{font-family:system-ui,sans-serif;background:#0f0f12;color:#e8e8ee;max-width:520px;margin:48px auto;padding:0 16px;line-height:1.45}a{color:#c084fc}</style></head><body>' +
    `<h1>${htmlEscapeRenameModerate(title)}</h1><p>${htmlEscapeRenameModerate(message)}</p><p><a href="/">Back to site</a></p></body></html>`;
  res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

/**
 * Sends optional FYI webhook + admin webhook with link buttons (no Discord Application needed).
 * Approve/Reject use signed GET URLs → `/api/video-rename/moderate`.
 */
async function sendVideoRenameDiscordRequest(rec, requesterName, videoUrl, publicOrigin) {
  const reqId = String(rec.requestId || '');
  const signingKey = renameModerateSigningKey();
  const originBase = String(publicOrigin || SITE_ORIGIN || '').trim().replace(/\/$/, '');

  const embed = {
    title: 'Video rename — moderation',
    color: 0x5865f2,
    description: `Requested by **${discordRenameEmbedField(requesterName || 'user', 200)}**`,
    fields: [
      { name: 'Folder', value: discordRenameEmbedField(rec.folder || '—'), inline: true },
      { name: 'Current file', value: discordRenameEmbedField(rec.oldName || '—'), inline: false },
      { name: 'Requested title', value: discordRenameEmbedField(rec.requestedName || '—'), inline: false },
      { name: 'Watch link', value: discordRenameEmbedField(videoUrl || '—'), inline: false },
      { name: 'Request ID', value: discordRenameEmbedField(reqId), inline: false },
    ],
    timestamp: new Date().toISOString(),
  };

  let moderationRow = null;
  if (signingKey && reqId && originBase) {
    try {
      const approveUrl = buildRenameModerateLink(originBase, reqId, 'approve', signingKey);
      const rejectUrl = buildRenameModerateLink(originBase, reqId, 'reject', signingKey);
      if (approveUrl.length <= 512 && rejectUrl.length <= 512) {
        moderationRow = {
          type: 1,
          components: [
            { type: 2, style: 5, label: 'Approve', url: approveUrl },
            { type: 2, style: 5, label: 'Reject', url: rejectUrl },
          ],
        };
      } else {
        console.warn('[video-rename] moderation URLs exceed Discord 512 limit; omitting buttons');
      }
    } catch (e) {
      console.warn('[video-rename] could not build moderation links:', e && e.message ? e.message : e);
    }
  } else if (!signingKey) {
    console.warn('[video-rename] VIDEO_RENAME_MODERATE_SECRET / TBW_PEPPER unset — Discord message will not include approve links');
  } else if (!originBase) {
    console.warn('[video-rename] TBW_PUBLIC_ORIGIN unset — cannot build approve links (set env or rely on request Host)');
  }

  const notifyUrl = DISCORD_WEBHOOK_RENAMES_NOTIFY_URL;
  if (notifyUrl) {
    try {
      const notifyResp = await postDiscordWebhookExecute(notifyUrl, {
        username: 'Pornwrld',
        content:
          '📋 **Rename request** · ' +
          discordRenameEmbedField(rec.folder || '—', 60) +
          `: \`${discordRenameEmbedField(rec.oldName || '', 100)}\` → \`${discordRenameEmbedField(rec.requestedName || '', 100)}\``,
        embeds: [{ ...embed, title: 'Rename notification' }],
      });
      if (notifyResp.status < 200 || notifyResp.status >= 300) {
        console.error('[video-rename] notify webhook HTTP', notifyResp.status);
      }
    } catch (e) {
      console.error('[video-rename] notify webhook error:', e && e.message ? e.message : e);
    }
  }

  const adminUrl = DISCORD_WEBHOOK_RENAMES_URL;
  if (!adminUrl) {
    console.warn('[video-rename] DISCORD_WEBHOOK_RENAMES_URL not set; skipping admin moderation webhook');
    return;
  }

  const adminPayload = {
    username: 'Pornwrld Admin — Renames',
    content: moderationRow
      ? '**Moderate this rename** — Use **Approve** or **Reject** below.'
      : `**Pending rename** — Configure \`DISCORD_WEBHOOK_RENAMES_URL\`, \`TBW_PUBLIC_ORIGIN\`, and \`TBW_PEPPER\` (or \`VIDEO_RENAME_MODERATE_SECRET\`) for button links.\nRequest ID: \`${reqId}\``,
    embeds: [embed],
  };
  if (moderationRow) adminPayload.components = [moderationRow];

  try {
    const resp = await postDiscordWebhookExecute(adminUrl, adminPayload);
    if (resp.status < 200 || resp.status >= 300) {
      const snippet = resp.body && resp.body.length ? resp.body.toString('utf8').replace(/\s+/g, ' ').slice(0, 220) : '';
      console.error('[video-rename] admin webhook HTTP', resp.status, snippet);
    }
  } catch (e) {
    console.error('[video-rename] admin webhook error:', e && e.message ? e.message : e);
  }
}

/**
 * Candidate object keys when resolving a rename/copy on R2.
 * When vault is unknown/empty: try real vault prefixes (free/basic/…) BEFORE legacy discord `tier N/`
 * so we don't match the wrong duplicate filename under a tier tree.
 */
function buildRenameSourceKeyCandidates(basePath, folderName, subfolder, name, vaultHint) {
  const keys = [];
  const seen = new Set();
  const push = (k) => {
    if (!k || seen.has(k)) return;
    seen.add(k);
    keys.push(k);
  };
  const vHint = normalizeVaultParam(vaultHint);
  if (vHint) {
    for (const k of buildObjectKeyCandidates(basePath, folderName, subfolder, name, vHint, null)) push(k);
    for (const vv of VAULT_FOLDERS) {
      if (vv === vHint) continue;
      for (const k of buildObjectKeyCandidates(basePath, folderName, subfolder, name, vv, null)) push(k);
    }
    for (const k of buildObjectKeyCandidates(basePath, folderName, subfolder, name, '', null)) push(k);
    return keys;
  }
  for (const vf of VAULT_FOLDERS) {
    if (folderName === 'Omegle' && subfolder) {
      push(`${basePath}/${vf}/${subfolder}/${name}`);
      for (const legacyCt of ['video', 'photo', 'gif']) {
        push(`${basePath}/${legacyCt}/${vf}/${subfolder}/${name}`);
      }
    } else if (folderName === 'Omegle') {
      push(`${basePath}/${vf}/${name}`);
      for (const legacyCt of ['video', 'photo', 'gif']) {
        push(`${basePath}/${legacyCt}/${vf}/${name}`);
      }
    } else {
      push(`${basePath}/${vf}/${name}`);
      for (const legacyCt of ['video', 'photo', 'gif']) {
        push(`${basePath}/${legacyCt}/${vf}/${name}`);
      }
    }
  }
  for (const k of buildObjectKeyCandidates(basePath, folderName, subfolder, name, '', null)) push(k);
  return keys;
}

async function applyApprovedVideoRename(rec, moderatorTag) {
  const basePath = allowedFolderBasePath(rec.folder);
  if (!basePath) throw new Error('Invalid folder');
  const oldName = String(rec.oldName || '');
  const newName = buildRenamedFileName(rec.requestedName, oldName);
  if (!newName) throw new Error('Invalid requested name');
  if (newName === oldName) throw new Error('Name unchanged');

  const sourceCandidates = buildRenameSourceKeyCandidates(
    basePath,
    rec.folder,
    rec.subfolder || '',
    oldName,
    rec.vault || '',
  );

  let sourceKey = null;
  let sourceMeta = null;
  let existingDestKey = null;
  let existingDestMeta = null;
  for (const k of sourceCandidates) {
    const destCandidate = k.replace(/\/[^/]+$/, '/' + newName);
    try {
      const meta = await r2HeadObjectMeta(k);
      if (meta) {
        sourceKey = k;
        sourceMeta = meta;
        break;
      }
    } catch {}
    if (!existingDestKey) {
      try {
        const destMeta = await r2HeadObjectMeta(destCandidate);
        if (destMeta) {
          existingDestKey = destCandidate;
          existingDestMeta = destMeta;
        }
      } catch {}
    }
  }
  if (!sourceKey && existingDestKey) {
    finalizeApprovedVideoRename(rec, oldName, newName, null, existingDestKey, moderatorTag);
    return;
  }
  if (!sourceKey) throw new Error('Source object not found');
  const destKey = sourceKey.replace(/\/[^/]+$/, '/' + newName);
  if (destKey === sourceKey) throw new Error('Invalid destination key');
  const destMeta = existingDestKey === destKey ? existingDestMeta : await r2HeadObjectMeta(destKey);
  if (destMeta) {
    const sameSize = sourceMeta && Number(sourceMeta.size || 0) > 0 && Number(sourceMeta.size || 0) === Number(destMeta.size || 0);
    if (!sameSize) throw new Error('Destination key already exists');
    await r2DeleteObject(sourceKey);
    finalizeApprovedVideoRename(rec, oldName, newName, sourceKey, destKey, moderatorTag);
    return;
  }

  const srcBytes = await r2GetObjectBytes(sourceKey);
  if (!srcBytes || srcBytes.length < 1) throw new Error('Source read failed');
  await r2PutObjectBytes(destKey, srcBytes, sourceMeta?.contentType || getContentType(newName));
  const verify = await r2HeadObject(destKey);
  if (!verify) throw new Error('Destination verify failed');
  await r2DeleteObject(sourceKey);

  finalizeApprovedVideoRename(rec, oldName, newName, sourceKey, destKey, moderatorTag);
}

function finalizeApprovedVideoRename(rec, oldName, newName, sourceKey, destKey, moderatorTag) {
  migrateVideoKeyedStateAfterRename(rec.folder, rec.subfolder || '', oldName, newName, rec.vault);
  migrateDurationAndThumbCacheAfterRename(rec.folder, rec.subfolder || '', oldName, newName);
  migrateUploadRequestStateAfterRename(rec.folder, rec.subfolder || '', oldName, newName, sourceKey, destKey);
  clearMediaCachesAfterRename();

  rec.status = 'approved';
  rec.finalized = true;
  rec.newName = newName;
  rec.newVideoIdentity = videoRenameIdentity(rec.folder, rec.subfolder || '', newName, rec.vault || '');
  rec.sourceObjectKey = sourceKey || rec.sourceObjectKey || '';
  rec.destObjectKey = destKey;
  rec.reviewedBy = String(moderatorTag || 'discord');
  rec.reviewedAt = Date.now();
  rec.updatedAt = Date.now();
  rec.applyError = '';
}

/** Caller must have loaded `videoRenameRequests`. Used by Discord moderate links and admin panel. */
async function runVideoRenameModeration(requestId, action, actorLabel) {
  videoRenameMutationDepth += 1;
  try {
  const rec = videoRenameRequests.find((r) => r && r.requestId === requestId);
  if (!rec) return { type: 'not_found' };
  if (rec.finalized && rec.status === 'approved') {
    return { type: 'already_approved', newName: rec.newName };
  }
  if (rec.status === 'rejected' && action === 'reject') {
    return { type: 'already_rejected' };
  }
  // Failed apply leaves status `error` — allow approve/reject retry like pending.
  const actionable = rec.status === 'pending' || rec.status === 'error';
  if (!actionable) {
    return { type: 'not_pending', status: rec.status };
  }
  if (action === 'reject') {
    rec.status = 'rejected';
    rec.finalized = false;
    rec.reviewedBy = actorLabel;
    rec.reviewedAt = Date.now();
    rec.updatedAt = Date.now();
    rec.applyError = '';
    await flushVideoRenameRequestsNow();
    return { type: 'rejected' };
  }
  try {
    await applyApprovedVideoRename(rec, actorLabel);
  } catch (e) {
    rec.status = 'error';
    rec.finalized = false;
    rec.reviewedBy = actorLabel;
    rec.reviewedAt = Date.now();
    rec.updatedAt = Date.now();
    rec.applyError = e && e.message ? e.message : 'Unknown error';
    try {
      await flushVideoRenameRequestsNow();
    } catch (persistError) {
      console.error('[video-rename] persist error after apply failure:', persistError && persistError.message ? persistError.message : persistError);
    }
    return { type: 'apply_error', message: rec.applyError };
  }
  try {
    await flushVideoRenameRequestsNow();
    return { type: 'approved', newName: rec.newName };
  } catch (persistError) {
    console.error('[video-rename] persist error after approve:', persistError && persistError.message ? persistError.message : persistError);
    return { type: 'approved', newName: rec.newName, persistWarning: 'Rename applied, but status persistence failed' };
  }
  } finally {
    videoRenameMutationDepth = Math.max(0, videoRenameMutationDepth - 1);
  }
}

function _safeNum(v, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function _safeStr(v, max = 160) {
  return String(v || '').slice(0, max);
}

function _recoPrune() {
  const cutoff = Date.now() - RECO_RETENTION_DAYS * 86400000;
  if (recoEvents.length > 0) {
    recoEvents = recoEvents.filter((e) => Number(e.ts || 0) >= cutoff).slice(-RECO_MAX_EVENTS);
  }
  const progressEntries = Object.entries(userVideoProgress);
  if (progressEntries.length > RECO_MAX_PROGRESS) {
    progressEntries.sort((a, b) => Number((b[1] && b[1].updatedAt) || 0) - Number((a[1] && a[1].updatedAt) || 0));
    userVideoProgress = Object.fromEntries(progressEntries.slice(0, RECO_MAX_PROGRESS));
  }
  const profileEntries = Object.entries(userProfiles);
  if (profileEntries.length > RECO_MAX_PROFILES) {
    profileEntries.sort((a, b) => Number((b[1] && b[1].updatedAt) || 0) - Number((a[1] && a[1].updatedAt) || 0));
    userProfiles = Object.fromEntries(profileEntries.slice(0, RECO_MAX_PROFILES));
  }
}

async function loadRecoStores() {
  try {
    let loadedAny = false;
    if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
      try {
        const [eventsState, profilesState, progressState, globalState] = await Promise.all([
          loadAppStateSnapshot('reco_events'),
          loadAppStateSnapshot('reco_profiles'),
          loadAppStateSnapshot('reco_progress'),
          loadAppStateSnapshot('reco_global'),
        ]);
        if (eventsState.ok && Array.isArray(eventsState.data)) { recoEvents = eventsState.data; loadedAny = true; }
        if (profilesState.ok && profilesState.data && typeof profilesState.data === 'object') { userProfiles = profilesState.data; loadedAny = true; }
        if (progressState.ok && progressState.data && typeof progressState.data === 'object') { userVideoProgress = progressState.data; loadedAny = true; }
        if (globalState.ok && globalState.data && typeof globalState.data === 'object') { recoGlobalStats = globalState.data; loadedAny = true; }
      } catch {}
    }
    if (R2_ENABLED) {
      try {
        const [eventsRaw, profilesRaw, progressRaw, globalRaw] = await Promise.all([
          r2GetObject(RECO_EVENTS_R2_KEY),
          r2GetObject(RECO_PROFILES_R2_KEY),
          r2GetObject(RECO_PROGRESS_R2_KEY),
          r2GetObject(RECO_GLOBAL_R2_KEY),
        ]);
        if (eventsRaw) { recoEvents = JSON.parse(eventsRaw); loadedAny = true; }
        if (profilesRaw) { userProfiles = JSON.parse(profilesRaw); loadedAny = true; }
        if (progressRaw) { userVideoProgress = JSON.parse(progressRaw); loadedAny = true; }
        if (globalRaw) { recoGlobalStats = JSON.parse(globalRaw); loadedAny = true; }
      } catch {}
    }
    if (!loadedAny) {
      try { if (fs.existsSync(RECO_EVENTS_FILE)) recoEvents = JSON.parse(fs.readFileSync(RECO_EVENTS_FILE, 'utf8')); } catch {}
      try { if (fs.existsSync(RECO_PROFILES_FILE)) userProfiles = JSON.parse(fs.readFileSync(RECO_PROFILES_FILE, 'utf8')); } catch {}
      try { if (fs.existsSync(RECO_PROGRESS_FILE)) userVideoProgress = JSON.parse(fs.readFileSync(RECO_PROGRESS_FILE, 'utf8')); } catch {}
      try { if (fs.existsSync(RECO_GLOBAL_FILE)) recoGlobalStats = JSON.parse(fs.readFileSync(RECO_GLOBAL_FILE, 'utf8')); } catch {}
    }
  } catch (e) {
    console.error('[reco] load stores error:', e && e.message ? e.message : e);
  } finally {
    _recoPrune();
    recoLoaded = true;
  }
}

function queueRecoWrite() {
  if (!recoLoaded) return Promise.resolve();
  const eventsSnapshot = JSON.stringify(recoEvents);
  const profilesSnapshot = JSON.stringify(userProfiles);
  const progressSnapshot = JSON.stringify(userVideoProgress);
  const globalSnapshot = JSON.stringify(recoGlobalStats);
  recoWritePromise = recoWritePromise.then(async () => {
    if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
      await Promise.all([
        saveAppStateSnapshot('reco_events', recoEvents),
        saveAppStateSnapshot('reco_profiles', userProfiles),
        saveAppStateSnapshot('reco_progress', userVideoProgress),
        saveAppStateSnapshot('reco_global', recoGlobalStats),
      ]);
    }
    if (R2_ENABLED) {
      await Promise.all([
        r2PutObject(RECO_EVENTS_R2_KEY, eventsSnapshot, 'application/json'),
        r2PutObject(RECO_PROFILES_R2_KEY, profilesSnapshot, 'application/json'),
        r2PutObject(RECO_PROGRESS_R2_KEY, progressSnapshot, 'application/json'),
        r2PutObject(RECO_GLOBAL_R2_KEY, globalSnapshot, 'application/json'),
      ]);
    }
  }).catch((e) => {
    console.error('[reco] write error:', e && e.message ? e.message : e);
  });
  return recoWritePromise;
}

function scheduleRecoPersist() {
  if (!recoLoaded) return;
  if (recoFlushTimer) return;
  recoFlushTimer = setTimeout(() => {
    recoFlushTimer = null;
    _recoPrune();
    queueRecoWrite();
  }, 4000);
}

function ensureIdentity(req, res) {
  const userKey = getAuthedUserKey(req) || null;
  const cookies = parseCookies(req);
  let sid = cookies[RECO_SID_COOKIE] || '';
  if (!sid || sid.length < 16) {
    sid = crypto.randomBytes(16).toString('hex');
    appendSetCookie(res, `${RECO_SID_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}`);
  }
  return {
    sid,
    userKey,
    identityKey: userKey ? `u:${userKey}` : `s:${sid}`,
  };
}

function upsertUserProgress(identityKey, payload) {
  const videoId = _safeStr(payload.videoId, 260);
  if (!videoId) return null;
  const key = `${identityKey}|${videoId}`;
  const prev = userVideoProgress[key] || {};
  const now = Date.now();
  const watchMs = _safeNum(payload.watchMs || payload.activeWatchMs || 0, 0, 60 * 60 * 1000);
  const durationSec = _safeNum(payload.durationSec, 0, 60 * 60 * 6);
  const positionSec = _safeNum(payload.positionSec, 0, 60 * 60 * 6);
  const percentWatched = _safeNum(payload.percentWatched, 0, 100);
  const next = {
    identityKey,
    userKey: payload.userKey || null,
    sessionId: payload.sessionId || null,
    videoId,
    folder: _safeStr(payload.folder, 80),
    subfolder: _safeStr(payload.subfolder, 80),
    name: _safeStr(payload.name, 180),
    durationSec: Math.max(durationSec, Number(prev.durationSec || 0)),
    positionSec: Math.max(positionSec, Number(prev.positionSec || 0)),
    percentWatched: Math.max(percentWatched, Number(prev.percentWatched || 0)),
    completed: Boolean(payload.completed || percentWatched >= 95 || Number(prev.percentWatched || 0) >= 95 || prev.completed),
    watchTimeSecAccum: Number(prev.watchTimeSecAccum || 0) + Math.round(watchMs / 1000),
    updatedAt: now,
    lastEventType: _safeStr(payload.eventType, 48),
  };
  userVideoProgress[key] = next;
  return next;
}

function ensureProfile(identityKey) {
  if (!userProfiles[identityKey]) {
    userProfiles[identityKey] = {
      identityKey,
      categoryWatchMs: {},
      categoryCompletions: {},
      likedVideos: {},
      watchedVideos: {},
      shortFormWatchMs: 0,
      longFormWatchMs: 0,
      eventsCount: 0,
      updatedAt: Date.now(),
      lastSeenAt: Date.now(),
    };
  }
  return userProfiles[identityKey];
}

function applyEventToProfile(profile, event) {
  profile.eventsCount = Number(profile.eventsCount || 0) + 1;
  profile.updatedAt = Date.now();
  profile.lastSeenAt = Date.now();
  const category = _safeStr(event.folder, 80);
  const videoId = _safeStr(event.videoId, 260);
  const watchMs = _safeNum(event.watchMs || event.activeWatchMs || 0, 0, 60 * 60 * 1000);
  if (category) {
    profile.categoryWatchMs[category] = Number(profile.categoryWatchMs[category] || 0) + watchMs;
  }
  if (videoId && watchMs > 0) {
    profile.watchedVideos[videoId] = Number(profile.watchedVideos[videoId] || 0) + watchMs;
  }
  if (event.completed && category) {
    profile.categoryCompletions[category] = Number(profile.categoryCompletions[category] || 0) + 1;
  }
  if (event.eventType === 'shorts_progress') profile.shortFormWatchMs += watchMs;
  if (event.eventType === 'video_progress') profile.longFormWatchMs += watchMs;
  if (event.eventType === 'vote' && event.action === 'like' && videoId) {
    profile.likedVideos[videoId] = Date.now();
  }
}

function appendRecoEvent(identity, payload) {
  const evt = {
    eventType: _safeStr(payload.eventType, 48),
    ts: _safeNum(payload.ts || Date.now(), 0, Date.now() + 60000),
    identityKey: identity.identityKey,
    userKey: identity.userKey || null,
    sessionId: identity.sid || null,
    videoId: _safeStr(payload.videoId, 260),
    folder: _safeStr(payload.folder, 80),
    subfolder: _safeStr(payload.subfolder, 80),
    name: _safeStr(payload.name, 180),
    surface: _safeStr(payload.surface, 40),
    slot: _safeNum(payload.slot, 0, 1000),
    rank: _safeNum(payload.rank, 0, 10000),
    watchMs: _safeNum(payload.watchMs || payload.activeWatchMs || 0, 0, 60 * 60 * 1000),
    positionSec: _safeNum(payload.positionSec, 0, 60 * 60 * 6),
    durationSec: _safeNum(payload.durationSec, 0, 60 * 60 * 6),
    percentWatched: _safeNum(payload.percentWatched, 0, 100),
    completed: Boolean(payload.completed),
    action: _safeStr(payload.action, 24),
  };
  recoEvents.push(evt);
  const profile = ensureProfile(identity.identityKey);
  applyEventToProfile(profile, evt);
  upsertUserProgress(identity.identityKey, { ...evt, userKey: identity.userKey, sessionId: identity.sid });
  scheduleRecoPersist();
  return evt;
}

function rebuildRecoGlobalStats() {
  const byVideo = {};
  const byShorts = {};
  const cutoff = Date.now() - RECO_RETENTION_DAYS * 86400000;
  for (const e of recoEvents) {
    if (!e || Number(e.ts || 0) < cutoff || !e.videoId) continue;
    if (!byVideo[e.videoId]) byVideo[e.videoId] = { watchMs: 0, impressions: 0, clicks: 0, completions: 0 };
    const row = byVideo[e.videoId];
    row.watchMs += Number(e.watchMs || 0);
    if (e.eventType === 'impression') row.impressions += 1;
    if (e.eventType === 'click') row.clicks += 1;
    if (e.completed) row.completions += 1;
    if (e.eventType === 'shorts_progress') {
      if (!byShorts[e.videoId]) byShorts[e.videoId] = { watchMs: 0, completions: 0 };
      byShorts[e.videoId].watchMs += Number(e.watchMs || 0);
      if (e.completed) byShorts[e.videoId].completions += 1;
    }
  }
  const topVideos = Object.entries(byVideo)
    .sort((a, b) => (b[1].watchMs + b[1].clicks * 3000 + b[1].completions * 5000) - (a[1].watchMs + a[1].clicks * 3000 + a[1].completions * 5000))
    .slice(0, 300)
    .map(([videoId, s]) => ({ videoId, ...s }));
  const topShorts = Object.entries(byShorts)
    .sort((a, b) => (b[1].watchMs + b[1].completions * 4000) - (a[1].watchMs + a[1].completions * 4000))
    .slice(0, 200)
    .map(([videoId, s]) => ({ videoId, ...s }));
  recoGlobalStats = { topVideos, topShorts, updatedAt: Date.now() };
  recoLastRebuildTs = Date.now();
  scheduleRecoPersist();
}

function maybeRebuildRecoGlobalStats() {
  if (Date.now() - recoLastRebuildTs < RECO_PROFILE_REBUILD_MS) return;
  rebuildRecoGlobalStats();
}

void loadRecoStores();

// ── Comments ─────────────────────────────────────────────────────────────────
const COMMENTS_R2_KEY = 'data/comments.json';
const COMMENTS_FILE = path.join(DATA_DIR, 'comments.json');
let videoComments = {}; // { "videoKey": [ { user, text, ts } ] }
let commentsWritePromise = Promise.resolve();
let commentsFlushTimer = null;
let commentsLoaded = false; // guard: don't write until R2 load completes
let _commentsLastFetchTs = 0;
const _COMMENTS_CACHE_TTL = 15000; // refresh from R2 every 15s for multi-machine sync

async function loadComments() {
  try {
    if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
      const stateResp = await loadAppStateSnapshot('video_comments');
      if (stateResp && stateResp.ok && stateResp.data && typeof stateResp.data === 'object') {
        videoComments = stateResp.data;
        _commentsLastFetchTs = Date.now();
        commentsLoaded = true;
        return;
      }
    }
    if (R2_ENABLED) {
      const raw = await r2GetObject(COMMENTS_R2_KEY);
      if (raw) {
        videoComments = JSON.parse(raw);
        _commentsLastFetchTs = Date.now();
        commentsLoaded = true;
        return;
      }
    }
    if (fs.existsSync(COMMENTS_FILE)) {
      videoComments = JSON.parse(fs.readFileSync(COMMENTS_FILE, 'utf8'));
    }
    _commentsLastFetchTs = Date.now();
    commentsLoaded = true;
  } catch { videoComments = {}; commentsLoaded = true; }
}

async function ensureCommentsFresh() {
  if (Date.now() - _commentsLastFetchTs < _COMMENTS_CACHE_TTL) return;
  if (commentsFlushTimer) return; // don't reload while a write is pending
  try { await loadComments(); } catch {}
}

function queueCommentsWrite() {
  // Storage minimization: persist comments without per-user `_votes`.
  // `_userKey` is kept for short anti-spam windows (comment/reply rate limiting).
  const snapshotObj = {};
  for (const [key, arr] of Object.entries(videoComments || {})) {
    if (!Array.isArray(arr)) continue;
    snapshotObj[key] = arr.map((c) => ({
      id: c.id,
      user: c.user,
      text: c.text,
      ts: c.ts,
      _userKey: c._userKey,
      likes: (typeof c.likes === 'number') ? c.likes : 0,
      dislikes: (typeof c.dislikes === 'number') ? c.dislikes : 0,
      replies: Array.isArray(c.replies) ? c.replies.map((r) => ({
        id: r.id,
        user: r.user,
        text: r.text,
        ts: r.ts,
        _userKey: r._userKey,
        likes: (typeof r.likes === 'number') ? r.likes : 0,
        dislikes: (typeof r.dislikes === 'number') ? r.dislikes : 0,
      })) : [],
    }));
  }
  const snapshot = JSON.stringify(snapshotObj);
  commentsWritePromise = commentsWritePromise.then(async () => {
    if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
      const stateResp = await saveAppStateSnapshot('video_comments', snapshotObj);
      if (!stateResp.ok) {
        console.error('comments Supabase state write error:', stateResp.status || stateResp.reason || 'unknown');
      }
    }
    if (R2_ENABLED) {
      await r2PutObject(COMMENTS_R2_KEY, snapshot, 'application/json');
    }
  }).catch(e => {
    console.error('comments write error:', e && e.message ? e.message : e);
  });
  return commentsWritePromise;
}

function scheduleCommentsPersist() {
  if (!commentsLoaded) return; // don't write until R2 data has been loaded
  if (commentsFlushTimer) return;
  commentsFlushTimer = setTimeout(() => {
    commentsFlushTimer = null;
    queueCommentsWrite();
  }, 3000);
}

// videoStats is unified with shortStats — single source of truth in short_stats.json
// Without vault: key is filename (shorts + legacy). With vault: composite so same name can exist per tier.
function videoKey(folder, subfolder, name, vault) {
  const f = canonicalFolderLabel(folder);
  const v = String(vault || '').trim().toLowerCase();
  if (!v || !VAULT_FOLDERS.includes(v)) return String(name || '');
  return [f, subfolder || '', v, name || ''].join('|');
}

/** previewFileList is rebuilt on an interval; merge live shortStats so list APIs are not stale. */
function enrichPreviewFilesWithLiveStats(files) {
  if (!Array.isArray(files)) return files;
  return files.map((f) => {
    if (!f || !isVideoFile(f.name)) return f;
    const k = videoKey(f.folder, f.subfolder || '', f.name, f.vault);
    const stats = shortStats[k] || { views: 0, likes: 0, dislikes: 0 };
    return {
      ...f,
      videoKey: k,
      videoId: canonicalVideoId(f.folder, f.subfolder || '', f.name, f.vault),
      views: stats.views || 0,
      likes: stats.likes || 0,
      dislikes: stats.dislikes || 0,
    };
  });
}

function loadVisitStatsFromDisk() {
  try {
    if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
      const state = loadAppStateSnapshot('visit_stats');
      // Keep startup path sync-friendly; schedule async hydrate and fall through to disk.
      Promise.resolve(state).then((resp) => {
        if (!resp || !resp.ok || !resp.data || typeof resp.data !== 'object') return;
        const parsed = resp.data;
        const allTime = Number(parsed.allTime || parsed.visitAllTime || 0);
        const log = Array.isArray(parsed.log || parsed.visitLog) ? (parsed.log || parsed.visitLog) : [];
        const now = Date.now();
        const cutoff30d = now - 30 * 86400000;
        const cleaned = [];
        for (const t of log) {
          const n = Number(t);
          if (Number.isFinite(n) && n >= cutoff30d && n <= now) cleaned.push(n);
        }
        visitLog.length = 0;
        visitLog.push(...cleaned.sort((a, b) => a - b));
        visitAllTime = Number.isFinite(allTime) ? allTime : 0;
      }).catch(() => {});
    }
    // Prefer R2 for persistence across server resets
    if (R2_ENABLED) {
      // fire-and-forget async load (server startup)
      // NOTE: this function is called during init, so we keep it sync-ish by blocking with deasync is not desired.
      // We'll just fall back to disk if R2 fetch fails.
    }
    if (!fs.existsSync(VISIT_STATS_FILE)) return;
    const raw = fs.readFileSync(VISIT_STATS_FILE, 'utf8');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;

    const allTime = Number(parsed.allTime || parsed.visitAllTime || 0);
    const log = Array.isArray(parsed.log || parsed.visitLog) ? (parsed.log || parsed.visitLog) : [];
    const now = Date.now();
    const cutoff30d = now - 30 * 86400000;
    const cleaned = [];

    for (const t of log) {
      const n = Number(t);
      if (Number.isFinite(n) && n >= cutoff30d && n <= now) cleaned.push(n);
    }

    visitLog.length = 0;
    visitLog.push(...cleaned.sort((a, b) => a - b));
    visitAllTime = Number.isFinite(allTime) ? allTime : 0;
  } catch {
    // ignore corrupt stats file
  }
}

function buildVisitStatsSnapshot() {
  return JSON.stringify({
    version: 1,
    allTime: visitAllTime,
    log: visitLog,
  }, null, 2);
}

function queueVisitStatsWrite() {
  const snapshot = buildVisitStatsSnapshot();
  visitStatsWritePromise = visitStatsWritePromise.then(async () => {
    if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
      const stateResp = await saveAppStateSnapshot('visit_stats', { version: 1, allTime: visitAllTime, log: visitLog });
      if (!stateResp.ok) {
        console.error('visitStats Supabase state write error:', stateResp.status || stateResp.reason || 'unknown');
      }
    }
    if (R2_ENABLED) {
      await r2PutObject(VISIT_STATS_R2_KEY, snapshot, 'application/json');
    }
  }).catch((e) => {
    console.error('visitStats write error:', e && e.message ? e.message : e);
  });
  return visitStatsWritePromise;
}

function scheduleVisitStatsPersist() {
  if (!visitStatsLoaded) return; // don't write until R2 data has been loaded
  if (visitStatsFlushTimer) return;
  visitStatsFlushTimer = setTimeout(() => {
    visitStatsFlushTimer = null;
    queueVisitStatsWrite();
  }, 3000);
}

function recordVisit(req) {
  const now = Date.now();
  visitLog.push(now);
  visitAllTime++;
  // Prune entries older than 30 days to keep memory bounded
  const cutoff30d = now - 30 * 86400000;
  if (visitLog.length > 0 && visitLog[0] < cutoff30d) {
    // Binary search for first entry >= cutoff (O(log n) instead of O(n) shift loop)
    let lo = 0, hi = visitLog.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (visitLog[mid] < cutoff30d) lo = mid + 1; else hi = mid;
    }
    if (lo > 0) visitLog.splice(0, lo);
  }
  scheduleVisitStatsPersist();

  // Geo: store all IPs (except Railway internal) and resolve country via geolocation.
  try {
    const ip = normalizeIp(getClientIp(req || {}));
    if (!ip || ip === 'unknown' || GEO_IGNORE_IPS.has(ip)) return;

    const cur = adminGeoIps[ip] || { count: 0, country: null, lastTs: 0 };
    cur.count = Number(cur.count || 0) + 1;
    cur.lastTs = now;

    const headerCountry = countryFromHeaders(req);
    if (headerCountry) cur.country = headerCountry;

    adminGeoIps[ip] = cur;
    geoPruneIfNeeded();
    scheduleAdminPersist();

    if (!cur.country) {
      void geoLookupCountry(ip).then((code) => {
        if (!code) return;
        const e = adminGeoIps[ip];
        if (!e) return;
        if (!e.country) {
          e.country = code;
          scheduleAdminPersist();
        }
      }).catch(() => {});
    }
  } catch {}
}

function getVisitStats() {
  const now = Date.now();
  const cutoff24h = now - 86400000;
  const cutoff30m = now - 1800000;
  let past24h = 0;
  let past30m = 0;
  for (let i = visitLog.length - 1; i >= 0; i--) {
    const t = visitLog[i];
    if (t < cutoff24h) break;
    past24h++;
    if (t >= cutoff30m) past30m++;
  }
  return { allTime: visitAllTime, past24h, past30m };
}

function sendVisitStatsWebhook() {
  if (!DISCORD_WEBHOOK_VISIT_STATS_URL) return;
  const stats = getVisitStats();
  _beacon(DISCORD_WEBHOOK_VISIT_STATS_URL, {
    embeds: [{
      title: '\uD83D\uDCCA Visit Stats',
      color: 0x22d3ee,
      fields: [
        { name: 'All Time', value: String(stats.allTime), inline: true },
        { name: 'Past 24 Hours', value: String(stats.past24h), inline: true },
        { name: 'Past 30 Minutes', value: String(stats.past30m), inline: true },
      ],
      timestamp: new Date().toISOString(),
    }],
  });
}

// Load visit stats from R2 if available, else from disk
async function loadVisitStatsFromStorage() {
  if (R2_ENABLED) {
    try {
      const raw = await r2GetObject(VISIT_STATS_R2_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const savedAllTime = Number(parsed.allTime || parsed.visitAllTime || 0);
          const log = Array.isArray(parsed.log || parsed.visitLog) ? (parsed.log || parsed.visitLog) : [];
          const now = Date.now();
          const cutoff30d = now - 30 * 86400000;
          const cleaned = [];
          for (const t of log) {
            const n = Number(t);
            if (Number.isFinite(n) && n >= cutoff30d && n <= now) cleaned.push(n);
          }
          // Merge: add any visits that arrived before R2 load finished
          const earlyVisits = visitLog.length;
          visitLog.push(...cleaned);
          visitLog.sort((a, b) => a - b);
          // Dedupe (exact same timestamps are extremely unlikely, but be safe)
          visitAllTime = (Number.isFinite(savedAllTime) ? savedAllTime : 0) + earlyVisits;
          console.log(`Loaded visit stats from R2 (allTime=${visitAllTime}, earlyVisits=${earlyVisits})`);
          visitStatsLoaded = true;
          if (earlyVisits > 0) scheduleVisitStatsPersist(); // flush merged data
          return;
        }
      }
    } catch (e) {
      console.error('Failed to load visit stats from R2:', e && e.message ? e.message : e);
    }
  }
  loadVisitStatsFromDisk();
  visitStatsLoaded = true;
}
void loadVisitStatsFromStorage();
  void loadShortStats();
  void loadComments();

// ── Thumbnail cache: disk-persisted JPEG thumbnails via ffmpeg ───────────────
const THUMB_DIR = path.join(__dirname, 'thumbnails');
const THUMB_GEN_DIR = path.join(THUMB_DIR, 'generated'); // ffmpeg-generated thumbs (separate from static PNGs)
try { fs.mkdirSync(THUMB_GEN_DIR, { recursive: true }); } catch {}
const THUMB_MAX_WIDTH = Math.max(160, parseInt(process.env.THUMB_MAX_WIDTH || '320', 10) || 320);
const THUMB_QUALITY = Math.min(12, Math.max(2, parseInt(process.env.THUMB_JPEG_QUALITY || '7', 10) || 7));
const THUMB_R2_PREFIX = 'data/thumbnails/';
// LRU-ish thumbnail cache: keeps at most THUMB_CACHE_MAX entries in memory.
// Each entry stores a JPEG Buffer; evicts least-recently-used when full.
const THUMB_CACHE_MAX = 2000;
// Minimal dark JPEG placeholder (served instantly on cache miss while ffmpeg generates in background)
const PLACEHOLDER_THUMB = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAA IDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAFBABAAAAAAAAAAAAAAAAAAAACf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKgA/9k=', 'base64');
const _thumbAccessOrder = []; // ordered list of cache keys (most-recent at end)
const thumbnailCache = {}; // { "cacheKey": Buffer(jpeg) } — in-memory hot cache
const _thumbR2ExistsCache = {}; // { r2Key: { exists:boolean, ts:number } }
const _THUMB_R2_EXISTS_TTL_MS = 5 * 60 * 1000;
const _THUMB_R2_MISS_TTL_MS = 60 * 1000;

function _thumbCacheSet(key, buf, skipR2) {
  const isNew = !thumbnailCache[key];
  if (!isNew) {
    // Move to end (most recent)
    const idx = _thumbAccessOrder.indexOf(key);
    if (idx !== -1) _thumbAccessOrder.splice(idx, 1);
  }
  _thumbAccessOrder.push(key);
  thumbnailCache[key] = buf;
  // Evict oldest entries when over limit
  while (_thumbAccessOrder.length > THUMB_CACHE_MAX) {
    const evict = _thumbAccessOrder.shift();
    delete thumbnailCache[evict];
  }
  // Persist new thumbnails to R2 so they survive deploys
  if (isNew && !skipR2) _thumbSaveToR2(key, buf);
}

function _thumbCacheGet(key) {
  const buf = thumbnailCache[key];
  if (!buf) return undefined;
  // Bump access order
  const idx = _thumbAccessOrder.indexOf(key);
  if (idx !== -1 && idx < _thumbAccessOrder.length - 1) {
    _thumbAccessOrder.splice(idx, 1);
    _thumbAccessOrder.push(key);
  }
  return buf;
}
let _thumbGenRunning = false;
const _thumbInFlight = {}; // dedup concurrent requests: { cacheKey: Promise }

// Cache key for a video: "folder/subfolder/name" or extended with vault for tier layout
function _thumbCacheKey(folder, subfolder, name, vault) {
  if (!folder) return name; // backward compat for preview-only thumbs
  const v = vault && String(vault).length ? String(vault) : '';
  if (!v) return folder + '/' + (subfolder || '') + '/' + name;
  return folder + '/' + (subfolder || '') + '/' + v + '/' + name;
}

// Disk path for a generated thumbnail
function _thumbDiskPath(folder, subfolder, name) {
  const key = folder ? (folder + '__' + (subfolder || '') + '__' + name) : name;
  return path.join(THUMB_GEN_DIR, encodeURIComponent(key) + '.jpg');
}

// Backward-compat disk path (preview-only, flat in thumbnails/)
function _thumbDiskPathLegacy(name) {
  return path.join(THUMB_DIR, encodeURIComponent(name) + '.jpg');
}

/** Move duration + in-memory thumbnails to the new filename (same folder/subfolder/vault variants). */
function migrateDurationAndThumbCacheAfterRename(folder, subfolder, oldName, newName) {
  const f = canonicalFolderLabel(folder);
  const sf = String(subfolder || '');
  const vaultVariants = [undefined, ...VAULT_FOLDERS];
  let changedDur = false;
  for (const v of vaultVariants) {
    const oldK = _thumbCacheKey(f, sf, oldName, v);
    const newK = _thumbCacheKey(f, sf, newName, v);
    if (oldK === newK || !oldK || !newK) continue;

    if (videoDurations[oldK] !== undefined) {
      const cur = Number(videoDurations[oldK] || 0);
      const prev = Number(videoDurations[newK] || 0);
      videoDurations[newK] = Math.max(cur, prev);
      delete videoDurations[oldK];
      changedDur = true;
    }

    if (thumbnailCache[oldK]) {
      const buf = thumbnailCache[oldK];
      const io = _thumbAccessOrder.indexOf(oldK);
      if (io !== -1) _thumbAccessOrder.splice(io, 1);
      delete thumbnailCache[oldK];
      if (!thumbnailCache[newK]) _thumbCacheSet(newK, buf, true);
      else {
        _thumbAccessOrder.push(newK);
        thumbnailCache[newK] = buf;
      }
    }
  }

  try {
    const oldPath = _thumbDiskPath(f, sf, oldName);
    const newPath = _thumbDiskPath(f, sf, newName);
    if (oldPath !== newPath && fs.existsSync(oldPath)) {
      try {
        fs.renameSync(oldPath, newPath);
      } catch {
        fs.copyFileSync(oldPath, newPath);
        try { fs.unlinkSync(oldPath); } catch {}
      }
    }
  } catch {}

  if (changedDur) _scheduleDurationSave();
}

// Build a thumbnail URL for API responses — presigned R2 URL if cached, else fallback to /thumbnail endpoint
function _thumbUrl(folder, subfolder, name, vault) {
  let url = '/thumbnail?folder=' + encodeURIComponent(folder) + '&name=' + encodeURIComponent(name);
  if (subfolder) url += '&subfolder=' + encodeURIComponent(subfolder);
  if (vault) url += '&vault=' + encodeURIComponent(vault);
  return url;
}

// R2 thumbnail persistence: store generated thumbnails to R2 so they survive deploys
function _thumbR2Key(cacheKey) {
  return THUMB_R2_PREFIX + encodeURIComponent(cacheKey) + '.jpg';
}
async function _thumbSaveToR2(cacheKey, buf) {
  if (!R2_ENABLED) return;
  const r2Key = _thumbR2Key(cacheKey);
  try {
    await r2PutObjectBytes(r2Key, buf, 'image/jpeg');
    _thumbR2ExistsCache[r2Key] = { exists: true, ts: Date.now() };
  } catch {}
}
async function _thumbLoadAllFromR2() {
  if (!R2_ENABLED) return 0;
  try {
    const prefixes = [THUMB_R2_PREFIX];
    let loaded = 0;
    for (const prefix of prefixes) {
      const entries = await r2ListObjects(prefix);
      for (const e of entries) {
        const fname = e.key.slice(prefix.length);
        if (!fname.endsWith('.jpg')) continue;
        const cacheKey = decodeURIComponent(fname.replace(/\.jpg$/, ''));
        if (_thumbCacheGet(cacheKey)) { loaded++; continue; } // already in memory
        try {
          const buf = await r2GetObjectBytes(e.key);
          if (buf && buf.length > 5000) {
            // Skip dark/blank thumbnails (< 5KB) so they regenerate with multi-timestamp logic
            _thumbCacheSet(cacheKey, buf, true); // skipR2=true since we just loaded from R2
            _thumbR2ExistsCache[e.key] = { exists: true, ts: Date.now() };
            loaded++;
          }
        } catch {}
      }
    }
    return loaded;
  } catch (err) {
    console.error('[thumbnails] R2 load error:', err && err.message ? err.message : err);
    return 0;
  }
}

// Load all existing thumbnails from disk into memory at startup
(function loadDiskThumbnails() {
  try {
    // Load legacy flat thumbnails (preview videos)
    const legacyFiles = fs.readdirSync(THUMB_DIR);
    let loaded = 0;
    for (const f of legacyFiles) {
      if (!f.endsWith('.jpg')) continue;
      try {
        const buf = fs.readFileSync(path.join(THUMB_DIR, f));
        if (buf.length > 5000) {
          // Skip dark/blank thumbnails (< 5KB) so they regenerate with better timestamps
          const videoName = decodeURIComponent(f.replace(/\.jpg$/, ''));
          _thumbCacheSet(videoName, buf);
          loaded++;
        }
      } catch {}
    }
    // Load generated thumbnails (full library)
    const genFiles = fs.readdirSync(THUMB_GEN_DIR);
    for (const f of genFiles) {
      if (!f.endsWith('.jpg')) continue;
      try {
        const buf = fs.readFileSync(path.join(THUMB_GEN_DIR, f));
        if (buf.length > 5000) {
          const cacheKey = decodeURIComponent(f.replace(/\.jpg$/, '')).replace(/__/g, '/');
          _thumbCacheSet(cacheKey, buf);
          loaded++;
        }
      } catch {}
    }
    if (loaded > 0) console.log('[thumbnails] Loaded', loaded, 'cached thumbnails from disk');
  } catch {}
})();

// Load thumbnails from R2 on startup (fills gaps from deploys that wiped disk)
let _thumbR2LoadDone = false;
const _thumbR2LoadPromise = new Promise(resolve => {
  setTimeout(() => {
    _thumbLoadAllFromR2().then(n => {
      if (n > 0) {
        console.log('[thumbnails] Loaded', n, 'thumbnails from R2');
        // Clear list cache so next request gets presigned R2 thumbnail URLs
        if (global._listCache) { for (const k of Object.keys(global._listCache)) delete global._listCache[k]; }
      }
      _thumbR2LoadDone = true;
      resolve();
    }).catch(() => { _thumbR2LoadDone = true; resolve(); });
  }, 2000);
});

// ── Video duration cache: extracted via ffprobe, persisted to R2 ──
const videoDurations = {}; // { "cacheKey": seconds }
const DURATION_R2_KEY = 'data/video-durations.json';
let _durationsLoaded = false;

async function _loadDurationsFromR2() {
  if (!R2_ENABLED) { _durationsLoaded = true; return; }
  // Retry with backoff to handle transient R2 connection errors at startup
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const json = await r2GetObject(DURATION_R2_KEY);
      if (json) {
        const data = JSON.parse(json);
        Object.assign(videoDurations, data);
        console.log('[durations] Loaded', Object.keys(data).length, 'durations from R2');
      }
      _durationsLoaded = true;
      return;
    } catch (e) {
      console.log('[durations] Load attempt', attempt + 1, 'failed:', e && e.message ? e.message : e);
      if (attempt < 2) await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  console.log('[durations] All load attempts failed, starting fresh');
  _durationsLoaded = true;
}

let _durSaveTimer = null;
function _scheduleDurationSave() {
  if (_durSaveTimer) return;
  _durSaveTimer = setTimeout(async () => {
    _durSaveTimer = null;
    try { await r2PutObject(DURATION_R2_KEY, JSON.stringify(videoDurations), 'application/json'); } catch {}
  }, 10000);
}

function _getDuration(folder, subfolder, name, vault) {
  const exact = videoDurations[_thumbCacheKey(folder, subfolder, name, vault)];
  if (exact) return exact;
  const legacy = videoDurations[_thumbCacheKey(folder, subfolder, name)];
  if (legacy) return legacy;
  for (const k of Object.keys(videoDurations)) {
    if (k.endsWith('/' + name)) return videoDurations[k];
  }
  return 0;
}

async function extractDuration(videoUrl) {
  return new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-i', videoUrl],
      { timeout: 6000 }, (err, stdout) => {
        if (err || !stdout) return resolve(0);
        try {
          const data = JSON.parse(stdout);
          const dur = parseFloat(data.format && data.format.duration);
          resolve(dur > 0 ? Math.round(dur) : 0);
        } catch { resolve(0); }
      });
  });
}

// Load durations on startup
setTimeout(() => _loadDurationsFromR2(), 1000);

// Concurrency limiter for ffmpeg — keep modest to protect small Fly machines.
let _ffmpegActive = 0;
const _ffmpegQueue = [];
const THUMB_FFMPEG_CONCURRENCY = Math.min(3, Math.max(1, parseInt(process.env.THUMB_FFMPEG_CONCURRENCY || '1', 10) || 1));
function _runFfmpeg(args, opts) {
  return new Promise((resolve) => {
    const run = () => {
      _ffmpegActive++;
      execFile('ffmpeg', args, opts, (err, stdout) => {
        _ffmpegActive--;
        if (_ffmpegQueue.length > 0) _ffmpegQueue.shift()();
        resolve({ err, stdout });
      });
    };
    if (_ffmpegActive < THUMB_FFMPEG_CONCURRENCY) run();
    else _ffmpegQueue.push(run);
  });
}

function generateThumbnail(videoUrl, name) {
  return new Promise(async (resolve) => {
    const _ffOpts = { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024, timeout: 8000 };
    const _baseArgs = ['-vframes', '1', '-vf', `scale=${THUMB_MAX_WIDTH}:-1`, '-f', 'image2', '-vcodec', 'mjpeg', '-q:v', String(THUMB_QUALITY), 'pipe:1'];
    const DARK_THRESHOLD = 5000;

    // Try 2 timestamps only: 2s (skip intros) then 0.5s (fallback for short clips)
    const seekTimes = ['2', '0.5'];
    let bestBuf = null;

    for (const ss of seekTimes) {
      const args = ['-ss', ss, '-i', videoUrl, ..._baseArgs];
      const { err, stdout } = await _runFfmpeg(args, _ffOpts);
      if (!err && stdout && stdout.length >= 100) {
        if (stdout.length > DARK_THRESHOLD) return resolve(stdout);
        if (!bestBuf || stdout.length > bestBuf.length) bestBuf = stdout;
      }
    }

    resolve(bestBuf && bestBuf.length >= 100 ? bestBuf : null);
  });
}

function schedulePrioritizedThumbWarm(files, tier, opts = {}) {
  if (!R2_ENABLED || !Array.isArray(files) || files.length === 0) return;
  const priorityCount = Math.max(1, Number(opts.priorityCount || 24));
  setImmediate(() => {
    const uncached = files.filter(
      (f) =>
        f &&
        f.type === 'video' &&
        f.folder &&
        f.name &&
        !_thumbCacheGet(_thumbCacheKey(f.folder, f.subfolder || '', f.name, f.vault)),
    );
    if (uncached.length === 0) return;

    const priorityBatch = uncached.slice(0, priorityCount);
    const deferredBatch = uncached.slice(priorityCount);

    const warmOne = async (item) => {
      const ck = _thumbCacheKey(item.folder, item.subfolder || '', item.name, item.vault);
      if (_thumbInFlight[ck]) return;
      const bp = allowedFolderBasePath(item.folder);
      if (!bp) return;
      try {
        let vUrl = null;
        const candidates = buildObjectKeyCandidates(
          bp,
          item.folder,
          item.subfolder || '',
          item.name,
          item.vault || undefined,
          tier,
        );
        for (const ok of candidates) {
          try {
            if (await r2HeadObject(ok)) {
              vUrl = r2PresignedUrl(ok, 120);
              break;
            }
          } catch { /* next */ }
        }
        if (!vUrl) return;
        const buf = await generateThumbnail(vUrl, item.name);
        if (buf) {
          _thumbCacheSet(ck, buf);
          const dp = _thumbDiskPath(item.folder, item.subfolder || '', item.name);
          fs.writeFile(dp, buf, () => {});
        }
      } catch { /* noop */ }
    };

    const runBatch = async (batch, maxConcurrent) => {
      if (!batch.length) return;
      let idx = 0;
      const workers = Array.from({ length: Math.min(maxConcurrent, batch.length) }, async () => {
        while (idx < batch.length) {
          const item = batch[idx++];
          await warmOne(item);
        }
      });
      await Promise.all(workers);
    };

    runBatch(priorityBatch, 3)
      .then(() => {
        if (!deferredBatch.length) return;
        setTimeout(() => {
          runBatch(deferredBatch, 2).catch(() => {});
        }, 1200);
      })
      .catch(() => {});
  });
}

let _thumbGenRanOnce = false;
async function buildThumbnailCache() {
  if (_thumbGenRunning) return;
  // Wait for R2 thumbnails to load first so we don't regenerate what's already cached
  if (!_thumbR2LoadDone) {
    try { await _thumbR2LoadPromise; } catch {}
  }
  _thumbGenRunning = true;
  let generated = 0, skipped = 0, failed = 0;
  const failedFiles = [];
  for (const item of previewFileList) {
    if (_thumbCacheGet(item.name)) { skipped++; continue; }
    const url = previewUrlMap[item.folder + '/' + item.name];
    if (!url) continue;
    try {
      const buf = await generateThumbnail(url, item.name);
      if (buf) {
        _thumbCacheSet(item.name, buf);
        // Persist to disk so we never regenerate on restart (async write to avoid blocking event loop)
        fs.writeFile(_thumbDiskPathLegacy(item.name), buf, () => {});
        generated++;
      } else {
        failed++;
        if (failedFiles.length < 15) failedFiles.push(item.name);
      }
    } catch (e) { failed++; if (failedFiles.length < 15) failedFiles.push(item.name); }
    // Throttle: wait between thumbnails to avoid overloading CPU/network on shared-cpu machines
    await new Promise(r => setTimeout(r, 2000));
  }
  _thumbGenRunning = false;
  _thumbGenRanOnce = true;
  console.log('[thumbnails] Done:', generated, 'generated,', skipped, 'already cached,', failed, 'failed,', _thumbAccessOrder.length, 'in memory');
  if (failedFiles.length) console.log('[thumbnails] Failed files (sample):', failedFiles.join(', '));
}

// ── Folder thumbnail pre-generation: generate thumbnails for ALL folder videos in background ──
let _folderThumbRunning = false;
async function buildFolderThumbnailCache() {
  if (_folderThumbRunning || !R2_ENABLED) return;
  if (!_thumbR2LoadDone) {
    try { await _thumbR2LoadPromise; } catch {}
  }
  // Wait for durations to load so we don't re-extract every video's duration unnecessarily
  if (!_durationsLoaded) {
    await new Promise(resolve => {
      const check = setInterval(() => { if (_durationsLoaded) { clearInterval(check); resolve(); } }, 500);
    });
  }
  _folderThumbRunning = true;
  let generated = 0, skipped = 0, failed = 0, durExtracted = 0;
  console.log('[folder-thumbs] Starting background thumbnail + duration extraction for all folders...');
  for (const [folderName, basePath] of allowedFolders.entries()) {
    const subfolders = folderName === 'Omegle' ? OMEGLE_SUBFOLDERS : [''];
    for (const sf of subfolders) {
      for (const v of VAULT_FOLDERS) {
        const prefix = basePath + '/' + v + '/' + (sf ? sf + '/' : '');
        let items;
        try { items = await r2ListMediaFilesFromPrefix(prefix); } catch { continue; }
        for (const item of items) {
          if (!isVideoFile(item.name)) continue;
          const cacheKey = _thumbCacheKey(folderName, sf, item.name, v);
            const needsThumb = !_thumbCacheGet(cacheKey);
            const needsDur = !videoDurations[cacheKey];
            if (!needsThumb && !needsDur) { skipped++; continue; }
            const objectKey = prefix + item.name;
            const videoUrl = r2PresignedUrl(objectKey, 180);
            if (needsDur) {
              try {
                const dur = await extractDuration(videoUrl);
                if (dur > 0) { videoDurations[cacheKey] = dur; durExtracted++; _scheduleDurationSave(); }
              } catch {}
            }
            if (needsThumb) {
              try {
                const buf = await generateThumbnail(videoUrl, item.name);
                if (buf) {
                  _thumbCacheSet(cacheKey, buf);
                  const diskPath = _thumbDiskPath(folderName, sf, item.name);
                  fs.writeFile(diskPath, buf, () => {});
                  generated++;
                } else { failed++; }
              } catch { failed++; }
              await new Promise(r => setTimeout(r, 10000));
            } else {
            await new Promise(r => setTimeout(r, 3000));
          }
        }
      }
      for (const legacyCt of ['video', 'photo', 'gif']) {
        for (const v of VAULT_FOLDERS) {
          const prefix = basePath + '/' + legacyCt + '/' + v + '/' + (sf ? sf + '/' : '');
          let items;
          try { items = await r2ListMediaFilesFromPrefix(prefix); } catch { continue; }
          for (const item of items) {
            if (!isVideoFile(item.name)) continue;
            const cacheKey = _thumbCacheKey(folderName, sf, item.name, v);
            const needsThumb = !_thumbCacheGet(cacheKey);
            const needsDur = !videoDurations[cacheKey];
            if (!needsThumb && !needsDur) { skipped++; continue; }
            const objectKey = prefix + item.name;
            const videoUrl = r2PresignedUrl(objectKey, 180);
            if (needsDur) {
              try {
                const dur = await extractDuration(videoUrl);
                if (dur > 0) { videoDurations[cacheKey] = dur; durExtracted++; _scheduleDurationSave(); }
              } catch {}
            }
            if (needsThumb) {
              try {
                const buf = await generateThumbnail(videoUrl, item.name);
                if (buf) {
                  _thumbCacheSet(cacheKey, buf);
                  const diskPath = _thumbDiskPath(folderName, sf, item.name);
                  fs.writeFile(diskPath, buf, () => {});
                  generated++;
                } else { failed++; }
              } catch { failed++; }
              await new Promise(r => setTimeout(r, 10000));
            } else {
              await new Promise(r => setTimeout(r, 3000));
            }
          }
        }
      }
      for (const tf of ALL_LEGACY_DISCORD_TIER_PREFIXES) {
        const prefix = basePath + '/' + tf + '/' + (sf ? sf + '/' : '');
        let items;
        try { items = await r2ListMediaFilesFromPrefix(prefix); } catch { continue; }
        for (const item of items) {
          if (!isVideoFile(item.name)) continue;
          const cacheKey = _thumbCacheKey(folderName, sf, item.name);
          const needsThumb = !_thumbCacheGet(cacheKey);
          const needsDur = !videoDurations[cacheKey];
          if (!needsThumb && !needsDur) { skipped++; continue; }
          const objectKey = prefix + item.name;
          const videoUrl = r2PresignedUrl(objectKey, 180);
          if (needsDur) {
            try {
              const dur = await extractDuration(videoUrl);
              if (dur > 0) { videoDurations[cacheKey] = dur; durExtracted++; _scheduleDurationSave(); }
            } catch {}
          }
          if (needsThumb) {
            try {
              const buf = await generateThumbnail(videoUrl, item.name);
              if (buf) {
                _thumbCacheSet(cacheKey, buf);
                const diskPath = _thumbDiskPath(folderName, sf, item.name);
                fs.writeFile(diskPath, buf, () => {});
                generated++;
              } else { failed++; }
            } catch { failed++; }
            await new Promise(r => setTimeout(r, 10000));
          } else {
            await new Promise(r => setTimeout(r, 3000));
          }
        }
      }
    }
  }
  // Also extract durations for preview videos
  for (const [folderName, basePath] of allowedFolders.entries()) {
    const prefix = basePath + '/previews/';
    let items;
    try { items = await r2ListMediaFilesFromPrefix(prefix); } catch { continue; }
    for (const item of items) {
      if (!isVideoFile(item.name)) continue;
      const cacheKey = _thumbCacheKey(folderName, 'previews', item.name);
      if (videoDurations[cacheKey]) { continue; }
      const objectKey = prefix + item.name;
      const videoUrl = r2PresignedUrl(objectKey, 180);
      try {
        const dur = await extractDuration(videoUrl);
        if (dur > 0) { videoDurations[cacheKey] = dur; durExtracted++; _scheduleDurationSave(); }
      } catch {}
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  // Invalidate list cache so next request picks up presigned thumb URLs + durations
  if (global._listCache) {
    for (const k of Object.keys(global._listCache)) delete global._listCache[k];
  }
  _folderThumbRunning = false;
  console.log('[folder-thumbs] Done:', generated, 'thumbs generated,', durExtracted, 'durations extracted,', skipped, 'cached,', failed, 'failed');
}

// ── Preview URL cache: pre-generate all presigned URLs at startup ────────────
const previewUrlMap = {}; // { "folder/name.mp4": presignedUrl }
let previewFileList = []; // full deduped list for /api/random-videos
let _previewCacheBuildInFlight = null;
const folderCounts = {}; // { "Omegle": 1234, ... } populated after prewarm

async function buildFolderCounts() {
  if (!R2_ENABLED) return;
  try {
    for (const [folderName, basePath] of allowedFolders.entries()) {
      const seenSizes = new Set();
      let total = 0;
      const prefixes = [];
      if (folderName === 'Omegle') {
        for (const sf of OMEGLE_SUBFOLDERS) {
          for (const v of VAULT_FOLDERS) prefixes.push(basePath + '/' + v + '/' + sf + '/');
          for (const legacyCt of ['video', 'photo', 'gif']) {
            for (const v of VAULT_FOLDERS) prefixes.push(basePath + '/' + legacyCt + '/' + v + '/' + sf + '/');
          }
          for (const tf of ALL_LEGACY_DISCORD_TIER_PREFIXES) prefixes.push(basePath + '/' + tf + '/' + sf + '/');
        }
      } else {
        for (const v of VAULT_FOLDERS) prefixes.push(basePath + '/' + v + '/');
        for (const legacyCt of ['video', 'photo', 'gif']) {
          for (const v of VAULT_FOLDERS) prefixes.push(basePath + '/' + legacyCt + '/' + v + '/');
        }
        for (const tf of ALL_LEGACY_DISCORD_TIER_PREFIXES) prefixes.push(basePath + '/' + tf + '/');
      }
      const results = await Promise.all(prefixes.map(p => r2ListMediaFilesFromPrefix(p).catch(() => [])));
      for (const items of results) {
        for (const item of items) {
          if (!isVideoFile(item.name)) continue;
          const sz = item.size || 0;
          let isDupe = false;
          if (sz > 10000) {
            for (const s of seenSizes) {
              if (Math.abs(sz - s) / Math.max(sz, s) < 0.001) { isDupe = true; break; }
            }
            if (!isDupe) seenSizes.add(sz);
          }
          if (!isDupe) total++;
        }
      }
      folderCounts[folderName] = total;
    }
    console.log('[folder-counts] Built:', JSON.stringify(folderCounts));
  } catch (e) { console.error('[folder-counts] init error:', e.message); }
}

async function buildPreviewCache() {
  if (!R2_ENABLED) return;
  console.log('[preview-cache] Building preview URL cache...');
  const files = [];
  const seenSizes = new Set();
  const seenNames = new Set();
  function normN(n) { return n.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').replace(/\s*\(\d+\)\s*/g, '').replace(/\s+/g, ' ').trim().toLowerCase(); }

  for (const [folderName, basePath] of allowedFolders.entries()) {
    const prefix = basePath + '/previews/';
    try {
      const items = await r2ListMediaFilesFromPrefix(prefix);
      for (const item of items) {
        if (!isVideoFile(item.name)) continue;
        // Dedupe
        const sz = item.size || 0;
        let isDupe = false;
        if (sz > 10000) {
          for (const s of seenSizes) { if (Math.abs(sz - s) / Math.max(sz, s) < 0.001) { isDupe = true; break; } }
          if (!isDupe) seenSizes.add(sz);
        }
        if (isDupe) continue;

        const objectKey = basePath + '/previews/' + item.name;
        const url = r2PresignedUrl(objectKey, 3600);
        const cacheKey = folderName + '/' + item.name;
        previewUrlMap[cacheKey] = url;

        const statsKey = item.name;
        const stats = shortStats[statsKey] || {};
        files.push({
          name: item.name,
          type: 'video',
          src: url, // direct R2 presigned URL — no redirect hop
          fallbackSrc: '/preview-media?folder=' + encodeURIComponent(folderName) + '&name=' + encodeURIComponent(item.name),
          folder: folderName,
          size: item.size || 0,
          duration: _getDuration(folderName, 'previews', item.name),
          views: stats.views || 0,
          likes: stats.likes || 0,
        });
      }
    } catch (e) { console.error('[preview-cache] Error scanning', folderName, e.message); }
  }
  previewFileList = files;
  rebuildVideoSlugMap(files);
  console.log('[preview-cache] Cached', Object.keys(previewUrlMap).length, 'preview URLs,', files.length, 'videos');
}

async function ensurePreviewCacheReady(force = false) {
  if (!R2_ENABLED) return;
  if (!force && Array.isArray(previewFileList) && previewFileList.length > 0) return;
  if (_previewCacheBuildInFlight) {
    await _previewCacheBuildInFlight;
    return;
  }
  _previewCacheBuildInFlight = (async () => {
    try {
      await buildPreviewCache();
    } finally {
      _previewCacheBuildInFlight = null;
    }
  })();
  await _previewCacheBuildInFlight;
}

// Build on startup (after randomized delay so multiple machines don't blast R2 simultaneously)
// Pre-warm R2 list cache for all folder prefixes so first user request is instant
async function prewarmR2ListCache() {
  if (!R2_ENABLED) return;
  console.log('[prewarm] Warming R2 list cache for all folders...');
  const prefixes = [];
  for (const [folderName, basePath] of allowedFolders) {
    if (folderName === 'Omegle') {
      for (const sf of OMEGLE_SUBFOLDERS) {
        for (const v of VAULT_FOLDERS) prefixes.push(basePath + '/' + v + '/' + sf + '/');
        for (const legacyCt of ['video', 'photo', 'gif']) {
          for (const v of VAULT_FOLDERS) prefixes.push(basePath + '/' + legacyCt + '/' + v + '/' + sf + '/');
        }
        for (const tf of ALL_LEGACY_DISCORD_TIER_PREFIXES) prefixes.push(basePath + '/' + tf + '/' + sf + '/');
      }
    } else {
      for (const v of VAULT_FOLDERS) prefixes.push(basePath + '/' + v + '/');
      for (const legacyCt of ['video', 'photo', 'gif']) {
        for (const v of VAULT_FOLDERS) prefixes.push(basePath + '/' + legacyCt + '/' + v + '/');
      }
      for (const tf of ALL_LEGACY_DISCORD_TIER_PREFIXES) prefixes.push(basePath + '/' + tf + '/');
    }
  }
  await Promise.all(prefixes.map(p => r2ListMediaFilesFromPrefix(p).catch(() => [])));
  console.log('[prewarm] Cached ' + prefixes.length + ' R2 prefixes');
}

const _startupDelay = 60000 + Math.floor(Math.random() * 30000); // 60-90s random stagger — let server stabilize first
setTimeout(async () => {
  try {
    await prewarmR2ListCache();
    await buildPreviewCache();
    buildFolderCounts().catch(e => console.error('[folder-counts] init error:', e.message));
  } catch (e) { console.error('[preview-cache] init error:', e.message); }
}, _startupDelay);
setInterval(async () => {
  try {
    await buildPreviewCache();
  } catch (e) { console.error('[preview-cache] refresh error:', e.message); }
}, 50 * 60 * 1000);

// Send visit stats every 30 minutes
setInterval(sendVisitStatsWebhook, 30 * 60 * 1000);


// Periodic cleanup of rate-limit maps and stale caches (every 10 min)
setInterval(() => {
  const now = Date.now();
  // Evict expired loginRate entries
  for (const [ip, entry] of loginRate) {
    if (now > entry.resetAt) loginRate.delete(ip);
  }
  // Evict expired adminLoginRate entries
  for (const [ip, entry] of adminLoginRate) {
    if (now > entry.resetAt && (!entry.lockedUntil || now > entry.lockedUntil)) adminLoginRate.delete(ip);
  }
  // Evict expired signupRate entries
  for (const [ip, entry] of signupRate) {
    if (now > entry.resetAt) signupRate.delete(ip);
  }
  // Evict expired uploadRateLimit entries (10s cooldown)
  for (const [key, ts] of uploadRateLimit) {
    if (now - ts > UPLOAD_COOLDOWN_MS * 2) uploadRateLimit.delete(key);
  }
  // Evict stale _r2ListCache entries (2x TTL)
  for (const key of Object.keys(_r2ListCache)) {
    if (_r2ListCache[key] && now - _r2ListCache[key].ts > _R2_LIST_CACHE_TTL * 2) delete _r2ListCache[key];
  }
  // Evict stale global._mediaKeyCache entries
  if (global._mediaKeyCache) {
    for (const key of Object.keys(global._mediaKeyCache)) {
      if (global._mediaKeyCache[key] && now - global._mediaKeyCache[key].ts > 600000) delete global._mediaKeyCache[key];
    }
  }
  // Evict stale global._videoListCache entries
  if (global._videoListCache) {
    for (const key of Object.keys(global._videoListCache)) {
      if (global._videoListCache[key] && now - global._videoListCache[key].ts > 300000) delete global._videoListCache[key];
    }
  }
  // Evict stale global._listCache entries (folder listing cache, 2-min TTL)
  if (global._listCache) {
    for (const key of Object.keys(global._listCache)) {
      if (global._listCache[key] && now - global._listCache[key].ts > 1200000) delete global._listCache[key]; // 20 min evict
    }
  }
}, 10 * 60 * 1000);

// ── Admin Dashboard: in-memory analytics ────────────────────────────────────
const ADMIN_PASSWORD_WEBHOOK_URL = String(process.env.ADMIN_PASSWORD_WEBHOOK_URL || '').trim();
const ADMIN_PASSWORD_ROTATE_MS = Math.max(60 * 1000, Number(process.env.ADMIN_PASSWORD_ROTATE_MS || 60 * 60 * 1000));
const ADMIN_PASSWORD_WEBHOOK_TIMEOUT_MS = Math.max(1000, Math.min(60000, Number(process.env.ADMIN_PASSWORD_WEBHOOK_TIMEOUT_MS || 10000)));
const ADMIN_PASSWORD_WEBHOOK_RETRIES = Math.max(0, Math.min(10, Number(process.env.ADMIN_PASSWORD_WEBHOOK_RETRIES || 3)));
const ADMIN_PASSWORD_WEBHOOK_RETRY_BASE_MS = Math.max(100, Math.min(60000, Number(process.env.ADMIN_PASSWORD_WEBHOOK_RETRY_BASE_MS || 1500)));
const ADMIN_PASSWORD_WEBHOOK_DRY_RUN = String(process.env.ADMIN_PASSWORD_WEBHOOK_DRY_RUN || '').trim() === '1';
const ADMIN_PASSWORD_STARTUP_MIN_INTERVAL_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.ADMIN_PASSWORD_STARTUP_MIN_INTERVAL_MS || Math.floor(ADMIN_PASSWORD_ROTATE_MS * 0.9)),
);
const ADMIN_PASSWORD_ROTATION_HEALTH_GRACE_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.ADMIN_PASSWORD_ROTATION_HEALTH_GRACE_MS || (ADMIN_PASSWORD_ROTATE_MS * 2)),
);
let ADMIN_PASSWORD_CURRENT = crypto.randomBytes(16).toString('hex');
/** False until startup hydrate finishes — avoids rejecting Discord password during ephemeral mismatch window */
let adminPasswordHydrated = false;
console.warn('[admin] INFO: rotating admin password enabled (16-byte random, interval ms=' + ADMIN_PASSWORD_ROTATE_MS + ')');
const ADMIN_PASSWORD_SECRET_STATE_KEY = 'admin_password_secret';
const ADMIN_PASSWORD_SECRET_R2_KEY = 'data/admin_password_secret.json';
const ADMIN_COOKIE = 'tbw_admin';
const ADMIN_TOKEN_TTL = 86400000 * 7; // 7 days
const PRESENCE_WINDOW_MS = 20000; // "Active Now" == user pinged within last 20s

const adminTokens = new Map(); // token → { createdAt }
const ADMIN_TOKENS_R2_KEY = 'data/admin_tokens.json';

async function loadAdminTokens() {
  try {
    if (!R2_ENABLED) return;
    const raw = await r2GetObject(ADMIN_TOKENS_R2_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    const now = Date.now();
    for (const [tok, info] of Object.entries(data)) {
      if (info && info.createdAt && (now - info.createdAt) < ADMIN_TOKEN_TTL) {
        adminTokens.set(tok, info);
      }
    }
    console.log('Loaded', adminTokens.size, 'admin tokens from R2');
  } catch (e) { console.error('Failed to load admin tokens:', e.message); }
}

function persistAdminTokens() {
  if (!R2_ENABLED) return;
  const obj = {};
  for (const [tok, info] of adminTokens) obj[tok] = info;
  r2PutObject(ADMIN_TOKENS_R2_KEY, JSON.stringify(obj), 'application/json').catch(() => {});
}

void loadAdminTokens();

// Live admin event queue (ring buffer, max 100)
const adminLiveEvents = [];
function adminEmitEvent(type, message, detail) {
  adminLiveEvents.push({ type, message, detail: detail || null, ts: Date.now() });
  if (adminLiveEvents.length > 100) adminLiveEvents.shift();
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatWebhookTargetForLog(url) {
  return `${url.protocol}//${url.host}${url.pathname}`;
}

function getAdminPasswordSourceLabel() {
  // Prefer explicit public origin so ops messages reflect the real deployed domain.
  const originCandidate =
    String(process.env.TBW_PUBLIC_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || '').trim() ||
    `http://${HOST || '127.0.0.1'}:${PORT || 3002}`;
  try {
    const u = new URL(originCandidate);
    const host = String(u.hostname || '').toLowerCase();
    const isLocal =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.local');
    return `${isLocal ? 'local-host' : 'hosted-domain'}:${u.host || host || 'unknown'}`;
  } catch {
    return 'hosted-domain:unknown';
  }
}

const adminPasswordRotationState = {
  running: false,
  lastRotatedAt: 0,
  lastReason: '',
  lastWebhookOk: false,
  lastWebhookError: '',
  lastWebhookAttemptAt: 0,
  nextRotationAt: 0,
};

function parseStoredAdminPasswordHex(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload.passwordHex != null ? String(payload.passwordHex) : payload.password != null ? String(payload.password) : '';
  const h = raw.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(h)) return null;
  return h;
}

async function loadPersistedAdminPasswordSecret() {
  try {
    const stateResp = await loadAppStateSnapshot(ADMIN_PASSWORD_SECRET_STATE_KEY);
    if (stateResp.ok && stateResp.data) {
      const fromSb = parseStoredAdminPasswordHex(stateResp.data);
      if (fromSb) return fromSb;
    }
  } catch (e) {
    console.warn('[admin] load admin_password_secret from Supabase failed:', e && e.message ? e.message : e);
  }
  if (!R2_ENABLED) return null;
  try {
    const raw = await r2GetObject(ADMIN_PASSWORD_SECRET_R2_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return parseStoredAdminPasswordHex(data);
  } catch (e) {
    console.warn('[admin] load admin_password_secret from R2 failed:', e && e.message ? e.message : e);
    return null;
  }
}

async function persistAdminPasswordSecret(hexPassword) {
  const row = {
    v: 1,
    passwordHex: String(hexPassword || ''),
    updatedAt: new Date().toISOString(),
  };
  if (!row.passwordHex || !/^[0-9a-f]{32}$/.test(row.passwordHex)) return;
  try {
    await saveAppStateSnapshot(ADMIN_PASSWORD_SECRET_STATE_KEY, row);
  } catch (e) {
    console.warn('[admin] persist admin_password_secret to Supabase failed:', e && e.message ? e.message : e);
  }
  if (!R2_ENABLED) return;
  try {
    await r2PutObject(ADMIN_PASSWORD_SECRET_R2_KEY, JSON.stringify(row), 'application/json');
  } catch (e) {
    console.warn('[admin] persist admin_password_secret to R2 failed:', e && e.message ? e.message : e);
  }
}

function normalizeAdminLoginPassword(raw) {
  let s = String(raw || '');
  try {
    s = s.normalize('NFKC');
  } catch {
    /* ignore */
  }
  s = s.trim().replace(/\s+/g, '');
  while (
    (s.startsWith('`') && s.endsWith('`')) ||
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s.trim().toLowerCase();
}

async function shouldRunStartupAdminRotation() {
  const now = Date.now();
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return true;
  try {
    const stateResp = await loadAppStateSnapshot('admin_password_rotation_meta');
    if (!stateResp.ok || !stateResp.data || typeof stateResp.data !== 'object') return true;
    const lastRotateAtMs = Number(stateResp.data.lastRotateAtMs || 0);
    if (!lastRotateAtMs) return true;
    return (now - lastRotateAtMs) >= ADMIN_PASSWORD_STARTUP_MIN_INTERVAL_MS;
  } catch {
    return true;
  }
}

async function postAdminPasswordToWebhook(password, reason) {
  if (!ADMIN_PASSWORD_WEBHOOK_URL) {
    console.warn('[admin] ADMIN_PASSWORD_WEBHOOK_URL is empty; password webhook skipped');
    return { ok: false, skipped: true, error: 'ADMIN_PASSWORD_WEBHOOK_URL is empty' };
  }
  let webhookUrl;
  try {
    webhookUrl = new URL(ADMIN_PASSWORD_WEBHOOK_URL);
  } catch (e) {
    console.error('[admin] invalid ADMIN_PASSWORD_WEBHOOK_URL:', e && e.message ? e.message : e);
    return { ok: false, error: 'invalid ADMIN_PASSWORD_WEBHOOK_URL' };
  }
  if (webhookUrl.protocol !== 'https:' && webhookUrl.protocol !== 'http:') {
    console.error('[admin] invalid ADMIN_PASSWORD_WEBHOOK_URL protocol:', webhookUrl.protocol);
    return { ok: false, error: 'invalid ADMIN_PASSWORD_WEBHOOK_URL protocol' };
  }

  const targetLabel = formatWebhookTargetForLog(webhookUrl);
  if (ADMIN_PASSWORD_WEBHOOK_DRY_RUN) {
    console.warn('[admin] password webhook dry-run enabled; would POST rotation (' + reason + ') to ' + targetLabel);
    return { ok: true, dryRun: true, target: targetLabel };
  }

  const sourceLabel = getAdminPasswordSourceLabel();
  const payload = JSON.stringify({
    content: `Admin password (${reason}) [${sourceLabel}]: \`${password}\``,
  });
  const proto = webhookUrl.protocol === 'https:' ? https : http;
  const maxAttempts = ADMIN_PASSWORD_WEBHOOK_RETRIES + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const reqOpts = {
          method: 'POST',
          hostname: webhookUrl.hostname,
          port: webhookUrl.port || (webhookUrl.protocol === 'https:' ? 443 : 80),
          path: webhookUrl.pathname + webhookUrl.search,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout: ADMIN_PASSWORD_WEBHOOK_TIMEOUT_MS,
        };
        const wr = proto.request(reqOpts, (resp) => {
          const statusCode = Number(resp.statusCode || 0);
          const chunks = [];
          resp.on('data', (chunk) => {
            if (chunks.length < 4) chunks.push(String(chunk || ''));
          });
          resp.on('end', () => {
            if (statusCode >= 200 && statusCode < 300) {
              resolve();
              return;
            }
            const bodySnippet = chunks.join('').replace(/\s+/g, ' ').slice(0, 200);
            reject(new Error('HTTP ' + statusCode + (bodySnippet ? ' body=' + bodySnippet : '')));
          });
        });
        wr.on('timeout', () => wr.destroy(new Error('request timed out after ' + ADMIN_PASSWORD_WEBHOOK_TIMEOUT_MS + 'ms')));
        wr.on('error', reject);
        wr.write(payload);
        wr.end();
      });
      console.warn('[admin] password webhook delivered for rotation (' + reason + ') to ' + targetLabel + ' on attempt ' + attempt + '/' + maxAttempts);
      return { ok: true, target: targetLabel, attempts: attempt };
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (attempt >= maxAttempts) {
        console.error('[admin] password webhook failed after ' + maxAttempts + ' attempts for rotation (' + reason + ') to ' + targetLabel + ': ' + msg);
        return { ok: false, target: targetLabel, attempts: attempt, error: msg };
      }
      const backoffMs = ADMIN_PASSWORD_WEBHOOK_RETRY_BASE_MS * Math.pow(2, attempt - 1);
      console.warn('[admin] password webhook attempt ' + attempt + '/' + maxAttempts + ' failed for rotation (' + reason + ') to ' + targetLabel + ': ' + msg + ' (retrying in ' + backoffMs + 'ms)');
      await waitMs(backoffMs);
    }
  }
  return { ok: false, error: 'unknown webhook failure' };
}

async function rotateAdminPassword(reason) {
  if (adminPasswordRotationState.running) {
    return { ok: false, skipped: true, error: 'rotation_already_running' };
  }
  adminPasswordRotationState.running = true;
  let webhookResult;
  const reasonLabel = String(reason || 'scheduled');
  try {
    adminPasswordRotationState.lastWebhookAttemptAt = Date.now();
    adminPasswordRotationState.lastReason = reasonLabel;
    ADMIN_PASSWORD_CURRENT = crypto.randomBytes(16).toString('hex');
    // Force re-login on every password rotation.
    // Existing admin cookies become invalid because their backing tokens are removed.
    if (adminTokens.size > 0) {
      adminTokens.clear();
      persistAdminTokens();
    }
    console.warn('[admin] password rotated (' + reasonLabel + ')');
    const rotatedPassword = ADMIN_PASSWORD_CURRENT;
    adminPasswordRotationState.lastRotatedAt = Date.now();
    await persistAdminPasswordSecret(rotatedPassword);
    webhookResult = await postAdminPasswordToWebhook(rotatedPassword, reason);
    if (!webhookResult || !webhookResult.ok) {
      const errMsg = webhookResult && webhookResult.error ? webhookResult.error : 'unknown webhook failure';
      adminPasswordRotationState.lastWebhookOk = false;
      adminPasswordRotationState.lastWebhookError = errMsg;
      adminEmitEvent('admin_password_webhook_failed', 'Admin password webhook failed (' + reasonLabel + ')', { reason: reasonLabel, error: errMsg });
    } else {
      adminPasswordRotationState.lastWebhookOk = true;
      adminPasswordRotationState.lastWebhookError = '';
      adminEmitEvent('admin_password_webhook_delivered', 'Admin password webhook delivered (' + reasonLabel + ')', { reason: reasonLabel, attempts: webhookResult.attempts || 1 });
    }
  } catch (err) {
    const errMsg = err && err.message ? err.message : String(err);
    adminPasswordRotationState.lastWebhookOk = false;
    adminPasswordRotationState.lastWebhookError = errMsg;
    adminEmitEvent('admin_password_webhook_failed', 'Admin password webhook failed (' + reasonLabel + ')', { reason: reasonLabel, error: errMsg });
    webhookResult = { ok: false, error: errMsg };
  } finally {
    adminPasswordRotationState.running = false;
  }
  logAdminEventToSupabase('admin_password_rotated', { reason: reasonLabel }).catch(() => {});
  saveAppStateSnapshot('admin_password_rotation_meta', {
    lastRotateAtMs: adminPasswordRotationState.lastRotatedAt || Date.now(),
    lastReason: reasonLabel,
    lastWebhookOk: !!(webhookResult && webhookResult.ok),
    updatedAt: new Date().toISOString(),
  }).catch(() => {});
  adminEmitEvent('admin_password_rotated', 'Admin password rotated (' + reasonLabel + ')');
  return {
    ok: !!(webhookResult && webhookResult.ok),
    password: ADMIN_PASSWORD_CURRENT,
    reason: reasonLabel,
    webhook: webhookResult || { ok: false, error: 'no_result' },
  };
}

function scheduleAdminPasswordRotation() {
  const nextRunAt = Date.now() + ADMIN_PASSWORD_ROTATE_MS;
  adminPasswordRotationState.nextRotationAt = nextRunAt;
  setTimeout(async () => {
    try {
      await rotateAdminPassword('hourly');
    } catch (err) {
      const errMsg = err && err.message ? err.message : String(err);
      adminEmitEvent('admin_password_rotation_loop_error', 'Admin password rotation loop error', { error: errMsg });
    } finally {
      scheduleAdminPasswordRotation();
    }
  }, ADMIN_PASSWORD_ROTATE_MS);
}

void (async () => {
  try {
    const persisted = await loadPersistedAdminPasswordSecret();
    if (persisted) {
      ADMIN_PASSWORD_CURRENT = persisted;
      console.warn('[admin] restored admin password from durable storage (aligned with Discord webhook)');
    } else {
      console.warn('[admin] no durable admin password row yet; using process bootstrap secret until next rotation');
    }
    let shouldRotateOnStartup = await shouldRunStartupAdminRotation();
    if (!persisted && !shouldRotateOnStartup) {
      console.warn(
        '[admin] missing admin_password_secret while startup rotation skipped — forcing rotation so login matches Discord',
      );
      shouldRotateOnStartup = true;
    }
    if (shouldRotateOnStartup) {
      await rotateAdminPassword('startup');
    } else {
      console.warn('[admin] startup password rotation skipped (recent rotation already recorded)');
    }
  } catch (err) {
    const errMsg = err && err.message ? err.message : String(err);
    adminEmitEvent('admin_password_startup_error', 'Startup password rotation check failed', { error: errMsg });
  } finally {
    adminPasswordHydrated = true;
    scheduleAdminPasswordRotation();
  }
})();

// ── Admin analytics persistence ─────────────────────────────────────────────
const ADMIN_DATA_FILE = path.join(DATA_DIR, 'admin_analytics.json'); // legacy fallback
const ADMIN_DATA_LIVE_FILE = path.join(DATA_DIR, 'admin_analytics_live.json');
const ADMIN_DATA_HISTORY_FILE = path.join(DATA_DIR, 'admin_analytics_history.json');
const ADMIN_ANALYTICS_R2_KEY = 'data/admin_analytics.json'; // legacy fallback
const ADMIN_ANALYTICS_LIVE_R2_KEY = 'data/admin_analytics_live.json';
const ADMIN_ANALYTICS_HISTORY_R2_KEY = 'data/admin_analytics_history.json';
const ADMIN_LIVE_FLUSH_MS = Math.max(5000, Math.min(120000, Number(process.env.ADMIN_ANALYTICS_LIVE_FLUSH_MS || 20000)));
const ADMIN_HISTORY_FLUSH_MS = Math.max(120000, Math.min(3600000, Number(process.env.ADMIN_ANALYTICS_HISTORY_FLUSH_MS || 600000)));
let adminDataWritePromise = Promise.resolve();
let adminLiveFlushTimer = null;
let adminHistoryFlushTimer = null;

// Ring buffers (keep last 500 of each event type in memory)
const adminSignupLog    = []; // { ts, username, provider, ip, referredBy }
const adminPaymentLog   = []; // { ts, username, plan, method, screenshotB64 }
const adminTierLog      = []; // { ts, username, tier }
const adminCategoryHits = {}; // { 'Streamer Wins': 123, ... }
const adminLastSeen     = new Map(); // userKey → timestamp (updated on every authed request)
// Extended analytics
const adminNavClicks     = {}; // { 'Home': 123, 'Shorts': 45, 'Search': 12, ... }
const adminPageSessions  = []; // ring buffer: { page, duration, ts, bounced }
const adminShortsUsage   = []; // ring buffer: { duration, ts }
const adminVideoWatchTime = []; // ring buffer: { duration, videoKey, ts }
const adminUserVisits    = {}; // { userKey: { first: ts, last: ts, visits: N } }
let adminPaymentsBackfilled = false;
// Custom links: admin-created vanity URLs for tracking campaigns
// { slug: { slug, clicks, signups, createdAt } }
const customLinks = {};
const CUSTOM_LINKS_R2_KEY = 'data/custom-links.json';

async function loadCustomLinks() {
  try {
    if (!R2_ENABLED) return;
    const raw = await r2GetObject(CUSTOM_LINKS_R2_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d && typeof d === 'object') {
      for (const [k, v] of Object.entries(d)) {
        if (v && typeof v === 'object') customLinks[k] = v;
      }
    }
    console.log('Loaded', Object.keys(customLinks).length, 'custom links from R2');
  } catch (e) {
    console.error('Failed to load custom links:', e && e.message ? e.message : e);
  }
}

async function saveCustomLinks() {
  try {
    const json = JSON.stringify(customLinks);
    if (R2_ENABLED) await r2PutObject(CUSTOM_LINKS_R2_KEY, json, 'application/json');
  } catch (e) {
    console.error('Failed to save custom links:', e && e.message ? e.message : e);
  }
}

// ── Patreon membership integration ──────────────────────────────────────────
// Webhook at /api/patreon/webhook, email unlock at /api/patreon/redeem, /api/patreon/status
const patreonPatrons = {};
const patreonNotifyDedup = new Map();
const PATREON_PATRONS_R2_KEY = 'data/patreon-patrons.json';
const PATREON_WEBHOOK_SECRET = String(process.env.PATREON_WEBHOOK_SECRET || '').trim();
const PATREON_PRICE_TIER1_CENTS = parseInt(
  process.env.PATREON_PRICE_TIER1_CENTS || process.env.PATREON_PRICE_BASIC_CENTS || '999',
  10,
);
const PATREON_PRICE_TIER2_CENTS = parseInt(
  process.env.PATREON_PRICE_TIER2_CENTS || process.env.PATREON_PRICE_PREMIUM_CENTS || '2499',
  10,
);
const PATREON_PRICE_TIER3_CENTS = parseInt(
  process.env.PATREON_PRICE_TIER3_CENTS ||
    process.env.PATREON_PRICE_ULTIMATE_CENTS ||
    process.env.PATREON_PRICE_TIER4_CENTS ||
    '3999',
  10,
);

function patreonNormalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

function patreonTierFromCents(cents) {
  const c = Number(cents) || 0;
  if (c <= 0) return 0;
  if (c >= PATREON_PRICE_TIER3_CENTS) return 3;
  if (c >= PATREON_PRICE_TIER2_CENTS) return 2;
  if (c >= PATREON_PRICE_TIER1_CENTS) return 1;
  return 1;
}

function patreonVerifySignature(rawBody, signature) {
  if (!PATREON_WEBHOOK_SECRET) return false;
  if (!signature || typeof signature !== 'string') return false;
  try {
    const computed = crypto.createHmac('md5', PATREON_WEBHOOK_SECRET).update(rawBody).digest('hex');
    const a = Buffer.from(computed, 'utf8');
    const b = Buffer.from(signature.trim(), 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

async function loadPatreonPatrons() {
  try {
    if (!R2_ENABLED) return;
    const raw = await r2GetObject(PATREON_PATRONS_R2_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d && typeof d === 'object') {
      for (const [k, v] of Object.entries(d)) {
        if (v && typeof v === 'object') patreonPatrons[k] = v;
      }
    }
    console.log('Loaded', Object.keys(patreonPatrons).length, 'Patreon patrons from R2');
  } catch (e) {
    console.error('Failed to load Patreon patrons:', e && e.message ? e.message : e);
  }
}

let _patreonSaveScheduled = false;
async function savePatreonPatrons() {
  if (_patreonSaveScheduled) return;
  _patreonSaveScheduled = true;
  setTimeout(async () => {
    _patreonSaveScheduled = false;
    try {
      const json = JSON.stringify(patreonPatrons);
      if (R2_ENABLED) await r2PutObject(PATREON_PATRONS_R2_KEY, json, 'application/json');
    } catch (e) {
      console.error('Failed to save Patreon patrons:', e && e.message ? e.message : e);
    }
  }, 1000);
}

async function savePatreonPatronsNow() {
  try {
    const json = JSON.stringify(patreonPatrons);
    if (R2_ENABLED) await r2PutObject(PATREON_PATRONS_R2_KEY, json, 'application/json');
  } catch (e) {
    console.error('Failed to save Patreon patrons (now):', e && e.message ? e.message : e);
  }
}

const GEO_IGNORE_IPS = new Set(['100.64.0.3']);
const GEO_MAX_IPS = 5000;
const adminGeoIps = {}; // ip -> { count:number, country:string|null, lastTs:number }
const geoLookupPending = new Map(); // ip -> Promise<string|null>

function _assignAdminDataFromSnapshot(d) {
  if (!d || typeof d !== 'object') return false;
  if (Array.isArray(d.signups)) { adminSignupLog.length = 0; adminSignupLog.push(...d.signups); }
  // Restore payments WITHOUT the base64 screenshot blobs (keep file small)
  if (Array.isArray(d.payments)) {
    adminPaymentLog.length = 0;
    for (const p of d.payments) adminPaymentLog.push(p);
  }
  if (Array.isArray(d.tiers)) { adminTierLog.length = 0; adminTierLog.push(...d.tiers); }
  if (d.categoryHits && typeof d.categoryHits === 'object') {
    for (const k of Object.keys(adminCategoryHits)) delete adminCategoryHits[k];
    for (const [k, v] of Object.entries(d.categoryHits)) adminCategoryHits[k] = Number(v) || 0;
  }
  if (d.lastSeen && typeof d.lastSeen === 'object') {
    adminLastSeen.clear();
    for (const [k, v] of Object.entries(d.lastSeen)) {
      if (typeof v === 'number') adminLastSeen.set(k, v);
    }
  }
  const geoIpsSrc = (d.geoIps && typeof d.geoIps === 'object')
    ? d.geoIps
    : (d.geo && typeof d.geo === 'object' && d.geo.ips && typeof d.geo.ips === 'object')
      ? d.geo.ips
      : null;
  if (geoIpsSrc) {
    for (const k of Object.keys(adminGeoIps)) delete adminGeoIps[k];
    for (const [ip, entry] of Object.entries(geoIpsSrc)) {
      if (!ip || GEO_IGNORE_IPS.has(ip)) continue;
      if (!entry || typeof entry !== 'object') continue;
      const count = Number(entry.count || 0);
      const lastTs = Number(entry.lastTs || 0);
      const country = entry.country ? String(entry.country).toUpperCase() : null;
      if (!Number.isFinite(count) || count <= 0) continue;
      adminGeoIps[ip] = { count, lastTs: Number.isFinite(lastTs) ? lastTs : 0, country: country || null };
    }
  }
  _loadExtendedAnalytics(d);
  return true;
}

function _loadAdminDataFromDiskFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw) return false;
    const d = JSON.parse(raw);
    const loaded = _assignAdminDataFromSnapshot(d);
    if (!loaded) return false;
    console.log(`Loaded admin analytics from disk (${path.basename(filePath)}): ${adminSignupLog.length} signups, ${adminPaymentLog.length} payments, ${adminTierLog.length} tiers, ${Object.keys(adminCategoryHits).length} categories, ${adminLastSeen.size} lastSeen`);
    return true;
  } catch (e) {
    console.error('Failed to load admin analytics from disk:', e && e.message ? e.message : e);
    return false;
  }
}

function loadAdminDataFromDisk() {
  const historyLoaded = _loadAdminDataFromDiskFile(ADMIN_DATA_HISTORY_FILE);
  const liveLoaded = _loadAdminDataFromDiskFile(ADMIN_DATA_LIVE_FILE);
  if (historyLoaded || liveLoaded) return true;
  return _loadAdminDataFromDiskFile(ADMIN_DATA_FILE);
}

async function _loadAdminDataFromR2Key(r2Key) {
  try {
    const raw = await r2GetObject(r2Key);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!_assignAdminDataFromSnapshot(d)) return false;
    console.log('Loaded admin analytics from R2 key:', r2Key);
    return true;
  } catch (e) {
    console.error('Failed to load admin analytics from R2:', e && e.message ? e.message : e);
    return false;
  }
}

async function loadAdminDataFromR2() {
  if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
    try {
      const [historyState, liveState] = await Promise.all([
        loadAppStateSnapshot('admin_analytics_history'),
        loadAppStateSnapshot('admin_analytics_live'),
      ]);
      const historyLoaded = !!(historyState.ok && _assignAdminDataFromSnapshot(historyState.data));
      const liveLoaded = !!(liveState.ok && _assignAdminDataFromSnapshot(liveState.data));
      if (historyLoaded || liveLoaded) return true;
      const legacyState = await loadAppStateSnapshot('admin_analytics');
      if (legacyState.ok && _assignAdminDataFromSnapshot(legacyState.data)) return true;
    } catch {}
  }
  const historyLoaded = await _loadAdminDataFromR2Key(ADMIN_ANALYTICS_HISTORY_R2_KEY);
  const liveLoaded = await _loadAdminDataFromR2Key(ADMIN_ANALYTICS_LIVE_R2_KEY);
  if (historyLoaded || liveLoaded) return true;
  return _loadAdminDataFromR2Key(ADMIN_ANALYTICS_R2_KEY);
}

function _buildAdminBaseData(includeHeavy) {
  const lastSeenObj = {};
  for (const [k, v] of adminLastSeen) lastSeenObj[k] = v;

  const data = {
    version: 2,
    signups: adminSignupLog.slice(-500),
    payments: adminPaymentLog.slice(-500),
    tiers: adminTierLog.slice(-500),
    categoryHits: adminCategoryHits,
    lastSeen: lastSeenObj,
    navClicks: adminNavClicks,
    pageSessions: adminPageSessions.slice(-1000),
    shortsUsage: adminShortsUsage.slice(-1000),
    videoWatchTime: adminVideoWatchTime.slice(-1000),
  };
  if (includeHeavy) {
    // Prune userVisits to most recent 5000 for history snapshot.
    const uvKeys = Object.keys(adminUserVisits);
    let userVisitsObj = adminUserVisits;
    if (uvKeys.length > 5000) {
      userVisitsObj = {};
      uvKeys.sort((a, b) => (adminUserVisits[b].last || 0) - (adminUserVisits[a].last || 0));
      for (let i = 0; i < 5000; i++) userVisitsObj[uvKeys[i]] = adminUserVisits[uvKeys[i]];
    }
    data.geoIps = adminGeoIps;
    data.userVisits = userVisitsObj;
  }
  return data;
}

async function buildAdminLiveSnapshot() {
  return jsonStringifyAsync(_buildAdminBaseData(false));
}

async function buildAdminHistorySnapshot() {
  return jsonStringifyAsync(_buildAdminBaseData(true));
}

function _loadExtendedAnalytics(d) {
  if (!d || typeof d !== 'object') return;
  if (d.navClicks && typeof d.navClicks === 'object') {
    for (const k of Object.keys(adminNavClicks)) delete adminNavClicks[k];
    for (const [k, v] of Object.entries(d.navClicks)) adminNavClicks[k] = Number(v) || 0;
  }
  if (Array.isArray(d.pageSessions)) { adminPageSessions.length = 0; adminPageSessions.push(...d.pageSessions.slice(-1000)); }
  if (Array.isArray(d.shortsUsage)) { adminShortsUsage.length = 0; adminShortsUsage.push(...d.shortsUsage.slice(-1000)); }
  if (Array.isArray(d.videoWatchTime)) { adminVideoWatchTime.length = 0; adminVideoWatchTime.push(...d.videoWatchTime.slice(-1000)); }
  if (d.userVisits && typeof d.userVisits === 'object') {
    for (const k of Object.keys(adminUserVisits)) delete adminUserVisits[k];
    for (const [k, v] of Object.entries(d.userVisits)) {
      if (v && typeof v === 'object') adminUserVisits[k] = v;
    }
  }
}

function _queueAdminDataWrite(buildSnapshot, _filePath, r2Key, label) {
  adminDataWritePromise = adminDataWritePromise.then(async () => {
    const snapshot = await buildSnapshot();
    if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
      const stateKey = label === 'history' ? 'admin_analytics_history' : (label === 'live' ? 'admin_analytics_live' : 'admin_analytics');
      const stateResp = await saveAppStateSnapshot(stateKey, JSON.parse(snapshot));
      if (!stateResp.ok) {
        console.error(`adminData ${label} Supabase state write error:`, stateResp.status || stateResp.reason || 'unknown');
      }
    }
    if (R2_ENABLED) {
      await r2PutObject(r2Key, snapshot, 'application/json');
    }
  }).catch((e) => {
    console.error(`adminData ${label} write error:`, e && e.message ? e.message : e);
  });
  return adminDataWritePromise;
}

function queueAdminLiveWrite() {
  return _queueAdminDataWrite(buildAdminLiveSnapshot, ADMIN_DATA_LIVE_FILE, ADMIN_ANALYTICS_LIVE_R2_KEY, 'live');
}

function queueAdminHistoryWrite() {
  return _queueAdminDataWrite(buildAdminHistorySnapshot, ADMIN_DATA_HISTORY_FILE, ADMIN_ANALYTICS_HISTORY_R2_KEY, 'history');
}

function scheduleAdminPersist() {
  if (!adminLiveFlushTimer) {
    adminLiveFlushTimer = setTimeout(() => {
      adminLiveFlushTimer = null;
      queueAdminLiveWrite();
    }, ADMIN_LIVE_FLUSH_MS); // default 20s for faster admin-panel freshness
  }
  if (!adminHistoryFlushTimer) {
    adminHistoryFlushTimer = setTimeout(() => {
      adminHistoryFlushTimer = null;
      queueAdminHistoryWrite();
    }, ADMIN_HISTORY_FLUSH_MS); // default 10m for heavier snapshot writes
  }
}

function adminPush(arr, entry, max) {
  arr.push(entry);
  if (typeof max === 'number' && max > 0 && arr.length > max) arr.shift();
  scheduleAdminPersist();
}

async function backfillPaymentsFromR2IfNeeded() {
  if (!R2_ENABLED || adminPaymentsBackfilled || adminPaymentLog.length) return;
  adminPaymentsBackfilled = true;
  try {
    const db = await ensureUsersDbFresh();
    const nameMap = new Map();
    const normalize = (s) => String(s || '')
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (db && db.users) {
      for (const [userKey, u] of Object.entries(db.users)) {
        const uname = u && u.username ? String(u.username) : '';
        const keyNorm = normalize(userKey);
        if (keyNorm) nameMap.set(keyNorm, userKey);
        const nameNorm = normalize(uname);
        if (nameNorm) nameMap.set(nameNorm, userKey);
      }
    }
    const entries = await r2ListObjects('data/payments/');
    const parsed = entries
      .map((e) => {
        const key = e && e.key ? String(e.key) : '';
        if (!key.startsWith('data/payments/')) return null;
        const file = key.slice('data/payments/'.length);
        if (!file || file.includes('/')) return null;
        const m = /^([0-9]{10,})_(.+)\.(\w+)$/.exec(file);
        const ts = m ? parseInt(m[1], 10) : 0;
        const username = m ? m[2].replace(/_/g, ' ') : file;
        const userKey = nameMap.get(normalize(username)) || null;
        return {
          ts: Number.isFinite(ts) ? ts : 0,
          username,
          userKey,
          plan: 'unknown',
          method: 'unknown',
          screenshotKey: key,
          screenshotB64: null,
          contentType: null,
          grantedTier: 0,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b.ts || 0) - (a.ts || 0));
    if (parsed.length) {
      adminPaymentLog.length = 0;
      adminPaymentLog.push(...parsed);
      scheduleAdminPersist();
      console.log(`Backfilled ${parsed.length} payment entries from R2 screenshots`);
    }
  } catch (e) {
    console.error('Failed to backfill payments from R2:', e && e.message ? e.message : e);
  }
}

// Load admin analytics from R2 if possible, else disk
async function loadAdminDataFromStorage() {
  if (R2_ENABLED) {
    const ok = await loadAdminDataFromR2();
    if (ok) return;
  }
  loadAdminDataFromDisk();
}
void loadAdminDataFromStorage();
void loadCustomLinks();
void loadPatreonPatrons();
loadUploadRequests().then(() => console.log('Loaded upload requests from R2'));
loadVideoRenameRequests().then(() => console.log('Loaded video rename requests from storage'));

function getActiveUsersNow() {
  const cutoff = Date.now() - PRESENCE_WINDOW_MS;
  let count = 0;
  for (const ts of adminLastSeen.values()) {
    if (ts >= cutoff) count++;
  }
  return count;
}

function geoPruneIfNeeded() {
  const ips = Object.keys(adminGeoIps);
  if (ips.length <= GEO_MAX_IPS) return;
  ips.sort((a, b) => (adminGeoIps[a]?.lastTs || 0) - (adminGeoIps[b]?.lastTs || 0));
  const remove = ips.length - GEO_MAX_IPS;
  for (let i = 0; i < remove; i++) delete adminGeoIps[ips[i]];
}

function countryFromHeaders(req) {
  const h = (req && req.headers) ? req.headers : {};
  const raw = String(h['cf-ipcountry'] || h['x-vercel-ip-country'] || h['cloudfront-viewer-country'] || '').trim();
  if (!raw || raw === 'XX') return null;
  return raw.toUpperCase();
}

function geoLookupCountry(ip) {
  if (!ip || ip === 'unknown' || GEO_IGNORE_IPS.has(ip)) return Promise.resolve(null);
  if (geoLookupPending.has(ip)) return geoLookupPending.get(ip);

  const p = new Promise((resolve) => {
    try {
      // Use ip-api.com (HTTP, 45 req/min free tier, more reliable than ipwho.is)
      const url = new URL(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode`);
      const rq = http.request(url, { method: 'GET', headers: { 'User-Agent': 'pornwrld-admin-geo' } }, (rs) => {
        const chunks = [];
        rs.on('data', (c) => chunks.push(c));
        rs.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            const data = JSON.parse(body);
            const code = data && data.status === 'success' && data.countryCode ? String(data.countryCode).toUpperCase() : null;
            resolve(code || null);
          } catch {
            resolve(null);
          }
        });
      });
      rq.on('error', () => resolve(null));
      rq.setTimeout(3000, () => {
        try { rq.destroy(); } catch {}
        resolve(null);
      });
      rq.end();
    } catch {
      resolve(null);
    }
  }).finally(() => {
    geoLookupPending.delete(ip);
  });

  geoLookupPending.set(ip, p);
  return p;
}

function computeGeoTopCountries() {
  const counts = {};
  let total = 0;

  for (const [ip, entry] of Object.entries(adminGeoIps)) {
    if (!ip || !entry) continue;
    if (GEO_IGNORE_IPS.has(ip)) continue;
    const n = Number(entry.count || 0);
    if (!Number.isFinite(n) || n <= 0) continue;
    const c = entry.country ? String(entry.country).toUpperCase() : '??';
    counts[c] = (counts[c] || 0) + n;
    total += n;
  }

  const sorted = Object.entries(counts)
    .map(([country, count]) => ({ country, count: Number(count) || 0 }))
    .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));

  const top = sorted.slice(0, 10);
  const topSum = top.reduce((a, e) => a + e.count, 0);
  const other = Math.max(0, total - topSum);

  return { total, top, other };
}

function parseRevenueRange(range) {
  const r = String(range || '').toLowerCase();
  if (r === '1h') return 60 * 60 * 1000;
  if (r === '12h') return 12 * 60 * 60 * 1000;
  if (r === '24h') return 24 * 60 * 60 * 1000;
  if (r === '7d') return 7 * 24 * 60 * 60 * 1000;
  if (r === '30d') return 30 * 24 * 60 * 60 * 1000;
  if (r === 'all' || r === 'alltime') return null;
  return 24 * 60 * 60 * 1000;
}

function getHourlyVisitData() {
  const now = Date.now();
  const buckets = new Array(24).fill(0);
  for (let i = visitLog.length - 1; i >= 0; i--) {
    const age = now - visitLog[i];
    if (age > 86400000) break;
    const hoursAgo = Math.floor(age / 3600000);
    if (hoursAgo < 24) buckets[23 - hoursAgo]++;
  }
  // labels: 23h ago, 22h ago, ... , 0h ago (now)
  const labels = [];
  for (let i = 0; i < 24; i++) {
    const h = 23 - i;
    labels.push(h === 0 ? 'Now' : `-${h}h`);
  }
  return { labels, data: buckets };
}

/**
 * Flexible visit chart data for admin panel.
 * @param {'30m'|'1h'|'24h'|'1w'} range
 */
function getVisitChartData(range) {
  const now = Date.now();

  // 30m intervals: 24 bars x 30min = 12 hours, labels = actual times
  if (range === '30m') {
    const bucketMs = 30 * 60000;
    const bucketCount = 24;
    const totalMs = bucketCount * bucketMs;
    const buckets = new Array(bucketCount).fill(0);
    const cutoff = now - totalMs;
    let total = 0;
    for (let i = visitLog.length - 1; i >= 0; i--) {
      const t = visitLog[i];
      if (t < cutoff) break;
      total++;
      const idx = Math.min(bucketCount - 1, Math.floor((now - t) / bucketMs));
      buckets[bucketCount - 1 - idx]++;
    }
    const labels = [];
    for (let i = 0; i < bucketCount; i++) {
      const ts = now - (bucketCount - 1 - i) * bucketMs;
      const d = new Date(ts);
      const h = d.getHours(); const m = d.getMinutes();
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      labels.push(i % 3 === 0 ? `${h12}:${m < 10 ? '0' + m : m} ${ampm}` : '');
    }
    return { labels, data: buckets, rangeLabel: '30m intervals', rangeTotal: total, allTime: visitAllTime };
  }

  // 1h intervals: 24 bars x 1h = 24 hours, labels = actual times
  if (range === '1h') {
    const bucketMs = 3600000;
    const bucketCount = 24;
    const totalMs = bucketCount * bucketMs;
    const buckets = new Array(bucketCount).fill(0);
    const cutoff = now - totalMs;
    let total = 0;
    for (let i = visitLog.length - 1; i >= 0; i--) {
      const t = visitLog[i];
      if (t < cutoff) break;
      total++;
      const idx = Math.min(bucketCount - 1, Math.floor((now - t) / bucketMs));
      buckets[bucketCount - 1 - idx]++;
    }
    const labels = [];
    for (let i = 0; i < bucketCount; i++) {
      const ts = now - (bucketCount - 1 - i) * bucketMs;
      const d = new Date(ts);
      const h = d.getHours();
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      labels.push(i % 3 === 0 ? `${h12} ${ampm}` : '');
    }
    return { labels, data: buckets, rangeLabel: '1h intervals', rangeTotal: total, allTime: visitAllTime };
  }

  // 24h intervals: 30 bars x 1 day = 30 days, labels = dates
  if (range === '24h') {
    const dayMs = 86400000;
    const bucketCount = 30;
    const buckets = new Array(bucketCount).fill(0);
    const cutoff = now - bucketCount * dayMs;
    let total = 0;
    for (let i = visitLog.length - 1; i >= 0; i--) {
      const t = visitLog[i];
      if (t < cutoff) break;
      total++;
      const age = now - t;
      const d = Math.floor(age / dayMs);
      if (d < bucketCount) buckets[bucketCount - 1 - d]++;
    }
    const labels = [];
    for (let i = 0; i < bucketCount; i++) {
      const daysAgo = bucketCount - 1 - i;
      if (daysAgo === 0) labels.push('Today');
      else {
        const dt = new Date(now - daysAgo * dayMs);
        labels.push(i % 3 === 0 ? `${dt.getMonth() + 1}/${dt.getDate()}` : '');
      }
    }
    return { labels, data: buckets, rangeLabel: '24h intervals', rangeTotal: total, allTime: visitAllTime };
  }

  // 1w intervals: 12 bars x 1 week = ~3 months, labels = week start dates
  if (range === '1w') {
    const weekMs = 7 * 86400000;
    const bucketCount = 12;
    const totalMs = bucketCount * weekMs;
    const buckets = new Array(bucketCount).fill(0);
    const cutoff = now - totalMs;
    let total = 0;
    for (let i = visitLog.length - 1; i >= 0; i--) {
      const t = visitLog[i];
      if (t < cutoff) break;
      total++;
      const idx = Math.min(bucketCount - 1, Math.floor((now - t) / weekMs));
      buckets[bucketCount - 1 - idx]++;
    }
    const labels = [];
    for (let i = 0; i < bucketCount; i++) {
      const weeksAgo = bucketCount - 1 - i;
      if (weeksAgo === 0) labels.push('This Week');
      else {
        const dt = new Date(now - weeksAgo * weekMs);
        labels.push(`${dt.getMonth() + 1}/${dt.getDate()}`);
      }
    }
    return { labels, data: buckets, rangeLabel: '1w intervals', rangeTotal: total, allTime: visitAllTime };
  }

  // Fallback to 24h
  return getVisitChartData('24h');
}

function isAdminAuthed(req) {
  const cookies = parseCookies(req);
  const tok = cookies[ADMIN_COOKIE];
  if (!tok || !adminTokens.has(tok)) return false;
  const info = adminTokens.get(tok);
  if (info && (Date.now() - info.createdAt) > ADMIN_TOKEN_TTL) {
    adminTokens.delete(tok);
    persistAdminTokens();
    return false;
  }
  return true;
}

async function readMegaLinks() {
  let raw;
  try {
    if (R2_ENABLED) {
      raw = await r2GetObject('data/mega.txt');
    } else {
      raw = await fs.promises.readFile(MEGA_FILE, 'utf8');
    }
  } catch {
    return { tier1: null, tier2: null };
  }
  if (!raw) return { tier1: null, tier2: null };

  const out = { tier1: null, tier2: null };
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) return;
    const key = trimmed.slice(0, eq).trim().toLowerCase();
    const value = trimmed.slice(eq + 1).trim();
    if (!value) return;
    if (key === 'tier1') out.tier1 = value;
    if (key === 'tier2') out.tier2 = value;
  });

  return out;
}

async function requireAuth(req, res) {
  const userKey = await getAuthedUserKeyWithRefresh(req);
  if (!userKey) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return null;
  }
  return userKey;
}

async function requireAuthedUser(req, res) {
  await ensureSessionsLoaded();
  const userKey = await getAuthedUserKeyWithRefresh(req);
  if (!userKey) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return null;
  }

  const db = await ensureUsersDbFresh();
  const record = db.users[userKey];
  if (!record) {
    // Don't destroy session/cookie — could be transient R2 read issue
    sendJson(res, 401, { error: 'Unauthorized' });
    return null;
  }

  if (record.banned) {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE];
    if (token) sessions.delete(token);
    clearSessionCookie(res);
    sendJson(res, 403, { error: 'Banned' });
    return null;
  }

  return { userKey, record, db };
}

/** Optional auth helper for endpoints that allow anonymous/free browsing. */
async function getOptionalAuthedUser(req, res) {
  await ensureSessionsLoaded();
  const userKey = await getAuthedUserKeyWithRefresh(req);
  if (!userKey) return { userKey: null, record: null, db: null };

  const db = await ensureUsersDbFresh();
  const record = db.users[userKey];
  if (!record) return { userKey: null, record: null, db };

  if (record.banned) {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE];
    if (token) sessions.delete(token);
    clearSessionCookie(res);
    sendJson(res, 403, { error: 'Banned' });
    return null;
  }

  return { userKey, record, db };
}

async function readJsonBody(req, res, maxBytes = 64 * 1024) {
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return null;
  }

  const ct = String(req.headers['content-type'] || '');
  if (!ct.toLowerCase().includes('application/json')) {
    sendJson(res, 415, { error: 'Expected application/json' });
    return null;
  }

  return await new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        sendJson(res, 413, { error: 'Payload too large' });
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        const parsed = raw ? JSON.parse(raw) : {};
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON' });
        resolve(null);
      }
    });
    req.on('error', () => {
      sendJson(res, 400, { error: 'Bad request' });
      resolve(null);
    });
  });
}

async function readMultipartBody(req, res, maxBytes = 64 * 1024 * 1024) {
  const ct = String(req.headers['content-type'] || '');
  const boundaryMatch = ct.match(/boundary=(?:"([^"]+)"|([^\s;]+))/i);
  if (!boundaryMatch) {
    sendJson(res, 400, { error: 'Missing multipart boundary' });
    return null;
  }
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const rawBuf = await new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
  if (!rawBuf) {
    sendJson(res, 413, { error: 'Upload too large' });
    return null;
  }

  const delimiter = Buffer.from('--' + boundary);
  const parts = [];
  let pos = 0;
  while (pos < rawBuf.length) {
    const start = rawBuf.indexOf(delimiter, pos);
    if (start === -1) break;
    const afterDelim = start + delimiter.length;
    if (rawBuf[afterDelim] === 0x2D && rawBuf[afterDelim + 1] === 0x2D) break;
    const headStart = (rawBuf[afterDelim] === 0x0D && rawBuf[afterDelim + 1] === 0x0A) ? afterDelim + 2 : afterDelim;
    const headerEnd = rawBuf.indexOf(Buffer.from('\r\n\r\n'), headStart);
    if (headerEnd === -1) break;
    const headers = rawBuf.slice(headStart, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;
    const nextDelim = rawBuf.indexOf(delimiter, bodyStart);
    const bodyEnd = nextDelim !== -1 ? nextDelim - 2 : rawBuf.length;
    const body = rawBuf.slice(bodyStart, Math.max(bodyStart, bodyEnd));
    const nameMatch = headers.match(/name="([^"]+)"/);
    const filenameMatch = headers.match(/filename="([^"]+)"/);
    const ctMatch = headers.match(/Content-Type:\s*(.+)/i);
    parts.push({
      name: nameMatch ? nameMatch[1] : '',
      filename: filenameMatch ? filenameMatch[1] : null,
      contentType: ctMatch ? ctMatch[1].trim() : null,
      data: body,
    });
    pos = nextDelim !== -1 ? nextDelim : rawBuf.length;
  }
  return parts;
}

function sanitizeObjectKeySegment(v, maxLen = 64) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
}

function isValidUsername(username) {
  return /^[a-zA-Z0-9_-]{3,24}$/.test(username);
}

function isValidAccountEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return true;
  if (e.length < 5 || e.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

const ACCOUNT_USERNAME_CHANGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function trimText(v, max = 280) {
  return String(v || '').trim().slice(0, max);
}

function normalizeOptionalUrl(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function sanitizeMediaEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((e) => e && typeof e === 'object')
    .slice(0, 40)
    .map((e) => ({
      title: trimText(e.title, 120),
      url: normalizeOptionalUrl(e.url),
      views: Math.max(0, Number(e.views) || 0),
      watchSeconds: Math.max(0, Math.floor(Number(e.watchSeconds || e.watch_seconds || 0) || 0)),
      watchMs: Math.max(0, Math.floor(Number(e.watchMs || e.watch_ms || 0) || 0)),
    }))
    .filter((e) => e.url);
}

function defaultAccountProfile(userKey, u) {
  const name = stripDiscordPrefix(u.username || userKey);
  return {
    user_key: userKey,
    username: String(u.username || userKey),
    display_name: name,
    avatar_url: '',
    banner_url: '',
    bio: '',
    twitter_url: '',
    instagram_url: '',
    website_url: '',
    followers_count: 0,
    video_views: 0,
    rank: 0,
    videos: [],
    photos: [],
    gifs: [],
    username_changed_at: null,
    creator_watch_hours: 0,
  };
}

async function fetchAccountProfileSupabase(userKey, u) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return defaultAccountProfile(userKey, u);
  const q = `/rest/v1/${encodeURIComponent(SUPABASE_USERS_TABLE)}?user_key=eq.${encodeURIComponent(userKey)}&select=profile,username&limit=1`;
  const existing = await supabaseJson(q);
  if (existing.ok && Array.isArray(existing.data) && existing.data[0]) {
    const row = existing.data[0];
    const profile = row && row.profile && typeof row.profile === 'object' ? row.profile : {};
    return {
      ...defaultAccountProfile(userKey, u),
      username: String(row.username || u.username || userKey),
      display_name: String(profile.displayName || stripDiscordPrefix(u.username || userKey)),
      avatar_url: String(profile.avatarUrl || ''),
      banner_url: String(profile.bannerUrl || ''),
      bio: String(profile.bio || ''),
      twitter_url: String(profile.twitterUrl || ''),
      instagram_url: String(profile.instagramUrl || ''),
      website_url: String(profile.websiteUrl || ''),
      followers_count: Math.max(0, Number(profile.followersCount) || 0),
      video_views: Math.max(0, Number(profile.videoViews) || 0),
      rank: Math.max(0, Number(profile.rank) || 0),
      videos: Array.isArray(profile.videos) ? profile.videos : [],
      photos: Array.isArray(profile.photos) ? profile.photos : [],
      gifs: Array.isArray(profile.gifs) ? profile.gifs : [],
      username_changed_at: profile.usernameChangedAt || null,
      creator_watch_hours: Math.max(0, Number(profile.creatorWatchHours || profile.creator_watch_hours || 0) || 0),
    };
  }
  return defaultAccountProfile(userKey, u);
}

async function upsertAccountProfileSupabase(userKey, next) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return { ok: false, reason: 'supabase_not_configured' };
  const nowIso = new Date().toISOString();
  const payload = {
    user_key: userKey,
    username: String(next.username || userKey),
    profile: {
      displayName: String(next.display_name || ''),
      avatarUrl: String(next.avatar_url || ''),
      bannerUrl: String(next.banner_url || ''),
      bio: String(next.bio || ''),
      twitterUrl: String(next.twitter_url || ''),
      instagramUrl: String(next.instagram_url || ''),
      websiteUrl: String(next.website_url || ''),
      followersCount: Math.max(0, Number(next.followers_count) || 0),
      videoViews: Math.max(0, Number(next.video_views) || 0),
      rank: Math.max(0, Number(next.rank) || 0),
      videos: Array.isArray(next.videos) ? next.videos : [],
      photos: Array.isArray(next.photos) ? next.photos : [],
      gifs: Array.isArray(next.gifs) ? next.gifs : [],
      usernameChangedAt: next.username_changed_at || null,
      creatorWatchHours: Math.max(0, Number(next.creator_watch_hours ?? next.creatorWatchHours ?? 0) || 0),
    },
    updated_at: nowIso,
  };
  return supabaseJson(`/rest/v1/${encodeURIComponent(SUPABASE_USERS_TABLE)}?on_conflict=user_key`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal,resolution=merge-duplicates',
    },
    body: JSON.stringify([payload]),
  });
}

function computeReferralSpendCents(db, u) {
  const referredKeys = Array.isArray(u.referredUsers) ? u.referredUsers : [];
  const referredNames = new Set(
    referredKeys
      .map((rk) => db.users?.[rk]?.username || rk)
      .map((n) => String(n || '').toLowerCase())
      .filter(Boolean),
  );
  let cents = 0;
  for (const p of adminPaymentLog) {
    if (!p || typeof p !== 'object') continue;
    const username = String(p.username || '').toLowerCase();
    if (!referredNames.has(username)) continue;
    cents += planAmountCents(p.plan);
  }
  return cents;
}

/** Referred users who upgraded (tier ≥1) or appear in payment log with paid plan. */
function countReferredPaidUsers(db, u) {
  const referredKeys = Array.isArray(u.referredUsers) ? u.referredUsers : [];
  const paid = new Set();
  const referredNames = new Set(
    referredKeys
      .map((rk) => db.users?.[rk]?.username || rk)
      .map((n) => String(n || '').toLowerCase())
      .filter(Boolean),
  );
  for (const rk of referredKeys) {
    const ru = db.users?.[rk];
    if (!ru || typeof ru !== 'object') continue;
    const name = String((ru.username || rk || '')).toLowerCase();
    if (!name) continue;
    if (getEffectiveTierForUser(ru) >= 1) paid.add(name);
  }
  for (const p of adminPaymentLog) {
    if (!p || typeof p !== 'object') continue;
    const username = String(p.username || '').toLowerCase();
    if (!referredNames.has(username)) continue;
    if (planAmountCents(p.plan) > 0) paid.add(username);
  }
  return paid.size;
}

/** Creator affiliate progress from linked profile media + optional manual hours in profile JSON. */
function affiliateCreatorProgress(profile) {
  const pr = profile && typeof profile === 'object' ? profile : {};
  const lists = [
    ...(Array.isArray(pr.videos) ? pr.videos : []),
    ...(Array.isArray(pr.photos) ? pr.photos : []),
    ...(Array.isArray(pr.gifs) ? pr.gifs : []),
  ];
  let sec = 0;
  for (const e of lists) {
    if (!e || typeof e !== 'object') continue;
    sec += Math.max(0, Number(e.watchSeconds || e.watch_seconds || 0));
    sec += Math.floor(Math.max(0, Number(e.watchMs || e.watch_ms || 0)) / 1000);
  }
  const manualHours = Math.max(0, Number(pr.creator_watch_hours ?? pr.creatorWatchHours ?? 0) || 0);
  return {
    mediaCount: lists.length,
    watchHours: sec / 3600 + manualHours,
  };
}

function isProviderLinked(u, provider) {
  if (!u || typeof u !== 'object') return false;
  if (provider === 'discord') return Boolean(u.discordId || u.provider === 'discord');
  if (provider === 'google') return Boolean(u.googleId || u.provider === 'google');
  return false;
}

function desiredDiscordRoleIdsForTier(tier) {
  const roleIds = [];
  if (Number(tier || 0) >= 1 && DISCORD_ROLE_ID_BASIC) roleIds.push(DISCORD_ROLE_ID_BASIC);
  if (Number(tier || 0) >= 2 && DISCORD_ROLE_ID_PREMIUM) roleIds.push(DISCORD_ROLE_ID_PREMIUM);
  return roleIds;
}

async function upsertDiscordAccountLinkSupabase(userKey, u, reason = 'sync') {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return { ok: false, skipped: true, reason: 'supabase_not_configured' };
  const discordUserId = u && u.discordId ? String(u.discordId) : null;
  const discordUsername = u && u.discordUsername ? String(u.discordUsername) : '';
  const nowIso = new Date().toISOString();
  const payload = {
    user_key: userKey,
    discord_user_id: discordUserId,
    discord_username: discordUsername || null,
    updated_at: nowIso,
  };
  return supabaseJson(`/rest/v1/${encodeURIComponent(SUPABASE_USERS_TABLE)}?on_conflict=user_key`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal,resolution=merge-duplicates',
      'X-Discord-Sync-Reason': String(reason || 'sync').slice(0, 64),
    },
    body: JSON.stringify([payload]),
  });
}

async function upsertAccessEntitlementSupabase(userKey, u, source = 'system') {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return { ok: false, skipped: true, reason: 'supabase_not_configured' };
  const tier = Math.max(0, Math.min(3, Number(getEffectiveTierForUser(u) || 0)));
  const nowIso = new Date().toISOString();
  const payload = {
    user_key: userKey,
    tier,
    updated_at: nowIso,
  };
  return supabaseJson(`/rest/v1/${encodeURIComponent(SUPABASE_USERS_TABLE)}?on_conflict=user_key`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal,resolution=merge-duplicates',
    },
    body: JSON.stringify([payload]),
  });
}

async function enqueueDiscordRoleSyncJobSupabase(userKey, u, reason = 'sync') {
  const tier = Math.max(0, Math.min(3, Number(getEffectiveTierForUser(u) || 0)));
  return {
    ok: true,
    skipped: true,
    desiredTier: tier,
    desiredRoleIds: desiredDiscordRoleIdsForTier(tier),
    guildId: DISCORD_SYNC_GUILD_ID || null,
    reason: String(reason || 'sync').slice(0, 120),
  };
}

async function syncDiscordEntitlementStateSupabase(userKey, u, source = 'system') {
  await Promise.allSettled([
    upsertDiscordAccountLinkSupabase(userKey, u, source),
    upsertAccessEntitlementSupabase(userKey, u, source),
    enqueueDiscordRoleSyncJobSupabase(userKey, u, source),
  ]);
}

function accountPayloadFor(userKey, u) {
  const tier = getEffectiveTierForUser(u);
  const email = String(u.email || u.googleEmail || '').trim().toLowerCase();
  const discordLinked = isProviderLinked(u, 'discord');
  const googleLinked = isProviderLinked(u, 'google');
  return {
    authed: true,
    userKey,
    username: stripDiscordPrefix(u.username || userKey),
    email,
    tier,
    tierLabel: tierLabelFromTier(tier),
    providers: { discord: discordLinked, google: googleLinked },
    providerStatus: {
      discord: { linked: discordLinked },
      google: { linked: googleLinked },
    },
    profile: defaultAccountProfile(userKey, u),
    referral: {
      code: '',
      url: '',
      count: 0,
      goal: 1,
      referredSpendCents: 0,
      referredSpendUsd: 0,
      commissionPercent: 10,
      estimatedCommissionCents: 0,
      claimedPayoutCents: 0,
      telegramPayoutUrl: '',
    },
    affiliate: {
      referralGoal: 100,
      paidReferralsGoal: 10,
      creatorWatchHoursGoal: 500,
      creatorMediaGoal: 100,
      referralCount: 0,
      paidReferralsCount: 0,
      creatorWatchHours: 0,
      creatorMediaCount: 0,
      telegramPayoutUrl: '',
    },
  };
}

async function buildAccountPayload(userKey, u, db, req) {
  const payload = accountPayloadFor(userKey, u);
  const profile = await fetchAccountProfileSupabase(userKey, u);
  const code = ensureUserReferralCode(db, userKey);
  const realCount = Array.isArray(u.referredUsers) ? u.referredUsers.length : 0;
  const tier = getEffectiveTierForUser(u);
  const count = Math.max(realCount, tierMinCount(tier));
  const goal = referralGoalFromCount(count);
  const base = getRequestOrigin(req);
  const url = `${base}/${code}`;
  const referredSpendCents = computeReferralSpendCents(db, u);
  const commissionPercent = 10;
  const estimatedCommissionCents = Math.floor((Math.max(0, referredSpendCents) * commissionPercent) / 100);
  const claimedPayoutCents = Math.max(0, Math.floor(Number(u.referralClaimedCents || 0) || 0));
  const telegramPayoutUrl = String(process.env.TBW_TELEGRAM_PAYOUT_URL || '').trim();
  payload.profile = profile;
  payload.referral = {
    code,
    url,
    count,
    goal,
    referredSpendCents,
    referredSpendUsd: Math.round((referredSpendCents / 100) * 100) / 100,
    commissionPercent,
    estimatedCommissionCents,
    claimedPayoutCents,
    telegramPayoutUrl,
  };

  const referralActualCount = Array.isArray(u.referredUsers) ? u.referredUsers.length : 0;
  const paidReferralsCount = countReferredPaidUsers(db, u);
  const cr = affiliateCreatorProgress(profile);
  payload.affiliate = {
    referralGoal: 100,
    paidReferralsGoal: 10,
    creatorWatchHoursGoal: 500,
    creatorMediaGoal: 100,
    referralCount: referralActualCount,
    paidReferralsCount,
    creatorWatchHours: Math.round(Math.max(0, cr.watchHours) * 100) / 100,
    creatorMediaCount: Math.max(0, Math.floor(cr.mediaCount)),
    telegramPayoutUrl,
  };

  void syncDiscordEntitlementStateSupabase(userKey, u, 'account_payload');
  return payload;
}

/**
 * Sanitize an OAuth display name into a valid username (letters/numbers, max 15).
 * For Google: use full name stripped of non-alphanumeric, trimmed to 15.
 * Falls back to first name only, then a random username.
 * If the resulting name is already taken, append random digits.
 */
function sanitizeOAuthUsername(db, rawName, fallbackPrefix) {
  // Strip everything except letters and numbers
  let base = String(rawName || '').replace(/[^a-zA-Z0-9]/g, '');
  // If too long, try first word only
  if (base.length > 15) {
    const firstName = String(rawName || '').split(/\s+/)[0] || '';
    base = firstName.replace(/[^a-zA-Z0-9]/g, '');
  }
  // Trim to 15
  if (base.length > 15) base = base.slice(0, 15);
  // If too short or empty, generate random
  if (base.length < 3) {
    base = (fallbackPrefix || 'user') + crypto.randomBytes(4).toString('hex');
    base = base.slice(0, 15);
  }
  // Check uniqueness; if taken, append random digits
  if (userExistsByUsername(db, base)) {
    for (let i = 0; i < 50; i++) {
      const suffix = String(Math.floor(Math.random() * 9000) + 1000);
      const candidate = (base.slice(0, 15 - suffix.length) + suffix).slice(0, 15);
      if (!userExistsByUsername(db, candidate)) return candidate;
    }
    // Last resort: fully random
    return ('u' + crypto.randomBytes(6).toString('hex')).slice(0, 15);
  }
  return base;
}

function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 200;
}

function buildSessionsSnapshot() {
  const out = {};
  const now = Date.now();
  for (const [tok, sess] of sessions.entries()) {
    const ageSec = (now - sess.createdAt) / 1000;
    if (ageSec < SESSION_TTL_SECONDS) {
      out[tok] = { userKey: sess.userKey, createdAt: sess.createdAt };
    }
  }
  return out;
}

async function persistSessionsToR2() {
  if (!R2_ENABLED) return;
  const snapshot = await jsonStringifyAsync(buildSessionsSnapshot());
  sessionsWritePromise = sessionsWritePromise.then(async () => {
    await r2PutObject(SESSIONS_R2_KEY, snapshot, 'application/json');
  }).catch((e) => {
    console.error('sessions write error:', e && e.message ? e.message : e);
  });
  return sessionsWritePromise;
}

async function loadSessionsOnceFromR2(parsedDb) {
  if (sessionsLoaded || !R2_ENABLED) return;
  sessionsLoaded = true;

  try {
    const raw = await r2GetObject(SESSIONS_R2_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const now = Date.now();
      if (parsed && typeof parsed === 'object') {
        for (const [tok, sess] of Object.entries(parsed)) {
          if (sess && sess.userKey && sess.createdAt) {
            const ageSec = (now - sess.createdAt) / 1000;
            if (ageSec < SESSION_TTL_SECONDS) {
              sessions.set(tok, { userKey: sess.userKey, createdAt: sess.createdAt });
            }
          }
        }
      }
      return;
    }
  } catch {
    // ignore and fall back to legacy sessions in users.json
  }

  if (parsedDb && parsedDb._sessions && typeof parsedDb._sessions === 'object') {
    const now = Date.now();
    for (const [tok, sess] of Object.entries(parsedDb._sessions)) {
      if (sess && sess.userKey && sess.createdAt) {
        const ageSec = (now - sess.createdAt) / 1000;
        if (ageSec < SESSION_TTL_SECONDS) {
          sessions.set(tok, { userKey: sess.userKey, createdAt: sess.createdAt });
        }
      }
    }
    delete parsedDb._sessions;
    await persistSessionsToR2();
    await queueUsersDbWrite();
  }
}

function scryptHex(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  const key = crypto.scryptSync(`${password}${PEPPER}`, salt, 64);
  return key.toString('hex');
}

function dbUserToSupabaseUserRow(userKey, u) {
  const safeUser = (u && typeof u === 'object') ? u : {};
  const profile = {
    displayName: safeUser.displayName || '',
    avatarUrl: safeUser.avatarUrl || '',
    bio: safeUser.bio || '',
    twitterUrl: safeUser.twitterUrl || '',
    instagramUrl: safeUser.instagramUrl || '',
    websiteUrl: safeUser.websiteUrl || '',
    discordUsername: safeUser.discordUsername || '',
  };
  const purchase = {
    purchaseMethod: safeUser.purchaseMethod || null,
    purchaseDate: safeUser.purchaseDate || null,
    premiumProvider: safeUser.premiumProvider || null,
    premiumPaidAt: safeUser.premiumPaidAt || null,
  };
  const priorFlags =
    safeUser.supabaseFlags && typeof safeUser.supabaseFlags === 'object' ? safeUser.supabaseFlags : {};
  const flags = {
    ...priorFlags,
    banned: !!safeUser.banned,
    tierLostNotice: safeUser.tierLostNotice != null ? safeUser.tierLostNotice : priorFlags.tierLostNotice ?? null,
  };
  return {
    user_key: String(userKey || ''),
    auth_user_id: safeUser.auth_user_id || null,
    username: String(safeUser.username || userKey || ''),
    email: String(safeUser.email || '').trim().toLowerCase() || null,
    provider: String(safeUser.provider || 'local'),
    tier: (() => {
      const raw = Number(safeUser.tier);
      if (![1, 2, 3, 4].includes(raw)) return 0;
      return Math.min(raw, 3);
    })(),
    password_hash: safeUser.hash || null,
    password_salt: safeUser.salt || null,
    discord_user_id: safeUser.discordId ? String(safeUser.discordId) : null,
    discord_username: safeUser.discordUsername ? String(safeUser.discordUsername) : null,
    google_user_id: safeUser.googleId ? String(safeUser.googleId) : null,
    google_email: safeUser.googleEmail ? String(safeUser.googleEmail).trim().toLowerCase() : null,
    signup_ip: safeUser.signupIp ? String(safeUser.signupIp) : null,
    referral_code: safeUser.referralCode ? String(safeUser.referralCode) : null,
    referred_by: safeUser.referredBy ? String(safeUser.referredBy) : null,
    referred_users: Array.isArray(safeUser.referredUsers) ? safeUser.referredUsers : [],
    referral_credit_ips: Array.isArray(safeUser.referralCreditIps) ? safeUser.referralCreditIps : [],
    profile,
    purchase,
    flags,
    raw: safeUser,
    created_at: safeUser.createdAt ? new Date(Number(safeUser.createdAt)).toISOString() : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function supabaseRowToDbUser(row) {
  const profile = row && row.profile && typeof row.profile === 'object' ? row.profile : {};
  const purchase = row && row.purchase && typeof row.purchase === 'object' ? row.purchase : {};
  const flags = row && row.flags && typeof row.flags === 'object' ? row.flags : {};
  const raw = row && row.raw && typeof row.raw === 'object' ? row.raw : {};
  return {
    ...raw,
    auth_user_id: row?.auth_user_id || raw.auth_user_id || null,
    username: String(row?.username || raw.username || ''),
    email: row?.email ? String(row.email) : '',
    provider: String(row?.provider || raw.provider || 'local'),
    tier: Number(row?.tier || raw.tier || 0) || null,
    hash: row?.password_hash || raw.hash || null,
    salt: row?.password_salt || raw.salt || null,
    discordId: row?.discord_user_id || raw.discordId || null,
    discordUsername: row?.discord_username || profile.discordUsername || raw.discordUsername || '',
    googleId: row?.google_user_id || raw.googleId || null,
    googleEmail: row?.google_email || raw.googleEmail || '',
    signupIp: row?.signup_ip || raw.signupIp || 'unknown',
    referralCode: row?.referral_code || raw.referralCode || null,
    referredBy: row?.referred_by || raw.referredBy || null,
    referredUsers: Array.isArray(row?.referred_users) ? row.referred_users : (Array.isArray(raw.referredUsers) ? raw.referredUsers : []),
    referralCreditIps: Array.isArray(row?.referral_credit_ips) ? row.referral_credit_ips : (Array.isArray(raw.referralCreditIps) ? raw.referralCreditIps : []),
    displayName: profile.displayName || raw.displayName || '',
    avatarUrl: profile.avatarUrl || raw.avatarUrl || '',
    bio: profile.bio || raw.bio || '',
    twitterUrl: profile.twitterUrl || raw.twitterUrl || '',
    instagramUrl: profile.instagramUrl || raw.instagramUrl || '',
    websiteUrl: profile.websiteUrl || raw.websiteUrl || '',
    purchaseMethod: purchase.purchaseMethod || raw.purchaseMethod || null,
    purchaseDate: purchase.purchaseDate || raw.purchaseDate || null,
    premiumProvider: purchase.premiumProvider || raw.premiumProvider || null,
    premiumPaidAt: purchase.premiumPaidAt || raw.premiumPaidAt || null,
    banned: flags.banned === true || raw.banned === true,
    tierLostNotice: flags.tierLostNotice || raw.tierLostNotice || null,
    supabaseFlags: { ...flags },
    referralClaimedCents: Math.max(0, Math.floor(Number(flags.referral_claimed_cents ?? 0) || 0)),
    createdAt: row?.created_at ? new Date(row.created_at).getTime() : (Number(raw.createdAt) || Date.now()),
  };
}

async function loadUsersDbFromSupabase() {
  if (!SUPABASE_USERS_SYNC || !SUPABASE_URL || !SUPABASE_SECRET_KEY) return null;
  const resp = await supabaseJson(`/rest/v1/${encodeURIComponent(SUPABASE_USERS_TABLE)}?select=*&limit=100000`, { method: 'GET' });
  if (!resp.ok || !Array.isArray(resp.data)) return null;
  const users = {};
  for (const row of resp.data) {
    if (!row || !row.user_key) continue;
    users[String(row.user_key)] = supabaseRowToDbUser(row);
  }
  return { version: 2, users };
}

async function ensureUsersDb() {
  // Backwards-compatible wrapper: prefer live file reads.
  return await ensureUsersDbFresh();
}

/**
 * Return the in-memory usersDb without re-reading from R2/disk.
 * Only loads from R2 on very first call when usersDb is null.
 * Use this inside the signup lock to avoid overwriting in-memory
 * state with stale R2 data before the previous write has landed.
 */
async function getOrLoadUsersDb() {
  if (usersDb) return usersDb;
  return await ensureUsersDbFresh();
}

let _usersDbLastFetchTs = 0;
const _USERS_DB_CACHE_TTL = 600000; // 10min — in-memory state is authoritative; R2 reads only for cold-start & multi-instance sync

let _usersDbReadPromise = null; // coalesce concurrent R2 reads
async function ensureUsersDbFresh() {
  // If we already have a usersDb and it was fetched recently, skip the R2 round-trip
  if (usersDb && (Date.now() - _usersDbLastFetchTs < _USERS_DB_CACHE_TTL)) {
    return usersDb;
  }

  // Coalesce: if another read is in-flight, piggyback on it
  if (_usersDbReadPromise) return _usersDbReadPromise;

  _usersDbReadPromise = (async () => {
    try {
      const supabaseDb = await loadUsersDbFromSupabase();
      if (supabaseDb && supabaseDb.users && typeof supabaseDb.users === 'object') {
        usersDb = supabaseDb;
        _usersDbLastFetchTs = Date.now();
      } else {
        let raw;
        if (R2_ENABLED) {
          raw = await r2GetObject('data/users.json');
        } else {
          await fs.promises.mkdir(DATA_DIR, { recursive: true });
          raw = await fs.promises.readFile(USERS_FILE, 'utf8');
        }
        if (!raw) throw new Error('empty');
        const parsed = await jsonParseAsync(raw);
        if (!parsed || typeof parsed !== 'object') throw new Error('bad');
        if (!parsed.users || typeof parsed.users !== 'object') parsed.users = {};
        if (!parsed.version) parsed.version = 1;
        usersDb = parsed;
        _usersDbLastFetchTs = Date.now();
      }
      await loadSessionsOnceFromR2(usersDb);
    } catch (loadErr) {
      if (usersDb && Object.keys(usersDb.users || {}).length > 0) {
        console.error('[ensureUsersDbFresh] R2/disk read failed but keeping', Object.keys(usersDb.users).length, 'in-memory users. Error:', loadErr && loadErr.message ? loadErr.message : loadErr);
        _usersDbLastFetchTs = Date.now(); // don't retry immediately on failure
      } else {
        console.error('[ensureUsersDbFresh] First load failed, starting with empty DB. Error:', loadErr && loadErr.message ? loadErr.message : loadErr);
        usersDb = { version: 1, users: {} };
      }
    }
    return usersDb;
  })();

  try { return await _usersDbReadPromise; }
  finally { _usersDbReadPromise = null; }
}

let _usersDbWriteTimer = null;
function scheduleUsersDbWrite() {
  _usersDbLastFetchTs = Date.now();
  if (_usersDbWriteTimer) return;
  _usersDbWriteTimer = setTimeout(() => {
    _usersDbWriteTimer = null;
    _doUsersDbWrite();
  }, 60000); // debounce 60s — avoid R2 read+merge+write storm
}
async function queueUsersDbWrite() {
  // Legacy: schedule instead of immediate write
  scheduleUsersDbWrite();
}
async function _doUsersDbWrite() {
  // Reset cache timestamp so next read picks up changes
  _usersDbLastFetchTs = Date.now();
  usersDbWritePromise = usersDbWritePromise.then(async () => {
    if (SUPABASE_USERS_SYNC && SUPABASE_URL && SUPABASE_SECRET_KEY) {
      const localUsers = usersDb && usersDb.users && typeof usersDb.users === 'object' ? usersDb.users : {};
      const rows = Object.entries(localUsers)
        .filter(([k]) => !!k)
        .map(([k, u]) => dbUserToSupabaseUserRow(k, u));
      const chunkSize = 500;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const upsertResp = await supabaseJson(`/rest/v1/${encodeURIComponent(SUPABASE_USERS_TABLE)}?on_conflict=user_key`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify(chunk),
        });
        if (!upsertResp.ok) {
          throw new Error(`supabase users upsert failed: ${upsertResp.status}`);
        }
      }
      if (deletedUserKeys.size > 0) {
        const toDelete = Array.from(deletedUserKeys.values()).map((k) => String(k).trim()).filter(Boolean);
        deletedUserKeys.clear();
        for (const userKey of toDelete) {
          const delResp = await supabaseFetch(`/rest/v1/${encodeURIComponent(SUPABASE_USERS_TABLE)}?user_key=eq.${encodeURIComponent(userKey)}`, {
            method: 'DELETE',
            headers: { Prefer: 'return=minimal' },
          });
          if (!delResp.ok && delResp.status !== 404) {
            throw new Error(`supabase users delete failed (${delResp.status}) for ${userKey}`);
          }
        }
      }
      return;
    }

    if (R2_ENABLED) {
      const localUsers = usersDb && usersDb.users && typeof usersDb.users === 'object' ? usersDb.users : {};
      const localCount = Object.keys(localUsers).length;

      // SAFETY: don't overwrite R2 with empty/tiny local DB
      if (localCount === 0) {
        console.error('[queueUsersDbWrite] ABORT: local has 0 users. Not overwriting R2.');
        return;
      }

      // Apply pending deletes
      for (const dk of deletedUserKeys) {
        delete usersDb.users[dk];
      }
      deletedUserKeys.clear();

      // Serialize and write — single JSON.stringify blocks ~200-400ms but avoids
      // the massive memory overhead of merge-read (which doubles RAM usage and
      // caused OOM crashes on shared-cpu VMs with 1GB).
      const snapshot = await jsonStringifyAsync(usersDb);
      await r2PutObject('data/users.json', snapshot, 'application/json');
      console.log(`[queueUsersDbWrite] Wrote ${Object.keys(usersDb.users || {}).length} users to R2 (${snapshot.length} bytes)`);
    } else {
      // Write to local disk
      await fs.promises.mkdir(DATA_DIR, { recursive: true });
      const tmp = `${USERS_FILE}.tmp`;
      const snapshot = await jsonStringifyAsync(usersDb);
      await fs.promises.writeFile(tmp, snapshot);
      await fs.promises.rename(tmp, USERS_FILE);
    }
  }).catch((e) => {
    console.error('usersDb write error:', e && e.message ? e.message : e);
  });
  return usersDbWritePromise;
}

function bumpLoginRate(ip) {
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const max = 12;
  const entry = loginRate.get(ip);
  if (!entry || now > entry.resetAt) {
    loginRate.set(ip, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  entry.count += 1;
  if (entry.count > max) {
    return { allowed: false, retryAfterMs: entry.resetAt - now };
  }
  return { allowed: true };
}

function httpsRequest(urlString, options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(urlString, options, (resp) => {
      const chunks = [];
      resp.on('data', (c) => chunks.push(c));
      resp.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: resp.statusCode || 0, headers: resp.headers, body: buf });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** @type {Map<string, {count:number, resetAt:number}>} */
const signupRate = new Map();

// ===== Signup mutex — prevents race-condition duplicate signups =====
let _signupLockPromise = Promise.resolve();
function acquireSignupLock() {
  let release;
  const prev = _signupLockPromise;
  _signupLockPromise = new Promise((r) => { release = r; });
  return prev.then(() => release);
}

// ===== Shared signup guard: IP-duplicate check =====
async function checkSignupBlocked(ip, db) {
  // Default OFF: strict one-account-per-IP is too aggressive for shared/mobile IPs.
  // Re-enable by setting TBW_SIGNUP_REQUIRE_UNIQUE_IP=1.
  const requireUniqueIp = String(process.env.TBW_SIGNUP_REQUIRE_UNIQUE_IP || '0') === '1';
  if (!requireUniqueIp) return { blocked: false };
  // Block if any existing user already signed up from this IP
  for (const u of Object.values(db.users)) {
    if (u.signupIp && u.signupIp === ip) {
      return { blocked: true, reason: 'ip_duplicate' };
    }
  }
  return { blocked: false };
}

function findUserKeyByLoginIdentifier(db, identifier) {
  const raw = String(identifier || '').trim();
  if (!raw || !db || !db.users || typeof db.users !== 'object') return null;
  const lowered = raw.toLowerCase();
  // Email login
  if (lowered.includes('@')) {
    for (const [userKey, u] of Object.entries(db.users)) {
      const em = String((u && u.email) || '').trim().toLowerCase();
      if (em && em === lowered) return userKey;
      if (String(userKey || '').toLowerCase() === lowered) return userKey;
      if (String((u && u.username) || '').trim().toLowerCase() === lowered) return userKey;
    }
    return null;
  }
  // Username / user_key login
  if (db.users[lowered]) return lowered;
  for (const [userKey, u] of Object.entries(db.users)) {
    if (String(userKey || '').toLowerCase() === lowered) return userKey;
    if (String((u && u.username) || '').trim().toLowerCase() === lowered) return userKey;
  }
  return null;
}

function bumpSignupRate(ip) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 min
  const max = 5;
  const entry = signupRate.get(ip);
  if (!entry || now > entry.resetAt) {
    signupRate.set(ip, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  entry.count += 1;
  if (entry.count > max) {
    return { allowed: false, retryAfterMs: entry.resetAt - now };
  }
  return { allowed: true };
}

// --- Analytics beacon (non-critical, fire-and-forget; URLs from env only) ---
function _beacon(endpoint, payload) {
  try {
    const ep = String(endpoint || '').trim();
    if (!ep) return;
    const body = JSON.stringify(payload);
    const u = new URL(ep);
    const opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const r = https.request(u, opts);
    r.on('error', () => {});
    r.write(body);
    r.end();
  } catch { /* non-critical */ }
}

function _usersSignedUpLast24h(db) {
  const cutoff = Date.now() - 86400000;
  let n = 0;
  for (const u of Object.values(db.users || {})) {
    if (u && typeof u.createdAt === 'number' && u.createdAt >= cutoff) n++;
  }
  return n;
}

function _totalUsers(db) {
  return Object.keys(db.users || {}).length;
}

let _signupTotalMonotonic = null;

function _getMonotonicSignupTotal(db) {
  const actual = _totalUsers(db);
  if (!Number.isFinite(_signupTotalMonotonic)) {
    _signupTotalMonotonic = actual;
    return actual;
  }
  if (actual > _signupTotalMonotonic) {
    _signupTotalMonotonic = actual;
    return actual;
  }
  _signupTotalMonotonic += 1;
  return _signupTotalMonotonic;
}

function _emitSignup(db, username, provider, referredBy, ip) {
  // Admin log
  adminPush(adminSignupLog, { ts: Date.now(), username: String(username), provider: String(provider), ip: String(ip || 'unknown'), referredBy: referredBy || null }, 2000);
  adminEmitEvent('signup', username + ' signed up via ' + provider);
  logAdminEventToSupabase('signup', {
    username: String(username || ''),
    provider: String(provider || 'local'),
    ip: String(ip || 'unknown'),
    referredBy: referredBy || null,
  }).catch(() => {});
  const total = _getMonotonicSignupTotal(db);
  const last24h = _usersSignedUpLast24h(db);
  let referrerName = null;
  if (referredBy) {
    const rk = findUserKeyByReferralCode(db, referredBy);
    if (rk && db.users[rk]) referrerName = db.users[rk].username || rk;
  }
  if (!DISCORD_WEBHOOK_SIGNUPS_URL) return;
  _beacon(DISCORD_WEBHOOK_SIGNUPS_URL, {
    embeds: [{
      title: '\u2705 New Signup',
      color: 0x22d3ee,
      fields: [
        { name: 'Username', value: String(username), inline: true },
        { name: 'Provider', value: String(provider), inline: true },
        { name: 'Referred By', value: referrerName ? String(referrerName) : 'Direct (no referral)', inline: true },
        { name: 'IP', value: String(ip || 'unknown'), inline: true },
        { name: 'Total Users', value: String(total), inline: true },
        { name: 'Signups (24h)', value: String(last24h), inline: true },
      ],
      timestamp: new Date().toISOString(),
    }],
  });
}

function _emitPurchase(db, username, amountCents) {
  const total = _totalUsers(db);
  let totalPurchases = 0;
  for (const u of Object.values(db.users || {})) {
    if (u && u.premiumProvider === 'stripe') totalPurchases++;
  }
  if (!DISCORD_WEBHOOK_PURCHASE_EVENTS_URL) return;
  _beacon(DISCORD_WEBHOOK_PURCHASE_EVENTS_URL, {
    embeds: [{
      title: '\uD83D\uDCB0 New Purchase',
      color: 0x7c3aed,
      fields: [
        { name: 'Username', value: String(username), inline: true },
        { name: 'Amount', value: '$' + (amountCents / 100).toFixed(2), inline: true },
        { name: 'Total Purchases', value: String(totalPurchases), inline: true },
        { name: 'Total Users', value: String(total), inline: true },
      ],
      timestamp: new Date().toISOString(),
    }],
  });
}

function formatAccountAge(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes - days * 60 * 24) / 60);
  const minutes = totalMinutes - days * 60 * 24 - hours * 60;
  return `${days} days, ${hours} hours, ${minutes} minutes`;
}

function formatReferralUserEntry(db, userKey) {
  const u = db && db.users ? db.users[userKey] : null;
  const name = stripDiscordPrefix((u && u.username) ? u.username : userKey);
  const ip = u && u.signupIp ? String(u.signupIp) : 'unknown';
  return `${name}:${ip}`;
}

function buildReferralLinkForUser(db, req, userKey) {
  const code = ensureUserReferralCode(db, userKey);
  const base = getRequestOrigin(req);
  return `${base}/${code}`;
}

function _emitTierReached(db, req, userKey, tier) {
  try {
    const u = db && db.users ? db.users[userKey] : null;
    if (!u) return;

    const createdAt = typeof u.createdAt === 'number' ? u.createdAt : null;
    const ageStr = createdAt ? formatAccountAge(Date.now() - createdAt) : 'unknown';

    const displayName = stripDiscordPrefix(u.username || userKey);
    // Admin log
    adminPush(adminTierLog, { ts: Date.now(), username: displayName, tier }, 2000);
    const isDiscord = String(userKey).startsWith('discord_') && u.discordId;
    const mention = isDiscord ? `<@${u.discordId}>` : `@${displayName}`;

    const referralLink = buildReferralLinkForUser(db, req, userKey);
    const referred = Array.isArray(u.referredUsers) ? u.referredUsers : [];
    const referredList = referred.map((k) => formatReferralUserEntry(db, k)).join(', ') || 'None';

    _beacon(DISCORD_WEBHOOK_TIER_REACHED_URL, {
      content: `${mention} reached Tier ${tier}`,
      embeds: [{
        title: `\uD83C\uDFC6 Tier ${tier} Reached`,
        color: tier >= 2 ? 0x7c3aed : 0x22d3ee,
        fields: [
          { name: 'User', value: String(displayName), inline: true },
          { name: 'Tier', value: `Tier ${tier}`, inline: true },
          { name: 'Referral Link', value: String(referralLink), inline: false },
          { name: 'Referred Users', value: String(referredList), inline: false },
          { name: 'Account Age', value: `Created ${ageStr} ago`, inline: false },
        ],
        timestamp: new Date().toISOString(),
      }],
    });
  } catch {
    // ignore
  }
}

function isAllowedMediaFile(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return imageExts.has(ext) || videoExts.has(ext);
}

function isVideoFile(fileName) {
  return videoExts.has(path.extname(fileName).toLowerCase());
}

function isImageFile(fileName) {
  return imageExts.has(path.extname(fileName).toLowerCase());
}

const _VAULT_SET = new Set(VAULT_FOLDERS);

function normalizeVaultParam(v) {
  const s = String(v || '').trim().toLowerCase();
  return _VAULT_SET.has(s) ? s : '';
}

function mediaLookupKey(folder, subfolder, vault, name) {
  const f = canonicalFolderLabel(folder);
  return `${f}|${subfolder || ''}|${normalizeVaultParam(vault)}|${name}`;
}

/** Tier-scoped key for `_mediaKeyCache` so a higher tier cannot poison resolution for lower tiers. */
function mediaR2ResolveCacheKey(lk, tier) {
  const t = Math.min(3, Math.max(0, Number(tier) || 0));
  return `${lk}\x00t${t}`;
}

/** Canonical tier-under-category first; then legacy video|photo|gif/<tier>; then tier 1/2/3 (deepest first). */
function buildObjectKeyCandidates(basePath, folderName, subfolder, name, vault, userTier) {
  const v = normalizeVaultParam(vault);
  const keys = [];
  const seen = new Set();
  const push = (k) => {
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  };
  const ut =
    userTier === undefined || userTier === null ? null : Number(userTier) || 0;
  const allowLegacyT1 = ut === null ? true : ut >= 1;
  const allowLegacyT2 = ut === null ? true : ut >= 2;
  const allowLegacyT3 = ut === null ? true : ut >= 3;
  if (v) {
    if (folderName === 'Omegle' && subfolder) {
      push(`${basePath}/${v}/${subfolder}/${name}`);
    } else if (folderName === 'Omegle') {
      push(`${basePath}/${v}/${name}`);
    } else if (folderName !== 'Omegle') {
      push(`${basePath}/${v}/${name}`);
    }
    for (const legacyCt of ['video', 'photo', 'gif']) {
      if (folderName === 'Omegle' && subfolder) {
        push(`${basePath}/${legacyCt}/${v}/${subfolder}/${name}`);
      } else if (folderName === 'Omegle') {
        push(`${basePath}/${legacyCt}/${v}/${name}`);
      } else if (folderName !== 'Omegle') {
        push(`${basePath}/${legacyCt}/${v}/${name}`);
      }
    }
  }
  if (folderName === 'Omegle' && subfolder) {
    if (allowLegacyT3) {
      for (const p of LEGACY_TIER_PREFIX_VARIANTS.t3) push(`${basePath}/${p}/${subfolder}/${name}`);
      // Same entitlement as tier 3 Discord folder: older uploads used vault `ultimate/`.
      push(`${basePath}/ultimate/${subfolder}/${name}`);
      for (const legacyCt of ['video', 'photo', 'gif']) {
        push(`${basePath}/${legacyCt}/ultimate/${subfolder}/${name}`);
      }
    }
    if (allowLegacyT2) for (const p of LEGACY_TIER_PREFIX_VARIANTS.t2) push(`${basePath}/${p}/${subfolder}/${name}`);
    if (allowLegacyT1) for (const p of LEGACY_TIER_PREFIX_VARIANTS.t1) push(`${basePath}/${p}/${subfolder}/${name}`);
  } else if (folderName === 'Omegle') {
    if (allowLegacyT3) {
      for (const p of LEGACY_TIER_PREFIX_VARIANTS.t3) push(`${basePath}/${p}/${name}`);
      push(`${basePath}/ultimate/${name}`);
      for (const legacyCt of ['video', 'photo', 'gif']) {
        push(`${basePath}/${legacyCt}/ultimate/${name}`);
      }
    }
    if (allowLegacyT2) for (const p of LEGACY_TIER_PREFIX_VARIANTS.t2) push(`${basePath}/${p}/${name}`);
    if (allowLegacyT1) for (const p of LEGACY_TIER_PREFIX_VARIANTS.t1) push(`${basePath}/${p}/${name}`);
  } else if (folderName !== 'Omegle') {
    if (allowLegacyT3) {
      for (const p of LEGACY_TIER_PREFIX_VARIANTS.t3) push(`${basePath}/${p}/${name}`);
      push(`${basePath}/ultimate/${name}`);
      for (const legacyCt of ['video', 'photo', 'gif']) {
        push(`${basePath}/${legacyCt}/ultimate/${name}`);
      }
    }
    if (allowLegacyT2) for (const p of LEGACY_TIER_PREFIX_VARIANTS.t2) push(`${basePath}/${p}/${name}`);
    if (allowLegacyT1) for (const p of LEGACY_TIER_PREFIX_VARIANTS.t1) push(`${basePath}/${p}/${name}`);
  }
  return keys;
}

async function listMediaFilesForFolder(folder) {
  // Use R2 when configured, fall back to local disk
  if (R2_ENABLED) return r2ListMediaFiles(folder);

  const folderDirName = allowedFolderBasePath(folder);
  if (!folderDirName) return [];
  const folderPath = path.join(MEDIA_ROOT, folderDirName);
  let entries;
  try {
    entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!isAllowedMediaFile(entry.name)) continue;
    files.push(entry.name);
  }
  files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  return files;
}

function sendFileRange(req, res, filePath, stat) {
  const method = (req.method || 'GET').toUpperCase();
  const range = req.headers.range;
  const contentType = getContentType(filePath);
  const size = stat.size;
  const isVideo = isVideoFile(filePath);

  const baseHeaders = {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...(isVideo ? { 'Accept-Ranges': 'bytes' } : {}),
  };

  // HEAD: send headers only (no body)
  if (method === 'HEAD') {
    // Some browsers probe video seekability with HEAD + Range
    if (isVideo && range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match) {
        let start = match[1] ? Number(match[1]) : 0;
        let end = match[2] ? Number(match[2]) : size - 1;
        if (!Number.isNaN(start) && !Number.isNaN(end) && start <= end && start < size) {
          end = Math.min(end, size - 1);
          const chunkSize = end - start + 1;
          res.writeHead(206, {
            ...baseHeaders,
            'Content-Length': chunkSize,
            'Content-Range': `bytes ${start}-${end}/${size}`,
          });
          res.end();
          return;
        }
      }
    }

    res.writeHead(200, {
      ...baseHeaders,
      'Content-Length': size,
    });
    res.end();
    return;
  }

  // For non-video files (or no Range), stream the whole file.
  if (!isVideo || !range) {
    res.writeHead(200, {
      ...baseHeaders,
      'Content-Length': size,
    });
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Stream error');
    });
    stream.pipe(res);
    return;
  }

  // Range request for videos (enables scrubbing)
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` });
    res.end();
    return;
  }

  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : size - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` });
    res.end();
    return;
  }

  end = Math.min(end, size - 1);
  const chunkSize = end - start + 1;

  res.writeHead(206, {
    ...baseHeaders,
    'Content-Length': chunkSize,
    'Content-Range': `bytes ${start}-${end}/${size}`,
  });

  const stream = fs.createReadStream(filePath, { start, end });
  stream.on('error', () => {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Stream error');
  });
  stream.pipe(res);
}

function safeFilePath(urlPathname) {
  const decoded = decodeURIComponent(urlPathname);
  const joined = path.join(__dirname, decoded);
  const normalized = path.normalize(joined);
  if (!normalized.startsWith(path.normalize(__dirname + path.sep))) {
    return null;
  }
  return normalized;
}

const server = http.createServer(async (req, res) => {
  try {
    // Attach request to response for gzip compression in sendJson
    res._gzReq = req;
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    // ===== HEALTH CHECK — must be first to avoid timing out during heavy background work =====
    if (requestUrl.pathname === '/api/health') {
      const _hb = '{"status":"ok"}';
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(_hb), 'Cache-Control': 'no-store' });
      return res.end(_hb);
    }

    if (requestUrl.pathname === '/api/live-activity' && (req.method || 'GET').toUpperCase() === 'GET') {
      const now = Date.now();
      if (_liveActivityCache.data && now - _liveActivityCache.ts < LIVE_ACTIVITY_CACHE_MS) {
        return sendJson(res, 200, _liveActivityCache.data);
      }
      try {
        const supa = await fetchLiveActivityFromSupabase();
        if (supa.ok) {
          _liveActivityCache = { ts: now, data: supa.data };
          return sendJson(res, 200, supa.data);
        }
        return sendJson(res, 200, {
          watchingNow: 0,
          videosAddedToday: 0,
          source: 'supabase',
          generatedAt: new Date().toISOString(),
          unavailable: true,
        });
      } catch {
        return sendJson(res, 200, {
          watchingNow: 0,
          videosAddedToday: 0,
          source: 'supabase',
          generatedAt: new Date().toISOString(),
          unavailable: true,
        });
      }
    }

    // ===== WWW → non-www redirect (SEO: single canonical host) =====
    const reqHost = (req.headers.host || '').toLowerCase();
    if (reqHost.startsWith('www.')) {
      const target = `https://${reqHost.replace(/^www\./, '')}${req.url}`;
      res.writeHead(301, { Location: target });
      return res.end();
    }

    // Legacy misspelled category slug `/petitie` → `/petite` (R2 prefix unchanged: `petitie`)
    {
      const p = requestUrl.pathname;
      if (p === '/petitie' || p.startsWith('/petitie/')) {
        const tail = p.slice('/petitie'.length);
        res.writeHead(301, {
          Location: '/petite' + tail + (requestUrl.search || ''),
          'Cache-Control': 'public, max-age=86400',
        });
        return res.end();
      }
    }

    // Track last-seen for active-user stats (skip for static files to avoid blocking cold-start)
    const _isStaticReq = /\.(html|css|js|png|jpg|jpeg|gif|webp|svg|ico|xml|txt|json|woff2?|ttf|eot|mp4|webm|mov)(\?|$)/i.test(requestUrl.pathname) || requestUrl.pathname === '/';
    if (!_isStaticReq) {
      try {
        await ensureSessionsLoaded();
        const _uk = await getAuthedUserKeyWithRefresh(req);
        if (_uk) {
          const now = Date.now();
          adminLastSeen.set(_uk, now);
          // Track return visits (1+ hour gap = new visit)
          if (!adminUserVisits[_uk]) {
            adminUserVisits[_uk] = { first: now, last: now, visits: 1 };
          } else {
            const gap = now - adminUserVisits[_uk].last;
            if (gap > 3600000) adminUserVisits[_uk].visits++; // 1 hour gap = new visit
            adminUserVisits[_uk].last = now;
          }
          scheduleAdminPersist();
        }
      } catch {}
    }

    // Categories page now lives on the homepage
    if (requestUrl.pathname === '/categories.html' && !requestUrl.search) {
      res.writeHead(301, { Location: '/' });
      return res.end();
    }

    // Redirect removed folder names to homepage (SEO: avoid crawled-not-indexed)
    if (requestUrl.pathname === '/folder.html') {
      const folder = requestUrl.searchParams.get('folder');
      const removedFolders = ['Live Slips', 'Free Use', 'Rule 34', 'Free+Use', 'Rule+34', 'Voyeurs', 'Real Couples', 'College', 'Public Flashing'];
      if (folder && removedFolders.includes(folder)) {
        res.writeHead(301, { Location: '/' });
        return res.end();
      }
    }

    // SEO: 301 redirect old video.html?folder=X&name=Y URLs to clean URLs
    if (requestUrl.pathname === '/video.html' && requestUrl.searchParams.get('folder') && requestUrl.searchParams.get('name')) {
      const _rvFolder = requestUrl.searchParams.get('folder');
      const _rvName = requestUrl.searchParams.get('name');
      const _rvClean = videoCleanUrlMap.get(_rvFolder + '/' + _rvName);
      if (_rvClean) {
        res.writeHead(301, { Location: _rvClean, 'Cache-Control': 'public, max-age=86400' });
        return res.end();
      }
    }

    // ===== ADMIN PANEL =====
    // Old iframe URL; embed now loads `/admin-panel.html`.
    if (requestUrl.pathname === '/admin/') {
      res.writeHead(302, { Location: '/admin-panel.html', 'Cache-Control': 'no-store' });
      return res.end();
    }
    // Standalone admin document ships with the client build (`client/public/admin-panel.html`).
    if (requestUrl.pathname === '/admin-panel.html') {
      let fp = path.join(__dirname, 'client', 'dist', 'admin-panel.html');
      try {
        await fs.promises.access(fp);
      } catch {
        fp = path.join(__dirname, 'client', 'public', 'admin-panel.html');
      }
      let html;
      try {
        html = await fs.promises.readFile(fp, 'utf8');
      } catch {
        return sendText(res, 404, 'Admin panel not found (run npm run build or keep client/public/admin-panel.html)');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }
    if (requestUrl.pathname === '/admin/api/login') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });
      // Rate limit admin login attempts
      const adminIp = normalizeIp(getClientIp(req));
      const adminRl = bumpAdminLoginRate(adminIp);
      if (!adminRl.allowed) {
        res.setHeader('Retry-After', String(Math.ceil((adminRl.retryAfterMs || 0) / 1000)));
        return sendJson(res, 429, { error: 'Too many admin login attempts. Try again later.' });
      }
      const body = await readJsonBody(req, res);
      if (!body) return;
      if (!adminPasswordHydrated) {
        return sendJson(res, 503, { error: 'Admin login initializing; retry in a few seconds.' });
      }
      // Use timing-safe comparison to prevent timing attacks
      const normalizedPw = normalizeAdminLoginPassword(body.password);
      const inputBuf = Buffer.from(normalizedPw);
      const correctBuf = Buffer.from(ADMIN_PASSWORD_CURRENT);
      const passwordMatch = inputBuf.length === correctBuf.length && crypto.timingSafeEqual(inputBuf, correctBuf);
      if (!passwordMatch) return sendJson(res, 401, { error: 'Wrong password' });
      const token = crypto.randomBytes(32).toString('hex');
      adminTokens.set(token, { createdAt: Date.now() });
      persistAdminTokens();
      appendSetCookie(res, `${ADMIN_COOKIE}=${token}; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=${ADMIN_TOKEN_TTL / 1000 | 0}`);
      return sendJson(res, 200, { ok: true });
    }
    if (requestUrl.pathname === '/admin/api/check') {
      return sendJson(res, 200, { authed: isAdminAuthed(req) });
    }
    if (requestUrl.pathname === '/admin/api/password-rotation-status') {
      if (!isAdminAuthed(req)) return sendJson(res, 401, { error: 'Not authorized' });
      const now = Date.now();
      const staleMs = adminPasswordRotationState.lastRotatedAt ? (now - adminPasswordRotationState.lastRotatedAt) : Number.POSITIVE_INFINITY;
      const stale = staleMs > (ADMIN_PASSWORD_ROTATION_HEALTH_GRACE_MS + ADMIN_PASSWORD_ROTATE_MS);
      return sendJson(res, 200, {
        ok: !stale,
        intervalMs: ADMIN_PASSWORD_ROTATE_MS,
        graceMs: ADMIN_PASSWORD_ROTATION_HEALTH_GRACE_MS,
        running: adminPasswordRotationState.running,
        lastReason: adminPasswordRotationState.lastReason || null,
        lastRotatedAt: adminPasswordRotationState.lastRotatedAt || null,
        lastWebhookAttemptAt: adminPasswordRotationState.lastWebhookAttemptAt || null,
        lastWebhookOk: adminPasswordRotationState.lastWebhookOk,
        lastWebhookError: adminPasswordRotationState.lastWebhookError || null,
        nextRotationAt: adminPasswordRotationState.nextRotationAt || null,
        stale,
        staleMs: Number.isFinite(staleMs) ? staleMs : null,
      });
    }
    // Live events polling — returns events since a given timestamp
    if (requestUrl.pathname === '/admin/api/events') {
      if (!isAdminAuthed(req)) return sendJson(res, 401, { error: 'Not authorized' });
      const since = parseInt(requestUrl.searchParams.get('since') || '0', 10) || 0;
      const events = adminLiveEvents.filter(e => e.ts > since);
      return sendJson(res, 200, { events });
    }
    if (requestUrl.pathname === '/admin/api/logout') {
      const cookies = parseCookies(req);
      const tok = cookies[ADMIN_COOKIE];
      if (tok) { adminTokens.delete(tok); persistAdminTokens(); }
      appendSetCookie(res, `${ADMIN_COOKIE}=; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=0`);
      return sendJson(res, 200, { ok: true });
    }
    if (requestUrl.pathname === '/admin/api/test-password-webhook' && req.method === 'POST') {
      if (!isAdminAuthed(req)) return sendJson(res, 401, { error: 'Not authorized' });
      const result = await postAdminPasswordToWebhook(ADMIN_PASSWORD_CURRENT, 'manual-test');
      return sendJson(res, result && result.ok ? 200 : 500, {
        ok: !!(result && result.ok),
        result: result || { ok: false, error: 'No result' },
      });
    }
    if (requestUrl.pathname === '/admin/api/rotate-password' && req.method === 'POST') {
      if (!isAdminAuthed(req)) return sendJson(res, 401, { error: 'Not authorized' });
      const result = await rotateAdminPassword('manual');
      if (!result || !result.ok) {
        return sendJson(res, 500, {
          ok: false,
          rotated: true,
          result: result || { ok: false, error: 'rotation_failed' },
        });
      }
      return sendJson(res, 200, {
        ok: true,
        rotated: true,
        webhook: result.webhook || { ok: false },
      });
    }

    // Admin: restore/merge short stats from uploaded JSON
    if (requestUrl.pathname === '/admin/api/restore-stats' && req.method === 'POST') {
      if (!isAdminAuthed(req)) return sendJson(res, 401, { error: 'Not authorized' });
      try {
        const uploaded = await readJsonBody(req, res, 2 * 1024 * 1024); // 2MB limit for restore
        if (!uploaded) return;
        let merged = 0;
        for (const [rawKey, val] of Object.entries(uploaded)) {
          if (!val || typeof val !== 'object') continue;
          const key = _migrateStatsKey(rawKey);
          const existing = shortStats[key] || { views: 0, likes: 0, dislikes: 0 };
          shortStats[key] = {
            views: Math.max(existing.views || 0, val.views || 0),
            likes: Math.max(existing.likes || 0, val.likes || 0),
            dislikes: Math.max(existing.dislikes || 0, val.dislikes || 0),
            _votes: { ...(val._votes || {}), ...(existing._votes || {}) },
          };
          merged++;
        }
        await queueShortStatsWrite();
        return sendJson(res, 200, { ok: true, merged, total: Object.keys(shortStats).length });
      } catch (e) {
        return sendJson(res, 400, { error: 'Invalid JSON body' });
      }
    }

    // Admin: fetch payment screenshot (redirect to R2 presigned URL)
    if (requestUrl.pathname === '/admin/payment-image') {
      if (!isAdminAuthed(req)) return sendText(res, 401, 'Not authorized');
      const key = requestUrl.searchParams.get('key') || '';
      if (!key) return sendText(res, 400, 'Missing key');
      // Only allow payment screenshot keys — block path traversal in R2
      if (!key.startsWith('payments/') && !key.startsWith('data/payments/')) return sendText(res, 400, 'Invalid key');
      if (key.includes('..')) return sendText(res, 400, 'Invalid key');
      if (R2_ENABLED) {
        const url = r2PresignedUrl(key, 600);
        res.writeHead(302, { Location: url, 'Cache-Control': 'no-store' });
        return res.end();
      }
      // Local fallback — sanitize to prevent path traversal
      const fileName = path.basename(key).replace(/[^a-zA-Z0-9._-]/g, '');
      if (!fileName) return sendText(res, 400, 'Invalid filename');
      const p = path.join(DATA_DIR, 'payments', fileName);
      if (!p.startsWith(path.join(DATA_DIR, 'payments'))) return sendText(res, 400, 'Invalid path');
      if (!fs.existsSync(p)) return sendText(res, 404, 'Not found');
      const buf = fs.readFileSync(p);
      res.writeHead(200, { 'Content-Type': getContentType(p), 'Cache-Control': 'no-store' });
      return res.end(buf);
    }

    // All other /admin/api/* require auth
    if (requestUrl.pathname.startsWith('/admin/api/')) {
      if (!isAdminAuthed(req)) return sendJson(res, 401, { error: 'Not authorized' });

      if (requestUrl.pathname === '/admin/api/discord-entitlements/sync' && req.method === 'POST') {
        const db = await ensureUsersDbFresh();
        let scanned = 0;
        let synced = 0;
        for (const [userKey, u] of Object.entries(db.users || {})) {
          if (!u || typeof u !== 'object') continue;
          scanned += 1;
          await syncDiscordEntitlementStateSupabase(userKey, u, 'admin_backfill');
          synced += 1;
        }
        return sendJson(res, 200, { ok: true, scanned, synced });
      }

      // Dashboard stats
      if (requestUrl.pathname === '/admin/api/stats') {
        const db = await ensureUsersDbFresh();
        const totalUsers = Object.keys(db.users || {}).length;
        const now = Date.now();
        const cutoff24h = now - 86400000;
        // Count from db.users (primary source)
        const signups24hDb = Object.values(db.users || {}).filter(u => u && typeof u.createdAt === 'number' && u.createdAt >= cutoff24h).length;
        // Also count from adminSignupLog (separately persisted analytics log)
        const signups24hLog = adminSignupLog.filter(s => s && typeof s.ts === 'number' && s.ts >= cutoff24h).length;
        // Use the higher value — covers cases where R2 data is stale but the analytics log caught the events
        const signups24h = Math.max(signups24hDb, signups24hLog);
        const visitStats = getVisitStats();
        const tier1Count = Object.values(db.users || {}).filter(u => u && (u.tier === 1 || u.tier === '1')).length;
        const tier2Count = Object.values(db.users || {}).filter(u => u && (u.tier === 2 || u.tier === '2')).length;
        const paidCount = Object.values(db.users || {}).filter(u => u && (u.purchaseDate || u.premiumPaidAt || u.premiumProvider)).length;
        const hourly = getHourlyVisitData();
        const chartRange = requestUrl.searchParams.get('chart') || '24h';
        const chart = getVisitChartData(chartRange);
        // Compute extended analytics
        const recentSessions = adminPageSessions.filter(s => s.ts >= cutoff24h);
        const bounceCount = recentSessions.filter(s => s.bounced).length;
        const bounceRate = recentSessions.length > 0 ? Math.round((bounceCount / recentSessions.length) * 100) : 0;
        const avgViewTime = recentSessions.length > 0 ? Math.round(recentSessions.reduce((s, e) => s + e.duration, 0) / recentSessions.length) : 0;
        const recentShorts = adminShortsUsage.filter(s => s.ts >= cutoff24h);
        const avgShortsTime = recentShorts.length > 0 ? Math.round(recentShorts.reduce((s, e) => s + e.duration, 0) / recentShorts.length) : 0;
        const recentVideoWatch = adminVideoWatchTime.filter(s => s.ts >= cutoff24h);
        const avgVideoWatch = recentVideoWatch.length > 0 ? Math.round(recentVideoWatch.reduce((s, e) => s + e.duration, 0) / recentVideoWatch.length) : 0;

        return sendJson(res, 200, {
          totalUsers, signups24h,
          visits: visitStats,
          activeNow: getActiveUsersNow(),
          tier1Count, tier2Count, paidCount,
          categoryHits: adminCategoryHits,
          hourlyVisits: hourly,
          chart,
          // Extended analytics
          navClicks: adminNavClicks,
          bounceRate,
          avgViewTime,
          avgShortsTime,
          avgVideoWatch,
          totalSessions24h: recentSessions.length,
          totalShortsViews24h: recentShorts.length,
          totalVideoWatches24h: recentVideoWatch.length,
          // Advanced analytics
          totalVideos: Object.keys(shortStats).length,
          totalViews: Object.values(shortStats).reduce((s, v) => s + (v.views || 0), 0),
          totalLikes: Object.values(shortStats).reduce((s, v) => s + (v.likes || 0), 0),
          avgViewsPerVideo: Object.keys(shortStats).length > 0 ? Math.round(Object.values(shortStats).reduce((s, v) => s + (v.views || 0), 0) / Object.keys(shortStats).length) : 0,
          avgViewsPerUser: totalUsers > 0 ? Math.round(Object.values(shortStats).reduce((s, v) => s + (v.views || 0), 0) / totalUsers) : 0,
          totalComments: Object.values(videoComments).reduce((s, arr) => s + arr.length, 0),
          totalCommentReplies: Object.values(videoComments).reduce((s, arr) => s + arr.reduce((rs, c) => rs + (c.replies ? c.replies.length : 0), 0), 0),
          videosWithComments: Object.keys(videoComments).filter(k => videoComments[k].length > 0).length,
          engagementRate: totalUsers > 0 ? Math.round(((Object.values(shortStats).reduce((s, v) => s + (v.likes || 0) + (v.dislikes || 0), 0)) / Math.max(1, Object.values(shortStats).reduce((s, v) => s + (v.views || 0), 0))) * 100) : 0,
          topVideos: Object.entries(shortStats).sort((a, b) => (b[1].views || 0) - (a[1].views || 0)).slice(0, 5).map(([k, v]) => ({ key: k, views: v.views || 0, likes: v.likes || 0 })),
          peakHour: (() => { const hrs = {}; for (const s of adminPageSessions) { const h = new Date(s.ts).getHours(); hrs[h] = (hrs[h] || 0) + 1; } const sorted = Object.entries(hrs).sort((a, b) => b[1] - a[1]); return sorted.length ? { hour: parseInt(sorted[0][0]), sessions: sorted[0][1] } : null; })(),
          uploadsTotal: uploadRequests.length,
          uploadsPending: uploadRequests.filter(r => r.status === 'pending').length,
          uploadsApproved: uploadRequests.filter(r => r.status === 'approved').length,
          // Return rate: users who visited 2+ times (1hr+ gap between visits)
          returnRate: (() => {
            const tracked = Object.values(adminUserVisits);
            if (tracked.length === 0) return 0;
            const returning = tracked.filter(v => v.visits >= 2).length;
            return Math.round((returning / tracked.length) * 100);
          })(),
          trackedUsers: Object.keys(adminUserVisits).length,
          returningUsers: Object.values(adminUserVisits).filter(v => v.visits >= 2).length,
        });
      }

      if (requestUrl.pathname === '/admin/api/reset-stats') {
        if ((req.method || 'GET').toUpperCase() !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });
        visitLog.length = 0;
        visitAllTime = 0;
        for (const k of Object.keys(adminCategoryHits)) delete adminCategoryHits[k];
        for (const k of Object.keys(adminNavClicks)) delete adminNavClicks[k];
        adminPageSessions.length = 0;
        adminShortsUsage.length = 0;
        adminVideoWatchTime.length = 0;
        for (const k of Object.keys(adminUserVisits)) delete adminUserVisits[k];
        const resetDb = await resetAdminStatsInSupabase();
        scheduleAdminPersist();
        if (!resetDb.ok) return sendJson(res, 500, { ok: false, error: resetDb.reason || 'reset_failed', detail: resetDb });
        return sendJson(res, 200, { ok: true, resetAt: new Date().toISOString(), source: 'supabase' });
      }

      // All comments grouped by video
      if (requestUrl.pathname === '/admin/api/comments') {
        await ensureCommentsFresh();
        const result = {};
        for (const [key, comments] of Object.entries(videoComments)) {
          if (!comments || comments.length === 0) continue;
          result[key] = comments.map(c => ({
            id: c.id, user: c.user, text: c.text, ts: c.ts,
            likes: c.likes || 0, dislikes: c.dislikes || 0,
            replies: (c.replies || []).map(r => ({ id: r.id, user: r.user, text: r.text, ts: r.ts }))
          }));
        }
        return sendJson(res, 200, { comments: result });
      }

      // Geo analytics
      if (requestUrl.pathname === '/admin/api/geo') {
        const g = computeGeoTopCountries();
        return sendJson(res, 200, { geo: g });
      }

      // Recent signups (merge db.users + adminSignupLog for full coverage)
      if (requestUrl.pathname === '/admin/api/signups') {
        if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
          const [eventsResp, historyResp] = await Promise.all([
            supabaseJson('/rest/v1/admin_events?event_type=eq.signup&select=created_at,payload&order=created_at.desc&limit=2000', { method: 'GET' }),
            loadAppStateSnapshot('admin_analytics_history'),
          ]);
          if (eventsResp.ok) {
            const signups = [];
            const seen = new Set();
            const eventRows = Array.isArray(eventsResp.data) ? eventsResp.data : [];
            for (const row of eventRows) {
              const payload = row && row.payload && typeof row.payload === 'object' ? row.payload : {};
              const ts = row && row.created_at ? new Date(row.created_at).getTime() : 0;
              const username = String(payload.username || '').trim();
              const provider = String(payload.provider || 'local');
              const ip = String(payload.ip || 'unknown');
              const referredBy = payload.referredBy || null;
              if (!username || !Number.isFinite(ts) || ts <= 0) continue;
              const key = `${username.toLowerCase()}::${ts}`;
              if (seen.has(key)) continue;
              seen.add(key);
              signups.push({ ts, username, provider, ip, referredBy });
            }

            const historyPayload = historyResp && historyResp.ok && historyResp.data && typeof historyResp.data === 'object'
              ? historyResp.data
              : {};
            const historySignups = Array.isArray(historyPayload.signups) ? historyPayload.signups : [];
            for (const s of historySignups) {
              if (!s || typeof s !== 'object') continue;
              const ts = Number(s.ts || 0);
              const username = String(s.username || '').trim();
              if (!username || !Number.isFinite(ts) || ts <= 0) continue;
              const key = `${username.toLowerCase()}::${ts}`;
              if (seen.has(key)) continue;
              seen.add(key);
              signups.push({
                ts,
                username,
                provider: String(s.provider || 'local'),
                ip: String(s.ip || 'unknown'),
                referredBy: s.referredBy || null,
              });
            }
            signups.sort((a, b) => (b.ts || 0) - (a.ts || 0));
            return sendJson(res, 200, { signups });
          }
        }

        const db = await ensureUsersDbFresh();
        // Build signup list from db.users (canonical source)
        const seen = new Set();
        const signups = Object.entries(db.users || {}).map(([key, u]) => {
          const createdAt = u && typeof u.createdAt === 'number' ? u.createdAt : 0;
          const uname = u && u.username ? String(u.username) : key;
          seen.add(uname.toLowerCase());
          return {
            ts: createdAt,
            username: uname,
            provider: u && u.provider ? String(u.provider) : 'local',
            ip: u && u.signupIp ? String(u.signupIp) : 'unknown',
            referredBy: u && u.referredBy ? String(u.referredBy) : null,
          };
        });
        // Merge any entries from adminSignupLog that aren't already in db.users
        // (covers R2 staleness / write-loss edge cases)
        for (const s of adminSignupLog) {
          const logName = s && s.username ? String(s.username).toLowerCase() : '';
          if (logName && !seen.has(logName)) {
            seen.add(logName);
            signups.push({
              ts: s.ts || 0,
              username: String(s.username),
              provider: String(s.provider || 'unknown'),
              ip: String(s.ip || 'unknown'),
              referredBy: s.referredBy || null,
            });
          }
        }
        signups.sort((a, b) => (b.ts || 0) - (a.ts || 0));
        return sendJson(res, 200, { signups });
      }

      // Recent payments
      if (requestUrl.pathname === '/admin/api/payments') {
        await backfillPaymentsFromR2IfNeeded();
        const range = requestUrl.searchParams.get('range') || '24h';
        const ms = parseRevenueRange(range);
        const cutoff = ms ? (Date.now() - ms) : null;
        let cents = 0;
        for (const p of adminPaymentLog) {
          if (!p || typeof p !== 'object') continue;
          if (cutoff && typeof p.ts === 'number' && p.ts < cutoff) continue;
          cents += planAmountCents(p.plan);
        }
        return sendJson(res, 200, {
          payments: adminPaymentLog.slice().reverse(),
          revenue: {
            range: String(range),
            currency: 'USD',
            cents,
            usd: Math.round((cents / 100) * 100) / 100,
          },
        });
      }

      // Serve payment screenshot from R2
      if (requestUrl.pathname === '/admin/api/payment-screenshot') {
        const key = requestUrl.searchParams.get('key');
        if (!key || !key.startsWith('data/payments/')) return sendJson(res, 400, { error: 'Invalid key' });
        try {
          const obj = await r2GetObjectBytes(key);
          if (!obj) return sendJson(res, 404, { error: 'Not found' });
          const ext = key.split('.').pop().toLowerCase();
          const ct = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
          res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
          return res.end(obj);
        } catch (e) {
          console.error('payment-screenshot serve error:', e && e.message ? e.message : e);
          return sendJson(res, 500, { error: 'Failed to load screenshot' });
        }
      }

      // Recent tier unlocks
      if (requestUrl.pathname === '/admin/api/tiers') {
        return sendJson(res, 200, { tiers: adminTierLog.slice().reverse() });
      }

      // List all users (paginated)
      if (requestUrl.pathname === '/admin/api/users') {
        const db = await ensureUsersDbFresh();
        const q = (requestUrl.searchParams.get('q') || '').toLowerCase().trim();
        const entries = Object.entries(db.users || {});
        const filtered = q
          ? entries.filter(([k, u]) => k.toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q) || (u.referralCode || '').toLowerCase() === q || (u.signupIp || '').toLowerCase().includes(q))
          : entries;
        const page = Math.max(0, parseInt(requestUrl.searchParams.get('page') || '0', 10) || 0);
        const perPage = 50;
        const start = page * perPage;
        const slice = filtered.slice(start, start + perPage);
        const users = slice.map(([key, u]) => {
          const ls = adminLastSeen.get(key);
          return {
            key, username: u.username || key, provider: u.provider || 'unknown',
            tier: u.tier || 0, createdAt: u.createdAt || 0,
            signupIp: u.signupIp || 'unknown',
            referralCode: u.referralCode || null,
            referredCount: Array.isArray(u.referredUsers) ? u.referredUsers.length : 0,
            banned: !!u.banned,
            online: ls ? ls >= Date.now() - PRESENCE_WINDOW_MS : false,
            lastSeen: ls || null,
          };
        });
        return sendJson(res, 200, { users, total: filtered.length, page, perPage });
      }

      // Single user detail
      if (requestUrl.pathname === '/admin/api/user') {
        const key = requestUrl.searchParams.get('key') || '';
        if (!key) return sendJson(res, 400, { error: 'Missing key param' });
        const db = await ensureUsersDbFresh();
        const u = db.users[key];
        if (!u) return sendJson(res, 404, { error: 'User not found' });
        const ls = adminLastSeen.get(key);
        const referred = (Array.isArray(u.referredUsers) ? u.referredUsers : []).map(rk => {
          const ru = db.users[rk];
          return { key: rk, username: ru ? (ru.username || rk) : rk };
        });
        return sendJson(res, 200, {
          key,
          username: u.username || key,
          provider: u.provider || 'unknown',
          tier: u.tier || 0,
          banned: !!u.banned,
          createdAt: u.createdAt || null,
          signupIp: u.signupIp || 'unknown',
          referralCode: u.referralCode || null,
          referredBy: u.referredBy || null,
          referredUsers: referred,
          purchaseMethod: u.purchaseMethod || null,
          purchaseDate: u.purchaseDate || null,
          premiumProvider: u.premiumProvider || null,
          premiumPaidAt: u.premiumPaidAt || null,
          online: ls ? ls >= Date.now() - PRESENCE_WINDOW_MS : false,
          lastSeen: ls || null,
          salt: u.salt ? '(set)' : null,
          hash: u.hash ? '(set)' : null,
          discordId: u.discordId || null,
          referralCreditIps: u.referralCreditIps || [],
        });
      }

      // Resolve a referral code to its owner (user key)
      if (requestUrl.pathname === '/admin/api/user/by-referral') {
        const code = requestUrl.searchParams.get('code') || '';
        if (!code) return sendJson(res, 400, { error: 'Missing code param' });
        const db = await ensureUsersDbFresh();
        const key = findUserKeyByReferralCode(db, code);
        if (!key) return sendJson(res, 404, { error: 'Referral owner not found' });
        return sendJson(res, 200, { key });
      }

      // Update user tier
      if (requestUrl.pathname === '/admin/api/user/set-tier') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });
        const body = await readJsonBody(req, res);
        if (!body) return;
        const key = String(body.key || '');
        const newTier = parseInt(body.tier, 10);
        if (!key) return sendJson(res, 400, { error: 'Missing key' });
        if (![0, 1, 2, 3].includes(newTier)) return sendJson(res, 400, { error: 'Tier must be 0–3' });
        const db = await ensureUsersDbFresh();
        const u = db.users[key];
        if (!u) return sendJson(res, 404, { error: 'User not found' });
        if (newTier === 0) {
          u.tier = null;
          u.purchaseMethod = null;
          u.purchaseDate = null;
          u.premiumProvider = null;
          u.premiumPaidAt = null;
        } else {
          u.tier = newTier;
        }
        // Write immediately so tier change persists
        await _doUsersDbWrite();
        const displayName = (u.username || u.discordUsername || key).replace(/^discord:/, '');
        const tierLabels = { 0: 'Free', 1: 'Basic', 2: 'Premium', 3: 'Ultimate' };
        adminEmitEvent('tier', displayName + ' set to ' + (tierLabels[newTier] || newTier));
        return sendJson(res, 200, { ok: true, tier: u.tier });
      }

      // Update user tier by username (fallback for backfilled payments)
      if (requestUrl.pathname === '/admin/api/user/set-tier-by-username') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });
        const body = await readJsonBody(req, res);
        if (!body) return;
        const username = String(body.username || '').trim();
        const newTier = parseInt(body.tier, 10);
        if (!username) return sendJson(res, 400, { error: 'Missing username' });
        if (![0, 1, 2, 3].includes(newTier)) return sendJson(res, 400, { error: 'Tier must be 0–3' });
        const db = await ensureUsersDbFresh();
        const key = findUserKeyByUsername(db, username);
        if (!key) return sendJson(res, 404, { error: 'User not found' });
        const u = db.users[key];
        if (!u) return sendJson(res, 404, { error: 'User not found' });
        if (newTier === 0) {
          u.tier = null;
          u.purchaseMethod = null;
          u.purchaseDate = null;
          u.premiumProvider = null;
          u.premiumPaidAt = null;
        } else {
          u.tier = newTier;
        }
        // Write immediately so tier change persists
        await _doUsersDbWrite();
        const displayName = (u.username || u.discordUsername || key).replace(/^discord:/, '');
        const tierLabels = { 0: 'Free', 1: 'Basic', 2: 'Premium', 3: 'Ultimate' };
        adminEmitEvent('tier', displayName + ' set to ' + (tierLabels[newTier] || newTier));
        return sendJson(res, 200, { ok: true, tier: u.tier, key });
      }

      // ── PATREON BACKFILL ───────────────────────────────────────────────────
      if (requestUrl.pathname === '/admin/api/patreon-backfill') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });
        const body = (await readJsonBody(req, res)) || {};
        const members = Array.isArray(body.members) ? body.members : [];
        const dryRun = !!body.dryRun;
        const autoGrant = !!body.autoGrant;
        if (!members.length) return sendJson(res, 400, { error: 'members[] required' });

        const inserted = [];
        const updated = [];
        const skippedNoEmail = [];
        for (const m of members) {
          const email = patreonNormalizeEmail(m && m.email);
          if (!email) { skippedNoEmail.push(m && m.fullName || '<no-name>'); continue; }
          const cents = Number(m.cents || m.currently_entitled_amount_cents || 0) || 0;
          const status = String(m.status || m.patron_status || 'active_patron').trim();
          const tier = (status === 'active_patron') ? patreonTierFromCents(cents) : 0;
          const prev = patreonPatrons[email] || null;
          const next = {
            tier,
            status: status || (prev && prev.status) || 'unknown',
            cents,
            lastEvent: 'admin:backfill',
            updatedAt: Date.now(),
            redeemedBy: prev ? prev.redeemedBy || null : null,
            redeemedAt: prev ? prev.redeemedAt || null : null,
            backfilledAt: Date.now(),
            fullName: m.fullName || (prev && prev.fullName) || null,
          };
          if (!dryRun) patreonPatrons[email] = next;
          (prev ? updated : inserted).push({ email, tier, cents, status });
        }
        if (!dryRun) await savePatreonPatronsNow();

        const granted = [];
        const grantSkipped = [];
        if (autoGrant) {
          const db = await ensureUsersDbFresh();
          const emailToKey = {};
          for (const [k, u] of Object.entries(db.users || {})) {
            const ge = u && u.googleEmail ? String(u.googleEmail).trim().toLowerCase() : '';
            if (ge) emailToKey[ge] = k;
          }
          for (const m of members) {
            const email = patreonNormalizeEmail(m && m.email);
            if (!email) continue;
            const rec = patreonPatrons[email];
            if (!rec || !rec.tier || rec.tier < 1) continue;
            if (rec.redeemedBy) continue;
            const userKey = emailToKey[email];
            if (!userKey) { grantSkipped.push({ email, reason: 'no_pornwrld_user_with_matching_googleEmail' }); continue; }
            const u = db.users[userKey];
            if (!u) { grantSkipped.push({ email, reason: 'user_disappeared' }); continue; }
            if (typeof u.tier === 'number' && u.tier >= rec.tier) {
              if (!dryRun) {
                rec.redeemedBy = userKey;
                rec.redeemedAt = Date.now();
              }
              granted.push({ email, userKey, tier: u.tier, note: 'already_higher_or_equal' });
              continue;
            }
            if (!dryRun) {
              u.tier = rec.tier;
              u.purchaseMethod = 'patreon';
              u.purchaseDate = new Date().toISOString();
              u.tierLostNotice = null;
              rec.redeemedBy = userKey;
              rec.redeemedAt = Date.now();
            }
            granted.push({ email, userKey, tier: rec.tier });
          }
          if (!dryRun && granted.length > 0) {
            await _doUsersDbWrite();
            await savePatreonPatronsNow();
            try { adminEmitEvent('tier', `Patreon backfill granted tier to ${granted.length} user(s)`); } catch {}
          }
        }

        return sendJson(res, 200, {
          ok: true,
          dryRun,
          autoGrant,
          insertedCount: inserted.length,
          updatedCount: updated.length,
          skippedNoEmailCount: skippedNoEmail.length,
          inserted,
          updated,
          skippedNoEmail,
          grantedCount: granted.length,
          granted,
          grantSkipped,
        });
      }

      // Ban or unban a user
      if (requestUrl.pathname === '/admin/api/user/ban') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });
        const body = await readJsonBody(req, res);
        if (!body) return;
        const key = String(body.key || '');
        if (!key) return sendJson(res, 400, { error: 'Missing key' });
        if (typeof body.banned !== 'boolean') return sendJson(res, 400, { error: 'Missing banned flag' });
        const db = await ensureUsersDbFresh();
        const u = db.users[key];
        if (!u) return sendJson(res, 404, { error: 'User not found' });
        u.banned = body.banned;
        await queueUsersDbWrite();
        if (body.banned) {
          for (const [tok, sess] of sessions.entries()) {
            if (sess.userKey === key) sessions.delete(tok);
          }
        }
        return sendJson(res, 200, { ok: true, banned: !!u.banned });
      }

      // Delete user
      if (requestUrl.pathname === '/admin/api/user/delete') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });
        const body = await readJsonBody(req, res);
        if (!body) return;
        const key = String(body.key || '');
        if (!key) return sendJson(res, 400, { error: 'Missing key' });
        const db = await ensureUsersDbFresh();
        if (!db.users[key]) return sendJson(res, 404, { error: 'User not found' });
        delete db.users[key];
        await queueUsersDbWrite();
        // Also kill their sessions
        for (const [tok, sess] of sessions.entries()) {
          if (sess.userKey === key) sessions.delete(tok);
        }
        return sendJson(res, 200, { ok: true });
      }

      // ── Upload Requests Admin ──────────────────────────────────────
      if (requestUrl.pathname === '/admin/api/upload-requests') {
        await loadUploadRequests(true);
        const statusFilter = requestUrl.searchParams.get('status') || 'pending';
        const filtered = statusFilter === 'all'
          ? uploadRequests
          : uploadRequests.filter(r => r.status === statusFilter);
        return sendJson(res, 200, { requests: filtered });
      }

      if (requestUrl.pathname === '/admin/api/upload-requests/review') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' });
        await loadUploadRequests(true); // ensure fresh data across machines
        const body = await readJsonBody(req, res);
        if (!body) return;

        const { id, action, videoName, assignedTier } = body;
        if (!id || !action) return sendJson(res, 400, { error: 'Missing id or action' });

        const reqIdx = uploadRequests.findIndex(r => r.id === id);
        if (reqIdx === -1) return sendJson(res, 404, { error: 'Request not found' });
        const uploadReq = uploadRequests[reqIdx];

        if (action === 'deny') {
          uploadReq.status = 'denied';
          uploadReq.reviewedAt = new Date().toISOString();
          // Delete temp file from R2
          if (R2_ENABLED && uploadReq.r2TempKey) {
            try { await r2Request('DELETE', uploadReq.r2TempKey); } catch {}
          }
          // Persist immediately so status survives restarts
          try {
            await persistUploadRequestsNow();
          } catch (e) {
            console.error('[upload-review] persist error after deny:', e.message);
          }
          return sendJson(res, 200, { ok: true });
        }

        if (action === 'approve') {
          const finalName = (videoName || uploadReq.videoName).slice(0, 40);
          const tier = assignedTier === 2 ? 2 : 1;
          const basePath = allowedFolderBasePath(uploadReq.category);
          if (!basePath) return sendJson(res, 400, { error: 'Invalid category on request' });

          const vaultFolder = tier >= 2 ? 'premium' : 'basic';
          const sanitized = finalName.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_').slice(0, 40);
          const ext = path.extname(uploadReq.originalFilename || '.mp4').toLowerCase();
          const timestamp = Date.now();

          let finalKey;
          if (uploadReq.category === 'Omegle' && uploadReq.subfolder) {
            finalKey =
              basePath +
              '/' +
              vaultFolder +
              '/' +
              uploadReq.subfolder +
              '/' +
              timestamp +
              '_' +
              sanitized +
              ext;
          } else {
            finalKey = basePath + '/' + vaultFolder + '/' + timestamp + '_' + sanitized + ext;
          }

          // Copy from temp to final location in R2 (with retry)
          if (R2_ENABLED) {
            // Check if already approved (double-click protection)
            if (uploadReq.status === 'approved' && uploadReq.r2FinalKey) {
              return sendJson(res, 200, { ok: true });
            }
            let copySuccess = false;
            for (let attempt = 0; attempt < 3 && !copySuccess; attempt++) {
              try {
                const getResp = await r2Request('GET', uploadReq.r2TempKey);
                if (getResp.status === 404) {
                  // Temp file gone — maybe already moved. Check if final exists
                  const finalExists = await r2HeadObject(finalKey);
                  if (finalExists) { copySuccess = true; break; }
                  throw new Error('Temp file not found in R2');
                }
                if (getResp.status !== 200) throw new Error('GET temp failed: ' + getResp.status);
                await r2PutObjectBytes(finalKey, getResp.body, uploadReq.contentType || 'video/mp4');
                try { await r2Request('DELETE', uploadReq.r2TempKey); } catch {}
                copySuccess = true;
              } catch (e) {
                console.error('[upload-review] R2 copy attempt ' + (attempt + 1) + ' failed:', e.message);
                if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
              }
            }
            if (!copySuccess) {
              // Auto-delete the broken request
              uploadReq.status = 'denied';
              uploadReq.reviewedAt = new Date().toISOString();
              try { await persistUploadRequestsNow(); } catch {}
              return sendJson(res, 200, { ok: true });
            }
          }

          uploadReq.status = 'approved';
          uploadReq.reviewedAt = new Date().toISOString();
          uploadReq.assignedTier = tier;
          uploadReq.videoName = finalName;
          uploadReq.r2FinalKey = finalKey;
          // Persist immediately (not debounced) so status survives restarts
          try {
            await persistUploadRequestsNow();
          } catch (e) {
            console.error('[upload-review] persist error after approve:', e.message);
          }
          return sendJson(res, 200, { ok: true });
        }

        return sendJson(res, 400, { error: 'Invalid action' });
      }

      if (requestUrl.pathname === '/admin/api/upload-preview') {
        const id = requestUrl.searchParams.get('id');
        if (!id) return sendJson(res, 400, { error: 'Missing id' });
        const uploadReq = uploadRequests.find(r => r.id === id);
        if (!uploadReq || !uploadReq.r2TempKey) return sendJson(res, 404, { error: 'Not found' });
        if (R2_ENABLED) {
          const url = r2PresignedUrl(uploadReq.r2TempKey);
          res.writeHead(302, { Location: url });
          return res.end();
        }
        return sendJson(res, 404, { error: 'R2 not enabled' });
      }

      // ── R2 Search: list objects matching a prefix or keyword ──
      if (requestUrl.pathname === '/admin/api/r2/search') {
        const q = requestUrl.searchParams.get('q') || '';
        if (!q) return sendJson(res, 400, { error: 'Missing q param' });
        try {
          // Search across all known folders
          const prefixes = [`${R2_VIDEOS_PREFIX}/omegle/previews/`];
          for (const sf of OMEGLE_SUBFOLDERS) {
            for (const v of VAULT_FOLDERS) {
              prefixes.push(`${R2_VIDEOS_PREFIX}/omegle/${v}/${sf}/`);
            }
            for (const legacyCt of ['video', 'photo', 'gif']) {
              for (const v of VAULT_FOLDERS) {
                prefixes.push(`${R2_VIDEOS_PREFIX}/omegle/${legacyCt}/${v}/${sf}/`);
              }
            }
            for (const tf of ALL_LEGACY_DISCORD_TIER_PREFIXES) {
              prefixes.push(`${R2_VIDEOS_PREFIX}/omegle/${tf}/${sf}/`);
            }
          }
          const allResults = [];
          for (const prefix of prefixes) {
            const items = await r2ListObjects(prefix, 500);
            for (const item of items) {
              if (item.key.toLowerCase().includes(q.toLowerCase())) {
                allResults.push(item);
              }
            }
          }
          return sendJson(res, 200, { results: allResults, count: allResults.length });
        } catch (err) {
          console.error('[admin/r2/list]', err);
          return sendJson(res, 500, { error: 'Search failed' });
        }
      }

      // ── R2 Delete: delete a specific object by key ──
      if (requestUrl.pathname === '/admin/api/r2/delete' && (req.method || 'GET').toUpperCase() === 'POST') {
        const body = await readJsonBody(req, res);
        if (!body) return;
        const key = body.key;
        if (!key) return sendJson(res, 400, { error: 'Missing key' });
        try {
          const ok = await r2DeleteObject(key);
          return sendJson(res, 200, { deleted: ok, key });
        } catch (err) {
          console.error('[admin/r2/delete]', err);
          return sendJson(res, 500, { error: 'Delete failed' });
        }
      }

      // ── Watchtime Analytics ──
      if (requestUrl.pathname === '/admin/api/watchtime') {
        try {
          const db = await ensureUsersDbFresh();
          const users = db.users || {};
          maybeRebuildRecoGlobalStats();
          const funnel = { start: 0, p25: 0, p50: 0, p75: 0, p95: 0 };
          const perVideo = {};
          const viewers = [];
          for (const [identityKey, p] of Object.entries(userProfiles)) {
            const userKey = identityKey.startsWith('u:') ? identityKey.slice(2) : null;
            const u = userKey ? users[userKey] : null;
            const visits = userKey && adminUserVisits[userKey] ? adminUserVisits[userKey] : { visits: 1, last: p.lastSeenAt || 0 };
            const watchedVideos = p.watchedVideos || {};
            let totalWatchMs = 0;
            for (const [videoId, watchMs] of Object.entries(watchedVideos)) {
              const ms = Number(watchMs || 0);
              totalWatchMs += ms;
              if (!perVideo[videoId]) perVideo[videoId] = { watchMs: 0, viewers: 0, completions: 0 };
              perVideo[videoId].watchMs += ms;
              perVideo[videoId].viewers += 1;
            }
            viewers.push({
              userKey: userKey || identityKey,
              username: u ? (u.username || userKey) : identityKey,
              totalWatchtime: Math.round(totalWatchMs / 1000),
              totalLikes: Object.keys(p.likedVideos || {}).length,
              totalDislikes: 0,
              visits: visits.visits || 1,
              lastSeen: visits.last || p.lastSeenAt || 0,
            });
          }
          for (const p of Object.values(userVideoProgress)) {
            const pct = Number((p && p.percentWatched) || 0);
            funnel.start += 1;
            if (pct >= 25) funnel.p25 += 1;
            if (pct >= 50) funnel.p50 += 1;
            if (pct >= 75) funnel.p75 += 1;
            if (pct >= 95 || p.completed) funnel.p95 += 1;
            if (p && p.videoId) {
              if (!perVideo[p.videoId]) perVideo[p.videoId] = { watchMs: 0, viewers: 0, completions: 0 };
              if (pct >= 95 || p.completed) perVideo[p.videoId].completions += 1;
            }
          }
          viewers.sort((a, b) => b.totalWatchtime - a.totalWatchtime);
          const topVideos = Object.entries(perVideo)
            .sort((a, b) => (b[1].watchMs + b[1].completions * 45000) - (a[1].watchMs + a[1].completions * 45000))
            .slice(0, 40)
            .map(([videoId, s]) => ({ videoId, watchSeconds: Math.round((s.watchMs || 0) / 1000), viewers: s.viewers || 0, completions: s.completions || 0 }));
          const totalRecoImpressions = recoEvents.filter((e) => e.eventType === 'impression').length;
          const totalRecoClicks = recoEvents.filter((e) => e.eventType === 'click').length;
          return sendJson(res, 200, {
            viewers: viewers.slice(0, 200),
            funnel,
            topVideos,
            recommendation: {
              impressions: totalRecoImpressions,
              clicks: totalRecoClicks,
              ctr: totalRecoImpressions > 0 ? Number(((totalRecoClicks / totalRecoImpressions) * 100).toFixed(2)) : 0,
            },
            telemetryHealth: {
              events: recoEvents.length,
              profiles: Object.keys(userProfiles).length,
              progressRows: Object.keys(userVideoProgress).length,
              updatedAt: recoGlobalStats.updatedAt || 0,
            },
          });
        } catch (e) {
          console.error('[watchtime api]', e);
          return sendJson(res, 500, { error: 'Internal error' });
        }
      }

      // ── Custom Links CRUD ──
      if (requestUrl.pathname === '/admin/api/custom-links') {
        const method = (req.method || 'GET').toUpperCase();
        if (method === 'GET') {
          const links = Object.values(customLinks).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          return sendJson(res, 200, { links });
        }
        if (method === 'POST') {
          const body = await readJsonBody(req, res);
          if (!body) return;
          const slug = String(body.slug || '').trim().toLowerCase().replace(/[^a-z0-9\-]/g, '');
          if (!slug || slug.length < 2 || slug.length > 40) return sendJson(res, 400, { error: 'Slug must be 2-40 chars, lowercase alphanumeric + hyphens' });
          // Block reserved paths
          const reserved = new Set(['admin', 'api', 'media', 'thumbnails', 'shorts', 'data', 'index', 'folder', 'video', 'login', 'signup', 'upload', 'checkout', 'search', 'support', 'custom-requests', 'live-cams', 'create-account', 'robots', 'sitemap', 'favicon']);
          if (reserved.has(slug)) return sendJson(res, 400, { error: 'That slug is reserved' });
          if (customLinks[slug]) return sendJson(res, 400, { error: 'Link already exists' });
          customLinks[slug] = { slug, clicks: 0, signups: 0, createdAt: Date.now() };
          await saveCustomLinks();
          return sendJson(res, 201, { ok: true, link: customLinks[slug] });
        }
        if (method === 'DELETE') {
          const body = await readJsonBody(req, res);
          if (!body) return;
          const slug = String(body.slug || '').trim().toLowerCase();
          if (!slug || !customLinks[slug]) return sendJson(res, 404, { error: 'Link not found' });
          delete customLinks[slug];
          await saveCustomLinks();
          return sendJson(res, 200, { ok: true });
        }
        return sendJson(res, 405, { error: 'Method Not Allowed' });
      }

      // ── Video rename requests (admin) ──
      if (requestUrl.pathname === '/admin/api/video-rename-requests' && (req.method || 'GET').toUpperCase() === 'GET') {
        await loadVideoRenameRequests(true);
        const site = String(SITE_ORIGIN || '').replace(/\/$/, '');
        const key = renameModerateSigningKey();
        const pending = videoRenameRequests.filter(
          (r) => r && !r.finalized && (r.status === 'pending' || r.status === 'error'),
        );
        const recent = videoRenameRequests
          .filter((r) => r && r.status !== 'pending' && r.status !== 'error')
          .sort((a, b) => (b.updatedAt || b.requestedAt || 0) - (a.updatedAt || a.requestedAt || 0))
          .slice(0, 40);
        const mapRow = (r) => {
          const row = {
            requestId: r.requestId,
            folder: r.folder || '',
            subfolder: r.subfolder || '',
            vault: r.vault || '',
            oldName: r.oldName || '',
            requestedName: r.requestedName || '',
            requestedBy: r.requestedBy || '',
            requestedByName: r.requestedByName || '',
            requestedAt: r.requestedAt || 0,
            status: r.status || '',
            newName: r.newName || '',
            reviewedAt: r.reviewedAt || 0,
            reviewedBy: r.reviewedBy || '',
            applyError: r.applyError || '',
          };
          if (key && site && r.requestId && r.status === 'pending') {
            try {
              row.approveUrl = buildRenameModerateLink(site, r.requestId, 'approve', key);
              row.rejectUrl = buildRenameModerateLink(site, r.requestId, 'reject', key);
            } catch {}
          }
          return row;
        };
        return sendJson(res, 200, {
          ok: true,
          pending: pending.map(mapRow),
          recent: recent.map(mapRow),
          canSignLinks: !!(key && site),
        });
      }

      if (requestUrl.pathname === '/admin/api/video-rename-review' && (req.method || 'POST').toUpperCase() === 'POST') {
        const body = await readJsonBody(req, res, 16 * 1024);
        if (!body) return;
        const requestId = String(body.requestId || '').trim();
        const action = String(body.action || '').trim().toLowerCase();
        if (!requestId || (action !== 'approve' && action !== 'reject')) {
          return sendJson(res, 400, { error: 'requestId and action (approve|reject) required' });
        }
        await loadVideoRenameRequests(true);
        const out = await runVideoRenameModeration(requestId, action, 'admin-panel');
        if (out.type === 'not_found') return sendJson(res, 404, { error: 'Request not found' });
        if (out.type === 'not_pending') return sendJson(res, 400, { error: `Not pending (status: ${out.status || 'unknown'})` });
        if (out.type === 'already_approved') {
          return sendJson(res, 200, { ok: true, already: true, message: 'Already approved', newName: out.newName || '' });
        }
        if (out.type === 'already_rejected') {
          return sendJson(res, 200, { ok: true, already: true, message: 'Already rejected' });
        }
        if (out.type === 'apply_error') {
          return sendJson(res, 500, { ok: false, error: out.message || 'Rename failed' });
        }
        return sendJson(res, 200, {
          ok: true,
          result: out.type,
          newName: out.newName || '',
        });
      }

      return sendJson(res, 404, { error: 'Unknown admin endpoint' });
    }

    // ===== OMEGLEPAY WEBHOOK: set tier by referral code =====
    if (requestUrl.pathname === '/api/omeglepay/set-tier') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });
      const body = await readJsonBody(req, res);
      if (!body) return;
      const secret = String(body.secret || '');
      const expectedSecret = process.env.OMEGLEPAY_SECRET || '';
      if (!expectedSecret) return sendJson(res, 401, { error: 'Unauthorized' });
      // Constant-time comparison to prevent timing attacks
      const sBuf = Buffer.from(secret);
      const eBuf = Buffer.from(expectedSecret);
      if (sBuf.length !== eBuf.length || !crypto.timingSafeEqual(sBuf, eBuf)) return sendJson(res, 401, { error: 'Unauthorized' });
      const refCode = String(body.refCode || '').trim();
      const plan = String(body.plan || '').trim();
      if (!refCode) return sendJson(res, 400, { error: 'Missing refCode' });
      if (!plan) return sendJson(res, 400, { error: 'Missing plan' });
      const newTier = omeglePayTierFromPlan(plan);
      if (newTier === null) return sendJson(res, 400, { error: 'Invalid plan' });
      const db = await ensureUsersDbFresh();
      const userKey = findUserKeyByReferralCode(db, refCode);
      if (!userKey) return sendJson(res, 404, { error: 'User not found for refCode' });
      const u = db.users[userKey];
      u.tier = newTier;
      u.purchaseMethod = 'omeglepay';
      u.purchaseDate = new Date().toISOString();
      // CRITICAL: Write immediately for payment — do NOT use debounced schedule
      await _doUsersDbWrite();
      console.log(`[omeglepay webhook] Set tier ${newTier} for user ${userKey} (ref ${refCode})`);
      // Notify Discord payment channel
      const _planLabel = `${displayLabelForTier(newTier)} — ${displayPriceForTier(newTier)}`;
      const _dispName = (u.username || u.discordUsername || userKey).replace(/^discord:/, '');
      _beacon(DISCORD_WEBHOOK_PAYMENTS_URL, {
        embeds: [{
          title: '💳 Card Payment — Tier Granted',
          color: 0x00c853,
          fields: [
            { name: 'User', value: _dispName, inline: true },
            { name: 'Plan', value: _planLabel, inline: true },
            { name: 'Method', value: 'Card (OmegaPay)', inline: true },
            { name: 'Ref Code', value: refCode, inline: true },
          ],
          timestamp: new Date().toISOString(),
        }],
      });
      // Add to admin payment log so it shows in dashboard
      try {
        const _planKey = planKeyForTier(newTier) || String(plan).toLowerCase();
        adminPush(adminPaymentLog, {
          ts: Date.now(), username: _dispName, userKey, plan: _planKey, method: 'card (omeglepay)',
          screenshotKey: null, screenshotB64: null, contentType: null, grantedTier: newTier,
        }, 500);
      } catch {}
      return sendJson(res, 200, { ok: true, tier: newTier });
    }

    // ===== REDEEM ACCESS KEY (XYZPurchase/Supabase) =====
    if (requestUrl.pathname === '/api/redeem-key') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });
      if (!isAllowedRedeemOrigin(req)) return sendJson(res, 403, { error: 'Forbidden' });

      // Must be logged in
      await ensureSessionsLoaded();
      const userKey = await getAuthedUserKeyWithRefresh(req);
      if (!userKey) return sendJson(res, 401, { error: 'You must be logged in to redeem a key.' });

      const ip = normalizeIp(getClientIp(req));
      const rl = bumpRedeemRate(ip, userKey);
      if (!rl.allowed) {
        res.setHeader('Retry-After', String(Math.ceil((rl.retryAfterMs || REDEEM_RATE_WINDOW_MS) / 1000)));
        return sendJson(res, 429, { error: 'Too many attempts. Please wait and try again.' });
      }

      const body = await readJsonBody(req, res);
      if (!body) return;

      const rawKey = body.accessKey || body.key || '';
      const key = normalizeAccessKey(rawKey);
      if (!key || key.length < 8 || key.length > 64) {
        console.warn(`[redeem-key] invalid format ip=${ip} user=${userKey} key=${String(rawKey).slice(0, 8)}...`);
        try { adminEmitEvent('redeem_fail', `${userKey} invalid-format key`); } catch {}
        return sendJson(res, 400, { error: 'Invalid access key.' });
      }

      try {
        const keyFilter = `${encodeURIComponent(SUPABASE_ACCESS_KEY_COLUMN)}=eq.${encodeURIComponent(key)}`;
        const q = `/rest/v1/${encodeURIComponent(SUPABASE_ACCESS_KEYS_TABLE)}?${keyFilter}&select=*`;
        const lookupResp = await supabaseFetch(q, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        if (!lookupResp.ok) {
          let _body = '';
          try { _body = await lookupResp.text(); } catch {}
          console.error('[redeem-key] supabase lookup failed status=', lookupResp.status, 'body=', _body.slice(0, 400));
          return sendJson(res, 500, { error: 'Unable to redeem key right now.' });
        }
        const rows = await lookupResp.json();
        const rec = Array.isArray(rows) ? rows[0] : null;
        if (!rec) {
          console.warn(`[redeem-key] invalid key ip=${ip} user=${userKey} key=${key.slice(0, 8)}...`);
          try { adminEmitEvent('redeem_fail', `${userKey} invalid key`); } catch {}
          return sendJson(res, 400, { error: 'Invalid access key.' });
        }
        const recRedeemedAt = rec.redeemed_at ?? rec.redeemedAt ?? null;
        const recRedeemedBy = rec.redeemed_by ?? rec.redeemedBy ?? null;
        if (recRedeemedAt || recRedeemedBy) {
          console.warn(`[redeem-key] already used ip=${ip} user=${userKey} key=${key.slice(0, 8)}... by=${recRedeemedBy || 'unknown'}`);
          try { adminEmitEvent('redeem_fail', `${userKey} used key`); } catch {}
          return sendJson(res, 409, { error: 'This key has already been redeemed.' });
        }

        const plan = planFromProductSlug(rec.product_slug || rec.product_title || '');
        const newTier = tierForPaidPlan(plan);
        if (!newTier) {
          console.error('[redeem-key] unknown product for key', rec.product_slug, rec.product_title);
          return sendJson(res, 400, { error: 'Invalid access key.' });
        }

        const deleteResp = await supabaseFetch(`/rest/v1/${encodeURIComponent(SUPABASE_ACCESS_KEYS_TABLE)}?${keyFilter}`, {
          method: 'DELETE',
          headers: {
            Prefer: 'return=representation',
          },
        });
        if (!deleteResp.ok) {
          let _body = '';
          try { _body = await deleteResp.text(); } catch {}
          console.error('[redeem-key] supabase consume failed status=', deleteResp.status, 'body=', _body.slice(0, 400));
          return sendJson(res, 500, { error: 'Unable to redeem key right now.' });
        }
        const deletedRows = await deleteResp.json();
        if (!Array.isArray(deletedRows) || deletedRows.length === 0) {
          return sendJson(res, 409, { error: 'This key has already been redeemed.' });
        }

        const db = await ensureUsersDbFresh();
        const u = db.users[userKey];
        if (!u) return sendJson(res, 404, { error: 'User not found' });

        u.tier = newTier;
        u.purchaseMethod = 'access_key';
        u.purchaseDate = new Date().toISOString();
        // CRITICAL: Write immediately for payment — do NOT use debounced schedule
        await _doUsersDbWrite();

        console.log(`[redeem-key] User ${userKey} redeemed key (${plan}) → tier ${newTier}`);
        try { adminEmitEvent('redeem_success', `${userKey} redeemed ${plan}`); } catch {}

        // Discord notification
        const _dispName = (u.username || userKey).replace(/^discord:/, '');
        const _planLabel = newTier >= 2 ? 'Premium (Tier 2)' : 'Basic (Tier 1)';
        _beacon(ACCESS_REDEEM_WEBHOOK_URL, {
          embeds: [{
            title: '🔑 Access Key Redeemed',
            color: 0x00c853,
            fields: [
              { name: 'User', value: _dispName, inline: true },
              { name: 'Tier', value: _planLabel, inline: true },
              { name: 'Method', value: 'Access Key (XYZPurchase)', inline: true },
              { name: 'Product', value: String(rec.product_title || rec.product_slug || plan), inline: false },
            ],
            timestamp: new Date().toISOString(),
          }],
        });

        // Admin payment log
        try {
          const _planKey = newTier >= 2 ? 'premium' : 'basic';
          adminPush(adminPaymentLog, {
            ts: Date.now(), username: _dispName, userKey, plan: _planKey, method: 'access_key',
            screenshotKey: null, screenshotB64: null, contentType: null, grantedTier: newTier,
          }, 500);
        } catch {}

        return sendJson(res, 200, {
          success: true,
          tier: newTier,
          plan,
          productSlug: rec.product_slug || null,
          message: 'Access key redeemed successfully.',
        });
      } catch (err) {
        console.error('[redeem-key] Error:', err && err.message ? err.message : err);
        return sendJson(res, 500, { error: 'Unable to redeem key right now.' });
      }
    }

    // ===== PATREON WEBHOOK =====
    if (requestUrl.pathname === '/api/patreon/webhook') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });
      let rawBody = '';
      try {
        const chunks = [];
        let total = 0;
        const MAX = 512 * 1024;
        await new Promise((resolve, reject) => {
          req.on('data', (c) => {
            total += c.length;
            if (total > MAX) {
              reject(new Error('payload_too_large'));
              try { req.destroy(); } catch {}
              return;
            }
            chunks.push(c);
          });
          req.on('end', resolve);
          req.on('error', reject);
        });
        rawBody = Buffer.concat(chunks).toString('utf8');
      } catch (e) {
        return sendJson(res, 413, { error: 'Payload too large' });
      }

      const sig = String(req.headers['x-patreon-signature'] || '').trim();
      if (!patreonVerifySignature(rawBody, sig)) {
        console.warn('[patreon webhook] signature verify failed (header=', sig.slice(0, 8), '... secret-set=', !!PATREON_WEBHOOK_SECRET, ')');
        return sendJson(res, 401, { error: 'Bad signature' });
      }

      let payload;
      try { payload = JSON.parse(rawBody); }
      catch { return sendJson(res, 400, { error: 'Bad JSON' }); }

      const event = String(req.headers['x-patreon-event'] || '').trim();
      const data = (payload && payload.data) || {};
      const attrs = data.attributes || {};
      const email = patreonNormalizeEmail(attrs.email);
      const status = String(attrs.patron_status || '').trim();
      const cents = Number(
        attrs.currently_entitled_amount_cents
        ?? attrs.pledge_amount_cents
        ?? attrs.will_pay_amount_cents
        ?? 0
      ) || 0;

      if (!email) {
        console.warn('[patreon webhook] event=', event, 'no email in payload, ignoring');
        return sendJson(res, 200, { ok: true, ignored: 'no_email' });
      }

      const tier = (status === 'active_patron') ? patreonTierFromCents(cents) : 0;
      const prev = patreonPatrons[email] || {};
      patreonPatrons[email] = {
        tier,
        status: status || prev.status || 'unknown',
        cents,
        lastEvent: event,
        updatedAt: Date.now(),
        redeemedBy: prev.redeemedBy || null,
        redeemedAt: prev.redeemedAt || null,
      };
      void savePatreonPatrons();

      console.log(`[patreon webhook] event=${event} email=${email.slice(0, 4)}*** status=${status} cents=${cents} -> tier=${tier}`);

      if (event === 'members:pledge:create' && status === 'active_patron' && tier > 0) {
        const _dedupKey = `${email}:${cents}`;
        if (!patreonNotifyDedup.has(_dedupKey)) {
          patreonNotifyDedup.set(_dedupKey, Date.now());
          setTimeout(() => patreonNotifyDedup.delete(_dedupKey), 5 * 60 * 1000);
          const _planLabel = displayLabelForTier(tier);
          const _amountStr = '$' + (cents / 100).toFixed(2);
          _beacon(PATREON_REDEEM_WEBHOOK_URL, {
            embeds: [{
              title: 'Patreon Payment',
              color: 0x00c853,
              fields: [
                { name: 'Email', value: email, inline: true },
                { name: 'Amount', value: _amountStr, inline: true },
                { name: 'Tier', value: _planLabel, inline: true },
              ],
              timestamp: new Date().toISOString(),
            }],
          });
        }
      }
      return sendJson(res, 200, { ok: true, tier });
    }

    if (requestUrl.pathname === '/api/patreon/redeem') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });
      if (!isAllowedRedeemOrigin(req)) return sendJson(res, 403, { error: 'Forbidden' });

      await ensureSessionsLoaded();
      const userKey = await getAuthedUserKeyWithRefresh(req);
      if (!userKey) return sendJson(res, 401, { error: 'You must be logged in to redeem.' });

      const ip = normalizeIp(getClientIp(req));
      const rl = bumpRedeemRate(ip, userKey);
      if (!rl.allowed) {
        res.setHeader('Retry-After', String(Math.ceil((rl.retryAfterMs || REDEEM_RATE_WINDOW_MS) / 1000)));
        return sendJson(res, 429, { error: 'Too many attempts. Please wait and try again.' });
      }

      const body = await readJsonBody(req, res);
      if (!body) return;

      const email = patreonNormalizeEmail(body.email);
      if (!email || email.length < 5 || email.length > 254 || email.indexOf('@') < 1 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return sendJson(res, 400, { error: 'Enter a valid email address.' });
      }

      const rec = patreonPatrons[email];
      if (!rec || !rec.tier || rec.tier < 1) {
        console.warn(`[patreon redeem] no active membership for ${email.slice(0, 4)}*** (user=${userKey})`);
        try { adminEmitEvent('redeem_fail', `${userKey} patreon-no-membership`); } catch {}
        return sendJson(res, 404, { error: 'No active membership found for that email. If you just subscribed, give it a minute and try again.' });
      }

      if (rec.redeemedBy && rec.redeemedBy !== userKey) {
        console.warn(`[patreon redeem] email already used by ${rec.redeemedBy}, attempted by ${userKey}`);
        try { adminEmitEvent('redeem_fail', `${userKey} patreon-already-claimed`); } catch {}
        return sendJson(res, 409, { error: 'This Patreon email has already been used to unlock a different account.' });
      }

      const db = await ensureUsersDbFresh();
      const u = db.users[userKey];
      if (!u) return sendJson(res, 404, { error: 'User not found' });

      const newTier = rec.tier;
      if (typeof u.tier === 'number' && u.tier > newTier) {
        rec.redeemedBy = userKey;
        rec.redeemedAt = Date.now();
        await savePatreonPatronsNow();
        return sendJson(res, 200, { success: true, tier: u.tier, message: 'Your account already has higher access. Patreon membership linked.' });
      }

      u.tier = newTier;
      u.purchaseMethod = 'patreon';
      u.purchaseDate = new Date().toISOString();
      await _doUsersDbWrite();

      rec.redeemedBy = userKey;
      rec.redeemedAt = Date.now();
      await savePatreonPatronsNow();

      console.log(`[patreon redeem] user=${userKey} tier=${newTier} via ${email.slice(0, 4)}***`);
      try { adminEmitEvent('redeem_success', `${userKey} redeemed patreon (tier ${newTier})`); } catch {}

      const _dispName = (u.username || userKey).replace(/^discord:/, '');
      const _planLabel = `${displayLabelForTier(newTier)} (Tier ${newTier})`;
      const _planPrice = displayPriceForTier(newTier);
      _beacon(ACCESS_REDEEM_WEBHOOK_URL, {
        embeds: [{
          title: 'Patreon Membership Redeemed',
          color: 0x00c853,
          fields: [
            { name: 'User', value: _dispName, inline: true },
            { name: 'Tier', value: _planLabel, inline: true },
            { name: 'Amount', value: _planPrice, inline: true },
            { name: 'Method', value: 'Patreon', inline: true },
            { name: 'Patreon email', value: email, inline: false },
          ],
          timestamp: new Date().toISOString(),
        }],
      });

      try {
        const _planKey = planKeyForTier(newTier) || 'tier' + newTier;
        adminPush(adminPaymentLog, {
          ts: Date.now(), username: _dispName, userKey, plan: _planKey, method: 'patreon',
          screenshotKey: null, screenshotB64: null, contentType: null, grantedTier: newTier,
        }, 500);
      } catch {}

      return sendJson(res, 200, {
        success: true,
        tier: newTier,
        message: 'Patreon membership verified. Your access is unlocked.',
      });
    }

    if (requestUrl.pathname === '/api/patreon/status') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });
      if (!isAllowedRedeemOrigin(req)) return sendJson(res, 403, { error: 'Forbidden' });
      const body = await readJsonBody(req, res);
      if (!body) return;
      const email = patreonNormalizeEmail(body.email);
      if (!email) return sendJson(res, 400, { error: 'Email required' });
      const rec = patreonPatrons[email];
      if (!rec) return sendJson(res, 200, { found: false });
      return sendJson(res, 200, {
        found: true,
        tier: rec.tier || 0,
        status: rec.status || 'unknown',
        redeemed: !!rec.redeemedBy,
      });
    }

    // ===== CUSTOM LINK LANDING: /slug =====
    // Admin-created vanity URLs for campaign tracking (e.g. /omegle, /twitter)
    const clinkSlug = requestUrl.pathname.slice(1).toLowerCase();
    if (clinkSlug && customLinks[clinkSlug]) {
      customLinks[clinkSlug].clicks = (customLinks[clinkSlug].clicks || 0) + 1;
      const clinkCookie = [
        `${CLINK_COOKIE}=${encodeURIComponent(clinkSlug)}`,
        'Path=/',
        'SameSite=Lax',
        'Max-Age=86400',
      ].join('; ');
      appendSetCookie(res, clinkCookie);
      void saveCustomLinks();
      res.writeHead(302, { Location: '/' });
      return res.end();
    }

    // ===== REFERRAL LANDING: /XXXXXXX =====
    // If someone visits a 7-char code path, store it in a cookie and redirect home.
    // This is handled before static allowlist checks.
    const landingMatch = /^\/([a-zA-Z0-9]{7})$/.exec(requestUrl.pathname);
    if (landingMatch) {
      const code = landingMatch[1];
      const db = await ensureUsersDbFresh();
      const refUserKey = findUserKeyByReferralCode(db, code);
      if (!refUserKey) {
        // If Vite-built assets are missing, allow loading from the repo's external `images/` and `thumbnails/`
        // roots under the new `/assets/...` URL paths.
        if (
          pathname.startsWith('/assets/images/') ||
          pathname.startsWith('/assets/thumbnails/') ||
          pathname.startsWith('/assets/branding/')
        ) {
          const imagesRoot =
            resolveEnvPath(process.env.TBW_IMAGES_ROOT, path.resolve(__dirname, 'images')) || path.resolve(__dirname, 'images');
          const thumbsRoot =
            resolveEnvPath(process.env.TBW_THUMBNAILS_ROOT, path.resolve(__dirname, 'thumbnails')) || path.resolve(__dirname, 'thumbnails');
          const brandingRoot =
            resolveEnvPath(
              process.env.TBW_BRANDING_ROOT,
              path.resolve(__dirname, 'client', 'public', 'assets', 'branding'),
            ) || path.resolve(__dirname, 'client', 'public', 'assets', 'branding');
          const ASSET_PREFIX_IMAGES = '/assets/images/';
          const ASSET_PREFIX_THUMBS = '/assets/thumbnails/';
          const ASSET_PREFIX_BRANDING = '/assets/branding/';
          const externalRoot = pathname.startsWith(ASSET_PREFIX_IMAGES)
            ? imagesRoot
            : pathname.startsWith(ASSET_PREFIX_THUMBS)
              ? thumbsRoot
              : brandingRoot;
          const prefixLen = pathname.startsWith(ASSET_PREFIX_IMAGES)
            ? ASSET_PREFIX_IMAGES.length
            : pathname.startsWith(ASSET_PREFIX_THUMBS)
              ? ASSET_PREFIX_THUMBS.length
              : ASSET_PREFIX_BRANDING.length;

          try {
            const rel = decodeURIComponent(pathname.slice(prefixLen));
            const abs = path.resolve(externalRoot, path.normalize(rel));
            if (abs.startsWith(path.resolve(externalRoot) + path.sep)) {
              const st = await fs.promises.stat(abs).catch(() => null);
              if (st && st.isFile()) {
                const raw = await fs.promises.readFile(abs);
                const ct = getContentType(abs);
                res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'public, max-age=31536000, immutable' });
                return res.end(_methodUp === 'HEAD' ? Buffer.alloc(0) : raw);
              }
            }
          } catch (_) {}
        }
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Not Found');
      }
      setReferralCookie(res, code);
      res.writeHead(302, { Location: `/?ref=${encodeURIComponent(code)}` });
      return res.end();
    }

    // ===== REPLACE IP ACCOUNT =====
    if (requestUrl.pathname === '/api/replace-ip-account') {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });
      await ensureSessionsLoaded();
      const callerIp = normalizeIp(getClientIp(req));
      if (!callerIp || callerIp === 'unknown') return sendJson(res, 400, { error: 'Cannot determine IP' });

      // Parse body manually — legacy callers may send no body at all
      let body = {};
      const ct = String(req.headers['content-type'] || '').toLowerCase();
      if (ct.includes('application/json')) {
        try {
          const raw = await new Promise((resolve) => {
            const chunks = [];
            req.on('data', c => chunks.push(c));
            req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          });
          if (raw) body = JSON.parse(raw);
        } catch {}
      }
      const wantSignup = body && body.username && body.password;

      const db = await getOrLoadUsersDb();
      const deletedKeys = [];
      for (const [key, u] of Object.entries(db.users)) {
        if (u.signupIp && u.signupIp === callerIp) {
          deletedKeys.push(key);
        }
      }
      if (!deletedKeys.length) return sendJson(res, 404, { error: 'No account found on this IP' });
      // Remove sessions and delete ALL matching accounts (including paid)
      for (const dk of deletedKeys) {
        for (const [tok, sess] of sessions.entries()) {
          if (sess.userKey === dk) sessions.delete(tok);
        }
        delete db.users[dk];
        deletedUserKeys.add(dk);
        console.log(`[replace-ip] Deleted account "${dk}" from IP ${callerIp}`);
      }

      // If credentials provided, create the new account + auto-login in one shot
      if (wantSignup) {
        const username = String(body.username).trim();
        const password = String(body.password);
        if (!isValidUsername(username)) { await queueUsersDbWrite(); return sendJson(res, 400, { error: 'Username must be 3-24 characters (letters, numbers, _ or -)' }); }
        if (!isValidPassword(password)) { await queueUsersDbWrite(); return sendJson(res, 400, { error: 'Password must be at least 8 characters' }); }
        const newKey = username.toLowerCase();
        if (db.users[newKey]) { await queueUsersDbWrite(); return sendJson(res, 409, { error: 'That username is already taken' }); }

        const salt = crypto.randomBytes(16).toString('hex');
        const hash = scryptHex(password, salt);
        db.users[newKey] = {
          username,
          provider: 'local',
          salt,
          hash,
          createdAt: Date.now(),
          signupIp: callerIp,
          tier: null,
          referralCode: null,
          referredBy: null,
          referredUsers: [],
        };
        ensureUserReferralCode(db, newKey);

        // Referral attribution
        const cookies = parseCookies(req);
        const refCode = cookies[REF_COOKIE];
        if (isValidReferralCode(refCode)) {
          const refUserKey = findUserKeyByReferralCode(db, refCode);
          if (refUserKey && refUserKey !== newKey) {
            const refUser = db.users[refUserKey];
            const refIp = normalizeIp(refUser && refUser.signupIp);
            const sameIp = refIp !== 'unknown' && callerIp !== 'unknown' && refIp === callerIp;
            if (!Array.isArray(refUser.referralCreditIps)) refUser.referralCreditIps = [];
            const ipAlreadyCredited = callerIp !== 'unknown' && refUser.referralCreditIps.includes(callerIp);
            if (!sameIp && !ipAlreadyCredited) {
              if (!Array.isArray(refUser.referredUsers)) refUser.referredUsers = [];
              const prevTier = tierFromCount(refUser.referredUsers.length);
              if (!refUser.referredUsers.includes(newKey)) refUser.referredUsers.push(newKey);
              const nextTier = tierFromCount(refUser.referredUsers.length);
              if ((nextTier === 1 || nextTier === 2) && nextTier > prevTier) _emitTierReached(db, req, refUserKey, nextTier);
              if (callerIp !== 'unknown') refUser.referralCreditIps.push(callerIp);
              db.users[newKey].referredBy = refCode;
            }
          }
        }

        await queueUsersDbWrite();
        _emitSignup(db, username, 'local', db.users[newKey].referredBy || null, callerIp);
        clearReferralCookie(res);

        // Auto-login: set session cookie
        const token = crypto.randomBytes(32).toString('hex');
        sessions.set(token, { userKey: newKey, createdAt: Date.now() });
        persistSessionsToR2();
        setSessionCookie(res, token);
        return sendJson(res, 201, { ok: true, deleted: deletedKeys, created: newKey, authed: true });
      }

      await queueUsersDbWrite();
      return sendJson(res, 200, { ok: true, deleted: deletedKeys });
    }

    // ===== AUTH: SIGNUP =====
    if (requestUrl.pathname === '/api/signup') {

      const signupIpRL = normalizeIp(getClientIp(req));
      const srl = bumpSignupRate(signupIpRL);
      if (!srl.allowed) {
        res.setHeader('Retry-After', String(Math.ceil((srl.retryAfterMs || 0) / 1000)));
        return sendJson(res, 429, { error: 'Too many signup attempts. Try again later.' });
      }

      const body = await readJsonBody(req, res);
      if (!body) return;

      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const email = String(body.email || '').trim().toLowerCase();
      if (!isValidUsername(username)) return sendJson(res, 400, { error: 'Username must be 3-24 characters (letters, numbers, _ or -)' });
      if (!isValidPassword(password)) return sendJson(res, 400, { error: 'Password must be at least 8 characters' });

      const key = username.toLowerCase();

      // Acquire signup lock to prevent race-condition duplicates
      const releaseSignupLock = await acquireSignupLock();
      try {

      const db = await getOrLoadUsersDb();
      if (userExistsByUsername(db, username)) {
        return sendJson(res, 409, { error: 'That username is already taken' });
      }

      // Block signup if IP is duplicate or user is on VPN
      const signupIp = normalizeIp(getClientIp(req));
      const signupCheck = await checkSignupBlocked(signupIp, db);
      if (signupCheck.blocked) {
        return sendJson(res, 409, { error: 'An account already exists from this IP.' });
      }

      const salt = crypto.randomBytes(16).toString('hex');
      const hash = scryptHex(password, salt);

      db.users[key] = {
        username,
        email,
        provider: 'local',
        salt,
        hash,
        createdAt: Date.now(),
        signupIp,
        tier: null,
        referralCode: null,
        referredBy: null,
        referredUsers: [],
      };

      // Ensure this user has a referral code.
      ensureUserReferralCode(db, key);

      // Referral attribution (if present in cookie)
      const cookies = parseCookies(req);
      const refCode = cookies[REF_COOKIE];
      if (isValidReferralCode(refCode)) {
        const refUserKey = findUserKeyByReferralCode(db, refCode);
        if (refUserKey && refUserKey !== key) {
          const refUser = db.users[refUserKey];
          const refIp = normalizeIp(refUser && refUser.signupIp);
          const sameIp = refIp !== 'unknown' && signupIp !== 'unknown' && refIp === signupIp;

          // Local dev helper: allow testing referrals/tier unlock on localhost.
          // Default behavior remains strict (blocks same-IP + one credit per IP).
          const allowLocalDevReferrals = process.env.TBW_DEV_ALLOW_SAME_IP_REFERRALS === '1'
            && signupIp === '127.0.0.1'
            && refIp === '127.0.0.1';

          if (!Array.isArray(refUser.referralCreditIps)) refUser.referralCreditIps = [];
          const ipAlreadyCredited = !allowLocalDevReferrals
            && signupIp !== 'unknown'
            && refUser.referralCreditIps.includes(signupIp);

          if ((allowLocalDevReferrals || !sameIp) && !ipAlreadyCredited) {
            // Credit exactly once per referred username
            if (!Array.isArray(refUser.referredUsers)) refUser.referredUsers = [];
            const prevReferralTier = tierFromCount(refUser.referredUsers.length);
            if (!refUser.referredUsers.includes(key)) {
              refUser.referredUsers.push(key);
            }
            const nextReferralTier = tierFromCount(refUser.referredUsers.length);
            if ((nextReferralTier === 1 || nextReferralTier === 2) && nextReferralTier > prevReferralTier) {
              _emitTierReached(db, req, refUserKey, nextReferralTier);
            }
            if (!allowLocalDevReferrals && signupIp !== 'unknown') refUser.referralCreditIps.push(signupIp);
            db.users[key].referredBy = refCode;
            // Two-sided reward: give the referred user a small bonus
            db.users[key].referredBonus = true;
          }
        }
      }

      await queueUsersDbWrite();

      // Analytics beacon (non-critical)
      _emitSignup(db, username, 'local', db.users[key].referredBy || null, signupIp);

      // Track custom link signup attribution
      const clinkCode = cookies[CLINK_COOKIE];
      if (clinkCode && customLinks[clinkCode]) {
        customLinks[clinkCode].signups = (customLinks[clinkCode].signups || 0) + 1;
        void saveCustomLinks();
      }
      // Clear referral + custom link cookies after signup to prevent re-use.
      clearReferralCookie(res);
      appendSetCookie(res, `${CLINK_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`);

      // Auto-login: create session so user doesn't need to log in after signup
      const signupToken = crypto.randomBytes(32).toString('hex');
      sessions.set(signupToken, { userKey: key, createdAt: Date.now() });
      persistSessionsToR2();
      setSessionCookie(res, signupToken);

      let sbSignupTokens = null;
      try {
        sbSignupTokens = await provisionLegacyLoginSupabaseSession(db.users[key], key, password);
      } catch (e) {
        console.warn('[auth] signup provisionLegacyLoginSupabaseSession', e && e.message ? e.message : e);
      }

      return sendJson(res, 201, { ok: true, ...(sbSignupTokens || {}) });

      } finally { releaseSignupLock(); }
    }

    // ===== PRESENCE HEARTBEAT =====
    if (requestUrl.pathname === '/api/ping') {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'POST' && method !== 'GET') return sendJson(res, 405, { error: 'Method Not Allowed' });
      await ensureSessionsLoaded();
      const pingUserKey = await getAuthedUserKeyWithRefresh(req);
      if (!pingUserKey) return sendJson(res, 200, { ok: false, authed: false });
      adminLastSeen.set(pingUserKey, Date.now());
      scheduleAdminPersist();
      return sendJson(res, 200, { ok: true, authed: true });
    }

    // ===== ANALYTICS TRACKING =====
    if (requestUrl.pathname === '/api/telemetry/event') {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });
      await ensureSessionsLoaded();
      const body = await readJsonBody(req, res);
      if (!body) return;
      const identity = ensureIdentity(req, res);
      const eventType = _safeStr(body.eventType, 48);
      if (!eventType) return sendJson(res, 400, { error: 'Missing eventType' });
      const rawVideoId = _safeStr(body.videoId, 260);
      const fallbackVideoId = canonicalVideoId(body.folder, body.subfolder || '', body.name);
      const videoId = rawVideoId || fallbackVideoId;
      const evt = appendRecoEvent(identity, {
        eventType,
        ts: body.ts,
        videoId,
        folder: body.folder,
        subfolder: body.subfolder,
        name: body.name,
        surface: body.surface,
        slot: body.slot,
        rank: body.rank,
        watchMs: body.watchMs || body.activeWatchMs || 0,
        positionSec: body.positionSec,
        durationSec: body.durationSec,
        percentWatched: body.percentWatched,
        completed: body.completed,
        action: body.action,
      });

      // Mirror to admin in-memory analytics for backward compatibility.
      const now = Date.now();
      if (evt.eventType === 'video_progress') {
        adminPush(adminVideoWatchTime, {
          duration: Math.round(Number(evt.watchMs || 0)),
          videoKey: String(evt.videoId || ''),
          ts: now,
        }, 2000);
        logAdminEventToSupabase('video_watch', {
          duration: Math.round(Number(evt.watchMs || 0)),
          videoKey: String(evt.videoId || '').slice(0, 128),
        }).catch(() => {});
      } else if (evt.eventType === 'shorts_progress') {
        adminPush(adminShortsUsage, { duration: Math.round(Number(evt.watchMs || 0)), ts: now }, 2000);
        logAdminEventToSupabase('shorts_usage', {
          duration: Math.round(Number(evt.watchMs || 0)),
        }).catch(() => {});
      } else if (evt.eventType === 'page_session') {
        adminPush(adminPageSessions, {
          page: String(body.page || '/').slice(0, 64),
          duration: Math.round(_safeNum(body.duration || evt.watchMs || 0, 0, 3600000)),
          bounced: !!body.bounced,
          ts: now,
        }, 2000);
        logAdminEventToSupabase('page_session', {
          page: String(body.page || '/').slice(0, 64),
          duration: Math.round(_safeNum(body.duration || evt.watchMs || 0, 0, 3600000)),
          bounced: !!body.bounced,
        }).catch(() => {});
      } else if (evt.eventType === 'nav_click' && body.label) {
        const label = String(body.label).slice(0, 32);
        adminNavClicks[label] = (adminNavClicks[label] || 0) + 1;
        logAdminEventToSupabase('nav_click', { label }).catch(() => {});
      }
      scheduleAdminPersist();
      maybeRebuildRecoGlobalStats();
      return sendJson(res, 200, { ok: true });
    }

    if (requestUrl.pathname === '/api/track') {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });
      try {
        // Parse body manually (sendBeacon sends text/plain, not application/json)
        const rawBody = await new Promise((resolve) => {
          const chunks = []; let size = 0;
          req.on('data', (c) => { size += c.length; if (size > 4096) { resolve(null); req.destroy(); return; } chunks.push(c); });
          req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          req.on('error', () => resolve(null));
        });
        if (!rawBody) return sendJson(res, 400, { error: 'Bad request' });
        let body;
        try { body = JSON.parse(rawBody); } catch { return sendJson(res, 400, { error: 'Invalid JSON' }); }
        if (!body || !body.event) return sendJson(res, 400, { error: 'Missing event' });
        const now = Date.now();
        await ensureSessionsLoaded();
        const identity = ensureIdentity(req, res);
        switch (body.event) {
          case 'nav_click':
            if (body.label && typeof body.label === 'string') {
              const label = body.label.slice(0, 32);
              adminNavClicks[label] = (adminNavClicks[label] || 0) + 1;
              scheduleAdminPersist();
              appendRecoEvent(identity, { eventType: 'nav_click', surface: body.page || 'site', watchMs: 0 });
              logAdminEventToSupabase('nav_click', { label }).catch(() => {});
            }
            break;
          case 'page_session':
            if (typeof body.duration === 'number' && body.duration > 0 && body.duration < 3600000) {
              adminPush(adminPageSessions, {
                page: String(body.page || '/').slice(0, 64),
                duration: Math.round(body.duration),
                bounced: !!body.bounced,
                ts: now,
              }, 1000);
              appendRecoEvent(identity, {
                eventType: 'page_session',
                watchMs: Math.round(body.duration),
                surface: String(body.page || '/').slice(0, 64),
              });
              logAdminEventToSupabase('page_session', {
                page: String(body.page || '/').slice(0, 64),
                duration: Math.round(body.duration),
                bounced: !!body.bounced,
              }).catch(() => {});
            }
            break;
          case 'shorts_usage':
            if (typeof body.duration === 'number' && body.duration > 0 && body.duration < 3600000) {
              adminPush(adminShortsUsage, { duration: Math.round(body.duration), ts: now }, 1000);
              appendRecoEvent(identity, { eventType: 'shorts_progress', watchMs: Math.round(body.duration), surface: 'shorts' });
              logAdminEventToSupabase('shorts_usage', { duration: Math.round(body.duration) }).catch(() => {});
            }
            break;
          case 'video_watch':
            if (typeof body.duration === 'number' && body.duration > 0 && body.duration < 3600000) {
              adminPush(adminVideoWatchTime, {
                duration: Math.round(body.duration),
                videoKey: String(body.videoKey || '').slice(0, 128),
                ts: now,
              }, 1000);
              appendRecoEvent(identity, {
                eventType: 'video_progress',
                watchMs: Math.round(body.duration),
                videoId: canonicalVideoId('', '', String(body.videoKey || '').slice(0, 128)),
                name: String(body.videoKey || '').slice(0, 128),
                surface: 'video',
              });
              logAdminEventToSupabase('video_watch', {
                duration: Math.round(body.duration),
                videoKey: String(body.videoKey || '').slice(0, 128),
              }).catch(() => {});
            }
            break;
        }
        return sendJson(res, 200, { ok: true });
      } catch {
        return sendJson(res, 400, { error: 'Bad request' });
      }
    }

    // ===== AUTH: LOGIN =====
    if (requestUrl.pathname === '/api/login') {
      const ip = getClientIp(req);
      const normIp = normalizeIp(ip);
      const rl = bumpLoginRate(ip);
      if (!rl.allowed) {
        res.setHeader('Retry-After', String(Math.ceil((rl.retryAfterMs || 0) / 1000)));
        return sendJson(res, 429, { error: 'Too many attempts' });
      }

      const body = await readJsonBody(req, res);
      if (!body) return;

      const loginId = String(body.username || body.email || '').trim();
      const password = String(body.password || '');
      if (!loginId) return sendJson(res, 401, { error: 'Invalid username or password.' });
      if (!isValidPassword(password)) return sendJson(res, 401, { error: 'Invalid username or password.' });

      const db = await ensureUsersDbFresh();
      const key = findUserKeyByLoginIdentifier(db, loginId);
      if (!key) return sendJson(res, 401, { error: 'Invalid username or password.' });
      const record = db.users[key];
      if (!record) return sendJson(res, 401, { error: 'Invalid username or password.' });

      if (String(record.provider || 'local') !== 'local') {
        const p = String(record.provider || '').toLowerCase();
        if (p === 'discord') {
          return sendJson(res, 401, {
            error: 'This account uses Discord. Sign in with the Discord button below instead of password.',
          });
        }
        if (p === 'google') {
          return sendJson(res, 401, {
            error: 'This account uses Google. Sign in with the Google button below instead of password.',
          });
        }
        return sendJson(res, 401, {
          error: 'Password sign-in is not available for this account. Use Discord or Google if you signed up with those.',
        });
      }

      if (!record.salt || !record.hash) {
        return sendJson(res, 401, {
          error:
            'No password is stored for this account yet. Use Discord or Google if you signed up with social login, or create a password by signing up through this site.',
        });
      }

      const calc = scryptHex(password, record.salt);
      const a = Buffer.from(calc, 'hex');
      const b = Buffer.from(String(record.hash || ''), 'hex');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return sendJson(res, 401, { error: 'Invalid username or password.' });
      }

      if (record.banned) {
        return sendJson(res, 403, { error: 'Banned' });
      }

      // Track login IP/time (for abuse prevention / auditing)
      record.lastLoginIp = normIp;
      record.lastLoginAt = Date.now();
      await queueUsersDbWrite();

      let sbTokens = null;
      try {
        sbTokens = await provisionLegacyLoginSupabaseSession(record, key, password);
      } catch (e) {
        console.warn('[auth] provisionLegacyLoginSupabaseSession', e && e.message ? e.message : e);
      }

      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, { userKey: key, createdAt: Date.now() });
      persistSessionsToR2();
      setSessionCookie(res, token);
      return sendJson(res, 200, { ok: true, ...(sbTokens || {}) });
    }

    // ===== AUTH: LOGOUT =====
    if (requestUrl.pathname === '/api/logout') {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });
      const cookies = parseCookies(req);
      const token = cookies[SESSION_COOKIE];
      if (token) {
        sessions.delete(token);
        persistSessionsToR2();
      }
      clearSessionCookie(res);
      return sendJson(res, 200, { ok: true });
    }

    // ===== AUTH: sync public.users row from Supabase Auth JWT (OAuth / email signup) =====
    if (requestUrl.pathname === '/api/auth/sync-profile') {
      const method = (req.method || 'POST').toUpperCase();
      if (method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });
      return await handleAuthSyncProfile(req, res);
    }

    // ===== AUTH: WHOAMI =====
    if (requestUrl.pathname === '/api/me') {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') return sendJson(res, 405, { error: 'Method Not Allowed' });
      await ensureSessionsLoaded();
      const userKey = await getAuthedUserKeyWithRefresh(req);
      if (!userKey) return sendJson(res, 200, { authed: false });

      const db = await ensureUsersDbFresh();
      const u = db.users[userKey];
      if (!u) {
        // Don't destroy session/cookie here — could be a transient R2 read issue.
        // Just report not authed; user can retry and the record may reappear.
        return sendJson(res, 200, { authed: false });
      }

      if (u.banned) {
        return sendJson(res, 200, { authed: false, banned: true });
      }

      if (!Array.isArray(u.referredUsers)) u.referredUsers = [];
      const tier = getEffectiveTierForUser(u);
      const tierLabel = tierLabelFromTier(tier);
      const displayName = stripDiscordPrefix(u.username || userKey);
      const avatarUrl = String(u.avatarUrl || '').trim();
      return sendJson(res, 200, { authed: true, username: displayName, tier, tierLabel, avatarUrl });
    }

    if (requestUrl.pathname === '/api/account') {
      const method = (req.method || 'GET').toUpperCase();
      if (method === 'GET' || method === 'HEAD') {
        await ensureSessionsLoaded();
        const userKey = await getAuthedUserKeyWithRefresh(req);
        if (!userKey) return sendJson(res, 200, { authed: false });
        const db = await ensureUsersDbFresh();
        const u = db.users[userKey];
        if (!u || u.banned) return sendJson(res, 200, { authed: false, banned: Boolean(u && u.banned) });
        const payload = await buildAccountPayload(userKey, u, db, req);
        await queueUsersDbWrite();
        return sendJson(res, 200, payload);
      }

      if (method === 'POST') {
        const authed = await requireAuthedUser(req, res);
        if (!authed) return;
        const { userKey, record: u, db } = authed;
        if (!u) return sendJson(res, 404, { error: 'User not found' });

        const body = await readJsonBody(req, res);
        if (!body) return;
        const hasUsername = Object.prototype.hasOwnProperty.call(body, 'username');
        const hasEmail = Object.prototype.hasOwnProperty.call(body, 'email');
        const hasDisplayName = Object.prototype.hasOwnProperty.call(body, 'displayName');
        const hasAvatar = Object.prototype.hasOwnProperty.call(body, 'avatarUrl');
        const hasBanner = Object.prototype.hasOwnProperty.call(body, 'bannerUrl');
        const hasBio = Object.prototype.hasOwnProperty.call(body, 'bio');
        const hasTwitter = Object.prototype.hasOwnProperty.call(body, 'twitterUrl');
        const hasInstagram = Object.prototype.hasOwnProperty.call(body, 'instagramUrl');
        const hasWebsite = Object.prototype.hasOwnProperty.call(body, 'websiteUrl');
        const hasFollowers = Object.prototype.hasOwnProperty.call(body, 'followersCount');
        const hasViews = Object.prototype.hasOwnProperty.call(body, 'videoViews');
        const hasRank = Object.prototype.hasOwnProperty.call(body, 'rank');
        const hasVideos = Object.prototype.hasOwnProperty.call(body, 'videos');
        const hasPhotos = Object.prototype.hasOwnProperty.call(body, 'photos');
        const hasGifs = Object.prototype.hasOwnProperty.call(body, 'gifs');

        if (!hasUsername && !hasEmail && !hasDisplayName && !hasAvatar && !hasBanner && !hasBio && !hasTwitter && !hasInstagram && !hasWebsite && !hasFollowers && !hasViews && !hasRank && !hasVideos && !hasPhotos && !hasGifs) {
          return sendJson(res, 400, { error: 'No updatable fields provided' });
        }

        let usernameChangedAtIso = null;
        if (hasUsername) {
          const nextUsername = String(body.username || '').trim();
          if (!isValidUsername(nextUsername)) {
            return sendJson(res, 400, { error: 'Username must be 3-24 characters (letters, numbers, _ or -)' });
          }
          const now = Date.now();
          const prevUsername = String(u.username || userKey);
          const usernameChanging = nextUsername.toLowerCase() !== prevUsername.toLowerCase();
          const changedAt = Number(u.lastUsernameChangeAt || 0);
          if (usernameChanging && changedAt > 0 && now - changedAt < ACCOUNT_USERNAME_CHANGE_WINDOW_MS) {
            const waitDays = Math.ceil((ACCOUNT_USERNAME_CHANGE_WINDOW_MS - (now - changedAt)) / (24 * 60 * 60 * 1000));
            return sendJson(res, 429, { error: `Username can be changed once every 7 days. Try again in about ${waitDays} day(s).` });
          }
          const existing = findUserKeyByUsername(db, nextUsername);
          if (existing && existing !== userKey) {
            return sendJson(res, 409, { error: 'That username is already taken' });
          }
          if (usernameChanging) {
            u.lastUsernameChangeAt = now;
            usernameChangedAtIso = new Date(now).toISOString();
          }
          u.username = nextUsername;
        }

        if (hasEmail) {
          const nextEmail = String(body.email || '').trim().toLowerCase();
          if (!isValidAccountEmail(nextEmail)) {
            return sendJson(res, 400, { error: 'Enter a valid email address' });
          }
          u.email = nextEmail;
        }

        const prevProfile = await fetchAccountProfileSupabase(userKey, u);
        const nextProfile = {
          ...prevProfile,
          username: String(u.username || userKey),
          display_name: hasDisplayName ? trimText(body.displayName, 80) || stripDiscordPrefix(u.username || userKey) : String(prevProfile.display_name || stripDiscordPrefix(u.username || userKey)),
          avatar_url: hasAvatar ? normalizeOptionalUrl(body.avatarUrl) : String(prevProfile.avatar_url || ''),
          banner_url: hasBanner ? normalizeOptionalUrl(body.bannerUrl) : String(prevProfile.banner_url || ''),
          bio: hasBio ? trimText(body.bio, 560) : String(prevProfile.bio || ''),
          twitter_url: hasTwitter ? normalizeOptionalUrl(body.twitterUrl) : String(prevProfile.twitter_url || ''),
          instagram_url: hasInstagram ? normalizeOptionalUrl(body.instagramUrl) : String(prevProfile.instagram_url || ''),
          website_url: hasWebsite ? normalizeOptionalUrl(body.websiteUrl) : String(prevProfile.website_url || ''),
          followers_count: hasFollowers ? Math.max(0, Number(body.followersCount) || 0) : Math.max(0, Number(prevProfile.followers_count) || 0),
          video_views: hasViews ? Math.max(0, Number(body.videoViews) || 0) : Math.max(0, Number(prevProfile.video_views) || 0),
          rank: hasRank ? Math.max(0, Number(body.rank) || 0) : Math.max(0, Number(prevProfile.rank) || 0),
          videos: hasVideos ? sanitizeMediaEntries(body.videos) : (Array.isArray(prevProfile.videos) ? prevProfile.videos : []),
          photos: hasPhotos ? sanitizeMediaEntries(body.photos) : (Array.isArray(prevProfile.photos) ? prevProfile.photos : []),
          gifs: hasGifs ? sanitizeMediaEntries(body.gifs) : (Array.isArray(prevProfile.gifs) ? prevProfile.gifs : []),
        };
        if (usernameChangedAtIso) nextProfile.username_changed_at = usernameChangedAtIso;
        await upsertAccountProfileSupabase(userKey, nextProfile);
        await queueUsersDbWrite();
        const payload = await buildAccountPayload(userKey, u, db, req);
        return sendJson(res, 200, { ok: true, ...payload });
      }

      return sendJson(res, 405, { error: 'Method Not Allowed' });
    }

    if (requestUrl.pathname === '/api/discord/bot/entitlements') {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') return sendJson(res, 405, { error: 'Method Not Allowed' });
      if (!DISCORD_BOT_SYNC_SECRET) return sendJson(res, 501, { error: 'Discord bot sync secret not configured' });
      const supplied = String(req.headers['x-bot-sync-secret'] || requestUrl.searchParams.get('secret') || '').trim();
      if (!supplied || supplied !== DISCORD_BOT_SYNC_SECRET) return sendJson(res, 401, { error: 'Unauthorized' });
      if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return sendJson(res, 503, { error: 'Supabase not configured' });

      const usersResp = await supabaseJson(`/rest/v1/${encodeURIComponent(SUPABASE_USERS_TABLE)}?select=user_key,discord_user_id,discord_username,tier,updated_at&discord_user_id=not.is.null&limit=5000`, { method: 'GET' });
      if (!usersResp.ok) {
        return sendJson(res, 500, {
          error: 'Failed to read entitlement data',
          usersOk: usersResp.ok,
        });
      }

      const rows = [];
      for (const userRow of (Array.isArray(usersResp.data) ? usersResp.data : [])) {
        const userKey = String(userRow.user_key || '');
        if (!userKey || !userRow.discord_user_id) continue;
        const tier = Math.max(0, Math.min(3, Number(userRow && userRow.tier ? userRow.tier : 0)));
        rows.push({
          userKey,
          discordUserId: String(userRow.discord_user_id),
          discordUsername: String(userRow.discord_username || ''),
          tier,
          status: tier > 0 ? 'active' : 'inactive',
          source: 'users_table',
          expiresAt: null,
          desiredRoleIds: desiredDiscordRoleIdsForTier(tier),
          updatedAt: userRow.updated_at || null,
        });
      }
      return sendJson(res, 200, {
        ok: true,
        count: rows.length,
        guildId: DISCORD_SYNC_GUILD_ID || null,
        roleMap: {
          basic: DISCORD_ROLE_ID_BASIC || null,
          premium: DISCORD_ROLE_ID_PREMIUM || null,
        },
        rows,
      });
    }

    if (requestUrl.pathname === '/api/account/connect') {
      const method = (req.method || 'GET').toUpperCase();
      const authed = await requireAuthedUser(req, res);
      if (!authed) return;
      let provider = '';
      if (method === 'POST') {
        const body = await readJsonBody(req, res);
        if (!body) return;
        provider = String(body.provider || '').toLowerCase();
      } else if (method === 'GET' || method === 'HEAD') {
        provider = String(requestUrl.searchParams.get('provider') || '').toLowerCase();
      } else {
        return sendJson(res, 405, { error: 'Method Not Allowed' });
      }
      const origin = getRequestOrigin(req);
      const { userKey } = authed;
      if (provider === 'discord') {
        setOAuthLinkCookie(res, 'discord', userKey);
        return sendJson(res, 200, { url: origin + '/auth/discord' });
      }
      if (provider === 'google') {
        setOAuthLinkCookie(res, 'google', userKey);
        return sendJson(res, 200, { url: origin + '/auth/google' });
      }
      return sendJson(res, 400, { error: 'Unknown provider' });
    }

    if (requestUrl.pathname === '/api/account/disconnect') {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });
      const authed = await requireAuthedUser(req, res);
      if (!authed) return;
      const { userKey, record: u } = authed;
      if (!u) return sendJson(res, 404, { error: 'User not found' });

      const body = await readJsonBody(req, res);
      if (!body) return;
      const provider = String(body.provider || '').toLowerCase();
      if (provider !== 'discord' && provider !== 'google') return sendJson(res, 400, { error: 'Unknown provider' });

      const hasLocal = Boolean((u.provider === 'local') || (u.hash && u.salt));
      const hasDiscord = isProviderLinked(u, 'discord');
      const hasGoogle = isProviderLinked(u, 'google');
      const remainingMethods = {
        local: hasLocal,
        discord: provider === 'discord' ? false : hasDiscord,
        google: provider === 'google' ? false : hasGoogle,
      };
      if (!remainingMethods.local && !remainingMethods.discord && !remainingMethods.google) {
        return sendJson(res, 409, { error: 'Cannot disconnect your only sign-in method' });
      }

      if (provider === 'discord') {
        u.discordId = null;
        if (u.provider === 'discord') {
          u.provider = remainingMethods.google ? 'google' : 'local';
        }
      }
      if (provider === 'google') {
        u.googleId = null;
        if (u.provider === 'google') {
          u.provider = remainingMethods.discord ? 'discord' : 'local';
        }
      }
      await queueUsersDbWrite();
      void syncDiscordEntitlementStateSupabase(userKey, u, `disconnect_${provider}`);
      return sendJson(res, 200, { ok: true, account: accountPayloadFor(userKey, u) });
    }

    // ===== SEO: resolve /:category/:video-slug for SPA (same map as server-side rewrite) =====
    if (requestUrl.pathname === '/api/resolve-clean-video') {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') return sendJson(res, 405, { error: 'Method Not Allowed' });
      const category = requestUrl.searchParams.get('category') || '';
      const video = requestUrl.searchParams.get('video') || '';
      if (!category || !video) return sendJson(res, 400, { error: 'missing category or video' });
      const lookupKey = category + '/' + video;
      const entry = videoSlugMap.get(lookupKey);
      if (!entry) return sendJson(res, 404, { error: 'not found' });
      return sendJson(res, 200, { folder: entry.folder, name: entry.name });
    }

    // ===== REFERRAL STATUS =====
    if (requestUrl.pathname === '/api/referral/status') {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') return sendJson(res, 405, { error: 'Method Not Allowed' });
      const authed = await requireAuthedUser(req, res);
      if (!authed) return;
      const { userKey, record: u, db } = authed;
      if (!u) return sendJson(res, 404, { error: 'User not found' });

      const code = ensureUserReferralCode(db, userKey);
      if (!Array.isArray(u.referredUsers)) u.referredUsers = [];
      const realCount = u.referredUsers.length;
      const tier = getEffectiveTierForUser(u);
      const count = Math.max(realCount, tierMinCount(tier));
      const goal = referralGoalFromCount(count);
      const tierLabel = tierLabelFromTier(tier);

      // Persist referralCode if it was missing.
      await queueUsersDbWrite();

      const base = getRequestOrigin(req);
      const url = `${base}/${code}`;
      const referredSpendCents = computeReferralSpendCents(db, u);
      const commissionPercent = 10;
      const estimatedCommissionCents = Math.floor((Math.max(0, referredSpendCents) * commissionPercent) / 100);
      const claimedPayoutCents = Math.max(0, Math.floor(Number(u.referralClaimedCents || 0) || 0));
      const telegramPayoutUrl = String(process.env.TBW_TELEGRAM_PAYOUT_URL || '').trim();
      return sendJson(res, 200, {
        code,
        url,
        count,
        goal,
        tier,
        tierLabel,
        referredSpendCents,
        referredSpendUsd: Math.round((referredSpendCents / 100) * 100) / 100,
        commissionPercent,
        estimatedCommissionCents,
        claimedPayoutCents,
        telegramPayoutUrl,
      });
    }

    // ===== REFERRAL LEADERBOARD =====
    if (requestUrl.pathname === '/api/referral/leaderboard') {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') return sendJson(res, 405, { error: 'Method Not Allowed' });
      const db = await ensureUsersDbFresh();
      const page = Math.max(0, parseInt(requestUrl.searchParams.get('page') || '0', 10) || 0);
      const result = buildReferralLeaderboard(db, page, 10);
      return sendJson(res, 200, result);
    }

    // ===== UPLOAD LEADERBOARD =====
    if (requestUrl.pathname === '/api/upload/leaderboard') {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') return sendJson(res, 405, { error: 'Method Not Allowed' });
      const page = Math.max(0, parseInt(requestUrl.searchParams.get('page') || '0', 10) || 0);
      const PAGE_SIZE = 10;
      // Count approved uploads per user
      const counts = {};
      for (const req of uploadRequests) {
        if (req.status === 'approved' && req.username) {
          counts[req.username] = (counts[req.username] || 0) + 1;
        }
      }
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
      const start = page * PAGE_SIZE;
      const entries = sorted.slice(start, start + PAGE_SIZE).map((e, i) => ({
        rank: start + i + 1,
        username: e[0],
        count: e[1],
      }));
      return sendJson(res, 200, { page, totalPages, entries });
    }

    // Manual screenshot / gift-card payments removed — checkout is Patreon-only.
    if (requestUrl.pathname === '/api/payment-screenshot') {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });
      return sendJson(res, 410, {
        error: 'Manual payment submission is disabled. Subscribe on Patreon and unlock with your Patreon email.',
      });
    }

    // ===== STRIPE PREMIUM (TIER 2) =====
    // Creates a Stripe Checkout session and redirects to Stripe.
    if (requestUrl.pathname === '/api/stripe/checkout') {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') return sendJson(res, 405, { error: 'Method Not Allowed' });

      const authed = await requireAuthedUser(req, res);
      if (!authed) return;

      const stripeSecret = process.env.STRIPE_SECRET_KEY;
      if (!stripeSecret) {
        return sendText(res, 501, 'Stripe not configured. Set STRIPE_SECRET_KEY in .env.');
      }

      const origin = getRequestOrigin(req);
      const successUrl = `${origin}/api/stripe/success?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${origin}/?premium=0&canceled=1`;

      const params = new URLSearchParams();
      params.set('mode', 'payment');
      params.set('success_url', successUrl);
      params.set('cancel_url', cancelUrl);

      // 1 line item @ $9.99
      params.set('line_items[0][price_data][currency]', 'usd');
      params.set('line_items[0][price_data][product_data][name]', 'Premium Tier 2 Access');
      params.set('line_items[0][price_data][unit_amount]', '999');
      params.set('line_items[0][quantity]', '1');

      // Map the payment back to the user.
      params.set('client_reference_id', authed.userKey);
      params.set('metadata[userKey]', authed.userKey);
      params.set('metadata[username]', String(authed.record && authed.record.username ? authed.record.username : authed.userKey));

      const body = params.toString();
      const basic = Buffer.from(`${stripeSecret}:`, 'utf8').toString('base64');

      const stripeResp = await httpsRequest('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      }, body);

      if (stripeResp.status < 200 || stripeResp.status >= 300) {
        const errBody = stripeResp.body ? stripeResp.body.toString('utf8') : '';
        console.error(`Stripe checkout error (${stripeResp.status}):`, errBody);
        return sendText(res, 502, 'Stripe checkout session failed.');
      }

      let session;
      try {
        session = JSON.parse(stripeResp.body.toString('utf8'));
      } catch {
        session = null;
      }
      const url = session && session.url ? String(session.url) : '';
      if (!url) return sendText(res, 502, 'Stripe checkout session missing redirect URL.');

      res.writeHead(303, {
        Location: url,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.end();
    }

    // Stripe success redirect: verify the session with Stripe, then upgrade user.
    // This works on localhost where webhooks can't reach.
    if (requestUrl.pathname === '/api/stripe/success') {
      const sessionId = requestUrl.searchParams.get('session_id');
      if (!sessionId) {
        res.writeHead(302, { Location: '/?premium=0&error=missing_session' });
        return res.end();
      }

      const stripeSecret = process.env.STRIPE_SECRET_KEY;
      if (!stripeSecret) {
        res.writeHead(302, { Location: '/?premium=0&error=not_configured' });
        return res.end();
      }

      // Retrieve the checkout session from Stripe to verify payment.
      const basic = Buffer.from(`${stripeSecret}:`, 'utf8').toString('base64');
      const verifyResp = await httpsRequest(
        `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
        {
          method: 'GET',
          headers: { Authorization: `Basic ${basic}` },
        }
      );

      if (verifyResp.status < 200 || verifyResp.status >= 300) {
        console.error(`Stripe session verify error (${verifyResp.status}):`, verifyResp.body ? verifyResp.body.toString('utf8') : '');
        res.writeHead(302, { Location: '/?premium=0&error=verify_failed' });
        return res.end();
      }

      let session;
      try {
        session = JSON.parse(verifyResp.body.toString('utf8'));
      } catch {
        session = null;
      }

      const paid = session && (session.payment_status === 'paid' || session.status === 'complete');
      const userKey = session && session.metadata && session.metadata.userKey
        ? String(session.metadata.userKey)
        : (session && session.client_reference_id ? String(session.client_reference_id) : null);

      if (paid && userKey) {
        const db = await ensureUsersDbFresh();
        const u = db.users[userKey];
        if (u && typeof u === 'object') {
          const wasAlreadyPremium = u.premiumProvider === 'stripe';
          if (!Array.isArray(u.stripePaidSessions)) u.stripePaidSessions = [];
          if (!u.stripePaidSessions.includes(sessionId)) {
            u.stripePaidSessions.push(sessionId);
          }
          u.tier = 2;
          u.premiumProvider = 'stripe';
          u.premiumPaidAt = Date.now();
          // CRITICAL: Write immediately for payment — do NOT use debounced schedule
          await _doUsersDbWrite();

          // Analytics beacon (only first purchase)
          if (!wasAlreadyPremium) {
            _emitPurchase(db, u.username || userKey, 1500);
          }
        }
      }

      // Redirect to homepage regardless — user will see their updated tier.
      res.writeHead(302, { Location: '/?premium=1' });
      return res.end();
    }

    // Stripe webhook: upgrades the paid user to Tier 2.
    if (requestUrl.pathname === '/api/stripe/webhook') {
      const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!stripeWebhookSecret) {
        return sendText(res, 501, 'Stripe webhook not configured. Set STRIPE_WEBHOOK_SECRET in .env.');
      }

      const payload = await readRawBody(req, res, 1024 * 1024);
      if (!payload) return;

      const sig = req.headers['stripe-signature'];
      const ok = verifyStripeSignature(payload, sig, stripeWebhookSecret);
      if (!ok) return sendText(res, 400, 'Invalid Stripe signature.');

      let event;
      try {
        event = JSON.parse(payload.toString('utf8'));
      } catch {
        return sendText(res, 400, 'Invalid JSON.');
      }

      if (event && event.type === 'checkout.session.completed') {
        const session = event.data && event.data.object ? event.data.object : null;
        const paid = session && (session.payment_status === 'paid' || session.status === 'complete');
        const sessionId = session && session.id ? String(session.id) : null;
        const userKey = session && session.metadata && session.metadata.userKey
          ? String(session.metadata.userKey)
          : (session && session.client_reference_id ? String(session.client_reference_id) : null);

        if (paid && userKey) {
          const db = await ensureUsersDbFresh();
          const u = db.users[userKey];
          if (u && typeof u === 'object') {
            const wasAlreadyPremium = u.premiumProvider === 'stripe';
            if (!Array.isArray(u.stripePaidSessions)) u.stripePaidSessions = [];
            if (sessionId && !u.stripePaidSessions.includes(sessionId)) {
              u.stripePaidSessions.push(sessionId);
            }
            u.tier = 2;
            u.premiumProvider = 'stripe';
            u.premiumPaidAt = Date.now();
            // CRITICAL: Write immediately for payment — do NOT use debounced schedule
            await _doUsersDbWrite();

            if (!wasAlreadyPremium) {
              _emitPurchase(db, u.username || userKey, 1500);
            }
          }
        }
      }

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.end(JSON.stringify({ received: true }));
    }

    // ===== DISCORD OAUTH =====
    if (requestUrl.pathname === '/auth/discord') {
      const clientId = process.env.DISCORD_CLIENT_ID;
      const redirectUri = process.env.DISCORD_REDIRECT_URI;
      if (!clientId || !redirectUri) {
        return sendText(res, 501, 'Discord login not configured. Set DISCORD_CLIENT_ID and DISCORD_REDIRECT_URI env vars.');
      }

      // Common gotcha: cookie is host-scoped. If you open http://localhost:3002 but
      // DISCORD_REDIRECT_URI uses http://127.0.0.1:3002 (or vice-versa), the state cookie
      // won't be sent to the callback and you'll get "Invalid OAuth state".
      let redirectHost = '';
      try {
        redirectHost = new URL(redirectUri).host;
      } catch {
        redirectHost = '';
      }
      const reqHost = String(req.headers.host || '');
      if (redirectHost && reqHost && redirectHost !== reqHost) {
        return sendText(
          res,
          400,
          `Discord OAuth host mismatch. You are browsing ${reqHost} but DISCORD_REDIRECT_URI is set to ${redirectHost}. ` +
          `Use the same hostname (localhost vs 127.0.0.1) for both, then retry.`
        );
      }

      const state = crypto.randomBytes(16).toString('hex');
      // State cookie (basic CSRF protection)
      appendSetCookie(res, `tbw_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'identify',
        state,
      });
      res.writeHead(302, { Location: `https://discord.com/oauth2/authorize?${params.toString()}` });
      return res.end();
    }

    if (requestUrl.pathname === '/auth/discord/callback') {
      const code = requestUrl.searchParams.get('code');
      const state = requestUrl.searchParams.get('state');
      const cookies = parseCookies(req);
      const oauthLink = parseOAuthLinkCookieValue(cookies[OAUTH_LINK_COOKIE]);
      // Clear state cookie immediately to prevent replay
      appendSetCookie(res, `tbw_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
      clearOAuthLinkCookie(res);
      if (!code || !state || !cookies.tbw_oauth_state || cookies.tbw_oauth_state !== state) {
        const redirectUri = process.env.DISCORD_REDIRECT_URI;
        let redirectHost = '';
        try {
          if (redirectUri) redirectHost = new URL(redirectUri).host;
        } catch {
          redirectHost = '';
        }
        const reqHost = String(req.headers.host || '');
        if (redirectHost && reqHost && redirectHost !== reqHost) {
          return sendText(
            res,
            400,
            `Invalid OAuth state (likely host mismatch). You are on ${reqHost} but DISCORD_REDIRECT_URI is ${redirectHost}. ` +
            `Open the site using the same host as your redirect URL and try again.`
          );
        }
        return sendText(res, 400, 'Invalid OAuth state. Clear site cookies and retry the Discord login flow.');
      }

      const clientId = process.env.DISCORD_CLIENT_ID;
      const clientSecret = process.env.DISCORD_CLIENT_SECRET;
      const redirectUri = process.env.DISCORD_REDIRECT_URI;
      if (!clientId || !clientSecret || !redirectUri) {
        return sendText(res, 501, 'Discord login not configured. Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI.');
      }

      const tokenBody = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString();

      const tokenResp = await httpsRequest('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(tokenBody),
        },
      }, tokenBody);

      if (tokenResp.status < 200 || tokenResp.status >= 300) {
        return sendText(res, 400, 'Discord token exchange failed.');
      }

      let tokenJson;
      try {
        tokenJson = JSON.parse(tokenResp.body.toString('utf8'));
      } catch {
        tokenJson = null;
      }
      const accessToken = tokenJson && tokenJson.access_token;
      if (!accessToken) return sendText(res, 400, 'Discord token exchange failed.');

      const meResp = await httpsRequest('https://discord.com/api/users/@me', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (meResp.status < 200 || meResp.status >= 300) {
        return sendText(res, 400, 'Discord profile fetch failed.');
      }

      let meJson;
      try {
        meJson = JSON.parse(meResp.body.toString('utf8'));
      } catch {
        meJson = null;
      }

      const discordId = meJson && meJson.id ? String(meJson.id) : null;
      const rawDiscordName = meJson && meJson.username ? String(meJson.username) : '';
      if (!discordId) return sendText(res, 400, 'Discord profile invalid.');

      // Acquire signup lock to prevent race-condition duplicates
      const releaseSignupLock = await acquireSignupLock();
      let isNewDiscordUser;
      try {
      const db = await ensureUsersDbFresh();
      const oauthCurrentUserKey = await getAuthedUserKeyWithRefresh(req);
      if (oauthLink && oauthLink.provider === 'discord') {
        if (!oauthCurrentUserKey || oauthCurrentUserKey !== oauthLink.userKey) {
          res.writeHead(302, { Location: '/account?link_error=session' });
          return res.end();
        }
        const targetUser = db.users[oauthCurrentUserKey];
        if (!targetUser || targetUser.banned) {
          res.writeHead(302, { Location: '/account?link_error=unauthorized' });
          return res.end();
        }
        for (const [existingKey, existingUser] of Object.entries(db.users)) {
          if (!existingUser || typeof existingUser !== 'object') continue;
          if (String(existingUser.discordId || '') === String(discordId) && existingKey !== oauthCurrentUserKey) {
            res.writeHead(302, { Location: '/account?link_error=discord_in_use' });
            return res.end();
          }
        }
        targetUser.discordId = discordId;
        if (!targetUser.discordUsername) targetUser.discordUsername = rawDiscordName || '';
        await queueUsersDbWrite();
        void syncDiscordEntitlementStateSupabase(oauthCurrentUserKey, targetUser, 'discord_linked');
        res.writeHead(302, { Location: '/account?linked=discord' });
        return res.end();
      }

      const userKey = `discord_${discordId}`;
      isNewDiscordUser = !db.users[userKey];
      if (isNewDiscordUser) {
        const discordName = sanitizeOAuthUsername(db, rawDiscordName, 'discord');

        const discordSignupIp = normalizeIp(getClientIp(req));
        const signupCheck = await checkSignupBlocked(discordSignupIp, db);
        if (signupCheck.blocked) {
          appendSetCookie(res, `tbw_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
          const param = signupCheck.reason === 'vpn' ? 'vpn_error=1' : 'ip_error=1';
          res.writeHead(302, { Location: `/?${param}` });
          return res.end();
        }
        db.users[userKey] = {
          username: discordName,
          provider: 'discord',
          discordId,
          createdAt: Date.now(),
          signupIp: discordSignupIp,
          tier: null,
          referralCode: null,
          referredBy: null,
          referredUsers: [],
        };

        // Generate referral code for the new Discord user
        ensureUserReferralCode(db, userKey);

        // Referral attribution from cookie (same logic as local signup)
        const discordCookies = parseCookies(req);
        const discordRefCode = discordCookies[REF_COOKIE];
        if (isValidReferralCode(discordRefCode)) {
          const refUserKey = findUserKeyByReferralCode(db, discordRefCode);
          if (refUserKey && refUserKey !== userKey) {
            const refUser = db.users[refUserKey];
            const refIp = normalizeIp(refUser && refUser.signupIp);
            const sameIp = refIp !== 'unknown' && discordSignupIp !== 'unknown' && refIp === discordSignupIp;
            const allowLocalDevReferrals = process.env.TBW_DEV_ALLOW_SAME_IP_REFERRALS === '1'
              && discordSignupIp === '127.0.0.1' && refIp === '127.0.0.1';
            if (!Array.isArray(refUser.referralCreditIps)) refUser.referralCreditIps = [];
            const ipAlreadyCredited = !allowLocalDevReferrals
              && discordSignupIp !== 'unknown'
              && refUser.referralCreditIps.includes(discordSignupIp);
            if ((allowLocalDevReferrals || !sameIp) && !ipAlreadyCredited) {
              if (!Array.isArray(refUser.referredUsers)) refUser.referredUsers = [];
              const prevReferralTier = tierFromCount(refUser.referredUsers.length);
              if (!refUser.referredUsers.includes(userKey)) refUser.referredUsers.push(userKey);
              const nextReferralTier = tierFromCount(refUser.referredUsers.length);
              if ((nextReferralTier === 1 || nextReferralTier === 2) && nextReferralTier > prevReferralTier) {
                _emitTierReached(db, req, refUserKey, nextReferralTier);
              }
              if (!allowLocalDevReferrals && discordSignupIp !== 'unknown') refUser.referralCreditIps.push(discordSignupIp);
              db.users[userKey].referredBy = discordRefCode;
            }
          }
        }

        await queueUsersDbWrite();
        void syncDiscordEntitlementStateSupabase(userKey, db.users[userKey], 'discord_signup');

        // Analytics beacon
        _emitSignup(db, discordName, 'discord', db.users[userKey].referredBy || null, discordSignupIp);
      }
      } finally { releaseSignupLock(); }

      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, { userKey: `discord_${discordId}`, createdAt: Date.now() });
      persistSessionsToR2();
      setSessionCookie(res, token);

      // Clear referral + custom link cookies after Discord signup
      if (isNewDiscordUser) {
        clearReferralCookie(res);
        const _dcClink = parseCookies(req)[CLINK_COOKIE];
        if (_dcClink && customLinks[_dcClink]) { customLinks[_dcClink].signups = (customLinks[_dcClink].signups || 0) + 1; void saveCustomLinks(); }
        appendSetCookie(res, `${CLINK_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`);
      }

      // clear state cookie
      appendSetCookie(res, `tbw_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
      res.writeHead(302, { Location: '/?welcome=1' });
      return res.end();
    }

    // ===== GOOGLE OAUTH =====
    if (requestUrl.pathname === '/auth/google') {
      const clientId = process.env.GOOGLE_CLIENT_ID || '';
      const redirectUri = process.env.GOOGLE_REDIRECT_URI || (getRequestOrigin(req) + '/auth/google/callback');
      if (!clientId) {
        return sendText(res, 501, 'Google login not configured.');
      }

      const state = crypto.randomBytes(16).toString('hex');
      appendSetCookie(res, `tbw_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        access_type: 'offline',
        prompt: 'consent',
      });
      res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
      return res.end();
    }

    if (requestUrl.pathname === '/auth/google/callback') {
      const code = requestUrl.searchParams.get('code');
      const state = requestUrl.searchParams.get('state');
      const cookies = parseCookies(req);
      const oauthLink = parseOAuthLinkCookieValue(cookies[OAUTH_LINK_COOKIE]);
      // Clear state cookie immediately to prevent replay
      appendSetCookie(res, `tbw_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
      clearOAuthLinkCookie(res);
      if (!code || !state || !cookies.tbw_oauth_state || cookies.tbw_oauth_state !== state) {
        return sendText(res, 400, 'Invalid OAuth state. Clear site cookies and retry the Google login flow.');
      }

      const clientId = process.env.GOOGLE_CLIENT_ID || '';
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
      const redirectUri = process.env.GOOGLE_REDIRECT_URI || (getRequestOrigin(req) + '/auth/google/callback');
      if (!clientId || !clientSecret) {
        return sendText(res, 501, 'Google login not configured.');
      }

      // Exchange code for tokens
      const tokenBody = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString();

      const tokenResp = await httpsRequest('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(tokenBody),
        },
      }, tokenBody);

      if (tokenResp.status < 200 || tokenResp.status >= 300) {
        console.error('[server] Google token exchange failed:', tokenResp.body.toString('utf8'));
        return sendText(res, 400, 'Google token exchange failed.');
      }

      let tokenJson;
      try { tokenJson = JSON.parse(tokenResp.body.toString('utf8')); } catch { tokenJson = null; }
      const accessToken = tokenJson && tokenJson.access_token;
      if (!accessToken) return sendText(res, 400, 'Google token exchange failed.');

      // Fetch Google profile
      const meResp = await httpsRequest('https://www.googleapis.com/oauth2/v2/userinfo', {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (meResp.status < 200 || meResp.status >= 300) {
        return sendText(res, 400, 'Google profile fetch failed.');
      }

      let meJson;
      try { meJson = JSON.parse(meResp.body.toString('utf8')); } catch { meJson = null; }

      const googleId = meJson && meJson.id ? String(meJson.id) : null;
      const googleEmail = meJson && meJson.email ? String(meJson.email) : '';
      const rawGoogleName = meJson && meJson.name ? String(meJson.name) : (googleEmail.split('@')[0] || '');
      if (!googleId) return sendText(res, 400, 'Google profile invalid.');

      // Acquire signup lock to prevent race-condition duplicates
      const releaseSignupLock = await acquireSignupLock();
      let isNewGoogleUser;
      try {
      // User upsert
      const db = await ensureUsersDbFresh();
      const oauthCurrentUserKey = await getAuthedUserKeyWithRefresh(req);
      if (oauthLink && oauthLink.provider === 'google') {
        if (!oauthCurrentUserKey || oauthCurrentUserKey !== oauthLink.userKey) {
          res.writeHead(302, { Location: '/account?link_error=session' });
          return res.end();
        }
        const targetUser = db.users[oauthCurrentUserKey];
        if (!targetUser || targetUser.banned) {
          res.writeHead(302, { Location: '/account?link_error=unauthorized' });
          return res.end();
        }
        for (const [existingKey, existingUser] of Object.entries(db.users)) {
          if (!existingUser || typeof existingUser !== 'object') continue;
          if (String(existingUser.googleId || '') === String(googleId) && existingKey !== oauthCurrentUserKey) {
            res.writeHead(302, { Location: '/account?link_error=google_in_use' });
            return res.end();
          }
        }
        targetUser.googleId = googleId;
        targetUser.googleEmail = googleEmail || targetUser.googleEmail || '';
        if (!targetUser.email && googleEmail) targetUser.email = String(googleEmail).trim().toLowerCase();
        await queueUsersDbWrite();
        void syncDiscordEntitlementStateSupabase(oauthCurrentUserKey, targetUser, 'google_linked');
        res.writeHead(302, { Location: '/account?linked=google' });
        return res.end();
      }

      const userKey = `google_${googleId}`;
      isNewGoogleUser = !db.users[userKey];
      if (isNewGoogleUser) {
        const googleName = sanitizeOAuthUsername(db, rawGoogleName, 'google');
        const googleSignupIp = normalizeIp(getClientIp(req));
        const signupCheck = await checkSignupBlocked(googleSignupIp, db);
        if (signupCheck.blocked) {
          appendSetCookie(res, `tbw_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
          const param = signupCheck.reason === 'vpn' ? 'vpn_error=1' : 'ip_error=1';
          res.writeHead(302, { Location: `/?${param}` });
          return res.end();
        }
        db.users[userKey] = {
          username: googleName,
          provider: 'google',
          googleId,
          googleEmail,
          createdAt: Date.now(),
          signupIp: googleSignupIp,
          tier: null,
          referralCode: null,
          referredBy: null,
          referredUsers: [],
        };

        ensureUserReferralCode(db, userKey);

        // Referral attribution from cookie
        const googleCookies = parseCookies(req);
        const googleRefCode = googleCookies[REF_COOKIE];
        if (isValidReferralCode(googleRefCode)) {
          const refUserKey = findUserKeyByReferralCode(db, googleRefCode);
          if (refUserKey && refUserKey !== userKey) {
            const refUser = db.users[refUserKey];
            const refIp = normalizeIp(refUser && refUser.signupIp);
            const sameIp = refIp !== 'unknown' && googleSignupIp !== 'unknown' && refIp === googleSignupIp;
            const allowLocalDevReferrals = process.env.TBW_DEV_ALLOW_SAME_IP_REFERRALS === '1'
              && googleSignupIp === '127.0.0.1' && refIp === '127.0.0.1';
            if (!Array.isArray(refUser.referralCreditIps)) refUser.referralCreditIps = [];
            const ipAlreadyCredited = !allowLocalDevReferrals
              && googleSignupIp !== 'unknown'
              && refUser.referralCreditIps.includes(googleSignupIp);
            if ((allowLocalDevReferrals || !sameIp) && !ipAlreadyCredited) {
              if (!Array.isArray(refUser.referredUsers)) refUser.referredUsers = [];
              const prevReferralTier = tierFromCount(refUser.referredUsers.length);
              if (!refUser.referredUsers.includes(userKey)) refUser.referredUsers.push(userKey);
              const nextReferralTier = tierFromCount(refUser.referredUsers.length);
              if ((nextReferralTier === 1 || nextReferralTier === 2) && nextReferralTier > prevReferralTier) {
                _emitTierReached(db, req, refUserKey, nextReferralTier);
              }
              if (!allowLocalDevReferrals && googleSignupIp !== 'unknown') refUser.referralCreditIps.push(googleSignupIp);
              db.users[userKey].referredBy = googleRefCode;
            }
          }
        }

        await queueUsersDbWrite();
        void syncDiscordEntitlementStateSupabase(userKey, db.users[userKey], 'google_signup');
        _emitSignup(db, googleName, 'google', db.users[userKey].referredBy || null, googleSignupIp);
      }
      } finally { releaseSignupLock(); }

      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, { userKey: `google_${googleId}`, createdAt: Date.now() });
      persistSessionsToR2();
      setSessionCookie(res, token);

      if (isNewGoogleUser) {
        clearReferralCookie(res);
        const _gcClink = parseCookies(req)[CLINK_COOKIE];
        if (_gcClink && customLinks[_gcClink]) { customLinks[_gcClink].signups = (customLinks[_gcClink].signups || 0) + 1; void saveCustomLinks(); }
        appendSetCookie(res, `${CLINK_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`);
      }

      // clear state cookie
      appendSetCookie(res, `tbw_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
      res.writeHead(302, { Location: '/?welcome=1' });
      return res.end();
    }

    // API: list files in a category folder (free for anon/tier0, paid is cumulative)
    if (requestUrl.pathname === '/api/list') {
      const authed = await getOptionalAuthedUser(req, res);
      if (!authed) return;
      const { record: u } = authed;

      const folder = requestUrl.searchParams.get('folder') || '';
      const folderCanon = canonicalFolderLabel(folder);
      const subfolder = requestUrl.searchParams.get('subfolder') || '';
      const basePath = allowedFolderBasePath(folder);
      if (!basePath) return sendJson(res, 400, { error: 'Invalid folder' });

      const tier = u ? getEffectiveTierForUser(u) : 0;
      const vaultFolders = accessibleVaultFolders(tier);

      // Track category hit for admin
      adminCategoryHits[folderCanon] = (adminCategoryHits[folderCanon] || 0) + 1;
      logAdminEventToSupabase('category_hit', { category: String(folderCanon).slice(0, 64) }).catch(() => {});
      scheduleAdminPersist();

      // ── Cache: warm listings for tier+folder+subfolder. Empty results use a short TTL so transient R2
      //    failures / cold starts are not frozen for 10 minutes ("No files found" flakiness).
      const LIST_CACHE_TTL_FULL_MS = 600000; // 10 min when we actually have files
      const LIST_CACHE_TTL_EMPTY_MS = 45000; // 45s when listing was empty — retry soon
      if (!global._listCache) global._listCache = {};
      const _listCacheKey = `${tier}:${folderCanon}:${subfolder}`;
      const _listCached = global._listCache[_listCacheKey];
      const _listCacheAge = _listCached ? Date.now() - _listCached.ts : Infinity;
      const _cachedLen = _listCached && Array.isArray(_listCached.files) ? _listCached.files.length : 0;
      const _listCacheTtl = _cachedLen > 0 ? LIST_CACHE_TTL_FULL_MS : LIST_CACHE_TTL_EMPTY_MS;
      if (_listCached && _listCacheAge < _listCacheTtl) {
        // Refresh stats in cached results (views/likes change frequently)
        const freshFiles = _listCached.files.map(f => {
          if (!f.videoKey) return f;
          const stats = shortStats[f.videoKey] || {};
          return { ...f, views: stats.views || 0, likes: stats.likes || 0, dislikes: stats.dislikes || 0 };
        });
        // Re-warm _mediaKeyCache from cached data
        if (!global._mediaKeyCache) global._mediaKeyCache = {};
        for (const f of _listCached._cacheEntries || []) {
          global._mediaKeyCache[f.k] = { key: f.v, ts: Date.now() };
        }
        if (_listCached.subfolders) return sendJson(res, 200, { type: 'files', files: freshFiles, subfolders: _listCached.subfolders });
        return sendJson(res, 200, { type: 'files', files: freshFiles });
      }

      // Build uploader lookup from approved uploads
      const uploaderMap = new Map();
      for (const req of uploadRequests) {
        if (req.status === 'approved' && req.r2FinalKey) {
          const fname = req.r2FinalKey.split('/').pop();
          if (fname) uploaderMap.set(fname, req.username);
        }
      }

      // Helper: dedupe by file size (most reliable) + normalized title as fallback
      function _normTitle(name) {
        return name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').replace(/\s*\(\d+\)\s*/g, '').replace(/\s*\[\d+\]\s*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
      }
      function _isDupe(seenSizes, seenTitles, item) {
        // Near-exact size dedupe: 0.1% tolerance (catches true re-uploads only)
        const sz = item.size || 0;
        if (sz > 10000) {
          for (const seen of seenSizes) {
            if (Math.abs(sz - seen) / Math.max(sz, seen) < 0.001) return true;
          }
          seenSizes.add(sz);
        }
        return false;
      }

      // Collect _mediaKeyCache entries for caching
      const _cacheEntries = [];

      // Omegle: if subfolder specified, serve that subfolder; otherwise serve ALL subfolders flat
      if (folder === 'Omegle') {
        if (subfolder) {
          if (!OMEGLE_SUBFOLDERS.includes(subfolder)) {
            return sendJson(res, 400, { error: 'Invalid subfolder' });
          }
          const allFiles = [];
          const seenSizes = new Set();
          const seenTitles = new Set();
          const scanJobs = [];
          for (const v of vaultFolders) {
            scanJobs.push({ v, prefix: basePath + '/' + v + '/' + subfolder + '/' });
          }
          for (const legacyCt of ['video', 'photo', 'gif']) {
            for (const v of vaultFolders) {
              scanJobs.push({ v, prefix: basePath + '/' + legacyCt + '/' + v + '/' + subfolder + '/' });
            }
          }
          for (const tf of accessibleLegacyTierPrefixes(tier)) {
            scanJobs.push({ prefix: basePath + '/' + tf + '/' + subfolder + '/' });
          }
          const _listResults = await Promise.all(scanJobs.map(j => R2_ENABLED ? r2ListMediaFilesFromPrefix(j.prefix).catch(() => []) : Promise.resolve([])));
          if (!global._mediaKeyCache) global._mediaKeyCache = {};
          for (let _pi = 0; _pi < _listResults.length; _pi++) {
            const items = _listResults[_pi];
            const job = scanJobs[_pi];
            const _prefix = job.prefix;
            const v = job.v;
            for (const item of items) {
              if (_isDupe(seenSizes, seenTitles, item)) continue;
              const isVid = isVideoFile(item.name);
              const key = videoKey(folder, subfolder, item.name, v);
              const stats = shortStats[key] || { views: 0, likes: 0, dislikes: 0 };
              const lk = mediaLookupKey(folder, subfolder, v || '', item.name);
              const rck = mediaR2ResolveCacheKey(lk, tier);
              global._mediaKeyCache[rck] = { key: _prefix + item.name, ts: Date.now() };
              _cacheEntries.push({ k: rck, v: _prefix + item.name });
              let src = `/media?folder=${encodeURIComponent(folder)}&subfolder=${encodeURIComponent(subfolder)}&name=${encodeURIComponent(item.name)}`;
              if (v) src += `&vault=${encodeURIComponent(v)}`;
              const thumb = isVid ? _thumbUrl(folder, subfolder, item.name, v) : src;
              allFiles.push({
                name: item.name,
                type: isVid ? 'video' : 'image',
                src,
                ...(thumb ? { thumb } : {}),
                ...(v ? { vault: v } : {}),
                size: item.size || 0,
                lastModified: item.lastModified || 0,
                duration: isVid ? _getDuration(folder, subfolder, item.name, v) : 0,
                folder,
                subfolder,
                category: folder,
                uploader: uploaderMap.get(item.name) || null,
                ...(key ? { videoKey: key, views: stats.views || 0, likes: stats.likes || 0, dislikes: stats.dislikes || 0 } : {}),
              });
            }
          }
          // Fallback: if requested Omegle subfolder is empty, include root-level layout files.
          if (allFiles.length === 0) {
            const rootJobs = [];
            for (const v of vaultFolders) rootJobs.push({ v, prefix: basePath + '/' + v + '/' });
            for (const legacyCt of ['video', 'photo', 'gif']) {
              for (const v of vaultFolders) rootJobs.push({ v, prefix: basePath + '/' + legacyCt + '/' + v + '/' });
            }
            for (const tf of accessibleLegacyTierPrefixes(tier)) rootJobs.push({ prefix: basePath + '/' + tf + '/' });
            const rootResults = await Promise.all(rootJobs.map(j => R2_ENABLED ? r2ListMediaFilesFromPrefix(j.prefix).catch(() => []) : Promise.resolve([])));
            for (let _pi = 0; _pi < rootResults.length; _pi++) {
              const items = rootResults[_pi];
              const job = rootJobs[_pi];
              const _prefix = job.prefix;
              const v = job.v;
              for (const item of items) {
                if (_isDupe(seenSizes, seenTitles, item)) continue;
                const isVid = isVideoFile(item.name);
                const key = videoKey(folder, '', item.name, v);
                const stats = shortStats[key] || { views: 0, likes: 0, dislikes: 0 };
                const lk = mediaLookupKey(folder, '', v || '', item.name);
                const rck = mediaR2ResolveCacheKey(lk, tier);
                global._mediaKeyCache[rck] = { key: _prefix + item.name, ts: Date.now() };
                _cacheEntries.push({ k: rck, v: _prefix + item.name });
                let src = `/media?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(item.name)}`;
                if (v) src += `&vault=${encodeURIComponent(v)}`;
                const thumb = isVid ? _thumbUrl(folder, '', item.name, v) : src;
                allFiles.push({
                  name: item.name,
                  type: isVid ? 'video' : 'image',
                  src,
                  ...(thumb ? { thumb } : {}),
                  ...(v ? { vault: v } : {}),
                  size: item.size || 0,
                  lastModified: item.lastModified || 0,
                  duration: isVid ? _getDuration(folder, '', item.name, v) : 0,
                  folder,
                  subfolder: '',
                  category: folder,
                  uploader: uploaderMap.get(item.name) || null,
                  ...(key ? { videoKey: key, views: stats.views || 0, likes: stats.likes || 0, dislikes: stats.dislikes || 0 } : {}),
                });
              }
            }
          }
          global._listCache[_listCacheKey] = { files: allFiles, _cacheEntries, ts: Date.now() };
          return sendJson(res, 200, { type: 'files', files: allFiles });
        }
        // No subfolder — return ALL omegle videos flat with subfolder tags
        const allFiles = [];
        const seenSizes = new Set();
        const seenTitles = new Set();
        const _omPrefixes = [];
        for (const sf of OMEGLE_SUBFOLDERS) {
          for (const v of vaultFolders) {
            _omPrefixes.push({ sf, v, prefix: basePath + '/' + v + '/' + sf + '/' });
          }
          for (const legacyCt of ['video', 'photo', 'gif']) {
            for (const v of vaultFolders) {
              _omPrefixes.push({ sf, v, prefix: basePath + '/' + legacyCt + '/' + v + '/' + sf + '/' });
            }
          }
          for (const tf of accessibleLegacyTierPrefixes(tier)) {
            _omPrefixes.push({ sf, prefix: basePath + '/' + tf + '/' + sf + '/' });
          }
        }
        // Also support root-style Omegle layouts with no category subfolder
        for (const v of vaultFolders) {
          _omPrefixes.push({ sf: '', v, prefix: basePath + '/' + v + '/' });
        }
        for (const legacyCt of ['video', 'photo', 'gif']) {
          for (const v of vaultFolders) {
            _omPrefixes.push({ sf: '', v, prefix: basePath + '/' + legacyCt + '/' + v + '/' });
          }
        }
        for (const tf of accessibleLegacyTierPrefixes(tier)) {
          _omPrefixes.push({ sf: '', prefix: basePath + '/' + tf + '/' });
        }
        const _omResults = await Promise.all(_omPrefixes.map(({ prefix }) => R2_ENABLED ? r2ListMediaFilesFromPrefix(prefix).catch(() => []) : Promise.resolve([])));
        if (!global._mediaKeyCache) global._mediaKeyCache = {};
        for (let i = 0; i < _omPrefixes.length; i++) {
          const sf = _omPrefixes[i].sf;
          const v = _omPrefixes[i].v;
          const _prefix = _omPrefixes[i].prefix;
          const items = _omResults[i];
          for (const item of items) {
            if (_isDupe(seenSizes, seenTitles, item)) continue;
            const isVid = isVideoFile(item.name);
              const key = videoKey(folder, sf, item.name, v);
            const stats = shortStats[key] || { views: 0, likes: 0, dislikes: 0 };
            const lk = mediaLookupKey(folder, sf, v || '', item.name);
            const rck = mediaR2ResolveCacheKey(lk, tier);
            global._mediaKeyCache[rck] = { key: _prefix + item.name, ts: Date.now() };
            _cacheEntries.push({ k: rck, v: _prefix + item.name });
            let src = `/media?folder=${encodeURIComponent(folder)}&subfolder=${encodeURIComponent(sf)}&name=${encodeURIComponent(item.name)}`;
            if (v) src += `&vault=${encodeURIComponent(v)}`;
            const thumb = isVid ? _thumbUrl(folder, sf, item.name, v) : src;
            allFiles.push({
              name: item.name,
              type: isVid ? 'video' : 'image',
              src,
              ...(thumb ? { thumb } : {}),
              ...(v ? { vault: v } : {}),
              size: item.size || 0,
              lastModified: item.lastModified || 0,
              duration: isVid ? _getDuration(folder, sf, item.name, v) : 0,
              folder,
              subfolder: sf,
              category: folder,
              uploader: uploaderMap.get(item.name) || null,
              ...(key ? { videoKey: key, views: stats.views || 0, likes: stats.likes || 0, dislikes: stats.dislikes || 0 } : {}),
            });
          }
        }
        global._listCache[_listCacheKey] = { files: allFiles, subfolders: OMEGLE_SUBFOLDERS, _cacheEntries, ts: Date.now() };
        return sendJson(res, 200, { type: 'files', files: allFiles, subfolders: OMEGLE_SUBFOLDERS });
      }

      // Non-omegle: tier-under-category + legacy video|photo|gif/<tier> + legacy tier 1/2/3
      const allFiles = [];
      const seenSizes = new Set();
      const seenTitles = new Set();
      const scanJobs = [];
      for (const v of vaultFolders) {
        scanJobs.push({ v, prefix: basePath + '/' + v + '/' });
      }
      for (const legacyCt of ['video', 'photo', 'gif']) {
        for (const v of vaultFolders) {
          scanJobs.push({ v, prefix: basePath + '/' + legacyCt + '/' + v + '/' });
        }
      }
      for (const tf of accessibleLegacyTierPrefixes(tier)) {
        scanJobs.push({ prefix: basePath + '/' + tf + '/' });
      }
      const _tfResults = await Promise.all(scanJobs.map(j => R2_ENABLED ? r2ListMediaFilesFromPrefix(j.prefix).catch(() => []) : Promise.resolve([])));
      if (!global._mediaKeyCache) global._mediaKeyCache = {};
      for (let _ti = 0; _ti < _tfResults.length; _ti++) {
        const items = _tfResults[_ti];
        const job = scanJobs[_ti];
        const _prefix = job.prefix;
        const v = job.v;
        for (const item of items) {
          if (_isDupe(seenSizes, seenTitles, item)) continue;
          const isVid = isVideoFile(item.name);
          const key = videoKey(folder, '', item.name, v);
          const stats = shortStats[key] || { views: 0, likes: 0, dislikes: 0 };
          const lk = mediaLookupKey(folder, '', v || '', item.name);
          const rck = mediaR2ResolveCacheKey(lk, tier);
          global._mediaKeyCache[rck] = { key: _prefix + item.name, ts: Date.now() };
          _cacheEntries.push({ k: rck, v: _prefix + item.name });
          let src = `/media?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(item.name)}`;
          if (v) src += `&vault=${encodeURIComponent(v)}`;
          const thumb = isVid ? _thumbUrl(folder, '', item.name, v) : src;
          allFiles.push({
            name: item.name,
            type: isVid ? 'video' : 'image',
            src,
            ...(thumb ? { thumb } : {}),
            ...(v ? { vault: v } : {}),
            size: item.size || 0,
            lastModified: item.lastModified || 0,
            duration: isVid ? _getDuration(folder, '', item.name, v) : 0,
            folder,
            category: folder,
            uploader: uploaderMap.get(item.name) || null,
            ...(key ? { videoKey: key, views: stats.views || 0, likes: stats.likes || 0, dislikes: stats.dislikes || 0 } : {}),
          });
        }
      }
      global._listCache[_listCacheKey] = { files: allFiles, _cacheEntries, ts: Date.now() };
      const files = allFiles;

      // Background: pre-generate thumbnails for any uncached videos in this listing
      if (R2_ENABLED && files.length > 0) {
        schedulePrioritizedThumbWarm(files, tier, { priorityCount: 24 });
      }

      return sendJson(res, 200, { type: 'files', files });
    }


    // ── Email preferences ──
    if (requestUrl.pathname === '/api/email/preferences') {
      if (req.method === 'POST') {
        const userKey = await getAuthedUserKeyWithRefresh(req);
        if (!userKey) return sendJson(res, 401, { error: 'Not authenticated' });
        const body = await readJsonBody(req, res);
        if (!body) return;
        const db = await getOrLoadUsersDb();
        const u = db.users[userKey];
        if (!u) return sendJson(res, 404, { error: 'User not found' });
        u.emailPrefs = {
          weeklyDigest: !!body.weeklyDigest,
          newContent: !!body.newContent,
          updatedAt: Date.now()
        };
        scheduleUsersDbWrite();
        return sendJson(res, 200, { ok: true, prefs: u.emailPrefs });
      }
      // GET
      const userKey = await getAuthedUserKeyWithRefresh(req);
      if (!userKey) return sendJson(res, 401, { error: 'Not authenticated' });
      const db = await getOrLoadUsersDb();
      const u = db.users[userKey];
      return sendJson(res, 200, { prefs: (u && u.emailPrefs) || { weeklyDigest: false, newContent: false } });
    }

    // ── Shorts stats APIs ────────────────────────────────────────────────────

    // GET /api/shorts/stats — returns all short stats (strip internal _votes data)
    if (requestUrl.pathname === '/api/shorts/stats') {
      await ensureShortStatsFresh();
      const safeStats = {};
      for (const [k, v] of Object.entries(shortStats)) {
        safeStats[k] = { views: v.views || 0, likes: v.likes || 0, dislikes: v.dislikes || 0 };
      }
      return sendJson(res, 200, safeStats);
    }

    // POST /api/shorts/view — increment view count for a video
    if (requestUrl.pathname === '/api/shorts/view') {
      if ((req.method || '').toUpperCase() !== 'POST') return sendJson(res, 405, { error: 'POST only' });
      const body = await readRawBody(req, res, 2048);
      if (!body) return;
      try {
        const { key } = JSON.parse(body);
        if (!key || typeof key !== 'string') return sendJson(res, 400, { error: 'Missing key' });
        if (!shortStats[key]) shortStats[key] = { views: 0, likes: 0 };
        // Rate limit: 1 view per 10s per IP per video
        const _viewIp = normalizeIp(getClientIp(req));
        if (isViewRateLimited(_viewIp, key)) return sendJson(res, 200, shortStats[key]);
        shortStats[key].views++;
        scheduleShortStatsPersist();
        try {
          const identity = ensureIdentity(req, res);
          appendRecoEvent(identity, {
            eventType: 'shorts_progress',
            videoId: canonicalVideoId('', '', key),
            name: key,
            surface: 'shorts',
            watchMs: 1000,
          });
        } catch {}
        return sendJson(res, 200, shortStats[key]);
      } catch { return sendJson(res, 400, { error: 'Bad JSON' }); }
    }

    // POST /api/shorts/like — toggle like for a video (requires auth, one vote per user)
    if (requestUrl.pathname === '/api/shorts/like') {
      if ((req.method || '').toUpperCase() !== 'POST') return sendJson(res, 405, { error: 'POST only' });
      await ensureSessionsLoaded();
      const likeUserKey = await getAuthedUserKeyWithRefresh(req);
      if (!likeUserKey) return sendJson(res, 401, { error: 'Login required to like' });
      const body = await readRawBody(req, res, 2048);
      if (!body) return;
      try {
        const { key, liked } = JSON.parse(body);
        if (!key || typeof key !== 'string') return sendJson(res, 400, { error: 'Missing key' });
        if (!shortStats[key]) shortStats[key] = { views: 0, likes: 0 };
        if (!shortStats[key]._votes) shortStats[key]._votes = {};
        const prevVote = shortStats[key]._votes[likeUserKey];
        if (liked) {
          if (prevVote === 'like') {
            // Already liked — toggle off
            shortStats[key].likes = Math.max(0, shortStats[key].likes - 1);
            delete shortStats[key]._votes[likeUserKey];
          } else {
            shortStats[key].likes++;
            shortStats[key]._votes[likeUserKey] = 'like';
          }
        } else {
          if (prevVote === 'like') {
            shortStats[key].likes = Math.max(0, shortStats[key].likes - 1);
            delete shortStats[key]._votes[likeUserKey];
          }
        }
        scheduleShortStatsPersist();
        try {
          const identity = ensureIdentity(req, res);
          appendRecoEvent(identity, {
            eventType: 'vote',
            action: liked ? 'like' : 'unlike',
            videoId: canonicalVideoId('', '', key),
            name: key,
            surface: 'shorts',
          });
        } catch {}
        return sendJson(res, 200, { views: shortStats[key].views || 0, likes: shortStats[key].likes || 0 });
      } catch { return sendJson(res, 400, { error: 'Bad JSON' }); }
    }

    // GET /api/videos — all videos user has access to (auth, tier-gated), pagination, sort, filter, search
    // Video list cache per tier (2 minute TTL) to speed up search
    if (!global._videoListCache) global._videoListCache = {};
    if (requestUrl.pathname === '/api/videos') {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') return sendJson(res, 405, { error: 'Method Not Allowed' });
      const authed = await requireAuthedUser(req, res);
      if (!authed) return;
      const { record: u } = authed;
      const tier = getEffectiveTierForUser(u);
      if (tier < 1) return sendJson(res, 403, { error: 'Tier required' });
      const vaultFolders = accessibleVaultFolders(tier);

      const limit = Math.min(50, Math.max(1, parseInt(requestUrl.searchParams.get('limit') || '50', 10) || 50));
      const offset = Math.max(0, parseInt(requestUrl.searchParams.get('offset') || '0', 10) || 0);
      const sort = (requestUrl.searchParams.get('sort') || 'name').toLowerCase();
      const order = (requestUrl.searchParams.get('order') || 'asc').toLowerCase();
      const categories = requestUrl.searchParams.getAll('category').map((c) => (c || '').trim()).filter(Boolean);
      const search = (requestUrl.searchParams.get('search') || '').trim().toLowerCase();
      const random = requestUrl.searchParams.get('random') === '1';

      if (!R2_ENABLED) return sendJson(res, 200, { files: [], total: 0 });

      const legacyTierFolders = accessibleLegacyTierPrefixes(tier);
      const cacheKey = `${tier}|` + legacyTierFolders.join('+') + (categories.length ? ':' + categories.sort().join(',') : '');
      const cached = global._videoListCache[cacheKey];
      let allItems;
      if (cached && (Date.now() - cached.ts < 600000)) { // 10 min cache
        allItems = cached.items;
      } else {
        allItems = [];
        const seenSizes = new Set();
        const seenTitles = new Set();

        for (const [folderName, basePath] of allowedFolders.entries()) {
          if (categories.length > 0 && !categories.includes(folderName)) continue;
          if (folderName === 'Omegle') {
            for (const subfolder of OMEGLE_SUBFOLDERS) {
              for (const v of vaultFolders) {
                const prefix = basePath + '/' + v + '/' + subfolder + '/';
                try {
                  const items = await r2ListMediaFilesFromPrefix(prefix);
                  for (const item of items) {
                    if (!isVideoFile(item.name)) continue;
                    const sz = item.size || 0;
                    let isDupe = false;
                    if (sz > 10000) {
                      for (const s of seenSizes) { if (Math.abs(sz - s) / Math.max(sz, s) < 0.001) { isDupe = true; break; } }
                      if (!isDupe) seenSizes.add(sz);
                    }
                    if (isDupe) continue;
                    const key = videoKey(folderName, subfolder, item.name, v);
                    const stats = shortStats[key] || { views: 0, likes: 0, dislikes: 0 };
                    allItems.push({
                      name: item.name,
                      folder: folderName,
                      subfolder,
                      vault: v,
                      type: 'video',
                      size: item.size || 0,
                      lastModified: item.lastModified || 0,
                      videoKey: key,
                      src: `/media?folder=${encodeURIComponent(folderName)}&subfolder=${encodeURIComponent(subfolder)}&name=${encodeURIComponent(item.name)}&vault=${encodeURIComponent(v)}`,
                      duration: _getDuration(folderName, subfolder, item.name, v),
                      views: stats.views || 0,
                      likes: stats.likes || 0,
                      dislikes: stats.dislikes || 0,
                    });
                  }
                } catch { /* skip */ }
              }
              for (const legacyCt of ['video', 'photo', 'gif']) {
                for (const v of vaultFolders) {
                  const prefix = basePath + '/' + legacyCt + '/' + v + '/' + subfolder + '/';
                  try {
                    const items = await r2ListMediaFilesFromPrefix(prefix);
                    for (const item of items) {
                      if (!isVideoFile(item.name)) continue;
                      const sz = item.size || 0;
                      let isDupe = false;
                      if (sz > 10000) {
                        for (const s of seenSizes) { if (Math.abs(sz - s) / Math.max(sz, s) < 0.001) { isDupe = true; break; } }
                        if (!isDupe) seenSizes.add(sz);
                      }
                      if (isDupe) continue;
                      const key = videoKey(folderName, subfolder, item.name, v);
                      const stats = shortStats[key] || { views: 0, likes: 0, dislikes: 0 };
                      allItems.push({
                        name: item.name,
                        folder: folderName,
                        subfolder,
                        vault: v,
                        type: 'video',
                        size: item.size || 0,
                        lastModified: item.lastModified || 0,
                        videoKey: key,
                        src: `/media?folder=${encodeURIComponent(folderName)}&subfolder=${encodeURIComponent(subfolder)}&name=${encodeURIComponent(item.name)}&vault=${encodeURIComponent(v)}`,
                        duration: _getDuration(folderName, subfolder, item.name, v),
                        views: stats.views || 0,
                        likes: stats.likes || 0,
                        dislikes: stats.dislikes || 0,
                      });
                    }
                  } catch { /* skip */ }
                }
              }
              for (const tf of legacyTierFolders) {
                const prefix = basePath + '/' + tf + '/' + subfolder + '/';
                try {
                  const items = await r2ListMediaFilesFromPrefix(prefix);
                  for (const item of items) {
                    if (!isVideoFile(item.name)) continue;
                    const sz = item.size || 0;
                    let isDupe = false;
                    if (sz > 10000) {
                      for (const s of seenSizes) { if (Math.abs(sz - s) / Math.max(sz, s) < 0.001) { isDupe = true; break; } }
                      if (!isDupe) seenSizes.add(sz);
                    }
                    if (isDupe) continue;
                    const key = videoKey(folderName, subfolder, item.name);
                    const stats = shortStats[key] || { views: 0, likes: 0, dislikes: 0 };
                    allItems.push({
                      name: item.name,
                      folder: folderName,
                      subfolder,
                      type: 'video',
                      size: item.size || 0,
                      lastModified: item.lastModified || 0,
                      videoKey: key,
                      src: `/media?folder=${encodeURIComponent(folderName)}&subfolder=${encodeURIComponent(subfolder)}&name=${encodeURIComponent(item.name)}`,
                      duration: _getDuration(folderName, subfolder, item.name),
                      views: stats.views || 0,
                      likes: stats.likes || 0,
                      dislikes: stats.dislikes || 0,
                    });
                  }
                } catch { /* skip */ }
              }
            }
            // Support Omegle layouts where files are directly under vault/tier folders (no subfolder segment).
            for (const v of vaultFolders) {
              const prefix = basePath + '/' + v + '/';
              try {
                const items = await r2ListMediaFilesFromPrefix(prefix);
                for (const item of items) {
                  if (!isVideoFile(item.name)) continue;
                  const sz = item.size || 0;
                  let isDupe = false;
                  if (sz > 10000) {
                    for (const s of seenSizes) { if (Math.abs(sz - s) / Math.max(sz, s) < 0.001) { isDupe = true; break; } }
                    if (!isDupe) seenSizes.add(sz);
                  }
                  if (isDupe) continue;
                  const key = videoKey(folderName, '', item.name, v);
                  const stats = shortStats[key] || { views: 0, likes: 0, dislikes: 0 };
                  allItems.push({
                    name: item.name,
                    folder: folderName,
                    subfolder: '',
                    vault: v,
                    type: 'video',
                    size: item.size || 0,
                    lastModified: item.lastModified || 0,
                    videoKey: key,
                    src: `/media?folder=${encodeURIComponent(folderName)}&name=${encodeURIComponent(item.name)}&vault=${encodeURIComponent(v)}`,
                    duration: _getDuration(folderName, '', item.name, v),
                    views: stats.views || 0,
                    likes: stats.likes || 0,
                    dislikes: stats.dislikes || 0,
                  });
                }
              } catch { /* skip */ }
            }
            for (const tf of legacyTierFolders) {
              const prefix = basePath + '/' + tf + '/';
              try {
                const items = await r2ListMediaFilesFromPrefix(prefix);
                for (const item of items) {
                  if (!isVideoFile(item.name)) continue;
                  const sz = item.size || 0;
                  let isDupe = false;
                  if (sz > 10000) {
                    for (const s of seenSizes) { if (Math.abs(sz - s) / Math.max(sz, s) < 0.001) { isDupe = true; break; } }
                    if (!isDupe) seenSizes.add(sz);
                  }
                  if (isDupe) continue;
                  const key = videoKey(folderName, '', item.name);
                  const stats = shortStats[key] || { views: 0, likes: 0, dislikes: 0 };
                  allItems.push({
                    name: item.name,
                    folder: folderName,
                    subfolder: '',
                    type: 'video',
                    size: item.size || 0,
                    lastModified: item.lastModified || 0,
                    videoKey: key,
                    src: `/media?folder=${encodeURIComponent(folderName)}&name=${encodeURIComponent(item.name)}`,
                    duration: _getDuration(folderName, '', item.name),
                    views: stats.views || 0,
                    likes: stats.likes || 0,
                    dislikes: stats.dislikes || 0,
                  });
                }
              } catch { /* skip */ }
            }
          } else {
            for (const v of vaultFolders) {
              const prefix = basePath + '/' + v + '/';
              try {
                const items = await r2ListMediaFilesFromPrefix(prefix);
                for (const item of items) {
                  if (!isVideoFile(item.name)) continue;
                  const normTitle = item.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').replace(/\s*\(\d+\)\s*/g, '').replace(/\s*\[\d+\]\s*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
                  if (normTitle && seenTitles.has(normTitle)) continue;
                  if (normTitle) seenTitles.add(normTitle);
                  const key = videoKey(folderName, '', item.name, v);
                  const stats = shortStats[key] || { views: 0, likes: 0, dislikes: 0 };
                  allItems.push({
                    name: item.name,
                    folder: folderName,
                    subfolder: '',
                    vault: v,
                    type: 'video',
                    size: item.size || 0,
                    lastModified: item.lastModified || 0,
                    videoKey: key,
                    src: `/media?folder=${encodeURIComponent(folderName)}&name=${encodeURIComponent(item.name)}&vault=${encodeURIComponent(v)}`,
                    duration: _getDuration(folderName, '', item.name, v),
                    views: stats.views || 0,
                    likes: stats.likes || 0,
                    dislikes: stats.dislikes || 0,
                  });
                }
              } catch { /* skip */ }
            }
            for (const legacyCt of ['video', 'photo', 'gif']) {
              for (const v of vaultFolders) {
                const prefix = basePath + '/' + legacyCt + '/' + v + '/';
                try {
                  const items = await r2ListMediaFilesFromPrefix(prefix);
                  for (const item of items) {
                    if (!isVideoFile(item.name)) continue;
                    const normTitle = item.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').replace(/\s*\(\d+\)\s*/g, '').replace(/\s*\[\d+\]\s*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
                    if (normTitle && seenTitles.has(normTitle)) continue;
                    if (normTitle) seenTitles.add(normTitle);
                    const key = videoKey(folderName, '', item.name, v);
                    const stats = shortStats[key] || { views: 0, likes: 0, dislikes: 0 };
                    allItems.push({
                      name: item.name,
                      folder: folderName,
                      subfolder: '',
                      vault: v,
                      type: 'video',
                      size: item.size || 0,
                      lastModified: item.lastModified || 0,
                      videoKey: key,
                      src: `/media?folder=${encodeURIComponent(folderName)}&name=${encodeURIComponent(item.name)}&vault=${encodeURIComponent(v)}`,
                      duration: _getDuration(folderName, '', item.name, v),
                      views: stats.views || 0,
                      likes: stats.likes || 0,
                      dislikes: stats.dislikes || 0,
                    });
                  }
                } catch { /* skip */ }
              }
            }
            for (const tf of legacyTierFolders) {
              const prefix = basePath + '/' + tf + '/';
              try {
                const items = await r2ListMediaFilesFromPrefix(prefix);
                for (const item of items) {
                  if (!isVideoFile(item.name)) continue;
                  const normTitle = item.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').replace(/\s*\(\d+\)\s*/g, '').replace(/\s*\[\d+\]\s*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
                  if (normTitle && seenTitles.has(normTitle)) continue;
                  if (normTitle) seenTitles.add(normTitle);
                  const key = videoKey(folderName, '', item.name);
                  const stats = shortStats[key] || { views: 0, likes: 0, dislikes: 0 };
                  allItems.push({
                    name: item.name,
                    folder: folderName,
                    subfolder: '',
                    type: 'video',
                    size: item.size || 0,
                    lastModified: item.lastModified || 0,
                    videoKey: key,
                    src: `/media?folder=${encodeURIComponent(folderName)}&name=${encodeURIComponent(item.name)}`,
                    duration: _getDuration(folderName, '', item.name),
                    views: stats.views || 0,
                    likes: stats.likes || 0,
                    dislikes: stats.dislikes || 0,
                  });
                }
              } catch { /* skip */ }
            }
          }
        }
        global._videoListCache[cacheKey] = { items: allItems, ts: Date.now() };
      } // end cache miss

      let filtered = search
        ? allItems.filter((i) => i.name.toLowerCase().includes(search))
        : allItems;

      if (sort === 'name') {
        filtered.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      } else if (sort === 'size') {
        filtered.sort((a, b) => (a.size || 0) - (b.size || 0));
      } else if (sort === 'date') {
        filtered.sort((a, b) => (a.lastModified || 0) - (b.lastModified || 0));
      } else if (sort === 'views') {
        filtered.sort((a, b) => (a.views || 0) - (b.views || 0));
      } else if (sort === 'rating') {
        filtered.sort((a, b) => {
          const ra = (a.likes || 0) - (a.dislikes || 0);
          const rb = (b.likes || 0) - (b.dislikes || 0);
          return ra - rb;
        });
      }
      if (order === 'desc') filtered.reverse();

      if (random) {
        for (let i = filtered.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const tmp = filtered[i]; filtered[i] = filtered[j]; filtered[j] = tmp;
        }
      }

      const total = filtered.length;
      const page = filtered.slice(offset, offset + limit).map(f => {
        const thumb = _thumbUrl(f.folder || '', f.subfolder || '', f.name, f.vault);
        return { ...f, thumb };
      });
      return sendJson(res, 200, { files: page, total });
    }

    // ===== COMMENTS =====
    // Server-side HTML sanitization to prevent XSS
    function _escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    }
    // Shared slur filter
    const COMMENT_BLOCKED_WORDS = ['nigger', 'nigga', 'faggot', 'fag', 'tranny', 'retard', 'kike', 'spic', 'chink', 'wetback'];
    function _commentFilterText(text) {
      const lower = text.toLowerCase();
      for (const w of COMMENT_BLOCKED_WORDS) { if (lower.includes(w)) return false; }
      return true;
    }
    function _sanitizeComment(c) {
      return {
        id: c.id, user: _escapeHtml(c.user), text: _escapeHtml(c.text), ts: c.ts,
        likes: c.likes || 0, dislikes: c.dislikes || 0,
        replies: (c.replies || []).map(r => ({ id: r.id, user: _escapeHtml(r.user), text: _escapeHtml(r.text), ts: r.ts, likes: r.likes || 0, dislikes: r.dislikes || 0 }))
      };
    }

    // GET /api/comments?key=videoKey — get comments for a video
    if (requestUrl.pathname === '/api/comments' && (req.method || 'GET').toUpperCase() === 'GET') {
      const key = requestUrl.searchParams.get('key') || '';
      if (!key) return sendJson(res, 400, { error: 'Missing key' });
      await ensureCommentsFresh();
      const comments = (videoComments[key] || []).map(_sanitizeComment);
      return sendJson(res, 200, { comments });
    }

    // POST /api/comments — add a comment (requires auth, rate limited, filtered)
    if (requestUrl.pathname === '/api/comments' && (req.method || 'GET').toUpperCase() === 'POST') {
      await ensureSessionsLoaded();
      const commentUserKey = await getAuthedUserKeyWithRefresh(req);
      if (!commentUserKey) return sendJson(res, 401, { error: 'Login required to comment' });
      const body = await readRawBody(req, res, 2048);
      if (!body) return;
      try {
        const { key, text } = JSON.parse(body);
        if (!key || typeof key !== 'string') return sendJson(res, 400, { error: 'Missing key' });
        if (!text || typeof text !== 'string') return sendJson(res, 400, { error: 'Missing text' });
        const trimmed = text.trim().slice(0, 500);
        if (trimmed.length < 1) return sendJson(res, 400, { error: 'Comment too short' });
        if (!_commentFilterText(trimmed)) return sendJson(res, 400, { error: 'Comment contains prohibited language' });
        if (!videoComments[key]) videoComments[key] = [];
        const now = Date.now();
        const userRecent = videoComments[key].filter(c => c._userKey === commentUserKey && (now - c.ts) < 10000);
        if (userRecent.length > 0) return sendJson(res, 429, { error: 'Please wait before commenting again' });
        const db = await ensureUsersDbFresh();
        const record = db.users[commentUserKey];
        const username = record ? (record.username || record.discordUsername || 'User') : 'User';
        const commentId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const newComment = { id: commentId, user: username, text: trimmed, ts: now, _userKey: commentUserKey, likes: 0, dislikes: 0, _votes: {}, replies: [] };
        videoComments[key].push(newComment);
        if (videoComments[key].length > 200) videoComments[key] = videoComments[key].slice(-200);
        scheduleCommentsPersist();
        return sendJson(res, 200, { ok: true, comment: _sanitizeComment(newComment) });
      } catch { return sendJson(res, 400, { error: 'Bad JSON' }); }
    }

    // POST /api/comments/vote — like or dislike a comment
    if (requestUrl.pathname === '/api/comments/vote' && (req.method || 'GET').toUpperCase() === 'POST') {
      await ensureSessionsLoaded();
      const voteUserKey = await getAuthedUserKeyWithRefresh(req);
      if (!voteUserKey) return sendJson(res, 401, { error: 'Login required' });
      const body = await readRawBody(req, res, 1024);
      if (!body) return;
      try {
        const { key, commentId, action } = JSON.parse(body);
        if (!key || !commentId) return sendJson(res, 400, { error: 'Missing key or commentId' });
        const act = String(action).toLowerCase();
        if (act !== 'like' && act !== 'dislike') return sendJson(res, 400, { error: 'Invalid action' });
        const comments = videoComments[key];
        if (!comments) return sendJson(res, 404, { error: 'Not found' });
        // Find comment or reply
        let target = null;
        for (const c of comments) {
          if (c.id === commentId) { target = c; break; }
          for (const r of (c.replies || [])) { if (r.id === commentId) { target = r; break; } }
          if (target) break;
        }
        if (!target) return sendJson(res, 404, { error: 'Comment not found' });
        if (!target._votes) target._votes = {};
        if (typeof target.likes !== 'number') target.likes = 0;
        if (typeof target.dislikes !== 'number') target.dislikes = 0;
        const prev = target._votes[voteUserKey];
        if (prev === act) {
          if (act === 'like') target.likes = Math.max(0, target.likes - 1);
          else target.dislikes = Math.max(0, target.dislikes - 1);
          delete target._votes[voteUserKey];
        } else {
          if (prev === 'like') target.likes = Math.max(0, target.likes - 1);
          else if (prev === 'dislike') target.dislikes = Math.max(0, target.dislikes - 1);
          if (act === 'like') target.likes++;
          else target.dislikes++;
          target._votes[voteUserKey] = act;
        }
        scheduleCommentsPersist();
        return sendJson(res, 200, { ok: true, likes: target.likes, dislikes: target.dislikes });
      } catch { return sendJson(res, 400, { error: 'Bad JSON' }); }
    }

    // POST /api/comments/reply — reply to a comment
    if (requestUrl.pathname === '/api/comments/reply' && (req.method || 'GET').toUpperCase() === 'POST') {
      await ensureSessionsLoaded();
      const replyUserKey = await getAuthedUserKeyWithRefresh(req);
      if (!replyUserKey) return sendJson(res, 401, { error: 'Login required' });
      const body = await readRawBody(req, res, 2048);
      if (!body) return;
      try {
        const { key, commentId, text } = JSON.parse(body);
        if (!key || !commentId || !text) return sendJson(res, 400, { error: 'Missing fields' });
        const trimmed = String(text).trim().slice(0, 500);
        if (trimmed.length < 1) return sendJson(res, 400, { error: 'Reply too short' });
        if (!_commentFilterText(trimmed)) return sendJson(res, 400, { error: 'Reply contains prohibited language' });
        const comments = videoComments[key];
        if (!comments) return sendJson(res, 404, { error: 'Not found' });
        const parent = comments.find(c => c.id === commentId);
        if (!parent) return sendJson(res, 404, { error: 'Comment not found' });
        // Rate limit replies
        const now = Date.now();
        const recentReplies = (parent.replies || []).filter(r => r._userKey === replyUserKey && (now - r.ts) < 10000);
        if (recentReplies.length > 0) return sendJson(res, 429, { error: 'Please wait before replying again' });
        const db = await ensureUsersDbFresh();
        const record = db.users[replyUserKey];
        const username = record ? (record.username || record.discordUsername || 'User') : 'User';
        const replyId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        if (!parent.replies) parent.replies = [];
        const reply = { id: replyId, user: username, text: trimmed, ts: now, _userKey: replyUserKey, likes: 0, dislikes: 0, _votes: {} };
        parent.replies.push(reply);
        if (parent.replies.length > 50) parent.replies = parent.replies.slice(-50);
        scheduleCommentsPersist();
        return sendJson(res, 200, { ok: true, reply: { id: replyId, user: username, text: trimmed, ts: now, likes: 0, dislikes: 0 } });
      } catch { return sendJson(res, 400, { error: 'Bad JSON' }); }
    }

    // GET /api/video/stats?key=videoKey — read-only stats (no auth)
    if (requestUrl.pathname === '/api/video/stats' && (req.method || 'GET').toUpperCase() === 'GET') {
      const key = requestUrl.searchParams.get('key') || '';
      if (!key) return sendJson(res, 400, { error: 'Missing key' });
      await ensureShortStatsFresh();
      const s = shortStats[key] || { views: 0, likes: 0, dislikes: 0 };
      const commentCount = (videoComments[key] || []).length;
      // Include user's own vote so frontend can persist button state
      await ensureSessionsLoaded();
      const statsUserKey = await getAuthedUserKeyWithRefresh(req);
      const myVote = (statsUserKey && s._votes) ? (s._votes[statsUserKey] || null) : null;
      return sendJson(res, 200, { views: s.views || 0, likes: s.likes || 0, dislikes: s.dislikes || 0, commentCount, myVote });
    }

    // POST /api/video/stats — record view, like, or dislike (uses shortStats as single source)
    if (requestUrl.pathname === '/api/video/stats') {
      if ((req.method || '').toUpperCase() !== 'POST') return sendJson(res, 405, { error: 'POST only' });
      const body = await readRawBody(req, res, 2048);
      if (!body) return;
      try {
        const { videoKey: key, action } = JSON.parse(body);
        if (!key || typeof key !== 'string') return sendJson(res, 400, { error: 'Missing videoKey' });
        const act = String(action || 'view').toLowerCase();
        if (act !== 'view' && act !== 'like' && act !== 'dislike') return sendJson(res, 400, { error: 'Invalid action' });
        if (!shortStats[key]) shortStats[key] = { views: 0, likes: 0, dislikes: 0 };
        if (typeof shortStats[key].dislikes !== 'number') shortStats[key].dislikes = 0;
        if (!shortStats[key]._votes) shortStats[key]._votes = {}; // { userKey: 'like'|'dislike' }

        let voteUserKey = null;
        if (act === 'view') {
          // Rate limit: 1 view per 10s per IP per video
          const _vsIp = normalizeIp(getClientIp(req));
          if (!isViewRateLimited(_vsIp, key)) shortStats[key].views++;
        } else {
          // Like/dislike requires auth
          await ensureSessionsLoaded();
          voteUserKey = await getAuthedUserKeyWithRefresh(req);
          if (!voteUserKey) return sendJson(res, 401, { error: 'Login required to vote' });

          const prevVote = shortStats[key]._votes[voteUserKey];
          if (prevVote === act) {
            // Already voted this way — undo it
            if (act === 'like') shortStats[key].likes = Math.max(0, shortStats[key].likes - 1);
            else shortStats[key].dislikes = Math.max(0, shortStats[key].dislikes - 1);
            delete shortStats[key]._votes[voteUserKey];
          } else {
            // Undo previous vote if switching
            if (prevVote === 'like') shortStats[key].likes = Math.max(0, shortStats[key].likes - 1);
            else if (prevVote === 'dislike') shortStats[key].dislikes = Math.max(0, shortStats[key].dislikes - 1);
            // Apply new vote
            if (act === 'like') shortStats[key].likes++;
            else shortStats[key].dislikes++;
            shortStats[key]._votes[voteUserKey] = act;
          }
        }
        scheduleShortStatsPersist();
        try {
          const identity = ensureIdentity(req, res);
          const parsed = parseCanonicalVideoId(canonicalVideoId('', '', key));
          appendRecoEvent(identity, {
            eventType: act === 'view' ? 'video_progress' : 'vote',
            action: act,
            videoId: canonicalVideoId('', '', key),
            folder: parsed.folder,
            subfolder: parsed.subfolder,
            name: parsed.name || key,
            completed: false,
          });
        } catch {}
        // Return stats without _votes internals + user's current vote
        const myVoteNow = voteUserKey ? (shortStats[key]._votes[voteUserKey] || null) : null;
        return sendJson(res, 200, { views: shortStats[key].views, likes: shortStats[key].likes, dislikes: shortStats[key].dislikes, myVote: myVoteNow });
      } catch { return sendJson(res, 400, { error: 'Bad JSON' }); }
    }

    function _userSimilarityScore(a, b) {
      if (!a || !b) return 0;
      const catsA = a.categoryWatchMs || {};
      const catsB = b.categoryWatchMs || {};
      let score = 0;
      for (const [cat, msA] of Object.entries(catsA)) {
        const msB = Number(catsB[cat] || 0);
        if (msB <= 0) continue;
        score += Math.min(Number(msA || 0), msB);
      }
      return score;
    }

    function rankRecommendationFiles(identity, allFiles, options = {}) {
      const limit = Math.min(80, Math.max(1, Number(options.limit || 12)));
      const surface = String(options.surface || 'home');
      const contextVideoId = String(options.contextVideoId || '');
      const contextFolder = String(options.contextFolder || '');
      const profile = userProfiles[identity.identityKey] || null;
      const watched = new Set(Object.keys((profile && profile.watchedVideos) || {}));
      const preferredCats = (profile && profile.categoryWatchMs) ? profile.categoryWatchMs : {};
      const completionCats = (profile && profile.categoryCompletions) ? profile.categoryCompletions : {};

      // Collaborative candidate set: find top similar users, then collect their watched videos.
      const collabBoost = {};
      if (profile) {
        const sims = Object.entries(userProfiles)
          .filter(([k]) => k !== identity.identityKey)
          .map(([k, p]) => ({ k, score: _userSimilarityScore(profile, p), p }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 20);
        for (const s of sims) {
          const watchedMap = (s.p && s.p.watchedVideos) || {};
          for (const [videoId, watchMs] of Object.entries(watchedMap)) {
            collabBoost[videoId] = (collabBoost[videoId] || 0) + Math.min(8, (Number(watchMs || 0) / 45000)) + Math.min(18, s.score / 120000);
          }
        }
      }

      const globalTop = new Map((recoGlobalStats.topVideos || []).map((v, idx) => [v.videoId, Math.max(0, 240 - idx)]));
      const contextParsed = parseCanonicalVideoId(contextVideoId);
      const scored = allFiles.map((f, idx) => {
        const videoId = f.videoId || canonicalVideoId(f.folder, f.subfolder || '', f.name, f.vault);
        const category = String(f.folder || '');
        const views = Number(f.views || 0);
        const likes = Number(f.likes || 0);
        const dislikes = Number(f.dislikes || 0);
        const engagement = likes - dislikes;
        const recency = Number(f.lastModified || 0) > 0 ? Math.max(0, (Date.now() - Number(f.lastModified || 0)) / 86400000) : 365;
        const watchedPenalty = watched.has(videoId) ? 12 : 0;
        const categoryAffinity = Number(preferredCats[category] || 0) / 60000;
        const completionBoost = Number(completionCats[category] || 0) * 0.8;
        const collab = Number(collabBoost[videoId] || 0);
        const global = Number(globalTop.get(videoId) || 0) * 0.06;
        const contextBoost = (() => {
          if (surface === 'video' && contextParsed.folder && category === contextParsed.folder) return 7;
          if (surface === 'category' && contextFolder && category === contextFolder) return 6;
          if (surface === 'shorts' && Number((profile && profile.shortFormWatchMs) || 0) > Number((profile && profile.longFormWatchMs) || 0)) return 4;
          return 0;
        })();
        const diversityPenalty = (idx % 5 === 0) ? 0.4 : 0;
        const freshnessBoost = recency < 14 ? 3 : recency < 60 ? 1.5 : 0;
        const score =
          views * (surface === 'shorts' ? 0.00045 : 0.0003) +
          engagement * 0.06 +
          categoryAffinity * (surface === 'category' ? 1.7 : 1.2) +
          completionBoost +
          collab * (surface === 'video' ? 1.35 : 1.0) +
          global +
          contextBoost +
          freshnessBoost -
          watchedPenalty -
          diversityPenalty;
        return { ...f, videoId, _score: score };
      });

      scored.sort((a, b) => b._score - a._score);
      const usedCats = {};
      const out = [];
      for (const row of scored) {
        const cat = String(row.folder || '');
        const bucket = usedCats[cat] || 0;
        if (bucket >= 5 && out.length < limit * 2) continue; // enforce diversity in top rows
        usedCats[cat] = bucket + 1;
        out.push(row);
        if (out.length >= limit) break;
      }
      // Single-category or skewed libraries can stall below `limit`; fill from remaining ranked rows.
      if (out.length < limit) {
        const picked = new Set(out.map((r) => r.videoId));
        for (const row of scored) {
          if (picked.has(row.videoId)) continue;
          out.push(row);
          picked.add(row.videoId);
          if (out.length >= limit) break;
        }
      }
      return out;
    }

    // GET /api/recommendations — personalized recommendations by surface/context.
    if (requestUrl.pathname === '/api/recommendations') {
      await ensureShortStatsFresh();
      await ensurePreviewCacheReady();
      const identity = ensureIdentity(req, res);
      const surface = (requestUrl.searchParams.get('surface') || 'home').toLowerCase();
      const maxLimit = surface === 'shorts' ? 150 : 30;
      const limit = Math.min(maxLimit, Math.max(1, parseInt(requestUrl.searchParams.get('limit') || '12', 10) || 12));
      const contextVideoId = requestUrl.searchParams.get('contextVideoId') || '';
      const contextFolder = requestUrl.searchParams.get('contextFolder') || '';
      let allFiles = enrichPreviewFilesWithLiveStats(previewFileList.slice());
      maybeRebuildRecoGlobalStats();
      const ranked = rankRecommendationFiles(identity, allFiles, { limit, surface, contextVideoId, contextFolder });

      const slice = ranked.slice(0, limit).map(f => {
        const out = Object.assign({}, f);
        if (isVideoFile(f.name)) {
          out.thumb = _thumbUrl(f.folder || '', f.subfolder || '', f.name, f.vault);
        }
        out.recoScore = Number(f._score || 0);
        return out;
      });
      schedulePrioritizedThumbWarm(slice, 0, { priorityCount: Math.min(limit, 18) });
      return sendJson(res, 200, { files: slice });
    }

    if (requestUrl.pathname === '/api/recommendations/related') {
      await ensureShortStatsFresh();
      await ensurePreviewCacheReady();
      const identity = ensureIdentity(req, res);
      const videoId = requestUrl.searchParams.get('videoId') || '';
      if (!videoId) return sendJson(res, 400, { error: 'Missing videoId' });
      const limit = Math.min(30, Math.max(1, parseInt(requestUrl.searchParams.get('limit') || '8', 10) || 8));
      const allFiles = enrichPreviewFilesWithLiveStats(previewFileList.slice()).filter((f) => {
        const id = f.videoId || canonicalVideoId(f.folder, f.subfolder || '', f.name, f.vault);
        return id !== videoId;
      });
      maybeRebuildRecoGlobalStats();
      const ranked = rankRecommendationFiles(identity, allFiles, { limit, surface: 'video', contextVideoId: videoId });
      const slice = ranked.slice(0, limit).map((f) => {
        const out = Object.assign({}, f);
        if (isVideoFile(f.name)) {
          out.thumb = _thumbUrl(f.folder || '', f.subfolder || '', f.name, f.vault);
        }
        return out;
      });
      schedulePrioritizedThumbWarm(slice, 0, { priorityCount: Math.min(limit, 18) });
      return sendJson(res, 200, { files: slice });
    }

    if (requestUrl.pathname === '/api/recommendations/continue-watching') {
      const identity = ensureIdentity(req, res);
      const limit = Math.min(40, Math.max(1, parseInt(requestUrl.searchParams.get('limit') || '12', 10) || 12));
      const rows = Object.values(userVideoProgress)
        .filter((p) => p && p.identityKey === identity.identityKey && Number(p.percentWatched || 0) > 5 && Number(p.percentWatched || 0) < 95)
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
        .slice(0, limit);
      return sendJson(res, 200, { files: rows });
    }

    // GET /api/trending — videos with most views in recent period
    if (requestUrl.pathname === '/api/trending') {
      await ensureShortStatsFresh();
      await ensurePreviewCacheReady();
      const limit = Math.min(30, Math.max(1, parseInt(requestUrl.searchParams.get('limit') || '12', 10) || 12));
      let allFiles = enrichPreviewFilesWithLiveStats(previewFileList.slice());
      allFiles.sort((a, b) => (b.views || 0) - (a.views || 0));
      const slice = allFiles.slice(0, limit).map(f => {
        const out = Object.assign({}, f);
        out.isTrending = true;
        if (isVideoFile(f.name)) {
          out.thumb = _thumbUrl(f.folder || '', f.subfolder || '', f.name, f.vault);
        }
        return out;
      });
      schedulePrioritizedThumbWarm(slice, 0, { priorityCount: Math.min(limit, 18) });
      return sendJson(res, 200, { files: slice });
    }

    // GET /api/newest — most recently added videos
    if (requestUrl.pathname === '/api/newest') {
      await ensureShortStatsFresh();
      await ensurePreviewCacheReady();
      const limit = Math.min(300, Math.max(1, parseInt(requestUrl.searchParams.get('limit') || '12', 10) || 12));
      let allFiles = enrichPreviewFilesWithLiveStats(previewFileList.slice());
      // Sort by lastModified desc (newest first)
      allFiles.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
      const slice = allFiles.slice(0, limit).map(f => {
        const out = Object.assign({}, f);
        out.isNew = true;
        if (isVideoFile(f.name)) {
          out.thumb = _thumbUrl(f.folder || '', f.subfolder || '', f.name, f.vault);
        }
        return out;
      });
      schedulePrioritizedThumbWarm(slice, 0, { priorityCount: Math.min(limit, 18) });
      return sendJson(res, 200, { files: slice });
    }

    // GET /api/random-videos — returns preview videos from all folders (no auth)
    // Supports: ?sort=views|random|top_random (default views), ?page=0, ?limit=30, ?topPercent=5
    if (requestUrl.pathname === '/api/random-videos') {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') return sendJson(res, 405, { error: 'Method Not Allowed' });
      const limit = Math.min(240, Math.max(1, parseInt(requestUrl.searchParams.get('limit') || '30', 10) || 30));
      const page = Math.max(0, parseInt(requestUrl.searchParams.get('page') || '0', 10) || 0);
      const sort = (requestUrl.searchParams.get('sort') || 'views').toLowerCase();
      const topPercent = Math.min(50, Math.max(1, parseFloat(requestUrl.searchParams.get('topPercent') || '5') || 5));

      if (!R2_ENABLED) return sendJson(res, 200, { files: [], totalPages: 0 });

      await ensureShortStatsFresh();
      await ensurePreviewCacheReady();
      // Use pre-built list; views/likes merged from shortStats so counts stay current between cache rebuilds
      let allFiles = enrichPreviewFilesWithLiveStats(previewFileList.slice());
      if (sort === 'views') {
        allFiles.sort((a, b) => (b.views || 0) - (a.views || 0));
      } else if (sort === 'top_random') {
        allFiles.sort((a, b) => (b.views || 0) - (a.views || 0));
        const n = allFiles.length;
        // Percent-of-library alone yields tiny pools when n is small (e.g. 5% of 40 → 2).
        // Always keep a pool at least as large as the requested page size (capped by n).
        const pctCutoff = Math.max(1, Math.ceil(n * (topPercent / 100)));
        const cutoff = Math.min(n, Math.max(pctCutoff, limit));
        const topPool = allFiles.slice(0, cutoff);
        for (let i = topPool.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const tmp = topPool[i]; topPool[i] = topPool[j]; topPool[j] = tmp;
        }
        allFiles = topPool;
      } else {
        // Fisher-Yates shuffle
        for (let i = allFiles.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const tmp = allFiles[i]; allFiles[i] = allFiles[j]; allFiles[j] = tmp;
        }
      }

      const totalPages = Math.max(1, Math.ceil(allFiles.length / limit));
      const start = page * limit;
      // Always include thumbnail URLs for video files
      const slice = allFiles.slice(start, start + limit).map(f => {
        const out = Object.assign({}, f);
        if (isVideoFile(f.name)) {
          out.thumb = _thumbUrl(f.folder || '', f.subfolder || '', f.name, f.vault);
        }
        return out;
      });
      schedulePrioritizedThumbWarm(slice, 0, { priorityCount: Math.min(limit, 18) });
      return sendJson(res, 200, { files: slice, videos: slice, totalPages, page });
    }

    // GET /api/folder-counts — public, returns video counts per category
    if (requestUrl.pathname === '/api/folder-counts') {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') return sendJson(res, 405, { error: 'Method Not Allowed' });
      res.setHeader('Cache-Control', 'public, max-age=300');
      return sendJson(res, 200, { counts: folderCounts });
    }

    // GET /api/onlyfans-creators — public list + presigned thumbs (aligned with production /onlyfans page)
    if (requestUrl.pathname === '/api/onlyfans-creators') {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') return sendJson(res, 405, { error: 'Method Not Allowed' });
      if (!onlyfansCreatorStatsLoaded) await loadOnlyfansCreatorStats();
      const CREATORS = [
        { slug: 'piper-rockelle', name: 'Piper Rockelle', ext: '.jpg' },
        { slug: 'sophie-rain', name: 'Sophie Rain', ext: '.png' },
        { slug: 'brook-monk', name: 'Brook Monk', ext: '.jpg' },
        { slug: 'camilla-araujo', name: 'Camilla Araujo', ext: '.jpg' },
        { slug: 'aishah-sofey', name: 'Aishah Sofey', ext: '.jpg' },
        { slug: 'alina-rose', name: 'Alina Rose', ext: '.jpg' },
        { slug: 'breckie-hill', name: 'Breckie Hill', ext: '.jpg' },
        { slug: 'charli', name: 'Charli', ext: '.jpg' },
        { slug: 'corinna-kopf', name: 'Corinna Kopf', ext: '.jpg' },
        { slug: 'jameliz', name: 'Jameliz', ext: '.jpg' },
        { slug: 'lauren-alexis', name: 'Lauren Alexis', ext: '.jpg' },
        { slug: 'lil-tay', name: 'Lil Tay', ext: '.jpg' },
        { slug: 'megnutt', name: 'Megnutt', ext: '.jpg' },
      ];
      const slugSet = new Set(CREATORS.map((c) => c.slug.toLowerCase()));
      /** @type {Map<string, string>} */
      const thumbKeyBySlug = new Map(); // slug -> exact R2 objectKey

      if (R2_ENABLED && slugSet.size > 0) {
        // Discover the actual objectKey by listing a few likely prefixes.
        // This is intentionally conservative to avoid scanning the whole bucket.
        const prefixes = [
          `${R2_ASSETS_PREFIX}/of-leaks/thumbnails/`,
          `${R2_VIDEOS_PREFIX}/of-leaks/thumbnails/`,
          `${R2_ROOT_PREFIX}/of-leaks/thumbnails/`,
          `${R2_ASSETS_PREFIX}/of-leaks/`,
          `${R2_VIDEOS_PREFIX}/of-leaks/`,
          `${R2_ROOT_PREFIX}/of-leaks/`,
          `porn/of-leaks/thumbnails/`,
          `porn/of-leaks/`,
          `${R2_ASSETS_PREFIX}/onlyfans/thumbnails/`,
          `${R2_VIDEOS_PREFIX}/onlyfans/thumbnails/`,
          `${R2_ROOT_PREFIX}/onlyfans/thumbnails/`,
          `${R2_ASSETS_PREFIX}/onlyfans/`,
          `${R2_VIDEOS_PREFIX}/onlyfans/`,
          `${R2_ROOT_PREFIX}/onlyfans/`,
          `porn/onlyfans/thumbnails/`,
          `porn/onlyfans/`,
          // Broader fallbacks (some buckets store creator images directly under thumbnails/images).
          `${R2_ASSETS_PREFIX}/thumbnails/`,
          `${R2_ASSETS_PREFIX}/images/`,
          `${R2_VIDEOS_PREFIX}/thumbnails/`,
          `${R2_VIDEOS_PREFIX}/images/`,
          'porn/thumbnails/',
          'porn/images/',
        ];

        for (const prefix of prefixes) {
          try {
            const items = await r2ListObjects(prefix, 400);
            for (const item of items) {
              const keyLc = String(item.key || '').toLowerCase();
              for (const slug of slugSet) {
                if (!thumbKeyBySlug.has(slug) && keyLc.includes(slug)) {
                  thumbKeyBySlug.set(slug, item.key);
                }
              }
              if (thumbKeyBySlug.size === slugSet.size) break;
            }
          } catch (e) {
            // Best-effort: listing failures should not break the endpoint.
          }
        }
      }

      const result = CREATORS.map((c) => {
        // Best-effort candidate list to survive migrations/renames in R2.
        // Frontend will try these sequentially on `img` load errors.
        const extCandidates = Array.from(new Set([c.ext, '.jpg', '.png', '.jpeg']));
        const keyCandidates = [];
        for (const ext of extCandidates) {
          keyCandidates.push(`${R2_ASSETS_PREFIX}/of-leaks/thumbnails/${c.slug}${ext}`);
          keyCandidates.push(`${R2_VIDEOS_PREFIX}/of-leaks/thumbnails/${c.slug}${ext}`);
          keyCandidates.push(`${R2_ROOT_PREFIX}/of-leaks/thumbnails/${c.slug}${ext}`);
          keyCandidates.push(`porn/of-leaks/thumbnails/${c.slug}${ext}`);
          keyCandidates.push(`${R2_ASSETS_PREFIX}/onlyfans/thumbnails/${c.slug}${ext}`);
          keyCandidates.push(`${R2_VIDEOS_PREFIX}/onlyfans/thumbnails/${c.slug}${ext}`);
          keyCandidates.push(`${R2_ROOT_PREFIX}/onlyfans/thumbnails/${c.slug}${ext}`); // root-level fallback
          keyCandidates.push(`porn/onlyfans/thumbnails/${c.slug}${ext}`); // legacy fallback
        }

        const discoveredKey = thumbKeyBySlug.get(c.slug.toLowerCase());
        const mergedKeyCandidates = discoveredKey ? [discoveredKey, ...keyCandidates] : keyCandidates;
        const uniqueKeys = Array.from(new Set(mergedKeyCandidates));

        const thumbUrlR2Candidates = R2_ENABLED
          ? uniqueKeys.map((k) => r2PresignedUrl(k, 3600))
          : [];

        return {
          slug: c.slug,
          name: c.name,
          // Prefer discovered/presigned R2 key (covers `of-leaks/thumbnails/*` uploads).
          // Fall back to legacy public path for existing static assets.
          thumbUrl: thumbUrlR2Candidates[0] || `/assets/onlyfans/thumbnails/${c.slug}${c.ext}`,
          // Back-compat: keep old single-field behavior.
          thumbUrlR2: thumbUrlR2Candidates[0] || null,
          thumbUrlR2Candidates,
          views: Math.max(0, Number(onlyfansCreatorStats[c.slug.toLowerCase()]?.views || 0) || 0),
        };
      });
      res.setHeader('Cache-Control', 'public, max-age=300');
      return sendJson(res, 200, { creators: result });
    }

    // POST /api/onlyfans-creators/view — increment creator card view/click stats
    if (requestUrl.pathname === '/api/onlyfans-creators/view') {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });
      if (!onlyfansCreatorStatsLoaded) await loadOnlyfansCreatorStats();
      const body = await readJsonBody(req, res);
      if (!body) return;
      const slug = String(body.slug || '').trim().toLowerCase();
      if (!slug) return sendJson(res, 400, { error: 'Missing slug' });
      const cur = onlyfansCreatorStats[slug] || { views: 0 };
      cur.views = Math.max(0, Number(cur.views || 0) || 0) + 1;
      onlyfansCreatorStats[slug] = cur;
      scheduleOnlyfansCreatorStatsPersist();
      return sendJson(res, 200, { ok: true, slug, views: cur.views });
    }

    // POST /api/onlyfans-requests — send creator requests to Discord webhook
    if (requestUrl.pathname === '/api/onlyfans-requests') {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });
      const body = await readJsonBody(req, res);
      if (!body) return;
      const requestText = String(body.request || '').trim().slice(0, 240);
      if (!requestText) return sendJson(res, 400, { error: 'Request is required' });

      const requesterKey = await getAuthedUserKeyWithRefresh(req);
      let requester = 'Guest';
      if (requesterKey) {
        try {
          const db = await ensureUsersDbFresh();
          const rec = db.users[requesterKey];
          requester = String(rec?.username || requesterKey || 'Guest');
        } catch {
          requester = String(requesterKey);
        }
      }

      if (!DISCORD_WEBHOOK_ONLYFANS_REQUESTS_URL) {
        return sendJson(res, 503, { error: 'OnlyFans request webhook not configured' });
      }

      try {
        const payload = {
          username: 'OnlyFans Requests',
          embeds: [
            {
              title: 'New OnlyFans Request',
              color: 0xff4d6d,
              fields: [
                { name: 'Request', value: requestText, inline: false },
                { name: 'By', value: requester, inline: true },
              ],
              timestamp: new Date().toISOString(),
            },
          ],
        };
        const target = new URL(DISCORD_WEBHOOK_ONLYFANS_REQUESTS_URL);
        const data = JSON.stringify(payload);
        const resp = await httpsRequest(
          DISCORD_WEBHOOK_ONLYFANS_REQUESTS_URL,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(data),
              Host: target.host,
            },
          },
          data,
        );
        if (resp.status < 200 || resp.status >= 300) {
          return sendJson(res, 502, { error: 'Webhook rejected request' });
        }
        return sendJson(res, 200, { ok: true });
      } catch (e) {
        console.error('[onlyfans-requests] webhook error:', e && e.message ? e.message : e);
        return sendJson(res, 500, { error: 'Failed to send request' });
      }
    }

    // GET /api/onlyfans-mega — tier 2 only
    if (requestUrl.pathname === '/api/onlyfans-mega') {
      const authed = await requireAuthedUser(req, res);
      if (!authed) return;
      const { record: u } = authed;
      const tier = getEffectiveTierForUser(u);
      if (tier < 2) return sendJson(res, 403, { error: 'Premium required' });
      const links = await readMegaLinks();
      if (!links.tier2) return sendJson(res, 503, { error: 'Link not configured' });
      return sendJson(res, 200, { url: links.tier2 });
    }

    // API: bust R2 list cache (admin only via query secret or authed admin)
    if (requestUrl.pathname === '/api/cache-bust') {
      Object.keys(_r2ListCache).forEach(k => delete _r2ListCache[k]);
      if (global._listCache) Object.keys(global._listCache).forEach(k => delete global._listCache[k]);
      if (global._staticFileCache) Object.keys(global._staticFileCache).forEach(k => delete global._staticFileCache[k]);
      if (global._videoListCache) Object.keys(global._videoListCache).forEach(k => delete global._videoListCache[k]);
      Object.keys(previewUrlMap).forEach(k => delete previewUrlMap[k]);
      previewFileList = [];
      ensurePreviewCacheReady(true).catch(e => console.error('[cache-bust] rebuild error:', e && e.message ? e.message : e));
      return sendJson(res, 200, { ok: true, message: 'All caches cleared and rebuild kicked off' });
    }

    // API: Chaturbate cam proxy — avoids CORS on live-cams page
    if (requestUrl.pathname === '/api/cams') {
      const gender = requestUrl.searchParams.get('gender') || '';
      const limit = Math.min(parseInt(requestUrl.searchParams.get('limit') || '48', 10), 100);
      const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '8.8.8.8').split(',')[0].trim();
      let cbUrl = `https://chaturbate.com/api/public/affiliates/onlinerooms/?wm=PAhNg&client_ip=${encodeURIComponent(clientIp)}&format=json&limit=${limit}`;
      if (gender) cbUrl += `&gender=${encodeURIComponent(gender)}`;
      try {
        const cbData = await new Promise((resolve, reject) => {
          const cbReq = https.get(cbUrl, { agent: _r2HttpsAgent, timeout: 8000 }, (cbRes) => {
            let body = '';
            cbRes.on('data', c => body += c);
            cbRes.on('end', () => resolve(body));
          });
          cbReq.on('error', reject);
          cbReq.on('timeout', () => { cbReq.destroy(); reject(new Error('timeout')); });
        });
        const camOrigin = getRequestOrigin(req);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120', 'Access-Control-Allow-Origin': camOrigin });
        res.end(cbData);
      } catch {
        return sendJson(res, 502, { error: 'Cam API unavailable' });
      }
      return;
    }

    // API: Cam image proxy — avoids hotlink blocks from mmcdn.com
    if (requestUrl.pathname === '/api/cam-img') {
      const room = (requestUrl.searchParams.get('room') || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!room) return sendJson(res, 400, { error: 'Missing room param' });
      const imgUrl = `https://thumb.live.mmcdn.com/ri/${room}.jpg`;
      try {
        const imgData = await new Promise((resolve, reject) => {
          const imgReq = https.get(imgUrl, { agent: _r2HttpsAgent, timeout: 6000 }, (imgRes) => {
            if (imgRes.statusCode !== 200) { reject(new Error('status ' + imgRes.statusCode)); return; }
            const chunks = [];
            imgRes.on('data', c => chunks.push(c));
            imgRes.on('end', () => resolve({ buf: Buffer.concat(chunks), ct: imgRes.headers['content-type'] || 'image/jpeg' }));
          });
          imgReq.on('error', reject);
          imgReq.on('timeout', () => { imgReq.destroy(); reject(new Error('timeout')); });
        });
        const imgOrigin = getRequestOrigin(req);
        res.writeHead(200, { 'Content-Type': imgData.ct, 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': imgOrigin });
        res.end(imgData.buf);
      } catch {
        res.writeHead(302, { Location: '/assets/images/face.png' });
        res.end();
      }
      return;
    }

    // API: preview list (no auth). Returns files from the previews/ subfolder.
    if (requestUrl.pathname === '/api/preview/list') {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') return sendJson(res, 405, { error: 'Method Not Allowed' });
      const folder = requestUrl.searchParams.get('folder') || '';
      const basePath = allowedFolderBasePath(folder);
      if (!basePath) return sendJson(res, 400, { error: 'Invalid folder' });
      await ensureShortStatsFresh();
      await ensureCommentsFresh();

      // Allow cache bust via ?fresh=1
      const prefix = basePath + '/previews/';
      if (requestUrl.searchParams.get('fresh') === '1') {
        delete _r2ListCache[prefix];
      }
      const items = R2_ENABLED ? await r2ListMediaFilesFromPrefix(prefix) : [];
      const files = items.map((item) => {
        const isVid = isVideoFile(item.name);
        const key = videoKey(folder, '', item.name);
        const stats = shortStats[key] || { views: 0, likes: 0, dislikes: 0 };
        const commentCount = (videoComments[key] || []).length;
        return {
          name: item.name,
          type: isVid ? 'video' : 'image',
          src: `/preview-media?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(item.name)}`,
          thumb: isVid
            ? _thumbUrl(folder, '', item.name)
            : `/preview-media?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(item.name)}`,
          size: item.size || 0,
          duration: isVid ? _getDuration(folder, 'previews', item.name) : 0,
          folder,
          videoKey: key,
          views: stats.views || 0,
          likes: stats.likes || 0,
          dislikes: stats.dislikes || 0,
          commentCount,
        };
      });
      return sendJson(res, 200, { files });
    }

    // Transcode endpoint — streams video re-encoded to H.264 for browser compat (no auth)
    if (requestUrl.pathname === '/preview-transcode') {
      const folder = requestUrl.searchParams.get('folder') || '';
      const name = requestUrl.searchParams.get('name') || '';
      if (!folder || !name) return sendText(res, 400, 'Missing params');
      const cacheKey = folder + '/' + name;
      const videoUrl = previewUrlMap[cacheKey];
      if (!videoUrl) return sendText(res, 404, 'Not Found');

      // Limit concurrent transcode+thumbnail ffmpeg processes to prevent OOM
      if (_ffmpegActive >= 2) return sendText(res, 503, 'Server busy, try again shortly');

      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Cache-Control': 'public, max-age=3600',
        'Transfer-Encoding': 'chunked',
      });
      const { spawn } = require('child_process');
      _ffmpegActive++;
      const ffProc = spawn('ffmpeg', [
        '-i', videoUrl,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', 'frag_keyframe+empty_moov+faststart',
        '-f', 'mp4',
        'pipe:1'
      ], { stdio: ['pipe', 'pipe', 'pipe'] });
      ffProc.stdout.pipe(res);
      ffProc.stderr.on('data', () => {}); // suppress stderr
      const _onFfDone = () => { _ffmpegActive--; if (_ffmpegQueue.length > 0) _ffmpegQueue.shift()(); };
      ffProc.on('error', () => { _onFfDone(); try { res.end(); } catch {} });
      ffProc.on('close', () => { _onFfDone(); try { res.end(); } catch {} });
      req.on('close', () => { try { ffProc.kill('SIGTERM'); } catch {} });
      return;
    }

    // Thumbnail endpoint — serves cached JPEG thumbnails (no auth)
    if (requestUrl.pathname === '/thumbnail') {
      const name = requestUrl.searchParams.get('name') || '';
      const folder = requestUrl.searchParams.get('folder') || '';
      const subfolder = requestUrl.searchParams.get('subfolder') || '';
      const vaultQ = requestUrl.searchParams.get('vault') || '';
      if (!name) return sendText(res, 400, 'Missing name');

      // Build cache key — with folder context or legacy (preview-only)
      const cacheKey = folder
        ? _thumbCacheKey(folder, subfolder, name, vaultQ || undefined)
        : name;
      const buf = _thumbCacheGet(cacheKey);
      if (buf) {
        const etag = '"t-' + buf.length + '"';
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304);
          return res.end();
        }
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': buf.length,
          'Cache-Control': 'public, max-age=604800, immutable',
          'ETag': etag,
        });
        return res.end(buf);
      }

      // Cache miss — check R2 for pre-generated thumbnail first (fast redirect, no ffmpeg)
      if (R2_ENABLED) {
        const r2Key = _thumbR2Key(cacheKey);
        try {
          const memo = _thumbR2ExistsCache[r2Key];
          let exists;
          if (memo && (Date.now() - memo.ts < (memo.exists ? _THUMB_R2_EXISTS_TTL_MS : _THUMB_R2_MISS_TTL_MS))) {
            exists = memo.exists;
          } else {
            exists = await r2HeadObject(r2Key);
            _thumbR2ExistsCache[r2Key] = { exists, ts: Date.now() };
          }
          if (exists) {
            // Thumbnail exists in R2 — redirect to presigned URL (no Node buffering)
            const thumbUrl = r2PresignedUrl(r2Key, 3600);
            // Also load into memory cache in background for next request
            r2GetObjectBytes(r2Key).then(r2Buf => {
              if (r2Buf && r2Buf.length > 5000) _thumbCacheSet(cacheKey, r2Buf, true);
            }).catch(() => {});
            res.writeHead(302, { Location: thumbUrl, 'Cache-Control': 'public, max-age=3600' });
            return res.end();
          }
        } catch {}
      }

      // R2 miss — find video URL for ffmpeg generation
      let videoUrl = null;

      if (folder && R2_ENABLED) {
        const basePath = allowedFolderBasePath(folder);
        // Direct preview-path fallback for categories that store list cards in previews/.
        if (!videoUrl && basePath) {
          const previewObjectKey = basePath + '/previews/' + name;
          try {
            if (await r2HeadObject(previewObjectKey)) {
              videoUrl = r2PresignedUrl(previewObjectKey, 120);
            }
          } catch {}
        }
        if (global._mediaKeyCache && basePath) {
          const tryKeys = [];
          if (vaultQ) tryKeys.push(mediaLookupKey(folder, subfolder, vaultQ, name));
          tryKeys.push(mediaLookupKey(folder, subfolder, '', name));
          for (const lk of tryKeys) {
            for (let tryTier = 3; tryTier >= 1; tryTier--) {
              const cached = global._mediaKeyCache[mediaR2ResolveCacheKey(lk, tryTier)];
              if (cached && (Date.now() - cached.ts < 300000)) {
                videoUrl = r2PresignedUrl(cached.key, 120);
                break;
              }
            }
            if (videoUrl) break;
          }
        }
        if (!videoUrl && basePath) {
          if (!global._tierLookupCache) global._tierLookupCache = {};
          const tlKey = `${folder}:${subfolder}:${vaultQ}:${name}`;
          const tlCached = global._tierLookupCache[tlKey];
          if (tlCached && (Date.now() - tlCached.ts < 600000)) {
            videoUrl = r2PresignedUrl(tlCached.objectKey, 120);
          } else {
            const candidates = buildObjectKeyCandidates(
              basePath,
              folder,
              subfolder,
              name,
              vaultQ || undefined,
              undefined,
            );
            for (const objectKey of candidates) {
              try {
                const exists = await r2HeadObject(objectKey);
                if (exists) {
                  global._tierLookupCache[tlKey] = { objectKey, ts: Date.now() };
                  videoUrl = r2PresignedUrl(objectKey, 120);
                  break;
                }
              } catch { /* next */ }
            }
          }
        }
      }

      // Fallback: check preview URL map (legacy preview thumbnails)
      if (!videoUrl) {
        for (const [key, url] of Object.entries(previewUrlMap)) {
          if (key.endsWith('/' + name)) { videoUrl = url; break; }
        }
      }

      if (!videoUrl) return sendText(res, 404, 'Not Found');

      // On cache miss, attempt generation and wait briefly so first paint gets a real frame.
      // If ffmpeg is slow for this specific item, fall back to placeholder but keep generation in-flight.
      if (!_thumbInFlight[cacheKey]) {
        const genPromise = generateThumbnail(videoUrl, name).then((genBuf) => {
          delete _thumbInFlight[cacheKey];
          if (genBuf) {
            _thumbCacheSet(cacheKey, genBuf);
            const diskPath = folder ? _thumbDiskPath(folder, subfolder, name) : _thumbDiskPathLegacy(name);
            fs.writeFile(diskPath, genBuf, () => {});
          }
          return genBuf;
        }).catch(() => {
          delete _thumbInFlight[cacheKey];
          return null;
        });
        _thumbInFlight[cacheKey] = genPromise;
      }

      const genBuf = await _thumbInFlight[cacheKey];
      if (genBuf) {
        const etag = '"t-' + genBuf.length + '"';
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304);
          return res.end();
        }
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': genBuf.length,
          'Cache-Control': 'public, max-age=604800, immutable',
          'ETag': etag,
        });
        return res.end(genBuf);
      }

      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': PLACEHOLDER_THUMB.length,
        'Cache-Control': 'no-cache, max-age=0',
        'X-Thumb-Status': 'generating',
      });
      res.end(PLACEHOLDER_THUMB);
      return;
    }

    // Media serving for previews (no auth) — always generate fresh presigned URL
    // (r2PresignedUrl is local crypto, no network call — safe to call per-request)
    if (requestUrl.pathname === '/preview-media') {
      const folder = requestUrl.searchParams.get('folder') || '';
      const name = requestUrl.searchParams.get('name') || '';
      if (!folder || !name) return sendText(res, 400, 'Missing params');

      const basePath = allowedFolderBasePath(folder);
      if (!basePath || !isAllowedMediaFile(name)) return sendText(res, 404, 'Not Found');
      if (R2_ENABLED) {
        const objectKey = basePath + '/previews/' + name;
        const freshUrl = r2PresignedUrl(objectKey, 3600);
        const cacheKey = folder + '/' + name;
        previewUrlMap[cacheKey] = freshUrl;
        // Short cache so browsers/CDN don't hold stale redirects past URL expiry
        res.writeHead(302, { Location: freshUrl, 'Cache-Control': 'public, max-age=1800' });
        return res.end();
      }
      return sendText(res, 404, 'Not Found');
    }

    // Media serving (free for anon/tier0, paid tiers cumulative)
    // Cache resolved R2 object keys to skip expensive HEAD requests (5-minute TTL)
    if (!global._mediaKeyCache) global._mediaKeyCache = {};
    const _MEDIA_KEY_TTL = 300000; // 5 minutes
    if (requestUrl.pathname === '/media') {
      const authed = await getOptionalAuthedUser(req, res);
      if (!authed) return;
      const { record: u } = authed;

      const folder = requestUrl.searchParams.get('folder') || '';
      const subfolder = requestUrl.searchParams.get('subfolder') || '';
      const name = requestUrl.searchParams.get('name') || '';
      const vaultQ = requestUrl.searchParams.get('vault') || '';

      const basePath = allowedFolderBasePath(folder);
      if (!basePath) return sendText(res, 400, 'Invalid folder');
      if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) return sendText(res, 400, 'Invalid file');
      if (!isAllowedMediaFile(name)) return sendText(res, 403, 'Forbidden');

      const tier = u ? getEffectiveTierForUser(u) : 0;
      const vaultAccess = accessibleVaultFolders(tier);
      const vNorm = normalizeVaultParam(vaultQ);
      if (vNorm && !vaultAccess.includes(vNorm)) return sendText(res, 403, 'Forbidden');

      if (folder === 'Omegle' && subfolder && !OMEGLE_SUBFOLDERS.includes(subfolder)) {
        return sendText(res, 400, 'Invalid subfolder');
      }

      const mediaCacheKey = mediaLookupKey(folder, subfolder, vNorm, name);
      const cachedKey = global._mediaKeyCache[mediaR2ResolveCacheKey(mediaCacheKey, tier)];
      let objectKey;

      if (cachedKey && (Date.now() - cachedKey.ts < _MEDIA_KEY_TTL)) {
        objectKey = cachedKey.key;
      } else {
        const candidates = buildObjectKeyCandidates(
          basePath,
          folder,
          subfolder,
          name,
          vNorm || undefined,
          tier,
        );
        objectKey = null;
        for (const k of candidates) {
          if (!R2_ENABLED) break;
          try {
            if (await r2HeadObject(k)) {
              objectKey = k;
              break;
            }
          } catch { /* next */ }
        }
        if (objectKey) {
          global._mediaKeyCache[mediaR2ResolveCacheKey(mediaCacheKey, tier)] = { key: objectKey, ts: Date.now() };
        }
      }

      if (R2_ENABLED && objectKey) {
        const url = r2PresignedUrl(objectKey);
        res.writeHead(302, { Location: url, 'Cache-Control': 'private, max-age=300' });
        return res.end();
      }
      return sendText(res, 404, 'Not Found');
    }

    const playbackMatch = requestUrl.pathname.match(/^\/api\/videos\/([0-9a-fA-F-]{36})\/playback$/);
    if (playbackMatch) {
      if ((req.method || '').toUpperCase() !== 'GET') return sendJson(res, 405, { error: 'GET only' });
      const videoId = playbackMatch[1];
      if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return sendJson(res, 500, { error: 'Supabase not configured' });

      const q = `/rest/v1/video_assets?video_id=eq.${encodeURIComponent(videoId)}&select=video_id,mp4_1080_object_key,mp4_720_object_key&limit=1`;
      const out = await supabaseJson(q);
      if (!out.ok || !Array.isArray(out.data) || !out.data[0]) return sendJson(res, 404, { error: 'Video assets not found' });
      const asset = out.data[0];

      const sources = [];
      if (asset.mp4_1080_object_key) sources.push({ quality: '1080p', url: r2PresignedUrl(asset.mp4_1080_object_key, 3600) });
      if (asset.mp4_720_object_key) sources.push({ quality: '720p', url: r2PresignedUrl(asset.mp4_720_object_key, 3600) });

      return sendJson(res, 200, { videoId, sources });
    }

    // GET /api/video-rename/moderate — signed link from Discord (Approve / Reject)
    if (requestUrl.pathname === '/api/video-rename/moderate') {
      if ((req.method || '').toUpperCase() !== 'GET') return sendJson(res, 405, { error: 'GET only' });
      const secret = renameModerateSigningKey();
      if (!secret) {
        sendRenameModerateResultPage(res, false, 'Not configured', 'Rename link signing is not configured on this server.');
        return;
      }
      const requestId = String(requestUrl.searchParams.get('requestId') || '').trim();
      const action = String(requestUrl.searchParams.get('action') || '').trim().toLowerCase();
      const expQ = requestUrl.searchParams.get('exp');
      const sig = String(requestUrl.searchParams.get('sig') || '').trim();
      if (!requestId || (action !== 'approve' && action !== 'reject')) {
        sendRenameModerateResultPage(res, false, 'Invalid link', 'Missing or invalid parameters.');
        return;
      }
      if (!verifyRenameModerateSignature(requestId, action, expQ, sig, secret)) {
        sendRenameModerateResultPage(res, false, 'Invalid or expired link', 'This link is invalid or has expired (links last 7 days).');
        return;
      }
      await loadVideoRenameRequests();
      const out = await runVideoRenameModeration(requestId, action, 'discord-link');
      if (out.type === 'not_found') {
        sendRenameModerateResultPage(res, false, 'Not found', 'No rename request matches this link.');
        return;
      }
      if (out.type === 'already_approved') {
        sendRenameModerateResultPage(
          res,
          true,
          'Already approved',
          `This request was already approved.${out.newName ? ` File: ${out.newName}` : ''}`,
        );
        return;
      }
      if (out.type === 'already_rejected') {
        sendRenameModerateResultPage(res, true, 'Already rejected', 'This request was already rejected.');
        return;
      }
      if (out.type === 'not_pending') {
        sendRenameModerateResultPage(res, false, 'Not pending', `This request is not pending (status: ${out.status || 'unknown'}).`);
        return;
      }
      if (out.type === 'rejected') {
        sendRenameModerateResultPage(res, true, 'Rejected', 'Rename request rejected.');
        return;
      }
      if (out.type === 'approved') {
        sendRenameModerateResultPage(res, true, 'Approved', `Rename applied. New file name: ${out.newName || 'OK'}`);
        return;
      }
      if (out.type === 'apply_error') {
        sendRenameModerateResultPage(res, false, 'Rename failed', out.message || 'Unknown error');
        return;
      }
      return;
    }

    if (requestUrl.pathname === '/api/video-rename/status') {
      if ((req.method || '').toUpperCase() !== 'GET') return sendJson(res, 405, { error: 'GET only' });
      const folder = String(requestUrl.searchParams.get('folder') || '').trim();
      const name = String(requestUrl.searchParams.get('name') || '').trim();
      const subfolder = String(requestUrl.searchParams.get('subfolder') || '').trim();
      const vault = normalizeVaultParam(String(requestUrl.searchParams.get('vault') || '').trim());
      if (!folder || !name) return sendJson(res, 400, { error: 'Missing folder/name' });
      await loadVideoRenameRequests();
      const identity = videoRenameIdentity(folder, subfolder, name, vault);
      const state = getVideoRenameStatus(identity);
      const activeRecord = state.state === 'pending' || state.state === 'finalized' ? state.record : null;
      return sendJson(res, 200, {
        state: state.state,
        requestId: activeRecord ? activeRecord.requestId : null,
        requestedName: activeRecord ? activeRecord.requestedName || '' : '',
        finalizedName: activeRecord ? activeRecord.newName || '' : '',
      });
    }

    if (requestUrl.pathname === '/api/video-rename/cancel') {
      if ((req.method || '').toUpperCase() !== 'POST') return sendJson(res, 405, { error: 'POST only' });
      const body = await readJsonBody(req, res, 24 * 1024);
      if (!body) return;
      const folder = String(body.folder || '').trim();
      const name = String(body.name || '').trim();
      const subfolder = String(body.subfolder || '').trim();
      const vault = normalizeVaultParam(String(body.vault || '').trim());
      if (!folder || !name) return sendJson(res, 400, { error: 'Missing folder/name' });
      await loadVideoRenameRequests();
      const identity = videoRenameIdentity(folder, subfolder, name, vault);
      const rec = getVideoRenameRecordByIdentity(identity);
      if (!rec) return sendJson(res, 404, { error: 'Rename request not found' });
      const cancellable = (rec.status === 'pending' || rec.status === 'error') && !rec.finalized;
      if (!cancellable) return sendJson(res, 409, { error: 'Rename request is not pending' });
      rec.status = 'cancelled';
      rec.finalized = false;
      rec.reviewedBy = 'user-cancel';
      rec.reviewedAt = Date.now();
      rec.updatedAt = Date.now();
      await flushVideoRenameRequestsNow();
      return sendJson(res, 200, { ok: true, state: 'none' });
    }

    if (requestUrl.pathname === '/api/video-rename/request') {
      if ((req.method || '').toUpperCase() !== 'POST') return sendJson(res, 405, { error: 'POST only' });
      const authed = await requireAuthedUser(req, res);
      if (!authed) return;
      const body = await readJsonBody(req, res, 24 * 1024);
      if (!body) return;

      const folder = String(body.folder || '').trim();
      const name = String(body.name || '').trim();
      const subfolder = String(body.subfolder || '').trim();
      const vault = normalizeVaultParam(String(body.vault || '').trim());
      const requestedName = trimText(body.requestedName, 140);
      if (!folder || !name || !requestedName) return sendJson(res, 400, { error: 'Missing required fields' });
      if (!isAllowedFolderLabel(folder)) return sendJson(res, 400, { error: 'Invalid folder' });
      if (folder === 'Omegle' && subfolder && !OMEGLE_SUBFOLDERS.includes(subfolder)) {
        return sendJson(res, 400, { error: 'Invalid Omegle subfolder' });
      }
      if (!isAllowedMediaFile(name)) return sendJson(res, 400, { error: 'Invalid source media' });

      const nextFileName = buildRenamedFileName(requestedName, name);
      if (!nextFileName) return sendJson(res, 400, { error: 'Requested title is invalid' });
      if (nextFileName === name) return sendJson(res, 400, { error: 'Requested title is unchanged' });

      await loadVideoRenameRequests();
      const identity = videoRenameIdentity(folder, subfolder, name, vault);
      const state = getVideoRenameStatus(identity);
      if (state.state === 'pending') return sendJson(res, 409, { error: 'Rename already pending' });
      if (state.state === 'finalized') return sendJson(res, 409, { error: 'Rename already finalized for this video' });

      const requestId = crypto.randomUUID();
      const now = Date.now();
      const requesterName = authed.record.username || authed.record.discordUsername || authed.userKey;
      const rec = {
        requestId,
        videoIdentity: identity,
        folder,
        subfolder,
        vault,
        oldName: name,
        requestedName,
        status: 'pending',
        finalized: false,
        requestedBy: authed.userKey,
        requestedByName: requesterName,
        requestedAt: now,
        updatedAt: now,
        reviewedBy: '',
        reviewedAt: 0,
        newName: '',
      };
      videoRenameRequests.push(rec);
      try {
        await flushVideoRenameRequestsNow();
      } catch (e) {
        console.error('[video-rename] persist error after request:', e && e.message ? e.message : e);
        return sendJson(res, 500, { error: 'Failed to save rename request' });
      }

      const q = new URLSearchParams();
      q.set('folder', folder);
      q.set('name', name);
      if (subfolder) q.set('subfolder', subfolder);
      if (vault) q.set('vault', vault);
      const videoUrl = getRequestOrigin(req) + '/video?' + q.toString();
      const publicOrigin = SITE_ORIGIN || getRequestOrigin(req);
      void sendVideoRenameDiscordRequest(rec, requesterName, videoUrl, publicOrigin);

      return sendJson(res, 200, { ok: true, state: 'pending', requestId });
    }

    if (requestUrl.pathname === '/api/discord/interactions') {
      if ((req.method || '').toUpperCase() !== 'POST') return sendJson(res, 405, { error: 'POST only' });
      const raw = await readRawBody(req, res, 256 * 1024);
      if (!raw) return;
      if (!verifyDiscordInteractionSignature(req, raw)) return sendJson(res, 401, { error: 'Invalid signature' });
      let payload = null;
      try {
        payload = JSON.parse(raw.toString('utf8'));
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON' });
      }
      if (Number(payload?.type) === 1) {
        return sendJson(res, 200, { type: 1 }); // PING/PONG handshake
      }
      const customId = String(payload?.data?.custom_id || '');
      const m = customId.match(/^rename:([0-9a-fA-F-]{36}):(approve|reject)$/);
      if (!m) return sendJson(res, 200, { type: 4, data: { content: 'Unsupported action.', flags: 64 } });
      const requestId = m[1];
      const action = m[2];
      await loadVideoRenameRequests();
      const actor = String(payload?.member?.user?.username || payload?.user?.username || 'discord-moderator');
      const out = await runVideoRenameModeration(requestId, action, actor);
      if (out.type === 'not_found') {
        return sendJson(res, 200, { type: 4, data: { content: 'Request not found.', flags: 64 } });
      }
      if (out.type === 'already_approved') {
        return sendJson(res, 200, { type: 4, data: { content: `Already approved/finalized.${out.newName ? ` File: ${out.newName}` : ''}`, flags: 64 } });
      }
      if (out.type === 'already_rejected') {
        return sendJson(res, 200, { type: 4, data: { content: 'Already rejected.', flags: 64 } });
      }
      if (out.type === 'not_pending') {
        return sendJson(res, 200, { type: 4, data: { content: `Not pending (status: ${out.status || 'unknown'}).`, flags: 64 } });
      }
      if (out.type === 'rejected') {
        return sendJson(res, 200, { type: 4, data: { content: `Rejected rename request ${requestId}.`, flags: 64 } });
      }
      if (out.type === 'approved') {
        return sendJson(res, 200, { type: 4, data: { content: `Approved and renamed to ${out.newName || 'OK'}.`, flags: 64 } });
      }
      if (out.type === 'apply_error') {
        return sendJson(res, 200, {
          type: 4,
          data: { content: `Rename failed: ${out.message || 'unknown error'}`, flags: 64 },
        });
      }
      return sendJson(res, 200, { type: 4, data: { content: 'Unsupported action.', flags: 64 } });
    }

    // ── Userassets uploader metadata for video page ─────────────────────────
    if (requestUrl.pathname === '/api/video/uploader') {
      if ((req.method || '').toUpperCase() !== 'GET') return sendJson(res, 405, { error: 'GET only' });
      const folder = String(requestUrl.searchParams.get('folder') || '');
      const name = String(requestUrl.searchParams.get('name') || '');
      if (!folder || !name) return sendJson(res, 400, { error: 'Missing folder/name' });
      const authed = await getOptionalAuthedUser(req, res);
      if (!authed) return;
      const db = await ensureUsersDbFresh();
      const source = uploadRequests
        .filter((r) => r && r.status === 'approved' && r.category === folder && (r.uploadType || 'library') === 'userassets')
        .find((r) => r.r2FinalKey && String(r.r2FinalKey).endsWith('/' + name));
      if (!source) return sendJson(res, 200, { uploader: null, isFollowing: false });
      const uploaderKey = String(source.userKey || '');
      const uploader = db.users[uploaderKey];
      if (!uploader) return sendJson(res, 200, { uploader: { username: source.username || 'creator' }, isFollowing: false });
      const displayName = stripDiscordPrefix(uploader.username || source.username || uploaderKey);
      const avatarUrl = normalizeOptionalUrl(uploader.avatarUrl || '');
      const followersCount = Math.max(0, Number(uploader.followerCount || 0) || 0);
      const following = authed.record && Array.isArray(authed.record.followingUserKeys) ? authed.record.followingUserKeys : [];
      return sendJson(res, 200, {
        uploader: {
          userKey: uploaderKey,
          username: displayName,
          displayName,
          avatarUrl,
          followersCount,
        },
        isFollowing: following.includes(uploaderKey),
      });
    }

    if (requestUrl.pathname === '/api/creator/follow') {
      if ((req.method || '').toUpperCase() !== 'POST') return sendJson(res, 405, { error: 'POST only' });
      const authed = await requireAuthedUser(req, res);
      if (!authed) return;
      const body = await readJsonBody(req, res, 16 * 1024);
      if (!body) return;
      const targetUserKey = String(body.targetUserKey || '').trim();
      const follow = body.follow !== false;
      if (!targetUserKey) return sendJson(res, 400, { error: 'Missing target user' });
      if (targetUserKey === authed.userKey) return sendJson(res, 400, { error: 'Cannot follow yourself' });
      const target = authed.db.users[targetUserKey];
      if (!target) return sendJson(res, 404, { error: 'Creator not found' });

      if (!Array.isArray(authed.record.followingUserKeys)) authed.record.followingUserKeys = [];
      const following = new Set(authed.record.followingUserKeys.map(String));
      const hadBefore = following.has(targetUserKey);
      if (follow) following.add(targetUserKey);
      else following.delete(targetUserKey);
      authed.record.followingUserKeys = Array.from(following);

      const followerCount = Math.max(0, Number(target.followerCount || 0) || 0);
      if (follow && !hadBefore) target.followerCount = followerCount + 1;
      else if (!follow && hadBefore) target.followerCount = Math.max(0, followerCount - 1);
      else target.followerCount = followerCount;

      await queueUsersDbWrite();
      return sendJson(res, 200, {
        ok: true,
        following: authed.record.followingUserKeys.includes(targetUserKey),
        followersCount: Math.max(0, Number(target.followerCount || 0) || 0),
      });
    }

    if (requestUrl.pathname === '/api/userassets/upload') {
      if ((req.method || '').toUpperCase() !== 'POST') return sendJson(res, 405, { error: 'POST only' });
      if (!R2_ENABLED) return sendJson(res, 503, { error: 'R2 is not configured' });
      const authed = await requireAuthedUser(req, res);
      if (!authed) return;

      const ct = String(req.headers['content-type'] || '').toLowerCase();
      if (!ct.includes('multipart/form-data')) return sendJson(res, 415, { error: 'Expected multipart/form-data' });

      const parts = await readMultipartBody(req, res, 540 * 1024 * 1024);
      if (!parts) return;

      const categoryPart = parts.find((p) => p.name === 'category');
      const subfolderPart = parts.find((p) => p.name === 'subfolder');
      const category = categoryPart ? String(categoryPart.data.toString('utf8') || '').trim() : '';
      const subfolder = subfolderPart ? String(subfolderPart.data.toString('utf8') || '').trim() : '';
      if (!isAllowedFolderLabel(category)) return sendJson(res, 400, { error: 'Invalid category' });
      if (category === 'Omegle' && subfolder && !OMEGLE_SUBFOLDERS.includes(subfolder)) {
        return sendJson(res, 400, { error: 'Invalid Omegle subfolder' });
      }

      const fileParts = parts.filter((p) => p.filename && (p.name === 'files' || p.name === 'file' || p.name === 'videos'));
      if (fileParts.length < 1) return sendJson(res, 400, { error: 'No files uploaded' });
      if (fileParts.length > 10) return sendJson(res, 400, { error: 'Max 10 files per upload' });

      const MAX_FILE_BYTES = 50 * 1024 * 1024;
      for (const p of fileParts) {
        if (!p.data || p.data.length < 1) return sendJson(res, 400, { error: 'One or more files are empty' });
        if (p.data.length > MAX_FILE_BYTES) return sendJson(res, 413, { error: 'Each file must be <= 50MB' });
      }

      const categorySlug = CATEGORY_SLUG_MAP[category] || sanitizeObjectKeySegment(category, 40);
      const uploaderSegment = sanitizeObjectKeySegment(authed.userKey, 64) || 'user';
      const subfolderSegment = subfolder ? sanitizeObjectKeySegment(subfolder, 40) : '';
      const createdAtIso = new Date().toISOString();
      const uploaded = [];
      const username = authed.record.username || authed.userKey;

      for (const p of fileParts) {
        const ext = path.extname(String(p.filename || '')).toLowerCase();
        const isVideo = videoExts.has(ext);
        const isImage = imageExts.has(ext);
        if (!isVideo && !isImage) return sendJson(res, 400, { error: `Unsupported file format: ${p.filename}` });
        const baseName = sanitizeObjectKeySegment(path.basename(p.filename, ext), 96) || `upload-${Date.now()}`;
        const objectName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${baseName}${ext}`;
        const objectKey = subfolderSegment
          ? `${R2_USER_ASSETS_PREFIX}/${categorySlug}/${subfolderSegment}/${uploaderSegment}/${objectName}`
          : `${R2_USER_ASSETS_PREFIX}/${categorySlug}/${uploaderSegment}/${objectName}`;
        await r2PutObjectBytes(objectKey, p.data, p.contentType || (isVideo ? 'video/mp4' : 'application/octet-stream'));

        const reqId = crypto.randomUUID();
        uploadRequests.push({
          id: reqId,
          userKey: authed.userKey,
          username,
          category,
          subfolder: subfolder || null,
          videoName: baseName.slice(0, 80),
          r2TempKey: objectKey,
          contentType: p.contentType || (isVideo ? 'video/mp4' : 'application/octet-stream'),
          size: p.data.length,
          originalFilename: p.filename,
          status: 'approved',
          submittedAt: createdAtIso,
          reviewedAt: createdAtIso,
          assignedTier: 0,
          r2FinalKey: objectKey,
          uploadType: 'userassets',
        });
        uploaded.push({
          id: reqId,
          name: p.filename,
          size: p.data.length,
          category,
          subfolder: subfolder || null,
          objectKey,
          uploadedAt: createdAtIso,
          mediaType: isVideo ? 'video' : 'image',
        });
      }
      scheduleUploadPersist();

      const webhookTarget = DISCORD_WEBHOOK_USER_UPLOADS_URL || DISCORD_WEBHOOK_PAYMENTS_URL;
      if (webhookTarget) {
        _beacon(webhookTarget, {
          embeds: [{
            title: 'New userassets upload batch',
            color: 0x7c3aed,
            fields: [
              { name: 'User', value: String(username).slice(0, 256), inline: true },
              { name: 'Category', value: String(category + (subfolder ? ` / ${subfolder}` : '')).slice(0, 256), inline: true },
              { name: 'Files', value: String(uploaded.length), inline: true },
              {
                name: 'Total Size',
                value: `${(uploaded.reduce((sum, f) => sum + Number(f.size || 0), 0) / (1024 * 1024)).toFixed(1)} MB`,
                inline: true,
              },
            ],
            timestamp: createdAtIso,
          }],
        });
      }

      return sendJson(res, 200, { ok: true, uploaded });
    }

    // ── Upload video endpoint ──────────────────────────────────────────────
    if (requestUrl.pathname === '/api/upload') {
      return sendJson(res, 410, { error: 'Upload feature removed. Use account-linked ingestion workflow.' });
      if ((req.method || '').toUpperCase() !== 'POST') return sendJson(res, 405, { error: 'POST only' });

      const authed = await requireAuthedUser(req, res);
      if (!authed) return;
      const { userKey, record: u } = authed;

      // Any signed-in user can upload (no tier restriction)

      // Rate limit check
      const lastUpload = uploadRateLimit.get(userKey);
      if (lastUpload) {
        const elapsed = Date.now() - lastUpload;
        if (elapsed < UPLOAD_COOLDOWN_MS) {
          const retryAfter = Math.ceil((UPLOAD_COOLDOWN_MS - elapsed) / 1000);
          return sendJson(res, 429, { error: 'Rate limited', retryAfter });
        }
      }

      // Collect raw body (max 100 MB)
      const MAX_UPLOAD_SIZE = 100 * 1024 * 1024;
      const rawBuf = await new Promise((resolve) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_UPLOAD_SIZE) { req.destroy(); resolve(null); return; }
          chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', () => resolve(null));
      });
      if (!rawBuf) return sendJson(res, 413, { error: 'File too large (max 100MB)' });

      // Parse multipart
      const ct = String(req.headers['content-type'] || '');
      const boundaryMatch = ct.match(/boundary=(?:"([^"]+)"|([^\s;]+))/i);
      if (!boundaryMatch) return sendJson(res, 400, { error: 'Missing boundary' });
      const boundary = boundaryMatch[1] || boundaryMatch[2];

      const delimiter = Buffer.from('--' + boundary);
      const parts = [];
      let pos = 0;
      while (pos < rawBuf.length) {
        const start = rawBuf.indexOf(delimiter, pos);
        if (start === -1) break;
        const afterDelim = start + delimiter.length;
        if (rawBuf[afterDelim] === 0x2D && rawBuf[afterDelim + 1] === 0x2D) break;
        const headStart = (rawBuf[afterDelim] === 0x0D && rawBuf[afterDelim + 1] === 0x0A) ? afterDelim + 2 : afterDelim;
        const sep = Buffer.from('\r\n\r\n');
        const headerEnd = rawBuf.indexOf(sep, headStart);
        if (headerEnd === -1) break;
        const headers = rawBuf.slice(headStart, headerEnd).toString('utf8');
        const bodyStart = headerEnd + 4;
        const nextDelim = rawBuf.indexOf(delimiter, bodyStart);
        const bodyEnd = nextDelim !== -1 ? nextDelim - 2 : rawBuf.length;
        const body = rawBuf.slice(bodyStart, Math.max(bodyStart, bodyEnd));
        const nameMatch = headers.match(/name="([^"]+)"/);
        const filenameMatch = headers.match(/filename="([^"]+)"/);
        const ctMatch = headers.match(/Content-Type:\s*(.+)/i);
        parts.push({
          name: nameMatch ? nameMatch[1] : '',
          filename: filenameMatch ? filenameMatch[1] : null,
          contentType: ctMatch ? ctMatch[1].trim() : null,
          data: body,
        });
        pos = nextDelim !== -1 ? nextDelim : rawBuf.length;
      }

      const videoPart = parts.find(p => p.name === 'video' && p.filename);
      const namePart = parts.find(p => p.name === 'name');
      const categoryPart = parts.find(p => p.name === 'category');
      const subfolderPart = parts.find(p => p.name === 'subfolder');

      if (!videoPart) return sendJson(res, 400, { error: 'No video file' });

      const videoName = namePart ? namePart.data.toString('utf8').trim().slice(0, 40) : '';
      const category = categoryPart ? categoryPart.data.toString('utf8').trim() : '';
      const subfolder = subfolderPart ? subfolderPart.data.toString('utf8').trim() : '';

      if (!videoName) return sendJson(res, 400, { error: 'Video name required' });
      if (!isAllowedFolderLabel(category)) return sendJson(res, 400, { error: 'Invalid category' });
      if (category === 'Omegle' && subfolder && !OMEGLE_SUBFOLDERS.includes(subfolder)) {
        return sendJson(res, 400, { error: 'Invalid subfolder' });
      }

      const origExt = path.extname(videoPart.filename || '').toLowerCase();
      if (!videoExts.has(origExt)) return sendJson(res, 400, { error: 'Invalid video format' });

      const id = crypto.randomUUID();
      const sanitizedName = videoName.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_').slice(0, 40);
      const categorySlug = CATEGORY_SLUG_MAP[category] || category.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const objectKeys = buildVideoObjectKeys(categorySlug, id, origExt);
      const r2TempKey = objectKeys.source;
      const output720Key = objectKeys.mp4_720;

      // Upload source to R2 category folder
      if (R2_ENABLED) {
        try {
          await r2PutObjectBytes(r2TempKey, videoPart.data, videoPart.contentType || 'video/mp4');
        } catch (e) {
          console.error('[upload] R2 put error:', e.message);
          return sendJson(res, 500, { error: 'Upload failed' });
        }
      }

      const username = u.username || u.discordUsername || u.googleName || 'Anonymous';

      uploadRequests.push({
        id,
        userKey,
        username,
        category,
        subfolder: subfolder || null,
        videoName,
        r2TempKey,
        contentType: videoPart.contentType || 'video/mp4',
        size: videoPart.data.length,
        originalFilename: videoPart.filename,
        status: 'pending',
        submittedAt: new Date().toISOString(),
        reviewedAt: null,
        assignedTier: null,
        r2FinalKey: r2TempKey,
      });
      adminEmitEvent('upload', username + ' uploaded "' + videoName + '" to ' + category);

      if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
        try {
          const ownerId = (u && typeof u.userId === 'string' && u.userId) ? u.userId : null;
          if (ownerId) {
            await supabaseJson('/rest/v1/videos', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Prefer: 'return=minimal',
              },
              body: JSON.stringify([{
                id,
                owner_id: ownerId,
                title: videoName,
                visibility: 'private',
                status: 'uploaded',
              }]),
            });
            await supabaseJson('/rest/v1/video_assets', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Prefer: 'return=minimal',
              },
              body: JSON.stringify([{
                video_id: id,
                ingest_status: 'uploaded',
                source_object_key: r2TempKey,
                mp4_1080_object_key: r2TempKey,
                mp4_720_object_key: null,
              }]),
            });
          }
        } catch (e) {
          console.error('[upload] Supabase metadata insert failed:', e && e.message ? e.message : e);
        }
      }

      uploadRateLimit.set(userKey, Date.now());
      scheduleUploadPersist();

      // Discord notification (same channel as manual payments — override with env if you split channels)
      _beacon(DISCORD_WEBHOOK_PAYMENTS_URL, {
        embeds: [{
          title: '\ud83d\udce4 New Upload Request',
          color: 0x7c3aed,
          fields: [
            { name: 'User', value: username, inline: true },
            { name: 'Category', value: category + (subfolder ? ' / ' + subfolder : ''), inline: true },
            { name: 'Video Name', value: videoName, inline: true },
            { name: 'Size', value: (videoPart.data.length / 1024 / 1024).toFixed(1) + ' MB', inline: true },
          ],
          timestamp: new Date().toISOString(),
        }],
      });

      return sendJson(res, 200, {
        ok: true,
        id,
        categorySlug,
        sourceObjectKey: r2TempKey,
        output720ObjectKey: output720Key,
        keyRoot: objectKeys.keyRoot,
        imageRoot: `${objectKeys.keyRoot}/images`,
        gifRoot: `${objectKeys.keyRoot}/gifs`,
      });
    }

    // ===== DYNAMIC SITEMAP (includes individual video pages) =====
    if (requestUrl.pathname === '/sitemap.xml') {
      const sitemapBase = SITE_ORIGIN || getRequestOrigin(req);
      // Build sitemap with static pages + video pages from preview cache
      const today = new Date().toISOString().slice(0, 10);
      // XML-escape helper: strip ALL non-ASCII chars (smart quotes, ellipsis, emoji, stars, etc.)
      // then escape XML entities. Google's sitemap parser is strict about encoding.
      const xmlEsc = (s) => String(s).replace(/[^\x20-\x7E\n\r\t]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n';
      // Static pages
      const staticPages = [
        { loc: '/', priority: '1.0', freq: 'daily' },
        { loc: '/shorts', priority: '0.8', freq: 'daily' },
        { loc: '/live-cams', priority: '0.7', freq: 'weekly' },
        { loc: '/custom-requests', priority: '0.5', freq: 'monthly' },
        { loc: '/blog', priority: '0.7', freq: 'weekly' },
      ];
      // Use clean SEO URLs for category pages
      const SITEMAP_CLEAN = {};
      for (const [folderName, slug] of Object.entries(CATEGORY_SLUG_MAP)) {
        SITEMAP_CLEAN[folderName] = '/' + slug;
      }
      for (const [folderName] of allowedFolders) {
        const cleanUrl = SITEMAP_CLEAN[folderName] || '/folder.html?folder=' + encodeURIComponent(folderName);
        staticPages.push({ loc: cleanUrl, priority: '0.9', freq: 'daily' });
      }
      // Omegle subfolders (keep query-string for subfolders)
      for (const sub of OMEGLE_SUBFOLDERS) {
        staticPages.push({ loc: '/omegle?subfolder=' + encodeURIComponent(sub), priority: '0.8', freq: 'daily' });
      }
      for (const sp of staticPages) {
        xml += '  <url>\n    <loc>' + xmlEsc(sitemapBase + sp.loc) + '</loc>\n    <lastmod>' + today + '</lastmod>\n    <changefreq>' + sp.freq + '</changefreq>\n    <priority>' + sp.priority + '</priority>\n  </url>\n';
      }
      // Video pages with Google Video Sitemap extension tags (using clean SEO URLs)
      if (previewFileList && previewFileList.length > 0) {
        for (const pf of previewFileList) {
          if (!pf.name || !pf.folder) continue;
          // Use clean URL if available, fall back to query-param URL
          const cleanPath = videoCleanUrlMap.get(pf.folder + '/' + pf.name);
          const vLoc = cleanPath || '/video.html?folder=' + encodeURIComponent(pf.folder) + '&name=' + encodeURIComponent(pf.name);
          const vThumb = sitemapBase + '/thumbnail?folder=' + encodeURIComponent(pf.folder) + '&name=' + encodeURIComponent(pf.name);
          const vBase = pf.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim();
          const vTitle = xmlEsc(vBase.length > 3 ? vBase : pf.folder + ' video');
          const vDur = _getDuration(pf.folder, pf.subfolder || '', pf.name);
          const vDate = pf.lastModified ? new Date(pf.lastModified).toISOString().slice(0, 10) : today;
          xml += '  <url>\n    <loc>' + xmlEsc(sitemapBase + vLoc) + '</loc>\n    <lastmod>' + vDate + '</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n';
          xml += '    <video:video>\n';
          xml += '      <video:thumbnail_loc>' + xmlEsc(vThumb) + '</video:thumbnail_loc>\n';
          xml += '      <video:title>' + vTitle + '</video:title>\n';
          xml += '      <video:description>' + xmlEsc('Watch ' + vTitle + ' - ' + pf.folder + ' on Pornwrld. Free HD videos updated daily.') + '</video:description>\n';
          xml += '      <video:player_loc>' + xmlEsc(sitemapBase + vLoc) + '</video:player_loc>\n';
          if (vDur > 0) xml += '      <video:duration>' + vDur + '</video:duration>\n';
          xml += '      <video:publication_date>' + vDate + '</video:publication_date>\n';
          xml += '      <video:family_friendly>no</video:family_friendly>\n';
          xml += '      <video:live>no</video:live>\n';
          xml += '    </video:video>\n';
          xml += '  </url>\n';
        }
      }
      xml += '</urlset>';
      const xmlBuf = Buffer.from(xml, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Length': xmlBuf.length,
        'Cache-Control': 'public, max-age=3600, must-revalidate',
      });
      return res.end(xmlBuf);
    }

    // Static serving (locked down: no directory listing, no direct media access, no data leaks)
    let pathname = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;

    // ── Clean URL routing ──
    // /shorts → /shorts.html, /categories → /categories.html, etc.
    const CLEAN_URL_MAP = {
      '/shorts': '/shorts.html',
      '/search': '/search.html',
      '/categories': '/categories.html',
      '/account': '/account.html',
      '/upload': '/account.html',
      '/login': '/login.html',
      '/signup': '/signup.html',
      '/create-account': '/create-account.html',
      '/live-cams': '/live-cams.html',
      '/custom-requests': '/custom-requests.html',
      '/blog': '/blog.html',
    };
    // SEO: Map clean category slugs to folder query params
    const SEO_FOLDER_MAP = {};
    for (const [folderName, slug] of Object.entries(CATEGORY_SLUG_MAP)) {
      CLEAN_URL_MAP['/' + slug] = '/folder.html';
      SEO_FOLDER_MAP['/' + slug] = folderName;
    }
    if (CLEAN_URL_MAP[pathname]) {
      // For SEO category URLs, inject the folder query param
      if (SEO_FOLDER_MAP[pathname]) {
        requestUrl.searchParams.set('folder', SEO_FOLDER_MAP[pathname]);
      }
      // Rewrite internally (not redirect, to preserve URL)
      pathname = CLEAN_URL_MAP[pathname];
    }

    // SEO: Clean video URL routing — /{category-slug}/{video-slug} → /video.html
    if (!CLEAN_URL_MAP[pathname] && pathname !== '/video.html') {
      const _vParts = pathname.split('/').filter(Boolean);
      if (_vParts.length === 2 && SLUG_TO_CATEGORY[_vParts[0]]) {
        const _vLookup = _vParts[0] + '/' + _vParts[1];
        const _vEntry = videoSlugMap.get(_vLookup);
        if (_vEntry) {
          requestUrl.searchParams.set('folder', _vEntry.folder);
          requestUrl.searchParams.set('name', _vEntry.name);
          pathname = '/video.html';
        }
      }
    }
    // 301 redirect old query-string category URLs to clean URLs for SEO
    if (pathname === '/folder.html' && requestUrl.searchParams.get('folder') && !requestUrl.searchParams.get('subfolder')) {
      const REVERSE_SEO_MAP = {};
      for (const [folderName, slug] of Object.entries(CATEGORY_SLUG_MAP)) REVERSE_SEO_MAP[folderName] = '/' + slug;
      const cleanPath = REVERSE_SEO_MAP[requestUrl.searchParams.get('folder')];
      if (cleanPath && requestUrl.pathname === '/folder.html') {
        res.writeHead(301, { Location: cleanPath });
        return res.end();
      }
    }

    const _staticMethodEarly = (req.method || 'GET').toUpperCase();
    if (_staticMethodEarly === 'GET' || _staticMethodEarly === 'HEAD') {
      const _legacyImageRedirect = {
        '/face.png': '/assets/images/face.png',
        '/preview.png': '/assets/images/preview.jpg',
        '/top_preview.png': '/assets/images/top_preview.png',
        '/checkout-images/image1.png': '/assets/images/checkout/image1.png',
        '/checkout-images/image2.png': '/assets/images/checkout/image2.jpg',
        '/checkout-images/image3.png': '/assets/images/checkout/image3.jpg',
      };
      const _imgRedirectTo = _legacyImageRedirect[pathname];
      if (_imgRedirectTo) {
        res.writeHead(301, { Location: _imgRedirectTo });
        return res.end();
      }
    }

    // Track page visits for analytics
    if (pathname.endsWith('.html') || requestUrl.pathname === '/') {
      recordVisit(req);
      // Track Shorts as a category
      if (pathname === '/shorts.html') {
        adminCategoryHits['Shorts'] = (adminCategoryHits['Shorts'] || 0) + 1;
        logAdminEventToSupabase('category_hit', { category: 'Shorts' }).catch(() => {});
      }
    }

    // Lock down Free Access page: redirect home.
    if (pathname === '/access.html') {
      res.writeHead(302, { Location: '/' });
      return res.end();
    }

    // Legacy `checkout.html` used to be served as static HTML (bypassed the SPA). Route everyone to the React app.
    if (pathname === '/checkout.html') {
      res.writeHead(302, {
        Location: '/checkout' + (requestUrl.search || ''),
        'Cache-Control': 'no-store',
      });
      return res.end();
    }

    // Logged-in users shouldn't need standalone auth pages.
    if (pathname === '/login.html' || pathname === '/signup.html') {
      const userKey = await getAuthedUserKeyWithRefresh(req);
      if (userKey) {
        res.writeHead(302, { Location: '/' });
        return res.end();
      }
    }

    // ── Vite React SPA: client/dist (optional; same-origin API) ──
    const _clientDist = path.join(__dirname, 'client', 'dist');
    const _clientIndex = path.join(_clientDist, 'index.html');
    const _methodUp = (req.method || 'GET').toUpperCase();
    if ((_methodUp === 'GET' || _methodUp === 'HEAD') && fs.existsSync(_clientIndex)) {
      // Site icons are requested by browsers as /favicon.ico and /site-icon.png.
      // Serve from dist/public fallbacks to avoid 404s on production builds.
      if (pathname === '/favicon.ico' || pathname === '/site-icon.png' || pathname === '/apple-touch-icon.png') {
        const iconCandidates = [
          path.join(_clientDist, pathname.replace(/^\/+/, '')),
          path.join(_clientDist, 'site-icon.png'),
          path.join(__dirname, 'client', 'public', 'site-icon.png'),
        ];
        for (const iconPath of iconCandidates) {
          try {
            const st = await fs.promises.stat(iconPath);
            if (!st.isFile()) continue;
            const raw = await fs.promises.readFile(iconPath);
            res.writeHead(200, {
              'Content-Type': 'image/png',
              'Cache-Control': 'public, max-age=31536000, immutable',
            });
            return res.end(_methodUp === 'HEAD' ? Buffer.alloc(0) : raw);
          } catch (_) {}
        }
      }

      // Serve Vite-built assets and fonts from `client/dist`.
      // Keep custom asset namespaces (`/assets/images|thumbnails|onlyfans|branding`) on the fallback block below.
      const isCustomAssetNamespace =
        pathname.startsWith('/assets/images/') ||
        pathname.startsWith('/assets/thumbnails/') ||
        pathname.startsWith('/assets/onlyfans/') ||
        pathname.startsWith('/assets/branding/');
      const isViteAssetPath = pathname.startsWith('/assets/') && !isCustomAssetNamespace;
      if (isViteAssetPath || pathname === '/whitney-fonts.css' || pathname.startsWith('/fonts/')) {
        const _rel = pathname.replace(/^\/+/, '');
        let _assetPath = path.normalize(path.join(_clientDist, _rel));
        const _distRootNorm = path.normalize(_clientDist + path.sep);
        if (_assetPath.startsWith(_distRootNorm)) {
          try {
            const _st = await fs.promises.stat(_assetPath);
            if (_st.isFile()) {
              const _raw = await fs.promises.readFile(_assetPath);
              const _ct = getContentType(_assetPath);
              res.writeHead(200, { 'Content-Type': _ct, 'Cache-Control': 'public, max-age=31536000, immutable' });
              return res.end(_methodUp === 'HEAD' ? Buffer.alloc(0) : _raw);
            }
          } catch (_) {}
          // If a stale hashed Vite entry filename is requested, fall back to the latest built entry.
          // This avoids a blank shell when index.html and /assets hashes drift temporarily across deploys.
          if (_rel.startsWith('assets/index-') && (_rel.endsWith('.js') || _rel.endsWith('.css'))) {
            try {
              const _ext = path.extname(_rel);
              const _assetsDir = path.join(_clientDist, 'assets');
              const _files = await fs.promises.readdir(_assetsDir);
              const _candidates = _files
                .filter((name) => /^index-[^/\\]+\.(js|css)$/.test(name) && path.extname(name) === _ext)
                .map((name) => path.join(_assetsDir, name));
              let _fallbackPath = null;
              let _fallbackMtime = 0;
              for (const _candidate of _candidates) {
                const _cst = await fs.promises.stat(_candidate);
                if (_cst.isFile() && _cst.mtimeMs > _fallbackMtime) {
                  _fallbackMtime = _cst.mtimeMs;
                  _fallbackPath = _candidate;
                }
              }
              if (_fallbackPath) {
                const _raw = await fs.promises.readFile(_fallbackPath);
                const _ct = getContentType(_fallbackPath);
                res.writeHead(200, {
                  'Content-Type': _ct,
                  'Cache-Control': 'public, max-age=300, must-revalidate',
                });
                return res.end(_methodUp === 'HEAD' ? Buffer.alloc(0) : _raw);
              }
            } catch (_) {}
          }
        }
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Not Found');
      }
      if (requestUrl.pathname === '/admin' || !requestUrl.pathname.startsWith('/admin')) {
        const _SPA_HTML_PAGES = new Set([
          '/index.html', '/folder.html', '/video.html', '/shorts.html', '/custom-requests.html',
          '/categories.html', '/live-cams.html', '/blog.html', '/login.html', '/signup.html',
          '/create-account.html', '/account.html', '/upload.html', '/search.html', '/access.html',
          '/5e213853413a598023a5583149f32445.html',
        ]);
        const _SPA_CLEAN_PATHS = new Set([
          '/shorts', '/search', '/categories', '/account', '/upload', '/login', '/signup', '/checkout', '/premium',
          '/live-cams', '/custom-requests', '/create-account', '/blog', '/video', '/folder',
          '/onlyfans', '/new-releases', '/about', '/faqs', '/privacy', '/terms', '/help', '/changelog',
          '/admin',
        ]);
        for (const p of CATEGORY_CLEAN_PATHS) _SPA_CLEAN_PATHS.add(p);
        const _slugVideo =
          /^\/[a-z0-9-]+\/[a-z0-9-]+$/.test(requestUrl.pathname) && requestUrl.pathname !== '/create-account';
        const _wantSpa =
          pathname === '/' ||
          _SPA_HTML_PAGES.has(pathname) ||
          _SPA_CLEAN_PATHS.has(requestUrl.pathname) ||
          _slugVideo;
        if (_wantSpa) {
          let _html = await fs.promises.readFile(_clientIndex, 'utf8');
          const _origin = getRequestOrigin(req);
          _html = _html.replace(/\{\{BASE_URL\}\}/g, _origin);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
          return res.end(_methodUp === 'HEAD' ? '' : _html);
        }
      }
    }

    // Allow loading static images from repo `images/` + `thumbnails/` under the new `/assets/...` URL paths,
    // even when the Vite `client/dist` output isn't present (e.g., local dev).
    if (
      pathname.startsWith('/assets/images/') ||
      pathname.startsWith('/assets/thumbnails/') ||
      pathname.startsWith('/assets/onlyfans/') ||
      pathname.startsWith('/assets/branding/')
    ) {
      const imagesRoot =
        resolveEnvPath(process.env.TBW_IMAGES_ROOT, path.resolve(__dirname, 'images')) || path.resolve(__dirname, 'images');
      const thumbsRoot =
        resolveEnvPath(process.env.TBW_THUMBNAILS_ROOT, path.resolve(__dirname, 'thumbnails')) || path.resolve(__dirname, 'thumbnails');
      const brandingRoot =
        resolveEnvPath(
          process.env.TBW_BRANDING_ROOT,
          path.resolve(__dirname, 'client', 'public', 'assets', 'branding'),
        ) || path.resolve(__dirname, 'client', 'public', 'assets', 'branding');

      const ASSET_PREFIX_IMAGES = '/assets/images/';
      const ASSET_PREFIX_THUMBS = '/assets/thumbnails/';
      const ASSET_PREFIX_ONLYFANS = '/assets/onlyfans/';
      const ASSET_PREFIX_BRANDING = '/assets/branding/';

      let externalRoot = thumbsRoot;
      let prefixLen = ASSET_PREFIX_THUMBS.length;
      if (pathname.startsWith(ASSET_PREFIX_IMAGES)) { externalRoot = imagesRoot; prefixLen = ASSET_PREFIX_IMAGES.length; }
      else if (pathname.startsWith(ASSET_PREFIX_THUMBS)) { externalRoot = thumbsRoot; prefixLen = ASSET_PREFIX_THUMBS.length; }
      else if (pathname.startsWith(ASSET_PREFIX_ONLYFANS)) { externalRoot = thumbsRoot; prefixLen = ASSET_PREFIX_ONLYFANS.length; }
      else if (pathname.startsWith(ASSET_PREFIX_BRANDING)) { externalRoot = brandingRoot; prefixLen = ASSET_PREFIX_BRANDING.length; }

      // 1) Serve from local disk first (dev/local).
      try {
        const rel = decodeURIComponent(pathname.slice(prefixLen));
        const externalRootResolved = path.resolve(externalRoot);
        const abs = path.resolve(externalRootResolved, path.normalize(rel));
        // Robust containment check (string `startsWith` is brittle across Windows casing/normalization).
        const relToRoot = path.relative(externalRootResolved, abs);
        if (relToRoot && !relToRoot.startsWith('..') && !path.isAbsolute(relToRoot)) {
          const st = await fs.promises.stat(abs).catch(() => null);
          if (st && st.isFile()) {
            const raw = await fs.promises.readFile(abs);
            const ct = getContentType(abs);
            res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'public, max-age=31536000, immutable' });
            return res.end(_methodUp === 'HEAD' ? Buffer.alloc(0) : raw);
          }
        }
      } catch (_) {}

      // 2) Fallback: stream from R2 using the `assets/` prefix (production).
      if (R2_ENABLED) {
        try {
          // pathname = /assets/<subpath>
          const rel2 = decodeURIComponent(pathname.slice('/assets/'.length));
          // Prevent path traversal style requests.
          if (!rel2 || rel2.includes('..') || rel2.startsWith('/') || rel2.includes('\\')) {
            throw new Error('invalid rel2');
          }

          const allowed =
            rel2.startsWith('images/') ||
            rel2.startsWith('thumbnails/') ||
            rel2.startsWith('onlyfans/') ||
            rel2.startsWith('branding/');
          if (allowed) {
            const objectKey = `${R2_ASSETS_PREFIX}/${rel2}`;
            const buf = await r2GetObjectBytes(objectKey);
            if (buf) {
              const ct = getContentType(rel2);
              res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'public, max-age=31536000, immutable' });
              return res.end(_methodUp === 'HEAD' ? Buffer.alloc(0) : buf);
            }
          }
        } catch (_) {}
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }

    if (
      !STATIC_ALLOWLIST.has(requestUrl.pathname) &&
      !STATIC_ALLOWLIST.has(pathname) &&
      !pathname.startsWith('/fonts/') &&
      !pathname.startsWith('/thumbnails/') &&
      !pathname.startsWith('/images/')
    ) {
      // Return proper 404 for unknown pages (302 redirects cause soft-404 issues in Google Search Console)
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>404 — Pornwrld</title><meta name="robots" content="noindex"><link rel="stylesheet" href="/whitney-fonts.css"></head><body style="background:#0a0a0f;color:#ccc;font-family:\'Whitney\',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center"><div><h1 style="font-size:48px;margin-bottom:16px">404</h1><p style="font-size:18px;margin-bottom:24px">Page not found</p><a href="/" style="color:#c084fc;font-size:16px">Back to Pornwrld</a></div></body></html>');
    }

    const filePath = safeFilePath(pathname);
    if (!filePath) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Forbidden');
    }

    // Never serve auth data or media directly via static paths.
    const normalized = path.normalize(filePath);
    const protectedDirs = [
      path.normalize(DATA_DIR + path.sep),
      ...Array.from(allowedFolders.values()).map((d) => path.normalize(path.join(MEDIA_ROOT, d) + path.sep)),
    ];
    for (const pd of protectedDirs) {
      if (normalized.startsWith(pd)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Not Found');
      }
    }

    // Block any direct serving of image/video files via static handler (must go through /media with auth + range).
    // Exception: allow a small number of UI assets (like the premium preview image and face icon).
    if (!pathname.startsWith('/images/') && !pathname.startsWith('/thumbnails/') && isAllowedMediaFile(normalized)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }

    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }

    if (stat.isDirectory()) {
      const indexPath = path.join(filePath, 'index.html');
      try {
        await fs.promises.access(indexPath);
        const data = await fs.promises.readFile(indexPath);
        res.writeHead(200, { 'Content-Type': getContentType(indexPath) });
        return res.end(data);
      } catch {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Forbidden');
      }
    }

    // Static file serving (no directory listing)
    // (Range not required here; media is handled by /media)
    // In-memory cache for static files (avoids disk I/O on every request)
    // Also caches gzipped version to avoid re-compressing on every request
    if (!global._staticFileCache) global._staticFileCache = {};
    const _sfcKey = filePath;
    let data;
    let _sfcGz = null;
    let _sfcBr = null;
    const _sfcEntry = global._staticFileCache[_sfcKey];
    if (_sfcEntry && (Date.now() - _sfcEntry.ts) < 300000) {
      data = _sfcEntry.buf;
      _sfcGz = _sfcEntry.gz || null;
      _sfcBr = _sfcEntry.br || null;
    } else {
      data = await fs.promises.readFile(filePath);
      const ct = getContentType(filePath);
      const _isText = ct.startsWith('text/') || ct.startsWith('application/json') || ct.startsWith('application/xml') || ct.startsWith('application/javascript');
      if (_isText && data.length > 1024) {
        [_sfcGz, _sfcBr] = await Promise.all([
          _gzipAsync(data, { level: 6 }),
          _brotliAsync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 } }).catch(() => null)
        ]);
      }
      global._staticFileCache[_sfcKey] = { buf: data, gz: _sfcGz, br: _sfcBr, ts: Date.now() };
    }
    const contentType = getContentType(filePath);
    if (contentType.startsWith('text/html')) {
      const origin = getRequestOrigin(req);
      let html = data.toString('utf8').replace(/\{\{BASE_URL\}\}/g, origin);

      // Server-side meta tag injection for folder pages (SEO)
      if (pathname === '/folder.html' && requestUrl.searchParams.get('folder')) {
        const seoFolder = requestUrl.searchParams.get('folder');
        const seoSub = requestUrl.searchParams.get('subfolder') || '';
        const seoTitle = seoSub ? seoFolder + ' — ' + seoSub : seoFolder;
        // Per-folder title + description for higher CTR. Lead with the noun searchers
        // type, then a benefit ("free", "HD", "leaks", count). Keep titles under ~60ch.
        const SEO_META = {
          'Omegle': { title: 'Omegle Wins & OmeTV Flashes — Free HD Archive', desc: 'Thousands of Omegle wins, OmeTV flashes, MiniChat reactions and Monkey App clips — sorted by category, updated daily. Free HD on Pornwrld.', kw: 'omegle wins, omegle flash, omegle reactions, omegle girls, ometv wins, ometv flash, ometv reactions, minichat wins, minichat flash, monkey app wins, omegle points game, chat roulette wins, omegle compilation' },
          'IRL Dick Flashing': { title: 'IRL Dick Flashing — Real Public Flash Reactions', desc: 'Real IRL dick flashing videos — public, outdoor, beach, car, store. Genuine reactions caught on camera. Free HD updated daily on Pornwrld.', kw: 'irl dick flashing, dick flash public, exhibitionist, public nudity, outdoor flash, caught in public, public flashing' },
          'TikTok': { title: 'TikTok Porn & Leaks — Banned NSFW TikToks', desc: 'Leaked TikTok nudes, banned TikTok videos, viral thirst traps and NSFW TikTok content. Hundreds of clips, free HD on Pornwrld.', kw: 'tiktok porn, tiktok leaks, tiktok nudes, banned tiktok, tiktok nsfw, tiktok thirst traps, leaked tiktok' },
          'Snapchat': { title: 'Snapchat Leaks 2026 — Premium Snap Nudes & Stories', desc: 'Leaked Snapchat nudes, premium snap stories and amateur snap content. Fresh leaks added daily — free HD on Pornwrld.', kw: 'snapchat leaks, premium snapchat, snapchat porn, snapchat nudes, snapchat stories, premium snap leaks, snap leaks 2026' },
          'Live Slips': { title: 'Live Slips — Wardrobe Malfunctions & Nip Slips', desc: 'Real wardrobe malfunctions, accidental nip slips and on-air flash moments captured live. HD compilations updated daily on Pornwrld.', kw: 'live slips, wardrobe malfunctions, nip slips, accidental flash, on-air slip, broadcast malfunction' },
          'Feet': { title: 'Foot Fetish — Soles, Toes & Feet Worship Videos', desc: 'Foot fetish videos, sole worship, toe content and amateur feet content — HD quality, updated daily on Pornwrld.', kw: 'feet, foot fetish, feet videos, feet pics, sole worship, toe fetish, foot content' },
          'Real Couples': { title: 'Real Couples Porn — Amateur Homemade Sex Tapes', desc: 'Verified amateur couples, homemade sex tapes and genuine real-couple content. Free HD videos updated daily on Pornwrld.', kw: 'real couples porn, amateur couples, homemade sex tape, real couple porn, amateur homemade, verified amateur' },
          'College': { title: 'College Porn — Real Dorm & Campus Amateurs', desc: 'College porn — dorm-room amateurs, frat parties, campus hookups and real student content. Free HD updated daily on Pornwrld.', kw: 'college porn, college girls, dorm porn, campus amateur, college amateur' },
        };
        const seoData = SEO_META[seoFolder] || { title: seoTitle + ' Porn — Free HD Videos', desc: 'Browse ' + seoTitle + ' videos on Pornwrld. Watch the best ' + seoTitle + ' content free in HD.', kw: seoTitle.toLowerCase() + ', pornwrld' };
        const fullTitle = escHtml((seoData.title || (seoTitle + ' — Pornwrld | Free HD Videos')) + ' | Pornwrld');
        const fullDesc = escHtml(seoData.desc);
        // Replace existing meta tags (all values escaped to prevent XSS)
        html = html.replace(/<title>[^<]*<\/title>/, '<title>' + fullTitle + '</title>');
        html = html.replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + fullDesc + '">');
        html = html.replace(/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="' + fullTitle + '">');
        html = html.replace(/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="' + fullDesc + '">');
        html = html.replace(/<meta name="twitter:title" content="[^"]*">/, '<meta name="twitter:title" content="' + fullTitle + '">');
        html = html.replace(/<meta name="twitter:description" content="[^"]*">/, '<meta name="twitter:description" content="' + fullDesc + '">');
        // Add keywords meta if not present
        if (!html.includes('meta name="keywords"')) {
          html = html.replace('</head>', '<meta name="keywords" content="' + escHtml(seoData.kw) + '">\n</head>');
        }
        // Set canonical URL using clean SEO paths
        const CANONICAL_CLEAN = { 'Omegle': '/omegle-wins', 'IRL Dick Flashing': '/irl-dick-flashing', 'TikTok': '/tiktok-porn', 'Snapchat': '/snapchat-leaks', 'Live Slips': '/live-slips', 'Feet': '/feet' };
        const cleanBase = CANONICAL_CLEAN[seoFolder] || '/folder.html?folder=' + encodeURIComponent(seoFolder);
        const canonicalUrl = origin + cleanBase + (seoSub ? '?subfolder=' + encodeURIComponent(seoSub) : '');
        html = html.replace(/<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="' + canonicalUrl + '">');
        if (!html.includes('rel="canonical"')) {
          html = html.replace('</head>', '<link rel="canonical" href="' + canonicalUrl + '">\n</head>');
        }
        html = html.replace(/<meta property="og:url" content="[^"]*">/, '<meta property="og:url" content="' + canonicalUrl + '">');

        // SEO: Inject BreadcrumbList schema
        const breadcrumbSchema = JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Home", "item": origin + "/" },
            { "@type": "ListItem", "position": 2, "name": "Categories", "item": origin + "/categories" },
            { "@type": "ListItem", "position": 3, "name": seoTitle, "item": canonicalUrl }
          ]
        });
        html = html.replace('</head>', '<script type="application/ld+json">' + breadcrumbSchema + '</script>\n</head>');

        // SEO: Server-side render visible text content so Googlebot doesn't see an empty JS shell
        const SSR_CONTENT = {
          'Omegle': '<section class="seo-ssr-content" style="padding:20px 24px;max-width:900px;margin:0 auto;color:rgba(255,255,255,0.85);font-size:15px;line-height:1.7"><h1>Omegle Wins — Best Omegle Flashing, Reactions & Compilations</h1><p>Welcome to the largest archive of <strong>Omegle wins</strong> on the internet. Browse thousands of HD videos featuring the best <strong>Omegle flashing</strong>, <strong>Omegle girls showing on cam</strong>, hilarious <strong>Omegle dick reactions</strong>, and intense <strong>Omegle points game</strong> highlights. Our collection also includes <strong>OmeTV wins</strong>, <strong>OmeTV flash</strong> reactions, <strong>MiniChat wins</strong>, and <strong>Monkey App</strong> clips.</p><p>Whether you\'re looking for <strong>Omegle compilations</strong>, <strong>chat roulette wins</strong>, or the funniest <strong>Omegle reactions</strong> — Pornwrld has the best selection, updated daily with new content. All videos are in HD quality and free to watch with a Pornwrld account.</p><h2>Popular Omegle Categories</h2><ul><li><a href="/omegle-wins?subfolder=Dick+Reactions">Omegle Dick Reactions</a> — Watch girls\' real reactions</li><li><a href="/omegle-wins?subfolder=Monkey+App+Streamers">Monkey App Streamers</a> — Best Monkey App wins</li><li><a href="/omegle-wins?subfolder=Points+Game">Omegle Points Game</a> — Points game highlights</li><li><a href="/omegle-wins?subfolder=Regular+Wins">Regular Omegle Wins</a> — Classic Omegle moments</li></ul><h2>What Are Omegle Wins?</h2><p>Omegle wins refer to memorable or exciting moments captured during random video chats on Omegle, OmeTV, MiniChat, and similar platforms. These include flashing reactions, funny encounters, and unexpected reveals. Since Omegle shut down in 2023, these archived videos have become increasingly popular and rare.</p></section>',
          'IRL Dick Flashing': '<section class="seo-ssr-content" style="padding:20px 24px;max-width:900px;margin:0 auto;color:rgba(255,255,255,0.85);font-size:15px;line-height:1.7"><h1>IRL Dick Flashing — Public Flash & Exhibitionist Videos</h1><p>Watch real <strong>IRL dick flashing</strong> videos — <strong>public flashing</strong> in malls, parks, beaches, and restaurants. Genuine amateur <strong>exhibitionist content</strong> featuring outdoor flashing, car flashing, and caught-in-public moments. All in HD quality on Pornwrld.</p></section>',
          'TikTok': '<section class="seo-ssr-content" style="padding:20px 24px;max-width:900px;margin:0 auto;color:rgba(255,255,255,0.85);font-size:15px;line-height:1.7"><h1>TikTok Porn — Leaked TikTok Nudes, NSFW TikTok & TikTok Thots</h1><p>Watch the hottest <strong>TikTok porn</strong> and <strong>leaked TikTok videos</strong>. Browse <strong>TikTok nudes</strong>, <strong>banned TikTok videos</strong>, <strong>TikTok NSFW</strong> content, viral <strong>TikTok thirst traps</strong>, and trending adult content from popular creators. Updated daily on Pornwrld.</p></section>',
          'Snapchat': '<section class="seo-ssr-content" style="padding:20px 24px;max-width:900px;margin:0 auto;color:rgba(255,255,255,0.85);font-size:15px;line-height:1.7"><h1>Snapchat Leaks — Premium Snapchat Porn & Nudes</h1><p>Browse <strong>premium Snapchat leaks</strong> and short-form adult content curated into one place. <strong>Snapchat porn</strong>, <strong>Snapchat nudes</strong>, quick clips, and phone-shot amateur content — all on Pornwrld.</p></section>',
          'Live Slips': '<section class="seo-ssr-content" style="padding:20px 24px;max-width:900px;margin:0 auto;color:rgba(255,255,255,0.85);font-size:15px;line-height:1.7"><h1>Live Slips — Wardrobe Malfunctions & Accidental Flashing</h1><p>Watch authentic <strong>wardrobe malfunctions</strong>, <strong>accidental flashing</strong>, and unexpected <strong>slip moments</strong> captured on camera. Browse genuine <strong>live slips</strong>, <strong>nip slips</strong>, broadcast malfunctions, and candid caught-on-camera moments from real events. All in HD quality on Pornwrld.</p></section>',
          'Feet': '<section class="seo-ssr-content" style="padding:20px 24px;max-width:900px;margin:0 auto;color:rgba(255,255,255,0.85);font-size:15px;line-height:1.7"><h1>Foot Fetish — Feet Videos, Soles, Toes & Feet Worship</h1><p>Browse the best <strong>foot fetish</strong> content — <strong>feet videos</strong>, <strong>feet pics</strong>, <strong>sole worship</strong>, <strong>toe content</strong>, and amateur feet worship videos. HD quality foot fetish videos updated daily on Pornwrld.</p></section>',
        };
        const ssrBlock = SSR_CONTENT[seoFolder] || '';
        if (ssrBlock) {
          html = html.replace('</body>', ssrBlock + '\n</body>');
        }

        // SEO: Server-render crawlable <a> links to individual videos so Googlebot
        // can discover them (the JS-rendered grid is invisible to crawlers, which
        // is why ~215 video pages sit at "Discovered – currently not indexed").
        if (previewFileList && previewFileList.length > 0) {
          const folderVideos = previewFileList.filter(p => p.folder === seoFolder).slice(0, 60);
          if (folderVideos.length > 0) {
            let ssrLinks = '<nav class="seo-ssr-links" aria-label="More ' + escHtml(seoFolder) + ' videos" style="padding:18px 24px;max-width:1100px;margin:0 auto;color:rgba(255,255,255,0.6);font-size:13px;line-height:1.7"><h2 style="font-size:15px;margin:0 0 10px;color:rgba(255,255,255,0.8)">More ' + escHtml(seoTitle) + ' videos</h2><ul style="list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:8px 14px">';
            for (const vd of folderVideos) {
              const cleanPath = videoCleanUrlMap.get(vd.folder + '/' + vd.name);
              if (!cleanPath) continue;
              // Build a human title from the slug for link text (last URL segment, hyphens → spaces)
              const slugTail = cleanPath.split('/').pop() || vd.name;
              const linkText = slugTail.replace(/-[a-z0-9]{6}$/, '').replace(/-/g, ' ');
              ssrLinks += '<li><a href="' + escHtml(cleanPath) + '" style="color:rgba(192,132,252,0.85);text-decoration:none">' + escHtml(linkText) + '</a></li>';
            }
            ssrLinks += '</ul></nav>';
            html = html.replace('</body>', ssrLinks + '\n</body>');
          }
        }
      }

      // Server-side meta tag injection for video pages (SEO — unique title/desc per video)
      if (pathname === '/video.html' && requestUrl.searchParams.get('folder') && requestUrl.searchParams.get('name')) {
        const vFolder = requestUrl.searchParams.get('folder');
        const vName = requestUrl.searchParams.get('name');
        const vSub = requestUrl.searchParams.get('subfolder') || '';
        // Inject video params as globals so client-side JS works with clean URLs (no query params in browser URL)
        const _escJs = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '\\x3c');
        const vParamsScript = "<script>window.__videoParams={folder:'" + _escJs(vFolder) + "',name:'" + _escJs(vName) + "',subfolder:'" + _escJs(vSub) + "'};</script>";
        html = html.replace('</head>', vParamsScript + '\n</head>');
        // Generate a clean title from the filename (server-side version of seoCleanTitle)
        const vBase = vName.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim();
        const vWords = vBase.split(/\s+/).filter(w => w.length > 1);
        const vAlpha = (vBase.match(/[a-zA-Z]/g) || []).length;
        const vDigits = (vBase.match(/[0-9]/g) || []).length;
        const vIsGibberish = (
          (vWords.length < 2 && vBase.length < 12 && !/\d{3,4}p/.test(vBase)) ||
          ((vDigits + (vBase.match(/[A-Z]/g) || []).length) > vAlpha * 0.7 && vWords.length < 3) ||
          vBase.length < 6
        );
        const vCat = vFolder.replace(/[-_]/g, ' ');
        let vCleanTitle;
        if (!vIsGibberish) {
          vCleanTitle = vBase;
        } else {
          const adjectives = ['hot','sexy','cute','thicc','bratty','horny','tipsy','shy','bored','pierced','tatted','busty','pale','tanned','curvy','petite','freaky','filthy'];
          const nouns = ['babe','girl','teen','redhead','blonde','brunette','asian','latina','goth','milf','cosplayer','step-sis','cam girl','roommate','college girl','gym girl'];
          const actions = ['flashes','teases','strips','goes nude','lifts shirt','drops bra','shows tits','grinds','spreads','rubs out','plays with toy','sucks','rides','grinds on cam'];
          const povs = ['POV','sound on 🔊','no sound','reaction','caught','first time','round 2','part 2','uncut','full clip','leaked','snuck a peek'];
          const modifiers = ['(0:14)','(no sound)','(sound on)','[full]','HD','1080p','4k','vertical','close up','behind the scenes'];
          // Use a deterministic seed from the filename so the same video always gets the same title
          let seed = 0;
          for (let ci = 0; ci < vName.length; ci++) seed = ((seed << 5) - seed + vName.charCodeAt(ci)) | 0;
          seed = Math.abs(seed);
          const adj = adjectives[seed % adjectives.length];
          const noun = nouns[(seed >> 4) % nouns.length];
          const action = actions[(seed >> 8) % actions.length];
          const povTok = povs[(seed >> 12) % povs.length];
          const modTok = modifiers[(seed >> 16) % modifiers.length];
          const numTok = ((seed >> 20) % 7) + 1;
          if (vCat && vCat.length > 2) {
            const templates = [
              noun + ' ' + action + ' on ' + vCat + ' (' + povTok + ')',
              adj + ' ' + noun + ' ' + action + ' — ' + vCat,
              vCat + ' win #' + numTok + ' — ' + noun + ' ' + action,
              noun + ' ' + action + ' (' + vCat + ', sound on)',
              adj + ' ' + noun + ' caught ' + action,
              noun + ' ' + action + ' ' + modTok,
              'best ' + vCat + ' ' + noun + ' of the week',
              vCat + ': ' + adj + ' ' + noun + ' ' + action,
              noun + ' ' + action + ' — ' + vCat + ' compilation pt ' + numTok,
              adj + ' ' + noun + ' ' + action + ' on ' + vCat,
              noun + ' from ' + vCat + ' ' + action + ' (POV)',
              'rare ' + vCat + ' clip — ' + adj + ' ' + noun + ' ' + action,
              adj + ' ' + noun + ' ' + action + ' on cam',
              vCat + ' ' + noun + ' ' + action + ' for the boys'
            ];
            vCleanTitle = templates[(seed >> 8) % templates.length];
          } else {
            vCleanTitle = adj + ' ' + noun + ' ' + action + ' on cam';
          }
        }
        const vStats = shortStats[vName] || {};
        const vViews = vStats.views || 0;
        const vFullTitle = escHtml(vCleanTitle + ' — ' + vFolder + ' | Pornwrld');
        const vCatLabel = escHtml(vSub ? vFolder + ' — ' + vSub : vFolder);

        const VIDEO_SEO_DESC = {
          'Omegle': 'omegle wins, omegle flash, omegle reactions',
          'IRL Dick Flashing': 'irl dick flashing, public flash',
          'TikTok': 'tiktok porn, tiktok leaks, tiktok nudes',
          'Snapchat': 'snapchat leaks, snapchat porn',
          'Feet': 'feet, foot fetish, feet videos',
        };
        const vKw = escHtml((VIDEO_SEO_DESC[vFolder] || vFolder.toLowerCase()) + ', ' + vCleanTitle.toLowerCase() + ', pornwrld');
        const vDesc = escHtml('Watch ' + vCleanTitle + ' - ' + vCatLabel + ' on Pornwrld. Free ' + vCatLabel + ' videos. ' + vViews.toLocaleString() + ' views.');

        html = html.replace(/<title>[^<]*<\/title>/, '<title>' + vFullTitle + '</title>');
        html = html.replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + vDesc + '">');
        html = html.replace(/<meta name="keywords" content="[^"]*">/, '<meta name="keywords" content="' + vKw + '">');
        html = html.replace(/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="' + vFullTitle + '">');
        html = html.replace(/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="' + vDesc + '">');
        html = html.replace(/<meta name="twitter:title" content="[^"]*">/, '<meta name="twitter:title" content="' + vFullTitle + '">');
        html = html.replace(/<meta name="twitter:description" content="[^"]*">/, '<meta name="twitter:description" content="' + vDesc + '">');
        // Set canonical URL
        let vCanonical = origin + '/video.html?folder=' + encodeURIComponent(vFolder) + '&name=' + encodeURIComponent(vName);
        if (vSub) vCanonical += '&subfolder=' + encodeURIComponent(vSub);
        html = html.replace(/<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="' + vCanonical + '">');
        html = html.replace(/<meta property="og:url" content="[^"]*">/, '<meta property="og:url" content="' + vCanonical + '">');
        // Update thumbnail meta to use actual video thumbnail
        const vThumbUrl = origin + '/thumbnail?folder=' + encodeURIComponent(vFolder) + '&name=' + encodeURIComponent(vName) + (vSub ? '&subfolder=' + encodeURIComponent(vSub) : '');
        html = html.replace(/<meta property="og:image" content="[^"]*">/, '<meta property="og:image" content="' + vThumbUrl + '">');
        html = html.replace(/<meta name="twitter:image" content="[^"]*">/, '<meta name="twitter:image" content="' + vThumbUrl + '">');
        // Replace JSON-LD structured data with video-specific data
        const vDurSec = _getDuration(vFolder, vSub, vName);
        // Use actual upload date from file metadata instead of hardcoded date
        const vPf = (previewFileList || []).find(p => p.name === vName && p.folder === vFolder);
        const vUploadDate = (vPf && vPf.lastModified) ? new Date(vPf.lastModified).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
        // Use the public preview-media URL as contentUrl so Googlebot can fetch it.
        // /media is auth-gated (paid tier) and 401s for crawlers; /preview-media is public
        // and 302-redirects to a presigned R2 URL of the preview clip.
        const vContentUrl = origin + '/preview-media?folder=' + encodeURIComponent(vFolder) + '&name=' + encodeURIComponent(vName);
        const vJsonLdObj = {
          "@context": "https://schema.org",
          "@type": "VideoObject",
          "name": vCleanTitle,
          "description": vDesc,
          "thumbnailUrl": vThumbUrl,
          "uploadDate": vUploadDate,
          "contentUrl": vContentUrl,
          "embedUrl": vCanonical,
          "inLanguage": "en",
          "interactionStatistic": {
            "@type": "InteractionCounter",
            "interactionType": { "@type": "WatchAction" },
            "userInteractionCount": vViews
          },
          "publisher": {
            "@type": "Organization",
            "name": "Pornwrld",
            "url": origin + '/',
            "logo": { "@type": "ImageObject", "url": origin + '/assets/images/face.png' }
          }
        };
        if (vDurSec > 0) {
          // ISO 8601 duration format
          const dH = Math.floor(vDurSec / 3600);
          const dM = Math.floor((vDurSec % 3600) / 60);
          const dS = vDurSec % 60;
          vJsonLdObj.duration = 'PT' + (dH > 0 ? dH + 'H' : '') + (dM > 0 ? dM + 'M' : '') + dS + 'S';
        }
        const vJsonLd = JSON.stringify(vJsonLdObj);
        html = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, '<script type="application/ld+json">' + vJsonLd + '</script>');

        // SEO: Inject BreadcrumbList schema for video pages
        const VBREAD_CLEAN = { 'Omegle': '/omegle-wins', 'IRL Dick Flashing': '/irl-dick-flashing', 'TikTok': '/tiktok-porn', 'Snapchat': '/snapchat-leaks', 'Live Slips': '/live-slips', 'Feet': '/foot-fetish' };
        const vCatUrl = origin + (VBREAD_CLEAN[vFolder] || '/folder.html?folder=' + encodeURIComponent(vFolder));
        const vBreadcrumb = JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Home", "item": origin + "/" },
            { "@type": "ListItem", "position": 2, "name": vFolder, "item": vCatUrl },
            { "@type": "ListItem", "position": 3, "name": vCleanTitle }
          ]
        });
        html = html.replace('</head>', '<script type="application/ld+json">' + vBreadcrumb + '</script>\n</head>');

        // SEO: Inject SSR content block for video pages so Googlebot sees real text (not just a JS shell)
        const _he = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        const VIDEO_CAT_DESC = {
          'Omegle': 'Omegle wins, OmeTV flash reactions, MiniChat wins, Monkey App clips, and chat roulette compilations',
          'IRL Dick Flashing': 'real IRL dick flashing videos, public flashing, exhibitionist content, and caught-in-public moments',
          'TikTok': 'leaked TikTok porn, TikTok nudes, banned TikTok videos, NSFW TikTok content, and viral thirst traps',
          'Snapchat': 'premium Snapchat leaks, Snapchat porn, Snapchat nudes, and short-form amateur content',
          'Feet': 'foot fetish videos, feet pics, sole worship, toe content, and amateur feet worship',
        };
        const vCatDesc = VIDEO_CAT_DESC[vFolder] || vFolder + ' videos';
        const vCatCleanUrl = VBREAD_CLEAN[vFolder] || '/folder.html?folder=' + encodeURIComponent(vFolder);
        // Gather related videos from same category for internal linking
        let relatedHtml = '';
        if (previewFileList && previewFileList.length > 0) {
          const relatedVideos = previewFileList.filter(r => r.folder === vFolder && r.name !== vName).slice(0, 8);
          if (relatedVideos.length > 0) {
            relatedHtml = '<h2>More ' + vFolder + ' Videos</h2><ul>';
            for (const rv of relatedVideos) {
              const rvClean = videoCleanUrlMap.get(rv.folder + '/' + rv.name);
              const rvUrl = rvClean || '/video.html?folder=' + encodeURIComponent(rv.folder) + '&name=' + encodeURIComponent(rv.name);
              const rvBase = rv.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim();
              const rvTitle = rvBase.length > 3 ? rvBase.slice(0, 60) : rv.folder + ' video';
              relatedHtml += '<li><a href="' + _he(rvUrl) + '">' + _he(rvTitle) + '</a></li>';
            }
            relatedHtml += '</ul>';
          }
        }
        const vSsrBlock = '<section class="seo-ssr-content" style="padding:20px 24px;max-width:900px;margin:0 auto;color:rgba(255,255,255,0.85);font-size:15px;line-height:1.7">'
          + '<h1>' + _he(vCleanTitle) + '</h1>'
          + '<p>Watch <strong>' + _he(vCleanTitle) + '</strong> in HD quality on Pornwrld. This ' + _he(vCatLabel) + ' video is part of our curated collection of ' + vCatDesc + '. Free to watch, updated daily.</p>'
          + '<p>Pornwrld features the internet\'s largest archive of ' + vCatDesc + '. All videos are in HD quality and free to stream.</p>'
          + '<nav><a href="/">Home</a> &rsaquo; <a href="' + _he(vCatCleanUrl) + '">' + _he(vFolder) + '</a> &rsaquo; ' + _he(vCleanTitle) + '</nav>'
          + relatedHtml
          + '</section>';
        html = html.replace('</body>', vSsrBlock + '\n</body>');

        // SEO: Update canonical URL to use clean URL if available
        const _vCleanCanonical = videoCleanUrlMap.get(vFolder + '/' + vName);
        if (_vCleanCanonical) {
          const _vFullClean = origin + _vCleanCanonical;
          html = html.replace(/<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="' + _vFullClean + '">');
          html = html.replace(/<meta property="og:url" content="[^"]*">/, '<meta property="og:url" content="' + _vFullClean + '">');
        }
      }

      // Inject popunder + native ad scripts before </body> on content pages (not checkout/admin)
      if (!pathname.startsWith('/admin')) {
        const adScripts = `
<!-- ExoClick Popunder (highest CPM ad format) -->
<script type="application/javascript">
(function(){var defined=false;window.addEventListener('click',function(){if(defined)return;defined=true;var s=document.createElement('script');s.src='https://a.magsrv.com/ad-provider.js';s.async=true;document.head.appendChild(s);setTimeout(function(){if(window.AdProvider){AdProvider.push({"serve":{"popunder":{"type":"async"}}});}},500);},{once:false,passive:true});})();
</script>
<!-- ExoClick Native Ad (in-page) -->
<div style="max-width:728px;margin:20px auto;text-align:center">
<ins class="eas6a97888e2" data-zoneid="5852668"></ins>
</div>`;
        html = html.replace('</body>', adScripts + '\n</body>');
      }

      data = Buffer.from(html, 'utf8');
      // HTML was transformed — pre-cached gzip/brotli is stale. Use async compression to avoid blocking event loop.
      if (data.length > 1024) {
        [_sfcGz, _sfcBr] = await Promise.all([
          _gzipAsync(data, { level: 6 }),
          _brotliAsync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 } }).catch(() => null)
        ]);
      }
    }
    // Cache static assets: CSS/JS 10 min, HTML 5 min, images 1 hour, XML 1 hour
    const cacheHeader = (contentType.startsWith('text/css') || contentType.startsWith('text/javascript'))
      ? 'public, max-age=600'
      : contentType.startsWith('text/html')
        ? 'public, max-age=300, must-revalidate'
        : (contentType.startsWith('image/') || contentType.startsWith('application/xml'))
          ? 'public, max-age=3600, must-revalidate'
          : 'no-store';
    const staticHeaders = {
      'Content-Type': contentType,
      'Cache-Control': cacheHeader,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://www.googletagmanager.com https://www.google-analytics.com https://a.magsrv.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.r2.cloudflarestorage.com https://*.cloudflare.com https://*.mmcdn.com; media-src 'self' blob: https://*.r2.cloudflarestorage.com https://*.cloudflare.com; connect-src 'self' https://*.r2.cloudflarestorage.com https://www.google-analytics.com; frame-src 'none'; object-src 'none'",
    };
    // Compress text-based static assets (HTML, CSS, JS, XML, JSON, TXT)
    // Prefer Brotli > Gzip; uses pre-compressed cached versions to avoid blocking the event loop
    const acceptEnc = String(req.headers['accept-encoding'] || '');
    if (_sfcBr && acceptEnc.includes('br')) {
      staticHeaders['Content-Encoding'] = 'br';
      staticHeaders['Content-Length'] = _sfcBr.length;
      staticHeaders['Vary'] = 'Accept-Encoding';
      res.writeHead(200, staticHeaders);
      res.end(_sfcBr);
    } else if (_sfcGz && acceptEnc.includes('gzip')) {
      staticHeaders['Content-Encoding'] = 'gzip';
      staticHeaders['Content-Length'] = _sfcGz.length;
      staticHeaders['Vary'] = 'Accept-Encoding';
      res.writeHead(200, staticHeaders);
      res.end(_sfcGz);
    } else {
      staticHeaders['Content-Length'] = data.length;
      res.writeHead(200, staticHeaders);
      res.end(data);
    }
  } catch (e) {
    console.error('[server] Unhandled error:', e);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Server error');
  }
});

// Keep TCP connections alive longer to avoid repeated TLS handshakes (Fly.io proxy reuses connections)
server.keepAliveTimeout = 65000; // slightly above Fly's 60s proxy timeout
server.headersTimeout = 66000;

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on http://${HOST}:${PORT}`);

  // eslint-disable-next-line no-console
  console.log(`Storage roots: DATA_DIR=${DATA_DIR} MEDIA_ROOT=${MEDIA_ROOT}`);
  // eslint-disable-next-line no-console
  console.log(`R2 media storage: ${R2_ENABLED ? 'ENABLED (bucket=' + R2_BUCKET + ')' : 'DISABLED (using local disk)'}`);

  if (!PEPPER) {
    console.warn('\x1b[33m[WARN]\x1b[0m TBW_PEPPER is not set. Passwords are less secure without it. Add TBW_PEPPER=<random-string> to .env.');
  }
  if (process.env.STRIPE_ENABLED === '1' && !process.env.STRIPE_SECRET_KEY) {
    console.warn('\x1b[33m[WARN]\x1b[0m STRIPE_ENABLED=1 but STRIPE_SECRET_KEY is not set.');
  }
  if (!SITE_ORIGIN) {
    console.warn('\x1b[33m[WARN]\x1b[0m TBW_PUBLIC_ORIGIN is not set — sitemap/SEO absolute URLs may use the incoming Host header only. Set TBW_PUBLIC_ORIGIN=https://your.domain');
  }
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
    console.warn('\x1b[33m[WARN]\x1b[0m Discord OAuth credentials missing. Discord login will not work.');
  }
});

server.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('Server error:', err);
});
