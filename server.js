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

const REF_COOKIE = 'tbw_ref';
const REF_CODE_LEN = 7;
const CLINK_COOKIE = 'tbw_clink'; // custom link tracking cookie

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

const allowedFolders = new Map([
  ['NSFW Straight', 'categories/nsfw-straight'],
  ['Alt and Goth', 'categories/alt-and-goth'],
  ['Petitie', 'categories/petitie'],
  ['Teen (18+ only)', 'categories/teen-18-plus'],
  ['MILF', 'categories/milf'],
  ['Asian', 'categories/asian'],
  ['Ebony', 'categories/ebony'],
  ['Hentai', 'categories/hentai'],
  ['Yuri', 'categories/yuri'],
  ['Yaoi', 'categories/yaoi'],
  ['Nip Slips', 'categories/nip-slips'],
  ['Omegle', 'categories/omegle'],
  ['OF Leaks', 'categories/of-leaks'],
  ['Premium Leaks', 'categories/premium-leaks'],
]);

const OMEGLE_SUBFOLDERS = ['Dick Reactions', 'Monkey App Streamers', 'Points Game', 'Regular Wins'];

// ── XYZPurchase + Supabase access key integration ───────────────────────────
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SECRET_KEY = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const SUPABASE_ACCESS_KEYS_TABLE = String(process.env.SUPABASE_ACCESS_KEYS_TABLE || 'issued_access_keys');
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

async function ensureCategoryRow(slug, label) {
  const query = `/rest/v1/categories?slug=eq.${encodeURIComponent(slug)}&select=id,slug&limit=1`;
  const existing = await supabaseJson(query);
  if (existing.ok && Array.isArray(existing.data) && existing.data[0]?.id) return existing.data[0];
  const inserted = await supabaseJson('/rest/v1/categories', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify([{ slug, label }]),
  });
  if (!inserted.ok || !Array.isArray(inserted.data) || !inserted.data[0]?.id) {
    throw new Error('category_insert_failed');
  }
  return inserted.data[0];
}

// ── SEO: Video slug generation for clean URLs ──
const CATEGORY_SLUG_MAP = {
  'NSFW Straight': 'nsfw-straight',
  'Alt and Goth': 'alt-and-goth',
  'Petitie': 'petitie',
  'Teen (18+ only)': 'teen-18-plus',
  'MILF': 'milf',
  'Asian': 'asian',
  'Ebony': 'ebony',
  'Hentai': 'hentai',
  'Yuri': 'yuri',
  'Yaoi': 'yaoi',
  'Nip Slips': 'nip-slips',
  'Omegle': 'omegle',
  'OF Leaks': 'of-leaks',
  'Premium Leaks': 'premium-leaks',
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
  '/5e213853413a598023a5583149f32445.html',
  '/robots.txt',
  '/sitemap.xml',
  '/',
  '/shorts',
  '/search',
  '/categories',
  '/upload',
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
async function r2HeadObject(objectKey) {
  try {
    const resp = await r2Request('HEAD', objectKey, null, {});
    return resp.status === 200;
  } catch { return false; }
}

async function r2GetObject(objectKey) {
  const resp = await r2Request('GET', objectKey, null, {});
  if (resp.status === 404 || resp.status === 403) return null;
  if (resp.status !== 200) throw new Error(`R2 GET ${objectKey} → ${resp.status}`);
  return resp.body.toString('utf8');
}

async function r2GetObjectBytes(objectKey) {
  const resp = await r2Request('GET', objectKey, null, {});
  if (resp.status === 404 || resp.status === 403) return null;
  if (resp.status !== 200) throw new Error(`R2 GET ${objectKey} → ${resp.status}`);
  return resp.body; // raw Buffer, not utf8
}

/**
 * PUT an object to R2.
 */
async function r2PutObject(objectKey, content, contentType) {
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
  const resp = await r2Request('PUT', objectKey, buf, { 'content-type': contentType || 'application/octet-stream' });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`R2 PUT(bytes) ${objectKey} → ${resp.status}: ${resp.body.toString('utf8').slice(0, 200)}`);
  }
}

async function loadUploadRequests(forceRefresh) {
  if (!R2_ENABLED) return;
  if (uploadRequestsLoaded && !forceRefresh) return;
  try {
    const raw = await r2GetObject(UPLOAD_REQUESTS_R2_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        uploadRequests.length = 0;
        uploadRequests.push(...arr);
      }
    }
  } catch (e) { console.error('[upload-requests] load error:', e.message); }
  uploadRequestsLoaded = true;
}

let _uploadPersistTimer = null;
function scheduleUploadPersist() {
  if (_uploadPersistTimer) return;
  _uploadPersistTimer = setTimeout(async () => {
    _uploadPersistTimer = null;
    if (!R2_ENABLED) return;
    try {
      await r2PutObject(UPLOAD_REQUESTS_R2_KEY, JSON.stringify(uploadRequests), 'application/json');
    } catch (e) { console.error('[upload-requests] persist error:', e.message); }
  }, 3000);
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
  const folderDirName = allowedFolders.get(folder);
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
  // Add Secure flag in production (when PORT is set by hosting platform, or explicitly enabled).
  if (process.env.TBW_SECURE_COOKIES === '1' || process.env.PORT) parts.push('Secure');
  const cookie = parts.join('; ');
  appendSetCookie(res, cookie);
}

