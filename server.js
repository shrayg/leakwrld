'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

function loadLocalEnv(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] != null) continue;
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    /* .env is optional in production; systemd/platform env can provide values. */
  }
}

loadLocalEnv(path.join(__dirname, '.env'));

const { Pool } = require('pg');
const {
  categoryNames,
  creators: fallbackCreators,
  readyCreators: fallbackReadyCreators,
  shorts: fallbackShorts,
} = require('./server/catalog');
const { generateReferralCode, normalizeReferralCode } = require('./server/referralCodes');
const adminHourly = require('./server/adminHourly');
const adminDashboard = require('./server/adminDashboard');
const adminUserActions = require('./server/adminUserActions');
const mediaAnalytics = require('./server/mediaAnalytics');
const { resolveCountryCode } = require('./server/geoCountry');

const thumbnailLookup = new Map(fallbackCreators.map((c) => [c.slug, c.thumbnail]));
const creatorBySlug = new Map(fallbackCreators.map((c) => [c.slug, c]));
const readySlugSet = new Set(fallbackReadyCreators.map((c) => c.slug));

function thumbnailFor(slug) {
  return thumbnailLookup.get(slug) || null;
}

const MEDIA_DIR = path.join(__dirname, 'client', 'public', 'media');
const MANIFEST_TIER_ACCESS = ['free', 'tier1', 'tier2', 'tier3'];
const FEED_FILTERS = [
  { slug: 'trending', name: 'Trending' },
  { slug: 'top-videos', name: 'Top videos' },
  { slug: 'featured', name: 'Featured' },
];
const FEED_FILTER_LABELS = new Map(FEED_FILTERS.map((filter) => [filter.slug, filter.name]));
const TIER_DISPLAY_LABELS = {
  free: 'Free',
  basic: 'Tier 1',
  tier1: 'Tier 1',
  premium: 'Tier 2',
  tier2: 'Tier 2',
  ultimate: 'Tier 3 / Ultimate',
  tier3: 'Tier 3',
  admin: 'Tier 3 / Ultimate',
};
const ACCOUNT_TIER_ALIASES = {
  free: 'free',
  tier1: 'basic',
  basic: 'basic',
  tier2: 'premium',
  premium: 'premium',
  tier3: 'ultimate',
  ultimate: 'ultimate',
  admin: 'admin',
};

function normalizeAccountTier(tier) {
  const key = String(tier || 'free').toLowerCase().replace(/[^a-z0-9]/g, '');
  return ACCOUNT_TIER_ALIASES[key] || 'free';
}

function userManifestTiers(user) {
  const tier = normalizeAccountTier(user?.tier || user);
  if (tier === 'admin' || tier === 'ultimate') return MANIFEST_TIER_ACCESS;
  if (tier === 'premium') return MANIFEST_TIER_ACCESS.slice(0, 3);
  if (tier === 'basic') return MANIFEST_TIER_ACCESS.slice(0, 2);
  return ['free'];
}

function accountTierLabel(tier) {
  return TIER_DISPLAY_LABELS[normalizeAccountTier(tier)] || 'Free';
}

function manifestTierFromParam(value) {
  const key = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!key) return '';
  if (key === 'free') return 'free';
  if (key === 'tier1' || key === 'basic') return 'tier1';
  if (key === 'tier2' || key === 'premium') return 'tier2';
  if (key === 'tier3' || key === 'ultimate') return 'tier3';
  return key;
}

function mediaStatsId(storageKey) {
  return mediaAnalytics.rowIdFromStorageKey(storageKey);
}

function stableHash(value) {
  let hash = 2166136261;
  const s = String(value || '');
  for (let i = 0; i < s.length; i += 1) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = stableHash(seed) || 0x9e3779b9;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(items, seed) {
  const out = items.slice();
  const rand = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function isShortsFeedMedia(item) {
  const ext = String(item?.ext || '').toLowerCase();
  return item?.kind === 'video' || ext === '.gif';
}

function r2ManifestTierFromKey(key) {
  const match = String(key || '').match(/^videos\/[^/]+\/(free|tier1|tier2|tier3)\//i);
  return match ? match[1].toLowerCase() : null;
}

function loadMediaManifest(slug) {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  try {
    const raw = fs.readFileSync(path.join(MEDIA_DIR, `${slug}.json`), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const R2_STATS_PATH = path.join(__dirname, 'data', 'r2-stats.json');
let r2StatsCache = null;
let r2StatsMtime = 0;

function loadR2Stats() {
  try {
    const stat = fs.statSync(R2_STATS_PATH);
    if (stat.mtimeMs !== r2StatsMtime) {
      r2StatsCache = JSON.parse(fs.readFileSync(R2_STATS_PATH, 'utf8'));
      r2StatsMtime = stat.mtimeMs;
    }
  } catch {
    r2StatsCache = null;
  }
  return r2StatsCache;
}

const PORT = Number(process.env.PORT || 3002);
const HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const SESSION_COOKIE = 'lw_session';
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.TBW_PEPPER || 'dev-session-secret-change-me';

/** Only send Secure cookies when explicitly enabled (HTTPS sites). Production HTTP behind nginx IP breaks login otherwise. */
function secureCookiesEnabled() {
  return String(process.env.SECURE_COOKIES || '').trim() === '1';
}
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 14);
const ONLINE_CAPACITY = Math.max(1, Number(process.env.ONLINE_CAPACITY || 100));
const SKIP_QUEUE_PRICE_CENTS = Math.max(0, Number(process.env.SKIP_QUEUE_PRICE_CENTS || 499));
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
/** VPS production: proxy `/r2/*` to Cloudflare Worker HTTPS origin (public URL, not a secret). */
const R2_WORKER_ORIGIN = String(process.env.R2_WORKER_ORIGIN || '').trim().replace(/\/+$/, '');

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim().slice(0, 64);
  const raw = req.socket?.remoteAddress || '';
  return String(raw).slice(0, 64);
}

function clientUserAgent(req) {
  return String(req.headers['user-agent'] || '').slice(0, 512);
}

function parseVisitorUuid(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) {
    return s;
  }
  return null;
}

/** After this many failed login/signup attempts per IP, enforce a short cooldown. */
const AUTH_THROTTLE_STRIKES = 3;
const AUTH_THROTTLE_COOLDOWN_MS = 5000;
const loginThrottle = new Map();
const signupThrottle = new Map();

function authThrottleSecondsLeft(map, ip) {
  const now = Date.now();
  const e = map.get(ip);
  if (!e?.lockedUntil) return 0;
  if (now >= e.lockedUntil) {
    map.delete(ip);
    return 0;
  }
  return Math.ceil((e.lockedUntil - now) / 1000);
}

function authThrottleReject(res, map, ip) {
  const sec = authThrottleSecondsLeft(map, ip);
  if (sec > 0) {
    sendJson(res, 429, {
      error: `Too many attempts. Wait ${sec}s and try again.`,
      retryAfterSeconds: sec,
    });
    return true;
  }
  return false;
}

/** Returns { locked, retryAfterSeconds? } — when locked, respond with 429 instead of the usual auth error. */
function authThrottleRegisterFailure(map, ip) {
  const now = Date.now();
  let e = map.get(ip);
  if (e?.lockedUntil && now < e.lockedUntil) {
    return { locked: true, retryAfterSeconds: Math.ceil((e.lockedUntil - now) / 1000) };
  }
  if (!e || !e.lockedUntil || now >= e.lockedUntil) {
    e = { strikes: 0, lockedUntil: 0 };
  }
  e.strikes += 1;
  if (e.strikes >= AUTH_THROTTLE_STRIKES) {
    e.lockedUntil = now + AUTH_THROTTLE_COOLDOWN_MS;
    e.strikes = 0;
    map.set(ip, e);
    return { locked: true, retryAfterSeconds: Math.ceil(AUTH_THROTTLE_COOLDOWN_MS / 1000) };
  }
  map.set(ip, e);
  return { locked: false };
}

function authThrottleClear(map, ip) {
  map.delete(ip);
}

function signupConflictMessage(err) {
  const c = String(err.constraint || '');
  if (c.includes('phone')) return 'That phone number is already registered.';
  if (c.includes('email')) return 'That email is already registered.';
  return 'That username is already taken.';
}

let databaseDisabledReason = '';
let pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
  : null;

function localDatabaseFallbackEnabled() {
  return String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
}

function isDatabaseConnectionError(err) {
  const code = String(err?.code || '');
  return ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNRESET'].includes(code);
}

function disableDatabaseForProcess(err) {
  if (!pool || !localDatabaseFallbackEnabled() || !isDatabaseConnectionError(err)) return false;
  const previousPool = pool;
  pool = null;
  catalogSeeded = false;
  databaseDisabledReason = `${err.code || 'connection_error'} ${err.message || ''}`.trim();
  previousPool.end().catch(() => {});
  console.warn(`[database] disabled for this dev process: ${databaseDisabledReason}`);
  return true;
}

async function recordAuthTraffic(dbQuery, { userId, visitorKey, path, eventType, referrer, req }) {
  if (!pool) return;
  const pathVal = String(path || '/').slice(0, 512);
  const et = String(eventType || pathVal).slice(0, 96);
  const ref = referrer != null ? String(referrer).slice(0, 1024) : null;
  const ip = clientIp(req) || null;
  const ua = clientUserAgent(req) || null;
  const countryCode = req ? resolveCountryCode(req, ip) : null;
  await dbQuery(
    `insert into analytics_visits (
      user_id, visitor_key, path, referrer,
      utm_source, utm_medium, utm_campaign,
      country_code, ip, user_agent
    ) values ($1,$2,$3,$4,null,null,null,$5,$6,$7)`,
    [userId || null, visitorKey, pathVal, ref, countryCode, ip, ua],
  ).catch(() => {});
  await dbQuery(
    `insert into analytics_events (user_id, visitor_key, event_type, path, category, payload)
     values ($1,$2,$3,$4,$5,$6::jsonb)`,
    [userId || null, visitorKey, et, pathVal, 'auth', JSON.stringify({})],
  ).catch(() => {});
}

let catalogSeeded = false;

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  const body = String(text || '');
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '')
    .split(';')
    .forEach((part) => {
      const idx = part.indexOf('=');
      if (idx < 0) return;
      const key = part.slice(0, idx).trim();
      const val = part.slice(idx + 1).trim();
      if (key) out[key] = decodeURIComponent(val);
    });
  return out;
}

function appendCookie(res, cookie) {
  const prev = res.getHeader('Set-Cookie');
  if (!prev) return res.setHeader('Set-Cookie', cookie);
  if (Array.isArray(prev)) return res.setHeader('Set-Cookie', prev.concat(cookie));
  return res.setHeader('Set-Cookie', [String(prev), cookie]);
}

function setSessionCookie(res, token) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 86400}`,
  ];
  if (secureCookiesEnabled()) parts.push('Secure');
  appendCookie(res, parts.join('; '));
}

function clearSessionCookie(res) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secureCookiesEnabled()) parts.push('Secure');
  appendCookie(res, parts.join('; '));
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(`${SESSION_SECRET}:${token}`).digest('hex');
}

function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 210_000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || '').split(':');
  if (!salt || !expected) return false;
  const candidate = passwordHash(password, salt).split(':')[1];
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function readJson(req, maxBytes = 64 * 1024) {
  return await new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

async function dbQuery(text, values = []) {
  if (!pool) throw new Error('database_not_configured');
  try {
    return await pool.query(text, values);
  } catch (err) {
    disableDatabaseForProcess(err);
    throw err;
  }
}

async function ensureCatalogSeeded() {
  if (!pool || catalogSeeded) return !!pool;
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    if (disableDatabaseForProcess(err) || (!pool && localDatabaseFallbackEnabled() && isDatabaseConnectionError(err))) {
      return false;
    }
    throw err;
  }
  try {
    await client.query('begin');
    /** Upsert every creator on each boot so newly-added creators land in the DB without manual migration. */
    for (const creator of fallbackCreators) {
      await client.query(
        `insert into creators
          (rank, name, slug, category, tagline, media_count, free_count, premium_count, heat, accent)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (slug) do update set
           rank = excluded.rank,
           name = excluded.name,
           category = excluded.category,
           tagline = excluded.tagline,
           media_count = excluded.media_count,
           free_count = excluded.free_count,
           premium_count = excluded.premium_count,
           heat = excluded.heat,
           accent = excluded.accent`,
        [
          creator.rank,
          creator.name,
          creator.slug,
          creator.category,
          creator.tagline,
          creator.mediaCount,
          creator.freeCount,
          creator.premiumCount,
          creator.heat,
          creator.accent,
        ],
      );
    }
    /** Legacy catalog preview shorts were seeded with demo engagement in older builds.
     *  Current Shorts are R2/manifest media, so keep placeholder `short-*` rows out of admin analytics. */
    await client.query(
      `update media_items
       set status = 'hidden',
         views = 0,
         likes = 0,
         watch_seconds_total = 0,
         watch_sessions = 0,
         updated_at = now()
       where id like 'short-%'
         and media_type = 'short'
         and storage_path is null`,
    );
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    if (disableDatabaseForProcess(err) || (!pool && localDatabaseFallbackEnabled() && isDatabaseConnectionError(err))) {
      return false;
    }
    throw err;
  } finally {
    client.release();
  }
  catalogSeeded = true;
  return true;
}

function durationToSeconds(value) {
  const parts = String(value || '0:00').split(':').map((p) => Number(p) || 0);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function secondsToDuration(seconds) {
  const n = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(n / 60);
  const s = String(n % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function normalizeUser(row) {
  if (!row) return null;
  const tier = normalizeAccountTier(row.tier);
  return {
    id: row.id,
    email: row.email,
    phone: row.phone || null,
    username: row.username,
    tier,
    rawTier: row.tier || 'free',
    tierLabel: accountTierLabel(tier),
    manifestTiers: userManifestTiers(tier),
    referralCode: row.referral_code,
    referralSignups: Number(row.referral_signups_count || 0),
    referredByUserId: row.referred_by_user_id || null,
    watchTimeSeconds: Number(row.watch_time_seconds || 0),
    siteTimeSeconds: Number(row.site_time_seconds || 0),
    planLabel: row.plan_label || null,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at || null,
  };
}

async function createSession(res, userId, req) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  const ip = req ? clientIp(req) : '';
  const ua = req ? clientUserAgent(req) : '';
  await dbQuery(
    `insert into sessions (token_hash, user_id, expires_at, last_seen_at, ip, user_agent)
     values ($1,$2,$3,now(),$4,$5)`,
    [tokenHash(token), userId, expiresAt, ip || null, ua || null],
  );
  setSessionCookie(res, token);
}

/** Resolve logged-in user id without touching sessions/users (for analytics beacons). */
async function sessionUserId(req) {
  if (!pool) return null;
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  let found;
  try {
    found = await dbQuery(
      `select u.id
       from sessions s
       join users u on u.id = s.user_id
       where s.token_hash = $1 and s.expires_at > now() and u.banned_at is null
       limit 1`,
      [tokenHash(token)],
    );
  } catch (err) {
    if (!pool || isDatabaseConnectionError(err)) return null;
    throw err;
  }
  return found.rows[0]?.id || null;
}

async function currentUser(req) {
  if (!pool) return null;
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  let found;
  try {
    found = await dbQuery(
      `select u.id, u.email, u.phone, u.username, u.tier, u.created_at,
              u.referral_code, u.referral_signups_count, u.referred_by_user_id,
              u.watch_time_seconds, u.site_time_seconds, u.plan_label, u.last_active_at
       from sessions s
       join users u on u.id = s.user_id
       where s.token_hash = $1 and s.expires_at > now() and u.banned_at is null
       limit 1`,
      [tokenHash(token)],
    );
  } catch (err) {
    if (!pool || isDatabaseConnectionError(err)) return null;
    throw err;
  }
  if (!found.rows[0]) return null;
  const ip = clientIp(req) || null;
  await dbQuery(
    'update sessions set last_seen_at = now(), ip = coalesce($2, sessions.ip) where token_hash = $1',
    [tokenHash(token), ip],
  ).catch(() => {});
  await dbQuery(
    'update users set last_active_at = now(), last_ip = coalesce($2, last_ip), updated_at = now() where id = $1',
    [found.rows[0].id, ip],
  ).catch(() => {});
  return normalizeUser(found.rows[0]);
}

async function destroySession(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token && pool) {
    await dbQuery('delete from sessions where token_hash = $1', [tokenHash(token)]).catch(() => {});
  }
  clearSessionCookie(res);
}

function validateSignup(body) {
  const emailRaw = String(body.email || '').trim().toLowerCase();
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const confirmPassword = String(body.confirmPassword ?? body.confirm_password ?? '');
  const email = emailRaw === '' ? null : emailRaw;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email or leave it blank.';
  if (!/^[a-zA-Z0-9_-]{3,24}$/.test(username)) return 'Username must be 3-24 characters.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (confirmPassword !== password) return 'Passwords do not match.';
  return null;
}

async function routeApi(req, res, url) {
  const method = (req.method || 'GET').toUpperCase();

  if (url.pathname === '/api/health') {
    const r2Media = R2_WORKER_ORIGIN ? 'worker-proxy' : process.env.RCLONE_CONFIG_R2_ACCESS_KEY_ID ? 'rclone' : 'off';
    return sendJson(res, 200, { ok: true, database: !!pool, databaseDisabledReason, mode: 'rebuilt', r2Media });
  }

  if (url.pathname === '/api/session' && method === 'GET') {
    const user = await currentUser(req);
    return sendJson(res, 200, { authed: !!user, user });
  }

  if (url.pathname === '/api/auth/signup' && method === 'POST') {
    if (!pool) return sendJson(res, 503, { error: 'Postgres is not configured. Set DATABASE_URL.' });
    const body = await readJson(req);
    const error = validateSignup(body);
    if (error) return sendJson(res, 400, { error });
    const emailFinal =
      String(body.email || '')
        .trim()
        .toLowerCase() === ''
        ? null
        : String(body.email || '')
            .trim()
            .toLowerCase();
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const phoneFinal = null;
    const refNorm = normalizeReferralCode(body.referralCode || body.referral_code || '');
    const ip = clientIp(req) || 'unknown';

    if (authThrottleReject(res, signupThrottle, ip)) return;

    const client = await pool.connect();
    try {
      await client.query('begin');

      let referrerId = null;
      if (refNorm) {
        const refRow = await client.query('select id from users where referral_code = $1', [refNorm]);
        if (!refRow.rows[0]) {
          await client.query('rollback');
          const th = authThrottleRegisterFailure(signupThrottle, ip);
          if (th.locked) {
            return sendJson(res, 429, {
              error: `Too many attempts. Wait ${th.retryAfterSeconds}s and try again.`,
              retryAfterSeconds: th.retryAfterSeconds,
            });
          }
          return sendJson(res, 400, { error: 'Invalid referral code.' });
        }
        referrerId = refRow.rows[0].id;
      }

      let inserted = null;
      for (let attempt = 0; attempt < 25; attempt += 1) {
        const code = generateReferralCode();
        try {
          inserted = await client.query(
            `insert into users (
              email, phone, username, password_hash, referral_code,
              referred_by_user_id, signup_ip, last_ip, last_active_at, auth_provider, tier
            ) values ($1,$2,$3,$4,$5,$6,$7,$8, now(), 'local', 'free')
            returning id, email, phone, username, tier, created_at,
              referral_code, referral_signups_count, referred_by_user_id,
              watch_time_seconds, site_time_seconds, plan_label, last_active_at`,
            [emailFinal, phoneFinal, username, passwordHash(password), code, referrerId, ip || null, ip || null],
          );
          break;
        } catch (err) {
          const constraint = String(err.constraint || '');
          const retryRef =
            String(err.code) === '23505' && (constraint.includes('referral') || constraint.includes('referral_code'));
          if (retryRef) {
            continue;
          }
          if (String(err.code) === '23505') {
            await client.query('rollback');
            const th = authThrottleRegisterFailure(signupThrottle, ip);
            if (th.locked) {
              return sendJson(res, 429, {
                error: `Too many attempts. Wait ${th.retryAfterSeconds}s and try again.`,
                retryAfterSeconds: th.retryAfterSeconds,
              });
            }
            return sendJson(res, 409, { error: signupConflictMessage(err) });
          }
          throw err;
        }
      }

      if (!inserted || !inserted.rows[0]) {
        await client.query('rollback');
        const th = authThrottleRegisterFailure(signupThrottle, ip);
        if (th.locked) {
          return sendJson(res, 429, {
            error: `Too many attempts. Wait ${th.retryAfterSeconds}s and try again.`,
            retryAfterSeconds: th.retryAfterSeconds,
          });
        }
        return sendJson(res, 500, { error: 'Could not allocate referral code.' });
      }

      const newUser = inserted.rows[0];
      if (referrerId) {
        await client.query(
          `insert into referral_signups (referrer_user_id, referred_user_id, referral_code_used)
           values ($1,$2,$3)`,
          [referrerId, newUser.id, refNorm],
        );
      }

      await client.query('commit');
      authThrottleClear(signupThrottle, ip);
      const signupVisitor = parseVisitorUuid(body.visitorKey ?? body.visitor_key);
      const signupReferrer =
        body.referrer != null ? String(body.referrer).slice(0, 1024) : null;
      await recordAuthTraffic(dbQuery, {
        userId: newUser.id,
        visitorKey: signupVisitor,
        path: '/signup',
        eventType: 'signup',
        referrer: signupReferrer,
        req,
      });
      await createSession(res, newUser.id, req);
      return sendJson(res, 201, { user: normalizeUser(newUser) });
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  if (url.pathname === '/api/auth/login' && method === 'POST') {
    if (!pool) return sendJson(res, 503, { error: 'Postgres is not configured. Set DATABASE_URL.' });
    const body = await readJson(req);
    const identifier = String(body.identifier || body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!identifier || !password) return sendJson(res, 400, { error: 'Email/username and password are required.' });
    const ip = clientIp(req) || 'unknown';
    if (authThrottleReject(res, loginThrottle, ip)) return;
    const found = await dbQuery(
      `select id, email, phone, username, password_hash, tier, created_at,
              referral_code, referral_signups_count, referred_by_user_id,
              watch_time_seconds, site_time_seconds, plan_label, last_active_at,
              banned_at
       from users
       where lower(username) = $1 or (email is not null and lower(email) = $1)
       limit 1`,
      [identifier],
    );
    const row = found.rows[0];
    if (!row || row.banned_at || !verifyPassword(password, row.password_hash)) {
      const th = authThrottleRegisterFailure(loginThrottle, ip);
      if (th.locked) {
        return sendJson(res, 429, {
          error: `Too many attempts. Wait ${th.retryAfterSeconds}s and try again.`,
          retryAfterSeconds: th.retryAfterSeconds,
        });
      }
      return sendJson(res, 401, { error: 'Invalid credentials.' });
    }
    authThrottleClear(loginThrottle, ip);
    await dbQuery(
      'update users set last_ip = $2, last_active_at = now(), updated_at = now() where id = $1',
      [row.id, clientIp(req) || null],
    ).catch(() => {});
    const loginVisitor = parseVisitorUuid(body.visitorKey ?? body.visitor_key);
    const loginReferrer =
      body.referrer != null ? String(body.referrer).slice(0, 1024) : null;
    await recordAuthTraffic(dbQuery, {
      userId: row.id,
      visitorKey: loginVisitor,
      path: '/login',
      eventType: 'login',
      referrer: loginReferrer,
      req,
    });
    await createSession(res, row.id, req);
    return sendJson(res, 200, { user: normalizeUser(row) });
  }

  if (url.pathname === '/api/analytics/visit' && method === 'POST') {
    if (!pool) return sendJson(res, 503, { error: 'Postgres is not configured. Set DATABASE_URL.' });
    try {
      const body = await readJson(req);
      const visitorKey = parseVisitorUuid(body.visitorKey ?? body.visitor_key);
      const pathVal = String(body.path || '/').slice(0, 512);
      const referrer = body.referrer != null ? String(body.referrer).slice(0, 1024) : null;
      const ua = clientUserAgent(req);
      const ip = clientIp(req);
      const authUserId = await sessionUserId(req).catch(() => null);
      const countryCode = resolveCountryCode(req, ip);

      /** Omit explicit ::uuid casts so NULL bindings never trip invalid_text_representation. */
      await dbQuery(
        `insert into analytics_visits (
          user_id, visitor_key, path, referrer,
          utm_source, utm_medium, utm_campaign,
          country_code, ip, user_agent
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          authUserId || null,
          visitorKey,
          pathVal,
          referrer,
          body.utmSource ? String(body.utmSource).slice(0, 128) : null,
          body.utmMedium ? String(body.utmMedium).slice(0, 128) : null,
          body.utmCampaign ? String(body.utmCampaign).slice(0, 128) : null,
          countryCode,
          ip || null,
          ua || null,
        ],
      );
      await dbQuery(
        `insert into analytics_events (user_id, visitor_key, event_type, path, category, payload)
         values ($1,$2,$3,$4,$5,$6::jsonb)`,
        [
          authUserId || null,
          visitorKey,
          'page_view',
          pathVal,
          'navigation',
          JSON.stringify({ via: 'visit_beacon' }),
        ],
      );
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      console.error('[analytics visit]', err.code || '', err.message || err);
      return sendJson(res, 503, { ok: false, error: 'Could not store visit.' });
    }
  }

  if (url.pathname === '/api/analytics/event' && method === 'POST') {
    if (!pool) return sendJson(res, 503, { error: 'Postgres is not configured. Set DATABASE_URL.' });
    try {
      const body = await readJson(req);
      const eventType = String(body.eventType || body.event_type || '').trim().slice(0, 96);
      if (!eventType) return sendJson(res, 400, { error: 'eventType is required.' });
      const visitorKey = parseVisitorUuid(body.visitorKey ?? body.visitor_key);
      const authUserId = await sessionUserId(req).catch(() => null);
      const pathVal = body.path != null ? String(body.path).slice(0, 512) : null;
      const category = body.category != null ? String(body.category).slice(0, 128) : null;
      const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};

      await dbQuery(
        `insert into analytics_events (user_id, visitor_key, event_type, path, category, payload)
         values ($1,$2,$3,$4,$5,$6::jsonb)`,
        [authUserId || null, visitorKey, eventType, pathVal, category, JSON.stringify(payload)],
      );
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      const msg = String(err?.message || err || '');
      if (msg === 'invalid_json' || msg === 'payload_too_large') {
        return sendJson(res, 400, { error: 'Invalid JSON body.' });
      }
      console.error('[analytics event]', err.code || '', err.message || err);
      return sendJson(res, 503, { ok: false, error: 'Could not store event.' });
    }
  }

  if (url.pathname === '/api/analytics/media' && method === 'POST') {
    if (!pool) return sendJson(res, 503, { error: 'Postgres is not configured. Set DATABASE_URL.' });
    try {
      const body = await readJson(req);
      return await mediaAnalytics.handleMediaAnalytics(pool, dbQuery, body, {
        res,
        sendJson,
        clientIp: () => clientIp(req),
        sessionUserId: () => sessionUserId(req),
      });
    } catch (err) {
      console.error('[analytics media]', err);
      return sendJson(res, 400, { error: 'Invalid JSON body.' });
    }
  }

  if (url.pathname === '/api/analytics/ping' && method === 'POST') {
    if (!pool) return sendJson(res, 503, { error: 'Postgres is not configured. Set DATABASE_URL.' });
    const user = await currentUser(req);
    if (!user) return sendJson(res, 401, { error: 'Authentication required.' });
    const body = await readJson(req);
    const siteSec = Math.min(900, Math.max(0, Math.floor(Number(body.siteSeconds ?? body.site_seconds ?? 0))));
    const watchSec = Math.min(3600, Math.max(0, Math.floor(Number(body.watchSeconds ?? body.watch_seconds ?? 0))));
    if (siteSec || watchSec) {
      await dbQuery(
        `update users set
           site_time_seconds = site_time_seconds + $2::bigint,
           watch_time_seconds = watch_time_seconds + $3::bigint,
           updated_at = now()
         where id = $1`,
        [user.id, siteSec, watchSec],
      ).catch(() => {});
    }
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === '/api/auth/logout' && method === 'POST') {
    await destroySession(req, res);
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === '/api/admin/session' && method === 'GET') {
    const ok = adminHourly.verifyAdminCookie(req);
    return sendJson(res, 200, {
      ok,
      siteLabel: ok ? adminHourly.publicSiteLabel() : undefined,
    });
  }

  if (url.pathname === '/api/admin/login' && method === 'POST') {
    const body = await readJson(req);
    const pw = body.password ?? body.adminPassword;
    if (!adminHourly.verifyPasswordAttempt(pw)) {
      return sendJson(res, 401, { error: 'Invalid password.' });
    }
    adminHourly.setAdminAuthCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === '/api/admin/logout' && method === 'POST') {
    adminHourly.clearAdminAuthCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === '/api/admin/stats' && method === 'GET') {
    if (!adminHourly.verifyAdminCookie(req)) {
      return sendJson(res, 401, { error: 'Admin authentication required.' });
    }
    let userCount = null;
    if (pool) {
      try {
        const cr = await dbQuery('select count(*)::int as c from users');
        userCount = cr.rows[0]?.c ?? null;
      } catch {
        userCount = null;
      }
    }
    return sendJson(res, 200, {
      ok: true,
      userCount,
      database: !!pool,
      siteLabel: adminHourly.publicSiteLabel(),
    });
  }

  if (url.pathname === '/api/admin/dashboard' && method === 'GET') {
    if (!adminHourly.verifyAdminCookie(req)) {
      return sendJson(res, 401, { error: 'Admin authentication required.' });
    }
    if (!pool) {
      return sendJson(res, 503, { error: 'Database not configured.', siteLabel: adminHourly.publicSiteLabel() });
    }
    try {
      await ensureCatalogSeeded();
      const rangeParam = adminDashboard.parseDashboardRange(url.searchParams.get('range'));
      const data = await adminDashboard.getDashboard(dbQuery, rangeParam);
      return sendJson(res, 200, {
        ok: true,
        database: true,
        siteLabel: adminHourly.publicSiteLabel(),
        ...data,
      });
    } catch (err) {
      console.error('[admin dashboard]', err);
      return sendJson(res, 500, { error: 'Dashboard query failed.' });
    }
  }

  const adminUserMatch = adminUserActions.matchAdminUserRoute(url.pathname);
  if (adminUserMatch && method !== 'GET') {
    if (!adminHourly.verifyAdminCookie(req)) {
      return sendJson(res, 401, { error: 'Admin authentication required.' });
    }
    if (!pool) return sendJson(res, 503, { error: 'Database not configured.' });
    try {
      const body = await readJson(req);
      const result = await adminUserActions.processAdminUserAction({
        method,
        userId: adminUserMatch.userId,
        sub: adminUserMatch.sub,
        body,
        dbQuery,
        passwordHash,
      });
      if (result.error) return sendJson(res, result.status, { error: result.error });
      return sendJson(res, result.status, { ok: true });
    } catch (err) {
      console.error('[admin user action]', err);
      return sendJson(res, 500, { error: 'Request failed.' });
    }
  }

  if (url.pathname === '/api/admin/users' && method === 'GET') {
    if (!adminHourly.verifyAdminCookie(req)) {
      return sendJson(res, 401, { error: 'Admin authentication required.' });
    }
    if (!pool) return sendJson(res, 503, { error: 'Database not configured.' });
    try {
      await ensureCatalogSeeded();
      const page = adminDashboard.clampPage(url.searchParams.get('page'));
      const limit = adminDashboard.clampLimit(url.searchParams.get('limit'));
      const qParam = url.searchParams.get('q') ?? '';
      const tierParam = url.searchParams.get('tier') ?? '';
      const payload = await adminDashboard.getUsersPage(dbQuery, page, limit, qParam, tierParam);
      return sendJson(res, 200, { ok: true, ...payload });
    } catch (err) {
      console.error('[admin users]', err);
      return sendJson(res, 500, { error: 'Query failed.' });
    }
  }

  if (url.pathname === '/api/admin/visits' && method === 'GET') {
    if (!adminHourly.verifyAdminCookie(req)) {
      return sendJson(res, 401, { error: 'Admin authentication required.' });
    }
    if (!pool) return sendJson(res, 503, { error: 'Database not configured.' });
    try {
      const page = adminDashboard.clampPage(url.searchParams.get('page'));
      const limit = adminDashboard.clampLimit(url.searchParams.get('limit'));
      const qParam = url.searchParams.get('q') ?? '';
      const payload = await adminDashboard.getVisitsPage(dbQuery, page, limit, qParam);
      return sendJson(res, 200, { ok: true, ...payload });
    } catch (err) {
      console.error('[admin visits]', err);
      return sendJson(res, 500, { error: 'Query failed.' });
    }
  }

  if (url.pathname === '/api/admin/events' && method === 'GET') {
    if (!adminHourly.verifyAdminCookie(req)) {
      return sendJson(res, 401, { error: 'Admin authentication required.' });
    }
    if (!pool) return sendJson(res, 503, { error: 'Database not configured.' });
    try {
      const page = adminDashboard.clampPage(url.searchParams.get('page'));
      const limit = adminDashboard.clampLimit(url.searchParams.get('limit'));
      const qParam = url.searchParams.get('q') ?? '';
      const payload = await adminDashboard.getEventsPage(dbQuery, page, limit, qParam);
      return sendJson(res, 200, { ok: true, ...payload });
    } catch (err) {
      console.error('[admin events]', err);
      return sendJson(res, 500, { error: 'Query failed.' });
    }
  }

  if (url.pathname === '/api/admin/referrals' && method === 'GET') {
    if (!adminHourly.verifyAdminCookie(req)) {
      return sendJson(res, 401, { error: 'Admin authentication required.' });
    }
    if (!pool) return sendJson(res, 503, { error: 'Database not configured.' });
    try {
      const page = adminDashboard.clampPage(url.searchParams.get('page'));
      const limit = adminDashboard.clampLimit(url.searchParams.get('limit'));
      const qParam = url.searchParams.get('q') ?? '';
      const payload = await adminDashboard.getReferralsPage(dbQuery, page, limit, qParam);
      return sendJson(res, 200, { ok: true, ...payload });
    } catch (err) {
      console.error('[admin referrals]', err);
      return sendJson(res, 500, { error: 'Query failed.' });
    }
  }

  if (url.pathname === '/api/admin/referral-lookup' && method === 'GET') {
    if (!adminHourly.verifyAdminCookie(req)) {
      return sendJson(res, 401, { error: 'Admin authentication required.' });
    }
    if (!pool) return sendJson(res, 503, { error: 'Database not configured.' });
    try {
      const qRaw = url.searchParams.get('q') ?? '';
      const result = await adminDashboard.getReferralLookup(dbQuery, qRaw);
      if (!result.ok) return sendJson(res, 400, { error: result.error });
      return sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      console.error('[admin referral-lookup]', err);
      return sendJson(res, 500, { error: 'Lookup failed.' });
    }
  }

  if (url.pathname === '/api/admin/media-items' && method === 'GET') {
    if (!adminHourly.verifyAdminCookie(req)) {
      return sendJson(res, 401, { error: 'Admin authentication required.' });
    }
    if (!pool) return sendJson(res, 503, { error: 'Database not configured.' });
    try {
      const page = adminDashboard.clampPage(url.searchParams.get('page'));
      const limit = adminDashboard.clampLimit(url.searchParams.get('limit'));
      const qParam = url.searchParams.get('q') ?? '';
      const payload = await adminDashboard.getMediaItemsPage(dbQuery, page, limit, qParam);
      return sendJson(res, 200, { ok: true, ...payload });
    } catch (err) {
      console.error('[admin media-items]', err);
      return sendJson(res, 500, { error: 'Query failed.' });
    }
  }

  if (url.pathname === '/api/admin/payments/summary' && method === 'GET') {
    if (!adminHourly.verifyAdminCookie(req)) {
      return sendJson(res, 401, { error: 'Admin authentication required.' });
    }
    if (!pool) return sendJson(res, 503, { error: 'Database not configured.' });
    try {
      const rangeParam = adminDashboard.parsePaymentAdminRange(url.searchParams.get('range'));
      const summary = await adminDashboard.getPaymentsAdminSummary(dbQuery, rangeParam);
      return sendJson(res, 200, { ok: true, ...summary });
    } catch (err) {
      console.error('[admin payments summary]', err);
      return sendJson(res, 500, { error: 'Query failed.' });
    }
  }

  if (url.pathname === '/api/admin/payments' && method === 'GET') {
    if (!adminHourly.verifyAdminCookie(req)) {
      return sendJson(res, 401, { error: 'Admin authentication required.' });
    }
    if (!pool) return sendJson(res, 503, { error: 'Database not configured.' });
    try {
      const page = adminDashboard.clampPage(url.searchParams.get('page'));
      const limit = adminDashboard.clampLimit(url.searchParams.get('limit'));
      const qParam = url.searchParams.get('q') ?? '';
      const rangeParam = adminDashboard.parsePaymentAdminRange(url.searchParams.get('range'));
      const payload = await adminDashboard.getPaymentsPage(dbQuery, page, limit, qParam, rangeParam);
      return sendJson(res, 200, { ok: true, ...payload });
    } catch (err) {
      console.error('[admin payments]', err);
      return sendJson(res, 500, { error: 'Query failed.' });
    }
  }

  if (url.pathname === '/api/admin/traffic-sources' && method === 'GET') {
    if (!adminHourly.verifyAdminCookie(req)) {
      return sendJson(res, 401, { error: 'Admin authentication required.' });
    }
    if (!pool) return sendJson(res, 503, { error: 'Database not configured.' });
    try {
      const rangeParam = adminDashboard.parseTrafficSourcesRange(url.searchParams.get('range'));
      const report = await adminDashboard.getTrafficSourcesReport(dbQuery, rangeParam);
      return sendJson(res, 200, {
        ok: true,
        siteLabel: adminHourly.publicSiteLabel(),
        ...report,
      });
    } catch (err) {
      console.error('[admin traffic-sources]', err);
      return sendJson(res, 500, { error: 'Query failed.' });
    }
  }

  if (url.pathname === '/api/admin/media-summary' && method === 'GET') {
    if (!adminHourly.verifyAdminCookie(req)) {
      return sendJson(res, 401, { error: 'Admin authentication required.' });
    }
    if (!pool) return sendJson(res, 503, { error: 'Database not configured.' });
    try {
      const rollup = await adminDashboard.getMediaRollup(dbQuery);
      return sendJson(res, 200, { ok: true, rollup });
    } catch (err) {
      console.error('[admin media-summary]', err);
      return sendJson(res, 500, { error: 'Query failed.' });
    }
  }

  if (url.pathname === '/api/queue/status' && method === 'GET') {
    let online = 0;
    if (pool) {
      try {
        online = Number((await dbQuery("select count(*)::int as count from sessions where last_seen_at > now() - interval '5 minutes'")).rows[0]?.count || 0);
      } catch (err) {
        if (!isDatabaseConnectionError(err) && !localDatabaseFallbackEnabled()) throw err;
        online = 0;
      }
    }
    const overCapacity = online > ONLINE_CAPACITY;
    return sendJson(res, 200, {
      online,
      capacity: ONLINE_CAPACITY,
      queued: overCapacity,
      position: overCapacity ? online - ONLINE_CAPACITY + 1 : 0,
      skipQueue: {
        available: true,
        priceCents: SKIP_QUEUE_PRICE_CENTS,
        enabled: false,
      },
    });
  }

  if (url.pathname === '/api/categories' && method === 'GET') {
    return sendJson(res, 200, {
      categories: categoryNames.map((name) => ({
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
      })),
    });
  }

  if (url.pathname === '/api/creators' && method === 'GET') {
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
    const category = String(url.searchParams.get('category') || '').trim();
    /** `?include=all` opts into seeing creators without R2 content (admin/debug). */
    const includeAll = url.searchParams.get('include') === 'all';
    let rows = includeAll ? fallbackCreators : fallbackReadyCreators;
    if (pool && (await ensureCatalogSeeded())) {
      try {
        const out = await dbQuery(
          `select rank, name, slug, category, tagline, media_count, free_count, premium_count, heat, accent
           from creators
           where ($1 = '' or lower(name) like '%' || $1 || '%')
             and ($2 = '' or category = $2)
           order by rank asc`,
          [q, category],
        );
        rows = out.rows.map((row) => {
          const seed = creatorBySlug.get(row.slug);
          return {
            rank: row.rank,
            name: row.name,
            slug: row.slug,
            category: row.category,
            tagline: row.tagline,
            /** Prefer real R2 counts (from seeded creator object) over DB-stored seeded values. */
            mediaCount: seed ? seed.mediaCount : Number(row.media_count || 0),
            freeCount: seed ? seed.freeCount : Number(row.free_count || 0),
            premiumCount: seed ? seed.premiumCount : Number(row.premium_count || 0),
            heat: Number(row.heat || 0),
            accent: row.accent || 'pink',
            thumbnail: thumbnailFor(row.slug),
            ready: readySlugSet.has(row.slug),
          };
        });
        if (!includeAll) rows = rows.filter((r) => r.ready);
      } catch (err) {
        if (!isDatabaseConnectionError(err) && !localDatabaseFallbackEnabled()) throw err;
      }
    }
    rows = rows.filter((row) => (!q || row.name.toLowerCase().includes(q)) && (!category || row.category === category));
    return sendJson(res, 200, { creators: rows });
  }

  /** Single creator detail (used by /creators/:slug page). */
  const creatorMatch = url.pathname.match(/^\/api\/creators\/([a-z0-9-]+)$/);
  if (creatorMatch && method === 'GET') {
    const slug = creatorMatch[1];
    const c = creatorBySlug.get(slug);
    if (!c) return sendJson(res, 404, { error: 'Creator not found.' });
    const manifest = loadMediaManifest(slug);
    return sendJson(res, 200, {
      creator: c,
      mediaSummary: manifest ? manifest.totals : null,
      hasMedia: !!manifest && manifest.totals.count > 0,
    });
  }

  /** Per-creator media manifest (paginated). */
  const mediaMatch = url.pathname.match(/^\/api\/creators\/([a-z0-9-]+)\/media$/);
  if (mediaMatch && method === 'GET') {
    const slug = mediaMatch[1];
    const c = creatorBySlug.get(slug);
    if (!c) return sendJson(res, 404, { error: 'Creator not found.' });
    const manifest = loadMediaManifest(slug);
    if (!manifest) return sendJson(res, 200, { creator: c, items: [], totals: null });

    const tier = manifestTierFromParam(url.searchParams.get('tier') || '');
    const kind = String(url.searchParams.get('kind') || '').trim();
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 200)));
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
    const user = await currentUser(req);
    const allowedTierSet = new Set(userManifestTiers(user));

    let items = manifest.items;
    if (tier) items = items.filter((it) => it.tier === tier);
    if (kind) items = items.filter((it) => it.kind === kind);
    const total = items.length;
    items = items.slice(offset, offset + limit).map((item, index) => {
      if (allowedTierSet.has(item.tier)) return item;
      return {
        tier: item.tier,
        name: item.name,
        key: `locked:${slug}:${item.tier}:${offset + index}`,
        sizeBytes: Number(item.sizeBytes || 0),
        ext: item.ext || '',
        kind: item.kind || 'other',
        locked: true,
      };
    });

    return sendJson(res, 200, {
      creator: c,
      totals: manifest.totals,
      access: {
        userTier: user?.tier || 'free',
        userTierLabel: accountTierLabel(user?.tier || 'free'),
        manifestTiers: Array.from(allowedTierSet),
      },
      page: { offset, limit, total, returned: items.length },
      items,
    });
  }

  if (url.pathname === '/api/shorts/feed' && method === 'GET') {
    const user = await currentUser(req);
    const allowedTiers = userManifestTiers(user);
    const allowedTierSet = new Set(allowedTiers);
    const limit = Math.min(260, Math.max(1, Number(url.searchParams.get('limit') || 180)));
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
    const seed = String(url.searchParams.get('seed') || crypto.randomUUID()).slice(0, 96);
    const wantedCreators = new Set(
      String(url.searchParams.get('creators') || '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => /^[a-z0-9-]+$/.test(s)),
    );
    const wantedCategories = new Set(
      String(url.searchParams.get('categories') || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
    const creatorFilters = [];
    const categoryCounts = new Map();
    const buckets = [];
    const allEligible = [];
    let fullAccessRaw = 0;
    let allowedAccessRaw = 0;

    for (const creator of fallbackReadyCreators) {
      const manifest = loadMediaManifest(creator.slug);
      if (!manifest) continue;
      const feedMedia = manifest.items.filter(isShortsFeedMedia);
      fullAccessRaw += feedMedia.length;
      const allowedForCreator = feedMedia.filter((item) => allowedTierSet.has(item.tier));
      allowedAccessRaw += allowedForCreator.length;
      if (wantedCreators.size && !wantedCreators.has(creator.slug)) continue;
      const videos = allowedForCreator
        .map((item) => ({
          id: mediaStatsId(item.key),
          key: item.key,
          name: item.name,
          title: creator.name,
          creatorSlug: creator.slug,
          creatorName: creator.name,
          creatorRank: Number(creator.rank || 999),
          creatorHeat: Number(creator.heat || 0),
          kind: item.ext === '.gif' ? 'image' : item.kind,
          tier: item.tier,
          sizeBytes: Number(item.sizeBytes || 0),
          ext: item.ext || '',
          views: 0,
          likes: 0,
          durationSeconds: 0,
        }));
      if (!videos.length) continue;
      creatorFilters.push({
        slug: creator.slug,
        name: creator.name,
        category: creator.category,
        count: videos.length,
      });
      buckets.push(videos);
      allEligible.push(...videos);
    }

    const interleaved = [];
    let row = 0;
    while (true) {
      let pushed = false;
      for (const bucket of buckets) {
        if (bucket[row]) {
          interleaved.push(bucket[row]);
          pushed = true;
        }
      }
      if (!pushed) break;
      row += 1;
    }

    const bucketSize = Math.max(8, Math.ceil(allEligible.length * 0.34));
    const topVideos = new Set(
      allEligible
        .slice()
        .sort((a, b) => {
          const scoreA = Number(a.sizeBytes || 0) + Number(a.creatorHeat || 0) * 400000 + (stableHash(`${seed}:top:${a.key}`) % 400000);
          const scoreB = Number(b.sizeBytes || 0) + Number(b.creatorHeat || 0) * 400000 + (stableHash(`${seed}:top:${b.key}`) % 400000);
          return scoreB - scoreA;
        })
        .slice(0, bucketSize)
        .map((item) => item.key),
    );
    const trending = new Set(
      allEligible
        .slice()
        .sort((a, b) => {
          const scoreA = Number(a.creatorHeat || 0) * 10000 + (stableHash(`${seed}:trend:${a.key}`) % 10000) + Math.min(2000, Number(a.sizeBytes || 0) / 250000);
          const scoreB = Number(b.creatorHeat || 0) * 10000 + (stableHash(`${seed}:trend:${b.key}`) % 10000) + Math.min(2000, Number(b.sizeBytes || 0) / 250000);
          return scoreB - scoreA;
        })
        .slice(0, bucketSize)
        .map((item) => item.key),
    );
    const featured = new Set(
      interleaved
        .slice()
        .sort((a, b) => {
          const scoreA = (1000 - Number(a.creatorRank || 999)) * 1000 + (stableHash(`${seed}:feature:${a.key}`) % 1000);
          const scoreB = (1000 - Number(b.creatorRank || 999)) * 1000 + (stableHash(`${seed}:feature:${b.key}`) % 1000);
          return scoreB - scoreA;
        })
        .slice(0, bucketSize)
        .map((item) => item.key),
    );

    for (const item of allEligible) {
      const categorySlugs = [];
      if (trending.has(item.key)) categorySlugs.push('trending');
      if (topVideos.has(item.key)) categorySlugs.push('top-videos');
      if (featured.has(item.key)) categorySlugs.push('featured');
      if (!categorySlugs.length) categorySlugs.push('featured');
      item.categorySlugs = categorySlugs;
      item.categoryLabels = categorySlugs.map((slug) => FEED_FILTER_LABELS.get(slug) || slug);
      item.categorySlug = categorySlugs[0];
      item.category = item.categoryLabels[0];
      for (const slug of categorySlugs) {
        const prev = categoryCounts.get(slug) || { slug, name: FEED_FILTER_LABELS.get(slug) || slug, count: 0 };
        prev.count += 1;
        categoryCounts.set(slug, prev);
      }
    }

    let feedPool = interleaved;
    if (wantedCategories.size) {
      feedPool = feedPool.filter((item) => item.categorySlugs?.some((slug) => wantedCategories.has(slug)));
    }
    const randomized = seededShuffle(feedPool, seed);
    const shorts = randomized.slice(offset, offset + limit);
    if (pool && shorts.length) {
      try {
        const stats = await dbQuery(
          `select id, storage_path, views, likes, duration_seconds
           from media_items
           where storage_path = any($1::text[])`,
          [shorts.map((item) => item.key)],
        );
        const byKey = new Map(stats.rows.map((r) => [r.storage_path, r]));
        for (const item of shorts) {
          const stat = byKey.get(item.key);
          if (!stat) continue;
          item.id = stat.id || item.id;
          item.views = Number(stat.views || 0);
          item.likes = Number(stat.likes || 0);
          item.durationSeconds = Number(stat.duration_seconds || 0);
        }
      } catch (err) {
        console.error('[shorts feed stats]', err.code || '', err.message || err);
      }
    }

    return sendJson(res, 200, {
      shorts,
      filters: {
        creators: creatorFilters.sort((a, b) => a.name.localeCompare(b.name)),
        categories: FEED_FILTERS.map((filter) => ({
          ...filter,
          count: categoryCounts.get(filter.slug)?.count || 0,
        })),
      },
      access: {
        userTier: user?.tier || 'free',
        userTierLabel: accountTierLabel(user?.tier || 'free'),
        manifestTiers: allowedTiers,
        allowedRaw: allowedAccessRaw,
        fullAccessRaw,
        unlockableRaw: Math.max(0, fullAccessRaw - allowedAccessRaw),
      },
      page: { offset, limit, total: randomized.length, returned: shorts.length, seed },
    });
  }

  if (url.pathname === '/api/shorts' && method === 'GET') {
    let rows = fallbackShorts;
    if (pool && (await ensureCatalogSeeded())) {
      try {
        const out = await dbQuery(
          `select m.id, m.creator_slug, c.name as creator_name, m.title, m.tier, m.duration_seconds, m.views, m.likes
           from media_items m
           join creators c on c.slug = m.creator_slug
           where m.media_type = 'short' and m.status = 'published'
           order by m.created_at desc, m.views desc
           limit 80`,
        );
        rows = out.rows.map((row) => ({
          id: row.id,
          creatorSlug: row.creator_slug,
          creatorName: row.creator_name,
          title: row.title,
          tier: row.tier,
          durationSeconds: Number(row.duration_seconds || 0),
          duration: secondsToDuration(row.duration_seconds),
          views: Number(row.views || 0),
          likes: Number(row.likes || 0),
        }));
      } catch (err) {
        if (!isDatabaseConnectionError(err) && !localDatabaseFallbackEnabled()) throw err;
      }
    }
    return sendJson(res, 200, { shorts: rows });
  }

  if (url.pathname === '/api/checkout/plans' && method === 'GET') {
    return sendJson(res, 200, {
      plans: [
        { key: 'basic', name: 'Basic', tier: 1, priceCents: 999, mediaAccess: 'Free previews plus full access to the basic vault.' },
        { key: 'premium', name: 'Premium', tier: 2, priceCents: 2499, mediaAccess: 'Every premium video, photo set, and priority on creator requests.' },
        { key: 'ultimate', name: 'Ultimate', tier: 3, priceCents: 3999, mediaAccess: 'Everything in Premium plus skip-the-queue priority access during peak hours.' },
      ],
      paymentsEnabled: false,
    });
  }

  if (url.pathname === '/api/stats' && method === 'GET') {
    /** Public-facing creator count = creators with real R2 content. The full
     *  catalog includes placeholders that haven't been processed yet, which
     *  shouldn't be advertised on the homepage. */
    let creatorCount = fallbackReadyCreators.length;
    if (pool) {
      try {
        const seeded = await ensureCatalogSeeded();
        /** Filter to ready slugs in SQL via the same set the seeder uses. */
        const slugs = fallbackReadyCreators.map((c) => c.slug);
        if (seeded && slugs.length > 0) {
          const row = await dbQuery(
            'select count(*)::int as creator_count from creators where slug = any($1::text[])',
            [slugs],
          );
          creatorCount = Number(row.rows[0]?.creator_count || creatorCount);
        }
      } catch (err) {
        console.error('[stats]', err);
      }
    }

    /** Real R2 object count + bytes (refreshed by `npm run r2:count`); fall back to
     *  the seeded catalog totals if the snapshot is missing so the page never shows
     *  zero. The client applies the marketing multipliers (see client/src/lib/metrics.js)
     *  -- this endpoint always returns RAW values so any future
     *  search/sort/threshold logic can use them safely. */
    const r2 = loadR2Stats();
    const rawCount = r2 ? r2.rawCount : fallbackCreators.reduce((sum, c) => sum + (c.mediaCount || 0), 0);
    const rawBytes = r2 ? r2.rawBytes : rawCount * 63 * 1024 * 1024;

    return sendJson(res, 200, {
      creators: creatorCount,
      rawObjectCount: rawCount,
      rawBytes,
      lastScannedAt: r2?.scannedAt || null,
      categories: categoryNames.length,
      backups: { cadence: 'daily', mirrored: true, reuploaded: true },
    });
  }

  return sendJson(res, 404, { error: 'Not found' });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.otf') return 'font/otf';
  if (ext === '.woff2') return 'font/woff2';
  return 'application/octet-stream';
}

async function sendStatic(req, res, url) {
  const dist = path.join(__dirname, 'client', 'dist');
  const publicDir = path.join(__dirname, 'client', 'public');
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return sendText(res, 405, 'Method Not Allowed');

  const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const candidates = [];
  if (requested !== '/index.html') candidates.push(path.join(dist, requested));
  candidates.push(path.join(publicDir, requested));

  for (const candidate of candidates) {
    const normalized = path.normalize(candidate);
    const allowed =
      normalized.startsWith(path.normalize(dist + path.sep)) ||
      normalized.startsWith(path.normalize(publicDir + path.sep));
    if (!allowed) continue;
    const stat = await fs.promises.stat(normalized).catch(() => null);
    if (!stat || !stat.isFile()) continue;
    const body = await fs.promises.readFile(normalized);
    res.writeHead(200, {
      'Content-Type': contentType(normalized),
      'Content-Length': body.length,
      'Cache-Control': normalized.includes('/assets/') || normalized.includes('/fonts/') ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end(method === 'HEAD' ? Buffer.alloc(0) : body);
  }

  const indexPath = path.join(dist, 'index.html');
  const index = await fs.promises.readFile(indexPath).catch(() => null);
  if (!index) return sendText(res, 404, 'Build not found. Run npm run build or use npm run dev.');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': index.length,
    'Cache-Control': 'no-cache',
  });
  return res.end(method === 'HEAD' ? Buffer.alloc(0) : index);
}

function parseR2ObjectKey(url) {
  const rawKey = decodeURIComponent(url.pathname.slice('/r2/'.length));
  if (!rawKey || rawKey.includes('..') || rawKey.startsWith('/') || /^[a-zA-Z]:/.test(rawKey)) return null;
  return rawKey;
}

/**
 * Production on VPS: browser loads same-origin `/r2/...`; Node forwards to the Worker.
 * No R2 API keys on the server; optional — avoids fragile `VITE_R2_PUBLIC_BASE` rebuilds.
 */
async function proxyR2FromWorker(req, res, rawKey) {
  const { Readable } = require('stream');
  if (!/^https:\/\//i.test(R2_WORKER_ORIGIN)) {
    return sendJson(res, 500, { error: 'R2_WORKER_ORIGIN must start with https://' });
  }
  const targetUrl = `${R2_WORKER_ORIGIN}/${rawKey.split('/').map((seg) => encodeURIComponent(seg)).join('/')}`;
  const headers = {};
  if (req.headers.range) headers.Range = req.headers.range;
  try {
    const upstream = await fetch(targetUrl, { method: req.method, headers, redirect: 'follow' });
    const passNames = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'cache-control'];
    const out = {};
    for (const name of passNames) {
      const v = upstream.headers.get(name);
      if (v) out[name] = v;
    }
    const requiredTier = r2ManifestTierFromKey(rawKey);
    if (requiredTier && requiredTier !== 'free') out['cache-control'] = 'private, max-age=300';
    res.writeHead(upstream.status, out);
    if (req.method === 'HEAD' || upstream.status === 304) {
      upstream.body?.cancel?.().catch(() => {});
      return res.end();
    }
    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res);
  } catch (err) {
    console.error('[r2-worker-proxy]', err);
    if (!res.headersSent) return sendJson(res, 502, { error: 'Media upstream unreachable' });
    res.destroy();
  }
}