function clearSessionCookie(res) {
  appendSetCookie(res, `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
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
  if (t >= 2) return 'TIER 2';
  if (t >= 1) return 'TIER 1';
  return 'NO TIER';
}

function normalizeManualTier(value) {
  if (value === undefined || value === null || value === 0) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const t = Math.floor(n);
  if (t === 1 || t === 2) return t;
  return null;
}

function tierMinCount(tier) {
  const t = Number(tier || 0);
  if (t >= 1) return 1;
  return 0;
}

function getEffectiveTierForUser(u) {
  const manual = normalizeManualTier(u && u.tier);
  if (manual !== null) return manual;
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

// Extract filename from old URL-style keys ("/media?folder=X&name=file.mp4" → "file.mp4")
function _migrateStatsKey(key) {
  if (!key || typeof key !== 'string') return key;
  // Old keys look like "/media?folder=...&name=encoded.mp4" or "/preview-media?folder=...&name=encoded.mp4"
  const m = key.match(/[?&]name=([^&]+)/);
  if (m) return decodeURIComponent(m[1]);
  return key; // already a filename
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
    let r2Data = null, localData = null;
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
    _mergeStatsMonotonic(merged, localData);  // merge local file (migrates old URL keys)
    _mergeStatsMonotonic(merged, r2Data);     // merge R2 data (migrates old URL keys)

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
  const snapshot = JSON.stringify(shortStats, null, 2);
  shortStatsWritePromise = shortStatsWritePromise.then(async () => {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    const tmp = SHORT_STATS_FILE + '.tmp';
    await fs.promises.writeFile(tmp, snapshot);
    await fs.promises.rename(tmp, SHORT_STATS_FILE);
    if (R2_ENABLED) {
      await r2PutObject(SHORT_STATS_R2_KEY, snapshot, 'application/json');
    }
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

function canonicalVideoId(folder, subfolder, name) {
  return [String(folder || ''), String(subfolder || ''), String(name || '')].join('|');
}

function parseCanonicalVideoId(videoId) {
  const parts = String(videoId || '').split('|');
  return { folder: parts[0] || '', subfolder: parts[1] || '', name: parts.slice(2).join('|') || '' };
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
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    await Promise.all([
      fs.promises.writeFile(RECO_EVENTS_FILE + '.tmp', eventsSnapshot).then(() => fs.promises.rename(RECO_EVENTS_FILE + '.tmp', RECO_EVENTS_FILE)),
      fs.promises.writeFile(RECO_PROFILES_FILE + '.tmp', profilesSnapshot).then(() => fs.promises.rename(RECO_PROFILES_FILE + '.tmp', RECO_PROFILES_FILE)),
      fs.promises.writeFile(RECO_PROGRESS_FILE + '.tmp', progressSnapshot).then(() => fs.promises.rename(RECO_PROGRESS_FILE + '.tmp', RECO_PROGRESS_FILE)),
      fs.promises.writeFile(RECO_GLOBAL_FILE + '.tmp', globalSnapshot).then(() => fs.promises.rename(RECO_GLOBAL_FILE + '.tmp', RECO_GLOBAL_FILE)),
    ]);
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
    if (R2_ENABLED) {
      const raw = await r2GetObject(COMMENTS_R2_KEY);
      if (raw) { videoComments = JSON.parse(raw); _commentsLastFetchTs = Date.now(); return; }
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
  const snapshot = JSON.stringify(videoComments);
  commentsWritePromise = commentsWritePromise.then(async () => {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    const tmp = COMMENTS_FILE + '.tmp';
    await fs.promises.writeFile(tmp, snapshot);
    await fs.promises.rename(tmp, COMMENTS_FILE);
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
// videoKey is just the filename so it matches how shorts already stores stats.
function videoKey(folder, subfolder, name) {
  return name;
}

/** previewFileList is rebuilt on an interval; merge live shortStats so list APIs are not stale. */
function enrichPreviewFilesWithLiveStats(files) {
  if (!Array.isArray(files)) return files;
  return files.map((f) => {
    if (!f || !isVideoFile(f.name)) return f;
    const k = videoKey(f.folder, f.subfolder || '', f.name);
    const stats = shortStats[k] || { views: 0, likes: 0, dislikes: 0 };
    return {
      ...f,
      videoKey: k,
      videoId: canonicalVideoId(f.folder, f.subfolder || '', f.name),
      views: stats.views || 0,
      likes: stats.likes || 0,
      dislikes: stats.dislikes || 0,
    };
  });
}

function loadVisitStatsFromDisk() {
  try {
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
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${VISIT_STATS_FILE}.tmp`;
    await fs.promises.writeFile(tmp, snapshot);
    await fs.promises.rename(tmp, VISIT_STATS_FILE);

    // Also persist to R2 so resets don't wipe stats
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
// LRU-ish thumbnail cache: keeps at most THUMB_CACHE_MAX entries in memory.
// Each entry stores a JPEG Buffer; evicts least-recently-used when full.
const THUMB_CACHE_MAX = 2000;
// Minimal dark JPEG placeholder (served instantly on cache miss while ffmpeg generates in background)
const PLACEHOLDER_THUMB = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAA IDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAFBABAAAAAAAAAAAAAAAAAAAACf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKgA/9k=', 'base64');
const _thumbAccessOrder = []; // ordered list of cache keys (most-recent at end)
const thumbnailCache = {}; // { "cacheKey": Buffer(jpeg) } — in-memory hot cache

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

// Cache key for a video: "folder/subfolder/name" or "folder//name" or just "name" (for preview compat)
function _thumbCacheKey(folder, subfolder, name) {
  if (!folder) return name; // backward compat for preview-only thumbs
  return folder + '/' + (subfolder || '') + '/' + name;
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

// Build a thumbnail URL for API responses — presigned R2 URL if cached, else fallback to /thumbnail endpoint
function _thumbUrl(folder, subfolder, name) {
  const cacheKey = _thumbCacheKey(folder, subfolder, name);
  // If thumbnail is in memory cache, it's also in R2 — serve directly from R2 (bypasses Node)
  if (R2_ENABLED && _thumbCacheGet(cacheKey)) {
    return r2PresignedUrl(_thumbR2Key(cacheKey), 3600);
  }
  let url = '/thumbnail?folder=' + encodeURIComponent(folder) + '&name=' + encodeURIComponent(name);
  if (subfolder) url += '&subfolder=' + encodeURIComponent(subfolder);
  return url;
}

// R2 thumbnail persistence: store generated thumbnails to R2 so they survive deploys
const THUMB_R2_PREFIX = 'data/thumbnails/';
function _thumbR2Key(cacheKey) {
  return THUMB_R2_PREFIX + encodeURIComponent(cacheKey) + '.jpg';
}
async function _thumbSaveToR2(cacheKey, buf) {
  if (!R2_ENABLED) return;
  try { await r2PutObjectBytes(_thumbR2Key(cacheKey), buf, 'image/jpeg'); } catch {}
}
async function _thumbLoadAllFromR2() {
  if (!R2_ENABLED) return 0;
  try {
    const entries = await r2ListObjects(THUMB_R2_PREFIX);
    let loaded = 0;
    for (const e of entries) {
      const fname = e.key.slice(THUMB_R2_PREFIX.length);
      if (!fname.endsWith('.jpg')) continue;
      const cacheKey = decodeURIComponent(fname.replace(/\.jpg$/, ''));
      if (_thumbCacheGet(cacheKey)) { loaded++; continue; } // already in memory
      try {
        const buf = await r2GetObjectBytes(e.key);
        if (buf && buf.length > 5000) {
          // Skip dark/blank thumbnails (< 5KB) so they regenerate with multi-timestamp logic
          _thumbCacheSet(cacheKey, buf, true); // skipR2=true since we just loaded from R2
          loaded++;
        }
      } catch {}
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

function _getDuration(folder, subfolder, name) {
  const exact = videoDurations[_thumbCacheKey(folder, subfolder, name)];
  if (exact) return exact;
  // Fallback: try matching by filename across all known keys (preview files often share names with full videos)
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

// Concurrency limiter for ffmpeg — max 1 at a time to prevent CPU starvation on small Fly machines
let _ffmpegActive = 0;
const _ffmpegQueue = [];
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
    if (_ffmpegActive < 1) run();
    else _ffmpegQueue.push(run);
  });
}

function generateThumbnail(videoUrl, name) {
  return new Promise(async (resolve) => {
    const _ffOpts = { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024, timeout: 8000 };
    const _baseArgs = ['-vframes', '1', '-vf', 'scale=480:-1', '-f', 'image2', '-vcodec', 'mjpeg', '-q:v', '6', 'pipe:1'];
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
      for (const tf of ['tier 1', 'tier 2']) {
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
          // Extract duration if missing
          if (needsDur) {
            try {
              const dur = await extractDuration(videoUrl);
              if (dur > 0) { videoDurations[cacheKey] = dur; durExtracted++; _scheduleDurationSave(); }
            } catch {}
          }
          // Generate thumbnail if missing
          if (needsThumb) {
            try {
              const buf = await generateThumbnail(videoUrl, item.name);
              if (buf) {
                _thumbCacheSet(cacheKey, buf);
                const diskPath = _thumbDiskPath(folderName, sf, item.name);
                fs.writeFile(diskPath, buf, () => {}); // async write, don't block event loop
                generated++;
              } else { failed++; }
            } catch { failed++; }
            await new Promise(r => setTimeout(r, 10000)); // heavy throttle after ffmpeg to keep server responsive
          } else {
            await new Promise(r => setTimeout(r, 3000)); // moderate throttle for duration-only
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
const folderCounts = {}; // { "Omegle": 1234, ... } populated after prewarm

async function buildFolderCounts() {
  if (!R2_ENABLED) return;
  try {
    for (const [folderName, basePath] of allowedFolders.entries()) {
      const seenSizes = new Set();
      let total = 0;
      const tierFolders = ['tier 1', 'tier 2'];
      const prefixes = [];
      if (folderName === 'Omegle') {
        for (const sf of OMEGLE_SUBFOLDERS) {
          for (const tf of tierFolders) prefixes.push(basePath + '/' + tf + '/' + sf + '/');
        }
      } else {
        for (const tf of tierFolders) prefixes.push(basePath + '/' + tf + '/');
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

// Build on startup (after randomized delay so multiple machines don't blast R2 simultaneously)
// Pre-warm R2 list cache for all folder prefixes so first user request is instant
async function prewarmR2ListCache() {
  if (!R2_ENABLED) return;
  console.log('[prewarm] Warming R2 list cache for all folders...');
  const prefixes = [];
  for (const [, basePath] of allowedFolders) {
    for (const tf of ['tier 1', 'tier 2']) {
      if (basePath === 'porn/omegle') {
        for (const sf of OMEGLE_SUBFOLDERS) {
          prefixes.push(basePath + '/' + tf + '/' + sf + '/');
        }
      } else {
        prefixes.push(basePath + '/' + tf + '/');
      }
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
    // Generate preview thumbnails first, then all folder thumbnails in background
    buildThumbnailCache().then(() => {
      buildFolderThumbnailCache().catch(e => console.error('[folder-thumbs] init error:', e.message));
    }).catch(e => console.error('[thumbnails] init error:', e.message));
  } catch (e) { console.error('[preview-cache] init error:', e.message); }
}, _startupDelay);
setInterval(async () => {
  try {
    await buildPreviewCache();
    // Only generate thumbnails for genuinely new videos (skip if already ran once)
    if (_thumbGenRanOnce) {
      const newFiles = previewFileList.filter(f => !_thumbCacheGet(f.name));
      if (newFiles.length > 0) {
        console.log('[thumbnails] refresh: ' + newFiles.length + ' new files to generate');
        buildThumbnailCache().catch(e => console.error('[thumbnails] refresh error:', e.message));
      }
    }
    // Also refresh folder thumbnails for any new uploads
    buildFolderThumbnailCache().catch(e => console.error('[folder-thumbs] refresh error:', e.message));
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
let ADMIN_PASSWORD_CURRENT = crypto.randomBytes(16).toString('hex');
console.warn('[admin] INFO: rotating admin password enabled (16-byte random, interval ms=' + ADMIN_PASSWORD_ROTATE_MS + ')');
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

function postAdminPasswordToWebhook(password, reason) {
  if (!ADMIN_PASSWORD_WEBHOOK_URL) return;
  try {
    const webhookUrl = new URL(ADMIN_PASSWORD_WEBHOOK_URL);
    const payload = JSON.stringify({
      content: `Admin password (${reason}): \`${password}\``,
    });
    const proto = webhookUrl.protocol === 'https:' ? https : http;
    const reqOpts = {
      method: 'POST',
      hostname: webhookUrl.hostname,
      port: webhookUrl.port || (webhookUrl.protocol === 'https:' ? 443 : 80),
      path: webhookUrl.pathname + webhookUrl.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const wr = proto.request(reqOpts, (resp) => {
      resp.on('data', () => {});
      resp.on('end', () => {});
    });
    wr.on('error', (e) => console.error('[admin] failed posting password to webhook:', e && e.message ? e.message : e));
    wr.write(payload);
    wr.end();
  } catch (e) {
    console.error('[admin] invalid ADMIN_PASSWORD_WEBHOOK_URL:', e && e.message ? e.message : e);
  }
}

function rotateAdminPassword(reason) {
  ADMIN_PASSWORD_CURRENT = crypto.randomBytes(16).toString('hex');
  // Force re-login on every password rotation.
  // Existing admin cookies become invalid because their backing tokens are removed.
  if (adminTokens.size > 0) {
    adminTokens.clear();
    persistAdminTokens();
  }
  console.warn('[admin] password rotated (' + reason + ')');
  postAdminPasswordToWebhook(ADMIN_PASSWORD_CURRENT, reason);
  adminEmitEvent('admin_password_rotated', 'Admin password rotated (' + reason + ')');
}

rotateAdminPassword('startup');
setInterval(() => rotateAdminPassword('hourly'), ADMIN_PASSWORD_ROTATE_MS);

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
const PATREON_PRICE_BASIC_CENTS = parseInt(process.env.PATREON_PRICE_BASIC_CENTS || '999', 10);
const PATREON_PRICE_PREMIUM_CENTS = parseInt(process.env.PATREON_PRICE_PREMIUM_CENTS || '2499', 10);

function patreonNormalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

function patreonTierFromCents(cents) {
  const c = Number(cents) || 0;
  if (c >= PATREON_PRICE_PREMIUM_CENTS) return 2;
  if (c >= PATREON_PRICE_BASIC_CENTS) return 1;
  if (c > 0) return 1;
  return 0;
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

function _queueAdminDataWrite(buildSnapshot, filePath, r2Key, label) {
  adminDataWritePromise = adminDataWritePromise.then(async () => {
    const snapshot = await buildSnapshot();
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${filePath}.tmp`;
    await fs.promises.writeFile(tmp, snapshot);
    await fs.promises.rename(tmp, filePath);

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
      const rq = http.request(url, { method: 'GET', headers: { 'User-Agent': 'pornyard-admin-geo' } }, (rs) => {
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

function planAmountCents(plan) {
  const p = String(plan || '').toLowerCase();
  if (p === 'premium') return 1500;
  return 0;
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

function isValidUsername(username) {
  return /^[a-zA-Z0-9_-]{3,24}$/.test(username);
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
      await loadSessionsOnceFromR2(parsed);
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
  // Block if any existing user already signed up from this IP
  for (const u of Object.values(db.users)) {
    if (u.signupIp && u.signupIp === ip) {
      return { blocked: true, reason: 'ip_duplicate' };
    }
  }
  return { blocked: false };
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

async function listMediaFilesForFolder(folder) {
  // Use R2 when configured, fall back to local disk
  if (R2_ENABLED) return r2ListMediaFiles(folder);

  const folderDirName = allowedFolders.get(folder);
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

    // ===== WWW → non-www redirect (SEO: single canonical host) =====
    const reqHost = (req.headers.host || '').toLowerCase();
    if (reqHost.startsWith('www.')) {
      const target = `https://${reqHost.replace(/^www\./, '')}${req.url}`;
      res.writeHead(301, { Location: target });
      return res.end();
    }

    // Track last-seen for active-user stats (skip for static files to avoid blocking cold-start)
    const _isStaticReq = /\.(html|css|js|png|jpg|jpeg|gif|webp|svg|ico|xml|txt|json|woff2?|ttf|eot|mp4|webm|mov)(\?|$)/i.test(requestUrl.pathname) || requestUrl.pathname === '/';
    if (!_isStaticReq) {
      try {
        await ensureSessionsLoaded();
        const _uk = getAuthedUserKey(req);
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
      // Use timing-safe comparison to prevent timing attacks
      const inputBuf = Buffer.from(String(body.password || ''));
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
        if (![0, 1, 2].includes(newTier)) return sendJson(res, 400, { error: 'Tier must be 0, 1, or 2' });
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
        const tierLabels = { 0: 'Free', 1: 'Tier 1', 2: 'Premium' };
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
        if (![0, 1, 2].includes(newTier)) return sendJson(res, 400, { error: 'Tier must be 0, 1, or 2' });
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
        const tierLabels = { 0: 'Free', 1: 'Tier 1', 2: 'Premium' };
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
            if (!userKey) { grantSkipped.push({ email, reason: 'no_pornyard_user_with_matching_googleEmail' }); continue; }
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
            await r2PutObject(UPLOAD_REQUESTS_R2_KEY, JSON.stringify(uploadRequests), 'application/json');
          } catch (e) {
            console.error('[upload-review] persist error after deny:', e.message);
          }
          return sendJson(res, 200, { ok: true });
        }

        if (action === 'approve') {
          const finalName = (videoName || uploadReq.videoName).slice(0, 40);
          const tier = assignedTier === 2 ? 2 : 1;
          const basePath = allowedFolders.get(uploadReq.category);
          if (!basePath) return sendJson(res, 400, { error: 'Invalid category on request' });

          const tierFolder = tier >= 2 ? 'tier 2' : 'tier 1';
          const sanitized = finalName.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_').slice(0, 40);
          const ext = path.extname(uploadReq.originalFilename || '.mp4').toLowerCase();
          const timestamp = Date.now();

          let finalKey;
          if (uploadReq.category === 'Omegle' && uploadReq.subfolder) {
            finalKey = basePath + '/' + tierFolder + '/' + uploadReq.subfolder + '/' + timestamp + '_' + sanitized + ext;
          } else {
            finalKey = basePath + '/' + tierFolder + '/' + timestamp + '_' + sanitized + ext;
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
              try { await r2PutObject(UPLOAD_REQUESTS_R2_KEY, JSON.stringify(uploadRequests), 'application/json'); } catch {}
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
            await r2PutObject(UPLOAD_REQUESTS_R2_KEY, JSON.stringify(uploadRequests), 'application/json');
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
          const prefixes = [
            'porn/omegle/previews/',
            'porn/omegle/tier 1/Dick Reactions/',
            'porn/omegle/tier 1/Monkey App Streamers/',
            'porn/omegle/tier 1/Points Game/',
            'porn/omegle/tier 1/Regular Wins/',
            'porn/omegle/tier 2/Dick Reactions/',
            'porn/omegle/tier 2/Monkey App Streamers/',
            'porn/omegle/tier 2/Points Game/',
            'porn/omegle/tier 2/Regular Wins/',
          ];
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
      const newTier = plan === 'premium' || plan === 'tier2' ? 2 : plan === 'basic' || plan === 'tier1' ? 1 : null;
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
      const _planLabel = plan === 'basic' ? 'Basic — $9.99' : newTier >= 2 ? 'Premium — $24.99' : 'Tier 1 (referral)';
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
        const _planKey = plan === 'basic' ? 'basic' : newTier >= 2 ? 'premium' : 'tier1';
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
      const userKey = getAuthedUserKey(req);
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
          const _planLabel = tier === 2 ? 'Premium' : 'Basic';
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
      const userKey = getAuthedUserKey(req);
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
      const _planLabel = newTier >= 2 ? 'Premium (Tier 2)' : 'Basic (Tier 1)';
      const _planPrice = newTier >= 2 ? '$24.99' : '$9.99';
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
        const _planKey = newTier >= 2 ? 'premium' : 'basic';
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

      return sendJson(res, 201, { ok: true });

      } finally { releaseSignupLock(); }
    }

    // ===== PRESENCE HEARTBEAT =====
    if (requestUrl.pathname === '/api/ping') {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'POST' && method !== 'GET') return sendJson(res, 405, { error: 'Method Not Allowed' });
      await ensureSessionsLoaded();
      const pingUserKey = getAuthedUserKey(req);
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
      } else if (evt.eventType === 'shorts_progress') {
        adminPush(adminShortsUsage, { duration: Math.round(Number(evt.watchMs || 0)), ts: now }, 2000);
      } else if (evt.eventType === 'page_session') {
        adminPush(adminPageSessions, {
          page: String(body.page || '/').slice(0, 64),
          duration: Math.round(_safeNum(body.duration || evt.watchMs || 0, 0, 3600000)),
          bounced: !!body.bounced,
          ts: now,
        }, 2000);
      } else if (evt.eventType === 'nav_click' && body.label) {
        const label = String(body.label).slice(0, 32);
        adminNavClicks[label] = (adminNavClicks[label] || 0) + 1;
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
            }
            break;
          case 'shorts_usage':
            if (typeof body.duration === 'number' && body.duration > 0 && body.duration < 3600000) {
              adminPush(adminShortsUsage, { duration: Math.round(body.duration), ts: now }, 1000);
              appendRecoEvent(identity, { eventType: 'shorts_progress', watchMs: Math.round(body.duration), surface: 'shorts' });
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

      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!isValidUsername(username)) return sendJson(res, 401, { error: 'Invalid credentials' });
      if (!isValidPassword(password)) return sendJson(res, 401, { error: 'Invalid credentials' });

      const db = await ensureUsersDbFresh();
      const key = username.toLowerCase();
      const record = db.users[key];
      if (!record || record.provider !== 'local') return sendJson(res, 401, { error: 'Invalid credentials' });

      const calc = scryptHex(password, record.salt);
      const a = Buffer.from(calc, 'hex');
      const b = Buffer.from(String(record.hash || ''), 'hex');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return sendJson(res, 401, { error: 'Invalid credentials' });
      }

      if (record.banned) {
        return sendJson(res, 403, { error: 'Banned' });
      }

      // Track login IP/time (for abuse prevention / auditing)
      record.lastLoginIp = normIp;
      record.lastLoginAt = Date.now();
      await queueUsersDbWrite();

      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, { userKey: key, createdAt: Date.now() });
      persistSessionsToR2();
      setSessionCookie(res, token);
      return sendJson(res, 200, { ok: true });
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
      return sendJson(res, 200, { authed: true, username: displayName, tier, tierLabel });
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
      return sendJson(res, 200, { code, url, count, goal, tier, tierLabel });
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

    // ===== PAYMENT SCREENSHOT SUBMISSION =====

    if (requestUrl.pathname === '/api/payment-screenshot') {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });

      // Collect raw body (max 8 MB)
      const MAX_SIZE = 8 * 1024 * 1024;
      const rawBuf = await new Promise((resolve) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_SIZE) { req.destroy(); resolve(null); return; }
          chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', () => resolve(null));
      });
      if (!rawBuf) return sendJson(res, 413, { error: 'Payload too large' });

      // Parse multipart boundary
      const ct = String(req.headers['content-type'] || '');
      const boundaryMatch = ct.match(/boundary=(?:"([^"]+)"|([^\s;]+))/i);
      if (!boundaryMatch) return sendJson(res, 400, { error: 'Missing boundary' });
      const boundary = boundaryMatch[1] || boundaryMatch[2];

      // Simple multipart parser
      const delimiter = Buffer.from('--' + boundary);
      const parts = [];
      let pos = 0;
      while (pos < rawBuf.length) {
        const start = rawBuf.indexOf(delimiter, pos);
        if (start === -1) break;
        const afterDelim = start + delimiter.length;
        // Check for closing --
        if (rawBuf[afterDelim] === 0x2D && rawBuf[afterDelim + 1] === 0x2D) break;
        // Skip \r\n after delimiter
        const headStart = (rawBuf[afterDelim] === 0x0D && rawBuf[afterDelim + 1] === 0x0A)
          ? afterDelim + 2
          : afterDelim;
        // Find header/body separator (\r\n\r\n)
        const sep = Buffer.from('\r\n\r\n');
        const headerEnd = rawBuf.indexOf(sep, headStart);
        if (headerEnd === -1) break;
        const headers = rawBuf.slice(headStart, headerEnd).toString('utf8');
        const bodyStart = headerEnd + 4;
        const nextDelim = rawBuf.indexOf(delimiter, bodyStart);
        const bodyEnd = nextDelim !== -1 ? nextDelim - 2 : rawBuf.length; // -2 for \r\n before delimiter
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

      const planPart  = parts.find(p => p.name === 'plan');
      const methodPart = parts.find(p => p.name === 'method');
      const screenshotPart = parts.find(p => p.name === 'screenshot' && p.filename);
      const giftcardCodePart = parts.find(p => p.name === 'giftcard_code');

      const plan   = planPart  ? planPart.data.toString('utf8').trim()  : 'unknown';
      const payMethod = methodPart ? methodPart.data.toString('utf8').trim() : 'unknown';
      const giftcardCode = giftcardCodePart ? giftcardCodePart.data.toString('utf8').trim() : null;
      const isGiftCard = payMethod === 'giftcard';

      if (!isGiftCard && !screenshotPart) {
        console.error('[payment-screenshot] No screenshot found. Parts:', parts.map(p => ({ name: p.name, filename: p.filename, size: p.data.length })));
        return sendJson(res, 400, { error: 'No screenshot attached' });
      }
      if (isGiftCard && !giftcardCode) {
        return sendJson(res, 400, { error: 'No gift card code provided' });
      }

      // Get user info — require login (use requireAuthedUser for R2 session sync)
      const authed = await requireAuthedUser(req, res);
      if (!authed) return;
      const { userKey, record } = authed;

      let username = 'anonymous';
      let grantedTier = 0;
      const tierForPlan = { tier1: 1, basic: 1, premium: 2 };

      try {

        username = record.username || record.discordUsername || 'anonymous';
        const newTier = tierForPlan[plan] || 0;
        
        if (newTier <= 0) {
          console.error('[payment] Invalid plan:', plan);
          return sendJson(res, 400, { error: 'Invalid plan selected.' });
        }

        // Grant the tier
        record.tier = newTier;
        record.purchaseMethod = payMethod;
        record.purchaseDate = Date.now();
        grantedTier = newTier;
        
        // CRITICAL: Write immediately for payment — do NOT use debounced schedule
        await _doUsersDbWrite();

        // Verify the tier was actually set
        const verifyDb = usersDb;
        const verifyRecord = verifyDb && verifyDb.users ? verifyDb.users[userKey] : null;
        if (!verifyRecord || verifyRecord.tier !== newTier) {
          console.error('[payment] Tier verification failed. Expected:', newTier, 'Got:', verifyRecord ? verifyRecord.tier : 'no record');
          return sendJson(res, 500, { error: 'Failed to save tier. Please contact support with your screenshot.' });
        }
        
        console.log('[payment] Tier granted successfully:', username, 'plan:', plan, 'tier:', newTier);
        adminEmitEvent('payment', username + ' purchased ' + (newTier === 2 ? 'Premium' : 'Tier 1') + ' via ' + payMethod);
      } catch (err) {
        console.error('[payment] Error granting tier:', err);
        return sendJson(res, 500, { error: 'Failed to process payment. Please contact support.' });
      }

      const PLAN_LABELS = { basic: 'Basic — $9.99', premium: 'Premium — $24.99' };
      const METHOD_LABELS = { paypal: 'PayPal', cashapp: 'Cash App', zelle: 'Zelle', venmo: 'Venmo', applepay: 'Apple Pay', giftcard: 'Gift Card' };

      // Send to Discord webhook
      if (DISCORD_WEBHOOK_PAYMENTS_URL && isGiftCard) {
        // Gift card: send embed with code (no screenshot)
        const gcEmbedPayload = JSON.stringify({
          embeds: [{
            title: '🎁 Gift Card Code Submitted',
            color: 0x00ff87,
            fields: [
              { name: 'User', value: username, inline: true },
              { name: 'Plan', value: PLAN_LABELS[plan] || plan, inline: true },
              { name: 'Method', value: 'Gift Card', inline: true },
              { name: 'Code', value: '`' + giftcardCode + '`', inline: false },
            ],
            timestamp: new Date().toISOString(),
          }],
        });
        try {
          const webhookUrl = new URL(DISCORD_WEBHOOK_PAYMENTS_URL);
          const postOpts = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          };
          const webhookReq = https.request(webhookUrl, postOpts);
          webhookReq.on('error', () => {});
          webhookReq.write(gcEmbedPayload);
          webhookReq.end();
        } catch { /* non-critical */ }
      } else if (DISCORD_WEBHOOK_PAYMENTS_URL && !isGiftCard) {
        // Regular: send embed with attached screenshot image
        const embedPayload = JSON.stringify({
          embeds: [{
            title: '💰 Payment Screenshot Submitted',
            color: 0xffd700,
            fields: [
              { name: 'User', value: username, inline: true },
              { name: 'Plan', value: PLAN_LABELS[plan] || plan, inline: true },
              { name: 'Method', value: METHOD_LABELS[payMethod] || payMethod, inline: true },
            ],
            image: { url: 'attachment://screenshot.png' },
            timestamp: new Date().toISOString(),
          }],
        });

        const discordBoundary = '----PaymentBoundary' + Date.now();
        const parts2 = [];

        parts2.push(
          `--${discordBoundary}\r\n` +
          `Content-Disposition: form-data; name="payload_json"\r\n` +
          `Content-Type: application/json\r\n\r\n` +
          embedPayload + '\r\n'
        );

        const fileHeader =
          `--${discordBoundary}\r\n` +
          `Content-Disposition: form-data; name="files[0]"; filename="screenshot.png"\r\n` +
          `Content-Type: ${screenshotPart.contentType || 'image/png'}\r\n\r\n`;

        const fileFooter = `\r\n--${discordBoundary}--\r\n`;

        const bodyBuf = Buffer.concat([
          Buffer.from(parts2.join('')),
          Buffer.from(fileHeader),
          screenshotPart.data,
          Buffer.from(fileFooter),
        ]);

        try {
          const webhookUrl = new URL(DISCORD_WEBHOOK_PAYMENTS_URL);
          const postOpts = {
            method: 'POST',
            headers: {
              'Content-Type': `multipart/form-data; boundary=${discordBoundary}`,
              'Content-Length': bodyBuf.length,
            },
          };
          const webhookReq = https.request(webhookUrl, postOpts);
          webhookReq.on('error', () => {});
          webhookReq.write(bodyBuf);
          webhookReq.end();
        } catch { /* non-critical */ }
      }

      // Persist screenshot to R2 so it survives server resets
      let screenshotKey = null;
      if (screenshotPart) {
        try {
          const ts = Date.now();
          const safeUser = String(username || 'user').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 48) || 'user';
          const ext = (screenshotPart.contentType || '').toLowerCase().includes('jpeg') ? 'jpg'
            : (screenshotPart.contentType || '').toLowerCase().includes('webp') ? 'webp'
            : 'png';
          screenshotKey = `data/payments/${ts}_${safeUser}.${ext}`;
          if (R2_ENABLED) {
            await r2PutObjectBytes(screenshotKey, screenshotPart.data, screenshotPart.contentType || 'image/png');
          } else {
            const dir = path.join(DATA_DIR, 'payments');
            await fs.promises.mkdir(dir, { recursive: true });
            await fs.promises.writeFile(path.join(dir, `${ts}_${safeUser}.${ext}`), screenshotPart.data);
          }
        } catch (e) {
          console.error('Failed to persist payment screenshot:', e && e.message ? e.message : e);
        }
      }

      // Admin payment log
      try {
        const logEntry = {
          ts: Date.now(), username, userKey, plan, method: payMethod,
          screenshotKey,
          grantedTier,
        };
        if (isGiftCard) {
          logEntry.giftcardCode = giftcardCode;
        }
        if (screenshotPart) {
          logEntry.screenshotB64 = screenshotPart.data.slice(0, 200 * 1024).toString('base64');
          logEntry.contentType = screenshotPart.contentType || 'image/png';
        }
        adminPush(adminPaymentLog, logEntry, 500);
      } catch {}

      return sendJson(res, 200, { ok: true, grantedTier });
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
      // Clear state cookie immediately to prevent replay
      appendSetCookie(res, `tbw_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
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
      // Clear state cookie immediately to prevent replay
      appendSetCookie(res, `tbw_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
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

    // API: list files in a category folder (tier-gated)
    if (requestUrl.pathname === '/api/list') {
      const authed = await requireAuthedUser(req, res);
      if (!authed) return;
      const { userKey, record: u, db } = authed;

      const folder = requestUrl.searchParams.get('folder') || '';
      const subfolder = requestUrl.searchParams.get('subfolder') || '';
      const basePath = allowedFolders.get(folder);
      if (!basePath) return sendJson(res, 400, { error: 'Invalid folder' });

      const tier = getEffectiveTierForUser(u);
      if (tier < 1) return sendJson(res, 403, { error: 'Tier required' });

      // Track category hit for admin
      adminCategoryHits[folder] = (adminCategoryHits[folder] || 0) + 1;
      scheduleAdminPersist();

      // ── Cache: reuse R2 listing for 2 minutes per tier+folder+subfolder ──
      if (!global._listCache) global._listCache = {};
      const _listCacheKey = `${tier}:${folder}:${subfolder}`;
      const _listCached = global._listCache[_listCacheKey];
      if (_listCached && (Date.now() - _listCached.ts < 600000)) { // 10 min cache
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

      // Tier folders to scan: tier 2 users get both tier 2 + tier 1, tier 1 gets tier 1 only
      const tierFolders = tier >= 2 ? ['tier 2', 'tier 1'] : ['tier 1'];

      // Omegle: if subfolder specified, serve that subfolder; otherwise serve ALL subfolders flat
      if (folder === 'Omegle') {
        if (subfolder) {
          if (!OMEGLE_SUBFOLDERS.includes(subfolder)) {
            return sendJson(res, 400, { error: 'Invalid subfolder' });
          }
          const allFiles = [];
          const seenSizes = new Set();
          const seenTitles = new Set();
          // Fetch all tier folders in parallel
          const _prefixes = tierFolders.map(tf => basePath + '/' + tf + '/' + subfolder + '/');
          const _listResults = await Promise.all(_prefixes.map(p => R2_ENABLED ? r2ListMediaFilesFromPrefix(p).catch(() => []) : Promise.resolve([])));
          if (!global._mediaKeyCache) global._mediaKeyCache = {};
          for (let _pi = 0; _pi < _listResults.length; _pi++) {
            const items = _listResults[_pi];
            const _prefix = _prefixes[_pi];
            for (const item of items) {
              if (_isDupe(seenSizes, seenTitles, item)) continue;
              const isVid = isVideoFile(item.name);
              const key = isVid ? videoKey(folder, subfolder, item.name) : null;
              const stats = key ? (shortStats[key] || { views: 0, likes: 0, dislikes: 0 }) : {};
              const _ck = `${tier}:${folder}:${subfolder}:${item.name}`;
              global._mediaKeyCache[_ck] = { key: _prefix + item.name, ts: Date.now() };
              _cacheEntries.push({ k: _ck, v: _prefix + item.name });
              allFiles.push({
                name: item.name,
                type: isVid ? 'video' : 'image',
                src: `/media?folder=${encodeURIComponent(folder)}&subfolder=${encodeURIComponent(subfolder)}&name=${encodeURIComponent(item.name)}`,
                ...(isVid ? { thumb: _thumbUrl(folder, subfolder, item.name) } : {}),
                size: item.size || 0,
                lastModified: item.lastModified || 0,
                duration: isVid ? _getDuration(folder, subfolder, item.name) : 0,
                folder,
                subfolder,
                category: folder,
                uploader: uploaderMap.get(item.name) || null,
                ...(key ? { videoKey: key, views: stats.views || 0, likes: stats.likes || 0, dislikes: stats.dislikes || 0 } : {}),
              });
            }
          }
          global._listCache[_listCacheKey] = { files: allFiles, _cacheEntries, ts: Date.now() };
          return sendJson(res, 200, { type: 'files', files: allFiles });
        }
        // No subfolder — return ALL omegle videos flat with subfolder tags
        const allFiles = [];
        const seenSizes = new Set();
        const seenTitles = new Set();
        // Fetch all subfolder+tier combos in parallel
        const _omPrefixes = [];
        for (const sf of OMEGLE_SUBFOLDERS) {
          for (const tf of tierFolders) {
            _omPrefixes.push({ sf, prefix: basePath + '/' + tf + '/' + sf + '/' });
          }
        }
        const _omResults = await Promise.all(_omPrefixes.map(({ prefix }) => R2_ENABLED ? r2ListMediaFilesFromPrefix(prefix).catch(() => []) : Promise.resolve([])));
        if (!global._mediaKeyCache) global._mediaKeyCache = {};
        for (let i = 0; i < _omPrefixes.length; i++) {
          const sf = _omPrefixes[i].sf;
          const _prefix = _omPrefixes[i].prefix;
          const items = _omResults[i];
          for (const item of items) {
            if (_isDupe(seenSizes, seenTitles, item)) continue;
            const isVid = isVideoFile(item.name);
            const key = isVid ? videoKey(folder, sf, item.name) : null;
            const stats = key ? (shortStats[key] || { views: 0, likes: 0, dislikes: 0 }) : {};
            const _ck = `${tier}:${folder}:${sf}:${item.name}`;
            global._mediaKeyCache[_ck] = { key: _prefix + item.name, ts: Date.now() };
            _cacheEntries.push({ k: _ck, v: _prefix + item.name });
            allFiles.push({
              name: item.name,
              type: isVid ? 'video' : 'image',
              src: `/media?folder=${encodeURIComponent(folder)}&subfolder=${encodeURIComponent(sf)}&name=${encodeURIComponent(item.name)}`,
              ...(isVid ? { thumb: _thumbUrl(folder, sf, item.name) } : {}),
              size: item.size || 0,
              lastModified: item.lastModified || 0,
              duration: isVid ? _getDuration(folder, sf, item.name) : 0,
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

      // Non-omegle: tier 2 gets both tiers, tier 1 gets tier 1 only, deduped
      const allFiles = [];
      const seenSizes = new Set();
      const seenTitles = new Set();
      // Fetch all tier folders in parallel
      const _tfPrefixes = tierFolders.map(tf => basePath + '/' + tf + '/');
      const _tfResults = await Promise.all(_tfPrefixes.map(p => R2_ENABLED ? r2ListMediaFilesFromPrefix(p).catch(() => []) : Promise.resolve([])));
      if (!global._mediaKeyCache) global._mediaKeyCache = {};
      for (let _ti = 0; _ti < _tfResults.length; _ti++) {
        const items = _tfResults[_ti];
        const _prefix = _tfPrefixes[_ti];
        for (const item of items) {
          if (_isDupe(seenSizes, seenTitles, item)) continue;
          const isVid = isVideoFile(item.name);
          const key = isVid ? videoKey(folder, '', item.name) : null;
          const stats = key ? (shortStats[key] || { views: 0, likes: 0, dislikes: 0 }) : {};
          const _ck = `${tier}:${folder}::${item.name}`;
          global._mediaKeyCache[_ck] = { key: _prefix + item.name, ts: Date.now() };
          _cacheEntries.push({ k: _ck, v: _prefix + item.name });
          allFiles.push({
            name: item.name,
            type: isVid ? 'video' : 'image',
            src: `/media?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(item.name)}`,
            ...(isVid ? { thumb: _thumbUrl(folder, '', item.name) } : {}),
            size: item.size || 0,
            lastModified: item.lastModified || 0,
            duration: isVid ? _getDuration(folder, '', item.name) : 0,
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
        setImmediate(() => {
          const uncached = files.filter(f => f.type === 'video' && !_thumbCacheGet(_thumbCacheKey(f.folder, f.subfolder || '', f.name)));
          if (uncached.length === 0) return;
          // Generate all uncached thumbnails in background
          for (const item of uncached) {
            const ck = _thumbCacheKey(item.folder, item.subfolder || '', item.name);
            if (_thumbInFlight[ck]) continue; // already in progress
            const tierCandidates = (getEffectiveTierForUser(u) >= 2) ? ['tier 2', 'tier 1'] : ['tier 1'];
            const bp = allowedFolders.get(item.folder);
            if (!bp) continue;
            (async () => {
              try {
                let vUrl = null;
                for (const tf of tierCandidates) {
                  let ok;
                  if (item.folder === 'Omegle' && item.subfolder) {
                    ok = bp + '/' + tf + '/' + item.subfolder + '/' + item.name;
                  } else {
                    ok = bp + '/' + tf + '/' + item.name;
                  }
                  const exists = await r2HeadObject(ok);
                  if (exists) { vUrl = r2PresignedUrl(ok, 120); break; }
                }
                if (!vUrl) return;
                const buf = await generateThumbnail(vUrl, item.name);
                if (buf) {
                  _thumbCacheSet(ck, buf);
                  const dp = _thumbDiskPath(item.folder, item.subfolder || '', item.name);
                  fs.writeFile(dp, buf, () => {});
                }
              } catch {}
            })();
          }
        });
      }

      return sendJson(res, 200, { type: 'files', files });
    }


    // ── Email preferences ──
    if (requestUrl.pathname === '/api/email/preferences') {
      if (req.method === 'POST') {
        const userKey = getAuthedUserKey(req);
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
      const userKey = getAuthedUserKey(req);
      if (!userKey) return sendJson(res, 401, { error: 'Not authenticated' });
      const db = await getOrLoadUsersDb();
      const u = db.users[userKey];
      return sendJson(res, 200, { prefs: (u && u.emailPrefs) || { weeklyDigest: false, newContent: false } });
    }

    // ── Shorts stats APIs ────────────────────────────────────────────────────

    // GET /api/shorts/stats — returns all short stats (strip internal _votes data)
    if (requestUrl.pathname === '/api/shorts/stats') {
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
      const likeUserKey = getAuthedUserKey(req);
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

      const limit = Math.min(50, Math.max(1, parseInt(requestUrl.searchParams.get('limit') || '50', 10) || 50));
      const offset = Math.max(0, parseInt(requestUrl.searchParams.get('offset') || '0', 10) || 0);
      const sort = (requestUrl.searchParams.get('sort') || 'name').toLowerCase();
      const order = (requestUrl.searchParams.get('order') || 'asc').toLowerCase();
      const categories = requestUrl.searchParams.getAll('category').map((c) => (c || '').trim()).filter(Boolean);
      const search = (requestUrl.searchParams.get('search') || '').trim().toLowerCase();
      const random = requestUrl.searchParams.get('random') === '1';

      if (!R2_ENABLED) return sendJson(res, 200, { files: [], total: 0 });

      const tierFolders = tier >= 2 ? ['tier 2', 'tier 1'] : ['tier 1'];
      const cacheKey = tierFolders.join('+') + (categories.length ? ':' + categories.sort().join(',') : '');
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
            for (const tf of tierFolders) {
              const prefix = basePath + '/' + tf + '/' + subfolder + '/';
              try {
                const items = await r2ListMediaFilesFromPrefix(prefix);
                for (const item of items) {
                  if (!isVideoFile(item.name)) continue;
                  // Server-side dedupe by near-exact file size (0.1% tolerance)
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
        } else {
          for (const tf of tierFolders) {
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
      const page = filtered.slice(offset, offset + limit).map(f => ({
        ...f,
        thumb: '/thumbnail?folder=' + encodeURIComponent(f.folder || '') + '&name=' + encodeURIComponent(f.name) + (f.subfolder ? '&subfolder=' + encodeURIComponent(f.subfolder) : ''),
      }));
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
      const commentUserKey = getAuthedUserKey(req);
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
      const voteUserKey = getAuthedUserKey(req);
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
      const replyUserKey = getAuthedUserKey(req);
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
      const statsUserKey = getAuthedUserKey(req);
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
          voteUserKey = getAuthedUserKey(req);
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
        const videoId = f.videoId || canonicalVideoId(f.folder, f.subfolder || '', f.name);
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
      return out;
    }

    // GET /api/recommendations — personalized recommendations by surface/context.
    if (requestUrl.pathname === '/api/recommendations') {
      await ensureShortStatsFresh();
      const identity = ensureIdentity(req, res);
      const limit = Math.min(30, Math.max(1, parseInt(requestUrl.searchParams.get('limit') || '12', 10) || 12));
      const surface = (requestUrl.searchParams.get('surface') || 'home').toLowerCase();
      const contextVideoId = requestUrl.searchParams.get('contextVideoId') || '';
      const contextFolder = requestUrl.searchParams.get('contextFolder') || '';
      let allFiles = enrichPreviewFilesWithLiveStats(previewFileList.slice());
      maybeRebuildRecoGlobalStats();
      const ranked = rankRecommendationFiles(identity, allFiles, { limit, surface, contextVideoId, contextFolder });

      const slice = ranked.slice(0, limit).map(f => {
        const out = Object.assign({}, f);
        if (isVideoFile(f.name)) {
          out.thumb = '/thumbnail?folder=' + encodeURIComponent(f.folder || '') + '&name=' + encodeURIComponent(f.name) + (f.subfolder ? '&subfolder=' + encodeURIComponent(f.subfolder) : '');
        }
        out.recoScore = Number(f._score || 0);
        return out;
      });
      return sendJson(res, 200, { files: slice });
    }

    if (requestUrl.pathname === '/api/recommendations/related') {
      await ensureShortStatsFresh();
      const identity = ensureIdentity(req, res);
      const videoId = requestUrl.searchParams.get('videoId') || '';
      if (!videoId) return sendJson(res, 400, { error: 'Missing videoId' });
      const limit = Math.min(30, Math.max(1, parseInt(requestUrl.searchParams.get('limit') || '8', 10) || 8));
      const allFiles = enrichPreviewFilesWithLiveStats(previewFileList.slice()).filter((f) => {
        const id = f.videoId || canonicalVideoId(f.folder, f.subfolder || '', f.name);
        return id !== videoId;
      });
      maybeRebuildRecoGlobalStats();
      const ranked = rankRecommendationFiles(identity, allFiles, { limit, surface: 'video', contextVideoId: videoId });
      const slice = ranked.slice(0, limit).map((f) => {
        const out = Object.assign({}, f);
        if (isVideoFile(f.name)) {
          out.thumb = '/thumbnail?folder=' + encodeURIComponent(f.folder || '') + '&name=' + encodeURIComponent(f.name) + (f.subfolder ? '&subfolder=' + encodeURIComponent(f.subfolder) : '');
        }
        return out;
      });
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
      const limit = Math.min(30, Math.max(1, parseInt(requestUrl.searchParams.get('limit') || '12', 10) || 12));
      let allFiles = enrichPreviewFilesWithLiveStats(previewFileList.slice());
      allFiles.sort((a, b) => (b.views || 0) - (a.views || 0));
      const slice = allFiles.slice(0, limit).map(f => {
        const out = Object.assign({}, f);
        out.isTrending = true;
        if (isVideoFile(f.name)) {
          out.thumb = '/thumbnail?folder=' + encodeURIComponent(f.folder || '') + '&name=' + encodeURIComponent(f.name) + (f.subfolder ? '&subfolder=' + encodeURIComponent(f.subfolder) : '');
        }
        return out;
      });
      return sendJson(res, 200, { files: slice });
    }

    // GET /api/newest — most recently added videos
    if (requestUrl.pathname === '/api/newest') {
      await ensureShortStatsFresh();
      const limit = Math.min(30, Math.max(1, parseInt(requestUrl.searchParams.get('limit') || '12', 10) || 12));
      let allFiles = enrichPreviewFilesWithLiveStats(previewFileList.slice());
      // Sort by lastModified desc (newest first)
      allFiles.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
      const slice = allFiles.slice(0, limit).map(f => {
        const out = Object.assign({}, f);
        out.isNew = true;
        if (isVideoFile(f.name)) {
          out.thumb = '/thumbnail?folder=' + encodeURIComponent(f.folder || '') + '&name=' + encodeURIComponent(f.name) + (f.subfolder ? '&subfolder=' + encodeURIComponent(f.subfolder) : '');
        }
        return out;
      });
      return sendJson(res, 200, { files: slice });
    }

    // GET /api/random-videos — returns preview videos from all folders (no auth)
    // Supports: ?sort=views|random|top_random (default views), ?page=0, ?limit=30, ?topPercent=5
    if (requestUrl.pathname === '/api/random-videos') {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') return sendJson(res, 405, { error: 'Method Not Allowed' });
      const limit = Math.min(50, Math.max(1, parseInt(requestUrl.searchParams.get('limit') || '30', 10) || 30));
      const page = Math.max(0, parseInt(requestUrl.searchParams.get('page') || '0', 10) || 0);
      const sort = (requestUrl.searchParams.get('sort') || 'views').toLowerCase();
      const topPercent = Math.min(50, Math.max(1, parseFloat(requestUrl.searchParams.get('topPercent') || '5') || 5));

      if (!R2_ENABLED) return sendJson(res, 200, { files: [], totalPages: 0 });

      await ensureShortStatsFresh();
      // Use pre-built list; views/likes merged from shortStats so counts stay current between cache rebuilds
      let allFiles = enrichPreviewFilesWithLiveStats(previewFileList.slice());
      if (sort === 'views') {
        allFiles.sort((a, b) => (b.views || 0) - (a.views || 0));
      } else if (sort === 'top_random') {
        allFiles.sort((a, b) => (b.views || 0) - (a.views || 0));
        const cutoff = Math.max(1, Math.ceil(allFiles.length * (topPercent / 100)));
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
          out.thumb = '/thumbnail?folder=' + encodeURIComponent(f.folder || '') + '&name=' + encodeURIComponent(f.name) + (f.subfolder ? '&subfolder=' + encodeURIComponent(f.subfolder) : '');
        }
        return out;
      });
      return sendJson(res, 200, { files: slice, totalPages, page });
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
      const result = CREATORS.map((c) => ({
        slug: c.slug,
        name: c.name,
        thumbUrl: R2_ENABLED
          ? r2PresignedUrl(`porn/onlyfans/thumbnails/${c.slug}${c.ext}`, 3600)
          : null,
      }));
      res.setHeader('Cache-Control', 'public, max-age=300');
      return sendJson(res, 200, { creators: result });
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
      if (global._staticFileCache) Object.keys(global._staticFileCache).forEach(k => delete global._staticFileCache[k]);
      if (global._videoListCache) Object.keys(global._videoListCache).forEach(k => delete global._videoListCache[k]);
      Object.keys(previewUrlMap).forEach(k => delete previewUrlMap[k]);
      previewFileList = [];
      buildPreviewCache().catch(e => console.error('[cache-bust] rebuild error:', e && e.message ? e.message : e));
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
        res.writeHead(302, { Location: '/images/face.png' });
        res.end();
      }
      return;
    }

    // API: preview list (no auth). Returns files from the previews/ subfolder.
    if (requestUrl.pathname === '/api/preview/list') {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') return sendJson(res, 405, { error: 'Method Not Allowed' });
      const folder = requestUrl.searchParams.get('folder') || '';
      const basePath = allowedFolders.get(folder);
      if (!basePath) return sendJson(res, 400, { error: 'Invalid folder' });

      // Allow cache bust via ?fresh=1
      const prefix = basePath + '/previews/';
      if (requestUrl.searchParams.get('fresh') === '1') {
        delete _r2ListCache[prefix];
      }
      const items = R2_ENABLED ? await r2ListMediaFilesFromPrefix(prefix) : [];
      const files = items.map((item) => {
        const isVid = isVideoFile(item.name);
        const key = isVid ? videoKey(folder, '', item.name) : null;
        const stats = key ? (shortStats[key] || { views: 0, likes: 0, dislikes: 0 }) : {};
        const commentCount = key ? (videoComments[key] || []).length : 0;
        return {
          name: item.name,
          type: isVid ? 'video' : 'image',
          src: `/preview-media?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(item.name)}`,
          ...(isVid ? { thumb: `/thumbnail?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(item.name)}` } : {}),
          size: item.size || 0,
          duration: isVid ? _getDuration(folder, 'previews', item.name) : 0,
          folder,
          ...(key ? { videoKey: key, views: stats.views || 0, likes: stats.likes || 0, dislikes: stats.dislikes || 0, commentCount } : {}),
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
      if (!name) return sendText(res, 400, 'Missing name');

      // Build cache key — with folder context or legacy (preview-only)
      const cacheKey = folder ? _thumbCacheKey(folder, subfolder, name) : name;
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
          const exists = await r2HeadObject(r2Key);
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
        // Fast path: check pre-warmed media key cache (populated by /api/list)
        if (global._mediaKeyCache) {
          for (const tier of [2, 1]) {
            const mk = `${tier}:${folder}:${subfolder}:${name}`;
            const cached = global._mediaKeyCache[mk];
            if (cached && (Date.now() - cached.ts < 300000)) {
              videoUrl = r2PresignedUrl(cached.key, 120);
              break;
            }
          }
        }
        // Slow fallback: HEAD requests to find the right tier folder (cached)
        if (!videoUrl) {
          if (!global._tierLookupCache) global._tierLookupCache = {};
          const tlKey = `${folder}:${subfolder}:${name}`;
          const tlCached = global._tierLookupCache[tlKey];
          if (tlCached && (Date.now() - tlCached.ts < 600000)) {
            videoUrl = r2PresignedUrl(tlCached.objectKey, 120);
          } else {
            const basePath = allowedFolders.get(folder);
            if (basePath) {
              const tierCandidates = ['tier 2', 'tier 1'];
              for (const tf of tierCandidates) {
                let objectKey;
                if (folder === 'Omegle' && subfolder) {
                  objectKey = basePath + '/' + tf + '/' + subfolder + '/' + name;
                } else {
                  objectKey = basePath + '/' + tf + '/' + name;
                }
                try {
                  const exists = await r2HeadObject(objectKey);
                  if (exists) {
                    global._tierLookupCache[tlKey] = { objectKey, ts: Date.now() };
                    videoUrl = r2PresignedUrl(objectKey, 120);
                    break;
                  }
                } catch { /* try next tier */ }
              }
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

      // NON-BLOCKING: Return placeholder immediately, generate in background
      // This prevents 15+ thumbnail requests from hanging the server
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': PLACEHOLDER_THUMB.length,
        'Cache-Control': 'no-cache, max-age=0',
        'X-Thumb-Status': 'generating',
      });
      res.end(PLACEHOLDER_THUMB);

      // Queue background generation (deduplicated)
      if (!_thumbInFlight[cacheKey]) {
        const genPromise = generateThumbnail(videoUrl, name).then(genBuf => {
          delete _thumbInFlight[cacheKey];
          if (genBuf) {
            _thumbCacheSet(cacheKey, genBuf);
            const diskPath = folder ? _thumbDiskPath(folder, subfolder, name) : _thumbDiskPathLegacy(name);
            fs.writeFile(diskPath, genBuf, () => {});
          }
          return genBuf;
        }).catch(e => { delete _thumbInFlight[cacheKey]; return null; });
        _thumbInFlight[cacheKey] = genPromise;
      }
      return;
    }

    // Media serving for previews (no auth) — always generate fresh presigned URL
    // (r2PresignedUrl is local crypto, no network call — safe to call per-request)
    if (requestUrl.pathname === '/preview-media') {
      const folder = requestUrl.searchParams.get('folder') || '';
      const name = requestUrl.searchParams.get('name') || '';
      if (!folder || !name) return sendText(res, 400, 'Missing params');

      const basePath = allowedFolders.get(folder);
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

    // Media serving (authenticated, tier-gated)
    // Cache resolved R2 object keys to skip expensive HEAD requests (5-minute TTL)
    if (!global._mediaKeyCache) global._mediaKeyCache = {};
    const _MEDIA_KEY_TTL = 300000; // 5 minutes
    if (requestUrl.pathname === '/media') {
      const authed = await requireAuthedUser(req, res);
      if (!authed) return;
      const { record: u } = authed;

      const folder = requestUrl.searchParams.get('folder') || '';
      const subfolder = requestUrl.searchParams.get('subfolder') || '';
      const name = requestUrl.searchParams.get('name') || '';

      const basePath = allowedFolders.get(folder);
      if (!basePath) return sendText(res, 400, 'Invalid folder');
      if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) return sendText(res, 400, 'Invalid file');
      if (!isAllowedMediaFile(name)) return sendText(res, 403, 'Forbidden');

      const tier = getEffectiveTierForUser(u);
      if (tier < 1) return sendText(res, 403, 'Tier required');

      if (folder === 'Omegle' && subfolder && !OMEGLE_SUBFOLDERS.includes(subfolder)) {
        return sendText(res, 400, 'Invalid subfolder');
      }

      // Check cache for resolved object key (avoids HEAD requests)
      const mediaCacheKey = `${tier}:${folder}:${subfolder}:${name}`;
      const cachedKey = global._mediaKeyCache[mediaCacheKey];
      let objectKey;

      if (cachedKey && (Date.now() - cachedKey.ts < _MEDIA_KEY_TTL)) {
        objectKey = cachedKey.key;
      } else {
        // Tier 2 can access both tier 2 and tier 1 files; try user's tier first, fall back
        const tierCandidates = tier >= 2 ? ['tier 2', 'tier 1'] : ['tier 1'];
        if (folder === 'Omegle' && subfolder) {
          for (const tf of tierCandidates) {
            objectKey = basePath + '/' + tf + '/' + subfolder + '/' + name;
            if (R2_ENABLED) {
              try {
                const exists = await r2HeadObject(objectKey);
                if (exists) break;
              } catch { /* try next */ }
            }
          }
        } else {
          for (const tf of tierCandidates) {
            objectKey = basePath + '/' + tf + '/' + name;
            if (R2_ENABLED) {
              try {
                const exists = await r2HeadObject(objectKey);
                if (exists) break;
              } catch { /* try next */ }
            }
          }
        }
        // Cache the resolved key
        global._mediaKeyCache[mediaCacheKey] = { key: objectKey, ts: Date.now() };
      }

      if (R2_ENABLED) {
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

    // ── Upload video endpoint ──────────────────────────────────────────────
    if (requestUrl.pathname === '/api/upload') {
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
      if (!allowedFolders.has(category)) return sendJson(res, 400, { error: 'Invalid category' });
      if (category === 'Omegle' && subfolder && !OMEGLE_SUBFOLDERS.includes(subfolder)) {
        return sendJson(res, 400, { error: 'Invalid subfolder' });
      }

      const origExt = path.extname(videoPart.filename || '').toLowerCase();
      if (!videoExts.has(origExt)) return sendJson(res, 400, { error: 'Invalid video format' });

      const id = crypto.randomUUID();
      const sanitizedName = videoName.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_').slice(0, 40);
      const categorySlug = CATEGORY_SLUG_MAP[category] || category.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const baseKey = `categories/${categorySlug}/${id}`;
      const r2TempKey = `${baseKey}/source${origExt}`;
      const output720Key = `${baseKey}/720p.mp4`;

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
          const catRow = await ensureCategoryRow(categorySlug, category);
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
                category_id: catRow.id,
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
                mp4_720_object_key: output720Key,
              }]),
            });
            await supabaseJson('/rest/v1/transcode_jobs', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Prefer: 'return=minimal',
              },
              body: JSON.stringify([{
                video_id: id,
                category_slug: categorySlug,
                source_object_key: r2TempKey,
                output_720_object_key: output720Key,
                status: 'pending',
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

      return sendJson(res, 200, { ok: true, id, sourceObjectKey: r2TempKey, output720ObjectKey: output720Key, categorySlug });
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
          xml += '      <video:description>' + xmlEsc('Watch ' + vTitle + ' - ' + pf.folder + ' on Pornyard. Free HD videos updated daily.') + '</video:description>\n';
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
      '/upload': '/upload.html',
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
        '/face.png': '/images/face.png',
        '/preview.png': '/images/preview.jpg',
        '/top_preview.png': '/images/top_preview.png',
        '/checkout-images/image1.png': '/images/checkout/image1.png',
        '/checkout-images/image2.png': '/images/checkout/image2.jpg',
        '/checkout-images/image3.png': '/images/checkout/image3.jpg',
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
      const userKey = getAuthedUserKey(req);
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
      if (pathname.startsWith('/assets/') || pathname === '/whitney-fonts.css' || pathname.startsWith('/fonts/')) {
        const _rel = pathname.replace(/^\/+/, '');
        const _assetPath = path.normalize(path.join(_clientDist, _rel));
        if (_assetPath.startsWith(path.normalize(_clientDist + path.sep))) {
          try {
            const _st = await fs.promises.stat(_assetPath);
            if (_st.isFile()) {
              const _raw = await fs.promises.readFile(_assetPath);
              const _ct = getContentType(_assetPath);
              res.writeHead(200, { 'Content-Type': _ct, 'Cache-Control': 'public, max-age=31536000, immutable' });
              return res.end(_methodUp === 'HEAD' ? Buffer.alloc(0) : _raw);
            }
          } catch (_) {}
        }
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Not Found');
      }
      if (requestUrl.pathname === '/admin' || !requestUrl.pathname.startsWith('/admin')) {
        const _SPA_HTML_PAGES = new Set([
          '/index.html', '/folder.html', '/video.html', '/shorts.html', '/custom-requests.html',
          '/categories.html', '/live-cams.html', '/blog.html', '/login.html', '/signup.html',
          '/create-account.html', '/upload.html', '/search.html', '/access.html',
          '/5e213853413a598023a5583149f32445.html',
        ]);
        const _SPA_CLEAN_PATHS = new Set([
          '/shorts', '/search', '/categories', '/upload', '/login', '/signup', '/checkout', '/premium',
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

    if (
      !STATIC_ALLOWLIST.has(requestUrl.pathname) &&
      !STATIC_ALLOWLIST.has(pathname) &&
      !pathname.startsWith('/fonts/') &&
      !pathname.startsWith('/thumbnails/') &&
      !pathname.startsWith('/images/')
    ) {
      // Return proper 404 for unknown pages (302 redirects cause soft-404 issues in Google Search Console)
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>404 — Pornyard</title><meta name="robots" content="noindex"><link rel="stylesheet" href="/whitney-fonts.css"></head><body style="background:#0a0a0f;color:#ccc;font-family:\'Whitney\',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center"><div><h1 style="font-size:48px;margin-bottom:16px">404</h1><p style="font-size:18px;margin-bottom:24px">Page not found</p><a href="/" style="color:#c084fc;font-size:16px">Back to Pornyard</a></div></body></html>');
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
          'Omegle': { title: 'Omegle Wins & OmeTV Flashes — Free HD Archive', desc: 'Thousands of Omegle wins, OmeTV flashes, MiniChat reactions and Monkey App clips — sorted by category, updated daily. Free HD on Pornyard.', kw: 'omegle wins, omegle flash, omegle reactions, omegle girls, ometv wins, ometv flash, ometv reactions, minichat wins, minichat flash, monkey app wins, omegle points game, chat roulette wins, omegle compilation' },
          'IRL Dick Flashing': { title: 'IRL Dick Flashing — Real Public Flash Reactions', desc: 'Real IRL dick flashing videos — public, outdoor, beach, car, store. Genuine reactions caught on camera. Free HD updated daily on Pornyard.', kw: 'irl dick flashing, dick flash public, exhibitionist, public nudity, outdoor flash, caught in public, public flashing' },
          'TikTok': { title: 'TikTok Porn & Leaks — Banned NSFW TikToks', desc: 'Leaked TikTok nudes, banned TikTok videos, viral thirst traps and NSFW TikTok content. Hundreds of clips, free HD on Pornyard.', kw: 'tiktok porn, tiktok leaks, tiktok nudes, banned tiktok, tiktok nsfw, tiktok thirst traps, leaked tiktok' },
          'Snapchat': { title: 'Snapchat Leaks 2026 — Premium Snap Nudes & Stories', desc: 'Leaked Snapchat nudes, premium snap stories and amateur snap content. Fresh leaks added daily — free HD on Pornyard.', kw: 'snapchat leaks, premium snapchat, snapchat porn, snapchat nudes, snapchat stories, premium snap leaks, snap leaks 2026' },
          'Live Slips': { title: 'Live Slips — Wardrobe Malfunctions & Nip Slips', desc: 'Real wardrobe malfunctions, accidental nip slips and on-air flash moments captured live. HD compilations updated daily on Pornyard.', kw: 'live slips, wardrobe malfunctions, nip slips, accidental flash, on-air slip, broadcast malfunction' },
          'Feet': { title: 'Foot Fetish — Soles, Toes & Feet Worship Videos', desc: 'Foot fetish videos, sole worship, toe content and amateur feet content — HD quality, updated daily on Pornyard.', kw: 'feet, foot fetish, feet videos, feet pics, sole worship, toe fetish, foot content' },
          'Real Couples': { title: 'Real Couples Porn — Amateur Homemade Sex Tapes', desc: 'Verified amateur couples, homemade sex tapes and genuine real-couple content. Free HD videos updated daily on Pornyard.', kw: 'real couples porn, amateur couples, homemade sex tape, real couple porn, amateur homemade, verified amateur' },
          'College': { title: 'College Porn — Real Dorm & Campus Amateurs', desc: 'College porn — dorm-room amateurs, frat parties, campus hookups and real student content. Free HD updated daily on Pornyard.', kw: 'college porn, college girls, dorm porn, campus amateur, college amateur' },
        };
        const seoData = SEO_META[seoFolder] || { title: seoTitle + ' Porn — Free HD Videos', desc: 'Browse ' + seoTitle + ' videos on Pornyard. Watch the best ' + seoTitle + ' content free in HD.', kw: seoTitle.toLowerCase() + ', pornyard' };
        const fullTitle = escHtml((seoData.title || (seoTitle + ' — Pornyard | Free HD Videos')) + ' | Pornyard');
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
        const CANONICAL_CLEAN = { 'Omegle': '/omegle-wins', 'IRL Dick Flashing': '/irl-dick-flashing', 'TikTok': '/tiktok-porn', 'Snapchat': '/snapchat-leaks', 'Live Slips': '/live-slips', 'Feet': '/foot-fetish' };
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
          'Omegle': '<section class="seo-ssr-content" style="padding:20px 24px;max-width:900px;margin:0 auto;color:rgba(255,255,255,0.85);font-size:15px;line-height:1.7"><h1>Omegle Wins — Best Omegle Flashing, Reactions & Compilations</h1><p>Welcome to the largest archive of <strong>Omegle wins</strong> on the internet. Browse thousands of HD videos featuring the best <strong>Omegle flashing</strong>, <strong>Omegle girls showing on cam</strong>, hilarious <strong>Omegle dick reactions</strong>, and intense <strong>Omegle points game</strong> highlights. Our collection also includes <strong>OmeTV wins</strong>, <strong>OmeTV flash</strong> reactions, <strong>MiniChat wins</strong>, and <strong>Monkey App</strong> clips.</p><p>Whether you\'re looking for <strong>Omegle compilations</strong>, <strong>chat roulette wins</strong>, or the funniest <strong>Omegle reactions</strong> — Pornyard has the best selection, updated daily with new content. All videos are in HD quality and free to watch with a Pornyard account.</p><h2>Popular Omegle Categories</h2><ul><li><a href="/omegle-wins?subfolder=Dick+Reactions">Omegle Dick Reactions</a> — Watch girls\' real reactions</li><li><a href="/omegle-wins?subfolder=Monkey+App+Streamers">Monkey App Streamers</a> — Best Monkey App wins</li><li><a href="/omegle-wins?subfolder=Points+Game">Omegle Points Game</a> — Points game highlights</li><li><a href="/omegle-wins?subfolder=Regular+Wins">Regular Omegle Wins</a> — Classic Omegle moments</li></ul><h2>What Are Omegle Wins?</h2><p>Omegle wins refer to memorable or exciting moments captured during random video chats on Omegle, OmeTV, MiniChat, and similar platforms. These include flashing reactions, funny encounters, and unexpected reveals. Since Omegle shut down in 2023, these archived videos have become increasingly popular and rare.</p></section>',
          'IRL Dick Flashing': '<section class="seo-ssr-content" style="padding:20px 24px;max-width:900px;margin:0 auto;color:rgba(255,255,255,0.85);font-size:15px;line-height:1.7"><h1>IRL Dick Flashing — Public Flash & Exhibitionist Videos</h1><p>Watch real <strong>IRL dick flashing</strong> videos — <strong>public flashing</strong> in malls, parks, beaches, and restaurants. Genuine amateur <strong>exhibitionist content</strong> featuring outdoor flashing, car flashing, and caught-in-public moments. All in HD quality on Pornyard.</p></section>',
          'TikTok': '<section class="seo-ssr-content" style="padding:20px 24px;max-width:900px;margin:0 auto;color:rgba(255,255,255,0.85);font-size:15px;line-height:1.7"><h1>TikTok Porn — Leaked TikTok Nudes, NSFW TikTok & TikTok Thots</h1><p>Watch the hottest <strong>TikTok porn</strong> and <strong>leaked TikTok videos</strong>. Browse <strong>TikTok nudes</strong>, <strong>banned TikTok videos</strong>, <strong>TikTok NSFW</strong> content, viral <strong>TikTok thirst traps</strong>, and trending adult content from popular creators. Updated daily on Pornyard.</p></section>',
          'Snapchat': '<section class="seo-ssr-content" style="padding:20px 24px;max-width:900px;margin:0 auto;color:rgba(255,255,255,0.85);font-size:15px;line-height:1.7"><h1>Snapchat Leaks — Premium Snapchat Porn & Nudes</h1><p>Browse <strong>premium Snapchat leaks</strong> and short-form adult content curated into one place. <strong>Snapchat porn</strong>, <strong>Snapchat nudes</strong>, quick clips, and phone-shot amateur content — all on Pornyard.</p></section>',
          'Live Slips': '<section class="seo-ssr-content" style="padding:20px 24px;max-width:900px;margin:0 auto;color:rgba(255,255,255,0.85);font-size:15px;line-height:1.7"><h1>Live Slips — Wardrobe Malfunctions & Accidental Flashing</h1><p>Watch authentic <strong>wardrobe malfunctions</strong>, <strong>accidental flashing</strong>, and unexpected <strong>slip moments</strong> captured on camera. Browse genuine <strong>live slips</strong>, <strong>nip slips</strong>, broadcast malfunctions, and candid caught-on-camera moments from real events. All in HD quality on Pornyard.</p></section>',
          'Feet': '<section class="seo-ssr-content" style="padding:20px 24px;max-width:900px;margin:0 auto;color:rgba(255,255,255,0.85);font-size:15px;line-height:1.7"><h1>Foot Fetish — Feet Videos, Soles, Toes & Feet Worship</h1><p>Browse the best <strong>foot fetish</strong> content — <strong>feet videos</strong>, <strong>feet pics</strong>, <strong>sole worship</strong>, <strong>toe content</strong>, and amateur feet worship videos. HD quality foot fetish videos updated daily on Pornyard.</p></section>',
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
        const vFullTitle = escHtml(vCleanTitle + ' — ' + vFolder + ' | Pornyard');
        const vCatLabel = escHtml(vSub ? vFolder + ' — ' + vSub : vFolder);

        const VIDEO_SEO_DESC = {
          'Omegle': 'omegle wins, omegle flash, omegle reactions',
          'IRL Dick Flashing': 'irl dick flashing, public flash',
          'TikTok': 'tiktok porn, tiktok leaks, tiktok nudes',
          'Snapchat': 'snapchat leaks, snapchat porn',
          'Feet': 'feet, foot fetish, feet videos',
        };
        const vKw = escHtml((VIDEO_SEO_DESC[vFolder] || vFolder.toLowerCase()) + ', ' + vCleanTitle.toLowerCase() + ', pornyard');
        const vDesc = escHtml('Watch ' + vCleanTitle + ' - ' + vCatLabel + ' on Pornyard. Free ' + vCatLabel + ' videos. ' + vViews.toLocaleString() + ' views.');

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
            "name": "Pornyard",
            "url": origin + '/',
            "logo": { "@type": "ImageObject", "url": origin + '/images/face.png' }
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
          + '<p>Watch <strong>' + _he(vCleanTitle) + '</strong> in HD quality on Pornyard. This ' + _he(vCatLabel) + ' video is part of our curated collection of ' + vCatDesc + '. Free to watch, updated daily.</p>'
          + '<p>Pornyard features the internet\'s largest archive of ' + vCatDesc + '. All videos are in HD quality and free to stream.</p>'
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