/** `/r2/*`: Worker proxy (`R2_WORKER_ORIGIN`), else rclone (`RCLONE_CONFIG_R2_*`). */
async function streamR2(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  const rawKey = parseR2ObjectKey(url);
  if (!rawKey) return sendJson(res, 400, { error: 'Invalid R2 key.' });
  const requiredTier = r2ManifestTierFromKey(rawKey);
  if (requiredTier && requiredTier !== 'free') {
    const user = await currentUser(req);
    if (!userManifestTiers(user).includes(requiredTier)) {
      return sendJson(res, 403, { error: 'Upgrade required for this media.' });
    }
  }

  if (R2_WORKER_ORIGIN) {
    return proxyR2FromWorker(req, res, rawKey);
  }

  if (!process.env.RCLONE_CONFIG_R2_ACCESS_KEY_ID) {
    return sendJson(res, 503, {
      error:
        'R2 unavailable: set R2_WORKER_ORIGIN=https://your-worker.workers.dev on the VPS, or RCLONE_CONFIG_R2_* for local rclone.',
    });
  }
  const ext = (rawKey.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
  const contentType = ext === '.mp4' || ext === '.m4v' ? 'video/mp4'
    : ext === '.webm' ? 'video/webm'
    : ext === '.mov' ? 'video/quicktime'
    : ext === '.mkv' ? 'video/x-matroska'
    : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.png' ? 'image/png'
    : ext === '.webp' ? 'image/webp'
    : ext === '.gif' ? 'image/gif'
    : 'application/octet-stream';
  if (req.method === 'HEAD') {
    /** Cheap HEAD: don't actually fetch the body, just acknowledge. */
    res.writeHead(200, { 'content-type': contentType, 'accept-ranges': 'none' });
    return res.end();
  }
  const { spawn } = require('node:child_process');
  const child = spawn('rclone', ['cat', `r2:leakwrld/${rawKey}`], { windowsHide: true });
  let headersSent = false;
  let aborted = false;
  child.stdout.on('data', (chunk) => {
    if (!headersSent) {
      const privateMedia = requiredTier && requiredTier !== 'free';
      res.writeHead(200, {
        'content-type': contentType,
        'cache-control': privateMedia ? 'private, max-age=300' : 'public, max-age=300',
        'accept-ranges': 'none',
      });
      headersSent = true;
    }
    if (!res.write(chunk)) child.stdout.pause();
  });
  res.on('drain', () => child.stdout.resume());
  /** Swallow rclone's progress noise (it writes "Transferred:" to stderr). */
  child.stderr.on('data', () => {});
  child.on('error', () => {
    if (!aborted && !headersSent) sendJson(res, 502, { error: 'rclone spawn failed' });
    aborted = true;
  });
  child.on('close', (code) => {
    if (aborted) return;
    if (!headersSent) {
      return sendJson(res, code === 0 ? 404 : 502, {
        error: code === 0 ? 'Empty object' : `rclone exit ${code}`,
      });
    }
    res.end();
  });
  res.on('close', () => {
    if (!child.killed) child.kill('SIGTERM');
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (url.pathname.startsWith('/api/')) return await routeApi(req, res, url);
    if (url.pathname.startsWith('/r2/')) return await streamR2(req, res, url);
    return await sendStatic(req, res, url);
  } catch (err) {
    const databaseDown = err.message === 'database_not_configured' || isDatabaseConnectionError(err);
    disableDatabaseForProcess(err);
    const status = err.message === 'invalid_json' ? 400 : err.message === 'payload_too_large' ? 413 : databaseDown ? 503 : 500;
    console.error('[server]', err);
    return sendJson(res, status, { error: status === 500 ? 'Server error' : status === 503 ? 'Database unavailable.' : err.message });
  }
});

server.listen(PORT, HOST, () => {
  adminHourly.initAdminHourlyScheduler();
  console.log(`Leak World server running on http://${HOST}:${PORT}`);
  console.log(`Postgres: ${pool ? 'enabled' : 'disabled (set DATABASE_URL)'}`);
  if (R2_WORKER_ORIGIN) console.log(`R2 media: proxied via Worker (${R2_WORKER_ORIGIN})`);
  else if (process.env.RCLONE_CONFIG_R2_ACCESS_KEY_ID) console.log('R2 media: rclone stream (dev)');
  else console.log('R2 media: disabled — set R2_WORKER_ORIGIN on VPS or rclone env locally');
  console.log(`Admin /admin → password${process.env.ADMIN_DISCORD_WEBHOOK_URL ? ' + Discord' : ' (set ADMIN_DISCORD_WEBHOOK_URL to notify)'}`);
});

process.on('SIGTERM', async () => {
  await pool?.end().catch(() => {});
  server.close(() => process.exit(0));
});
