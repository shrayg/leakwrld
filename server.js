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
const {
  PROGRAM_RULES,
  TIER_LADDER,
  REVSHARE_LADDER,
  TIER_RANK,
  entitlementsFor,
  nextTierGoal,
  nextRevshareGoal,
  effectiveTier,
  trackCreditIp,
} = require('./server/referralProgram');
const adminHourly = require('./server/adminHourly');
const adminDashboard = require('./server/adminDashboard');
const adminUserActions = require('./server/adminUserActions');
const mediaAnalytics = require('./server/mediaAnalytics');
const { getSupabaseAdminClient, supabaseEnabled } = require('./server/supabaseClient');
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

async function mediaStatsForStorageKeys(keys) {
  const uniqueKeys = Array.from(new Set((keys || []).filter(Boolean)));
  const stats = new Map();
  for (const key of uniqueKeys) {
    stats.set(key, { views: 0, likes: 0, dislikes: 0 });
  }
  if (!pool || !uniqueKeys.length) return stats;
  try {
    const { rows } = await dbQuery(
      `select mi.storage_path,
        coalesce(mi.views, 0)::int as views,
        coalesce(mi.likes, 0)::int as likes,
        coalesce(d.dislikes, 0)::int as dislikes
       from media_items mi
       left join (
         select path as storage_path, count(*)::int as dislikes
         from analytics_events
         where event_type = 'media_dislike'
           and path = any($1::text[])
         group by path
       ) d on d.storage_path = mi.storage_path
       where mi.storage_path = any($1::text[])`,
      [uniqueKeys],
    );
    for (const row of rows) {
      stats.set(row.storage_path, {
        views: Number(row.views || 0),
        likes: Number(row.likes || 0),
        dislikes: Number(row.dislikes || 0),
      });
    }
  } catch (err) {
    console.error('[media stats lookup]', err.code || '', err.message || err);
  }
  return stats;
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
  const match = String(key || '').match(/^videos\/[a-z0-9-]+\/(free|tier1|tier2|tier3)\//i);
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

const MANIFEST_TIER_KEYS = ['free', 'tier1', 'tier2', 'tier3'];

function sumManifestByTierAcrossCreators() {
  const sums = {
    free: { count: 0, bytes: 0 },
    tier1: { count: 0, bytes: 0 },
    tier2: { count: 0, bytes: 0 },
    tier3: { count: 0, bytes: 0 },
  };
  for (const creator of fallbackReadyCreators) {
    const manifest = loadMediaManifest(creator.slug);
    const by = manifest?.totals?.byTier;
    if (!by || typeof by !== 'object') continue;
    for (const key of MANIFEST_TIER_KEYS) {
      const cell = by[key];
      if (!cell) continue;
      sums[key].count += Number(cell.count || 0);
      sums[key].bytes += Number(cell.bytes || 0);
    }
  }
  return sums;
}

/** Video files only (manifest `kind` / extension), summed per vault tier across creators. */
function sumManifestVideosByVaultTierAcrossCreators() {
  const sums = { free: 0, tier1: 0, tier2: 0, tier3: 0 };
  const videoExt = /\.(mp4|mov|webm|m4v|mkv|avi|wmv)$/i;
  for (const creator of fallbackReadyCreators) {
    const manifest = loadMediaManifest(creator.slug);
    const items = manifest?.items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const tier = String(item?.tier || '').toLowerCase();
      if (!MANIFEST_TIER_KEYS.includes(tier)) continue;
      const kind = String(item?.kind || '').toLowerCase();
      const ext = String(item?.ext || '').toLowerCase();
      const isVideo = kind === 'video' || videoExt.test(ext);
      if (!isVideo) continue;
      sums[tier] += 1;
    }
  }
  return sums;
}

const checkoutLibraryMatrixCache = { at: 0, value: null };
const CHECKOUT_LIBRARY_TTL_MS = 5 * 60 * 1000;

/** Cumulative files + bytes each subscription tier can access (manifest tiers). */
function getCheckoutLibraryMatrix() {
  const now = Date.now();
  if (checkoutLibraryMatrixCache.value && now - checkoutLibraryMatrixCache.at < CHECKOUT_LIBRARY_TTL_MS) {
    return checkoutLibraryMatrixCache.value;
  }
  const s = sumManifestByTierAcrossCreators();
  const v = sumManifestVideosByVaultTierAcrossCreators();
  const f = s.free;
  const t1 = s.tier1;
  const t2 = s.tier2;
  const t3 = s.tier3;
  const value = {
    free: { fileCount: f.count, bytes: f.bytes },
    basic: { fileCount: f.count + t1.count, bytes: f.bytes + t1.bytes },
    premium: { fileCount: f.count + t1.count + t2.count, bytes: f.bytes + t1.bytes + t2.bytes },
    ultimate: {
      fileCount: f.count + t1.count + t2.count + t3.count,
      bytes: f.bytes + t1.bytes + t2.bytes + t3.bytes,
    },
    videoCountsByVault: {
      free: v.free,
      tier1: v.tier1,
      tier2: v.tier2,
      tier3: v.tier3,
    },
  };
  checkoutLibraryMatrixCache = { at: now, value };
  return value;
}

/** Prefer stills for gallery; fall back to video, then any allowed item. */
function pickRandomPreviewFromManifest(items, allowedTierSet, rng) {
  const allowed = (items || []).filter((it) => it && it.key && allowedTierSet.has(it.tier));
  if (!allowed.length) return null;
  const images = allowed.filter((it) => (it.kind || '') === 'image');
  const videos = allowed.filter((it) => (it.kind || '') === 'video');
  const pool = images.length ? images : videos.length ? videos : allowed;
  const idx = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  return pool[idx] || null;
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

function extractSellAuthProductId(invoice) {
  try {
    const items = invoice?.items || invoice?.invoice_json?.items || invoice?.invoiceJson?.items;
    if (!Array.isArray(items)) return null;
    for (const it of items) {
      const pid = it?.product?.id ?? it?.product_id ?? it?.productId;
      if (pid != null && String(pid).trim()) return String(pid).trim();
    }
  } catch {
    /* ignore */
  }
  return null;
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

/**
 * Decide whether a new signup should count toward the referrer's totals.
 *
 *  Rules (in order):
 *    1. Self-referral (referrer signed up from the same IP) → drop.
 *    2. Same IP already credited the referrer before → drop (one credit per IP).
 *    3. Otherwise → counted, IP added to the referrer's credit list.
 *
 *  Returns `{ counted, fraudReason, nextCreditIps }`. Caller persists the
 *  `referral_credit_ips` JSON only when `counted` is true.
 */
async function evaluateReferralCredit(client, referrerId, signupIp) {
  const r = await client.query(
    'select signup_ip, referral_credit_ips from users where id = $1 limit 1',
    [referrerId],
  );
  const row = r.rows[0];
  if (!row) return { counted: false, fraudReason: 'referrer_missing', nextCreditIps: [] };
  const ip = String(signupIp || '').trim();
  if (!ip || ip === 'unknown') {
    /** No IP captured — count it (better to miss a fraud case than reject a real user). */
    return { counted: true, fraudReason: null, nextCreditIps: Array.isArray(row.referral_credit_ips) ? row.referral_credit_ips : [] };
  }
  if (row.signup_ip && String(row.signup_ip).trim() === ip) {
    return { counted: false, fraudReason: 'same_ip_as_referrer', nextCreditIps: row.referral_credit_ips || [] };
  }
  const existing = Array.isArray(row.referral_credit_ips) ? row.referral_credit_ips : [];
  const { list, duplicate } = trackCreditIp(existing, ip);
  if (duplicate) {
    return { counted: false, fraudReason: 'duplicate_ip_credit', nextCreditIps: existing };
  }
  return { counted: true, fraudReason: null, nextCreditIps: list };
}

/**
 * Apply tier / revshare entitlements to a referrer after a new counted signup.
 *
 * Idempotent — only writes when the user *doesn't* already have the
 * entitlement at the higher level. Each grant produces a `referral_rewards`
 * row so we have a forever audit trail.
 */
async function applyReferralEntitlements(client, referrerId, referredId) {
  const r = await client.query(
    `select referral_signups_count, lifetime_tier, revshare_unlocked_at, revshare_rate_bps
     from users where id = $1 limit 1`,
    [referrerId],
  );
  const row = r.rows[0];
  if (!row) return null;
  const count = Number(row.referral_signups_count || 0);
  const { lifetimeTier: targetTier, revshareRateBps: targetRate } = entitlementsFor(count);

  const currentLifetime = row.lifetime_tier || null;
  const currentRate = Number(row.revshare_rate_bps || 0);

  const promoteTier =
    targetTier && (TIER_RANK[targetTier] ?? 0) > (TIER_RANK[currentLifetime] ?? 0);
  const promoteRate = targetRate > currentRate;
  const unlockingRevshare = currentRate === 0 && targetRate > 0;

  if (promoteTier) {
    await client.query(
      `update users
         set lifetime_tier = $2,
             tier_granted_at = coalesce(tier_granted_at, now()),
             updated_at = now()
       where id = $1`,
      [referrerId, targetTier],
    );
    await client.query(
      `insert into referral_rewards (referrer_user_id, referred_user_id, reward_type, tier_granted, notes)
       values ($1, $2, 'lifetime_tier_grant', $3, $4)`,
      [referrerId, referredId, targetTier, `Auto-granted at ${count} signups.`],
    );
  }

  if (promoteRate) {
    await client.query(
      `update users
         set revshare_rate_bps = $2,
             revshare_unlocked_at = coalesce(revshare_unlocked_at, now()),
             updated_at = now()
       where id = $1`,
      [referrerId, targetRate],
    );
    if (unlockingRevshare) {
      await client.query(
        `insert into referral_rewards (referrer_user_id, referred_user_id, reward_type, revshare_rate_bps, notes)
         values ($1, $2, 'revshare_unlocked', $3, $4)`,
        [referrerId, referredId, targetRate, `Unlocked at ${count} signups.`],
      );
    } else {
      await client.query(
        `insert into referral_rewards (referrer_user_id, referred_user_id, reward_type, revshare_rate_bps, notes)
         values ($1, $2, 'revshare_unlocked', $3, $4)`,
        [referrerId, referredId, targetRate, `Rate bumped to ${(targetRate / 100).toFixed(2)}% at ${count} signups.`],
      );
    }
  }

  return { count, lifetimeTier: promoteTier ? targetTier : currentLifetime, revshareRateBps: promoteRate ? targetRate : currentRate };
}

/**
 * Accrue revshare on a referred user's payment.
 *
 *  Called from every payment-insertion path. No-op if:
 *    - referred user has no referrer
 *    - referrer hasn't unlocked revshare yet (< 10 signups)
 *    - amount is zero / negative
 */
async function accrueReferralRevshare(client, paymentId, payingUserId, amountCents) {
  if (!paymentId || !payingUserId || !Number.isFinite(Number(amountCents)) || Number(amountCents) <= 0) return;
  const r = await client.query(
    `select u.referred_by_user_id, ref.revshare_rate_bps, ref.revshare_unlocked_at
       from users u
       left join users ref on ref.id = u.referred_by_user_id
      where u.id = $1
      limit 1`,
    [payingUserId],
  );
  const row = r.rows[0];
  if (!row || !row.referred_by_user_id || !row.revshare_unlocked_at) return;
  const rateBps = Number(row.revshare_rate_bps || 0);
  if (rateBps <= 0) return;
  const accrual = Math.floor((Math.max(0, Number(amountCents)) * rateBps) / 10000);
  if (accrual <= 0) return;
  await client.query(
    `insert into referral_rewards
       (referrer_user_id, referred_user_id, source_payment_id, reward_type,
        revshare_rate_bps, amount_cents, status)
     values ($1, $2, $3, 'revshare_accrual', $4, $5, 'pending_payout')`,
    [row.referred_by_user_id, payingUserId, paymentId, rateBps, accrual],
  );
  await client.query(
    `update users
        set referral_earned_cents = referral_earned_cents + $2,
            updated_at = now()
      where id = $1`,
    [row.referred_by_user_id, accrual],
  );
}

function normalizeUser(row) {
  if (!row) return null;
  /** Effective tier blends the manually-granted tier with the lifetime tier
   *  earned via the referral program. The lifetime tier never decays so it
   *  always wins ties — see server/referralProgram.js for the ladder. */
  const baseTier = normalizeAccountTier(row.tier);
  const lifetime = row.lifetime_tier ? normalizeAccountTier(row.lifetime_tier) : null;
  const tier = lifetime ? effectiveTier(baseTier, lifetime) : baseTier;
  return {
    id: row.id,
    email: row.email,
    phone: row.phone || null,
    username: row.username,
    tier,
    rawTier: row.tier || 'free',
    lifetimeTier: lifetime,
    tierLabel: accountTierLabel(tier),
    manifestTiers: userManifestTiers(tier),
    referralCode: row.referral_code,
    referralSignups: Number(row.referral_signups_count || 0),
    referredByUserId: row.referred_by_user_id || null,
    revshareUnlockedAt: row.revshare_unlocked_at || null,
    revshareRateBps: Number(row.revshare_rate_bps || 0),
    referralEarnedCents: Number(row.referral_earned_cents || 0),
    referralPaidCents: Number(row.referral_paid_cents || 0),
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
              u.lifetime_tier, u.revshare_unlocked_at, u.revshare_rate_bps,
              u.referral_earned_cents, u.referral_paid_cents,
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

  if (url.pathname === '/api/redeem' && method === 'POST') {
    if (!pool) return sendJson(res, 503, { error: 'Postgres is not configured. Set DATABASE_URL.' });
    if (!supabaseEnabled()) return sendJson(res, 503, { error: 'Redeem is not configured.' });
    const user = await currentUser(req);
    if (!user) return sendJson(res, 401, { error: 'Login required.' });
    const body = await readJson(req);
    const emailRaw = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) return sendJson(res, 400, { error: 'Enter a valid email.' });

    const sb = getSupabaseAdminClient();
    if (!sb) return sendJson(res, 503, { error: 'Redeem is not configured.' });

    const { data: invoices, error } = await sb
      .from('sellauth_invoices')
      .select('*')
      .eq('email', emailRaw)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('[redeem]', error);
      return sendJson(res, 500, { error: 'Redeem lookup failed.' });
    }
    const invoiceList = Array.isArray(invoices) ? invoices : [];
    if (invoiceList.length === 0) return sendJson(res, 404, { error: 'No purchase found for that email.' });

    const isPaidStatus = (raw) => /paid|complete|completed|success|successful|processed|confirming/i.test(String(raw || ''));
    const paid = invoiceList.find((x) => isPaidStatus(x.status)) || null;
    if (!paid) return sendJson(res, 400, { error: 'Purchase exists but is not marked paid yet.' });

    const productId = String(
      paid.product_id || extractSellAuthProductId(paid.invoice_json || paid) || '',
    ).trim();
    const inferred =
      productId === '713938'
        ? 'ultimate'
        : productId === '713936'
          ? 'premium'
          : productId === '713867'
            ? 'basic'
            : null;
    if (!inferred) return sendJson(res, 400, { error: 'Could not infer tier from invoice (missing product id).' });

    const invoiceId = Number(paid.sellauth_invoice_id);
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) return sendJson(res, 400, { error: 'Invoice id is invalid.' });

    const client = await pool.connect();
    try {
      await client.query('begin');

      await client.query(
        `create table if not exists sellauth_redemptions (
          sellauth_invoice_id bigint primary key,
          redeemed_at timestamptz not null default now(),
          user_id uuid not null references users (id) on delete cascade,
          email text not null,
          tier_granted text not null check (tier_granted in ('basic','premium','ultimate','admin')),
          unique_id text,
          status text,
          invoice_json jsonb not null default '{}'::jsonb
        )`,
      );

      const already = await client.query(
        'select sellauth_invoice_id from sellauth_redemptions where sellauth_invoice_id = $1 limit 1',
        [invoiceId],
      );
      if (already.rows[0]) {
        await client.query('rollback');
        return sendJson(res, 409, { error: 'That invoice has already been redeemed.' });
      }

      await client.query('update users set email = $2, tier = $3, updated_at = now() where id = $1', [
        user.id,
        emailRaw,
        inferred,
      ]);

      const paymentCents =
        Number(String(paid.paid_usd || paid.price_usd || paid.price || '0').replace(/[^0-9.]/g, '')) * 100 || 0;
      let insertedPaymentId = null;
      try {
        const pmRow = await client.query(
          `insert into payments (user_id, provider, amount_cents, currency, plan_label, tier_granted, screenshot_url, notes)
           values ($1,$2,$3,$4,$5,$6,$7,$8)
           returning id`,
          [
            user.id,
            'xyzpurchase',
            paymentCents,
            paid.currency ? String(paid.currency) : 'USD',
            `sellauth:product:${productId}`,
            inferred,
            null,
            `sellauth_invoice_id=${invoiceId} status=${String(paid.status || '').slice(0, 48)} product_id=${productId}`,
          ],
        );
        insertedPaymentId = pmRow.rows[0]?.id || null;
      } catch (paymentErr) {
        /** Soft-fail: legacy behavior was to swallow errors here so the user
         *  still got their tier even if the analytics insert blew up. We
         *  preserve that, just no longer silent — and we skip the revshare
         *  accrual since we don't have a payment id. */
        console.error('[redeem-payment-insert]', paymentErr);
      }
      if (insertedPaymentId) {
        /** Referral revshare attribution — pays the referrer (if any) at
         *  whatever rate they've unlocked. See `accrueReferralRevshare`. */
        try {
          await accrueReferralRevshare(client, insertedPaymentId, user.id, paymentCents);
        } catch (accrueErr) {
          console.error('[redeem-revshare]', accrueErr);
        }
      }

      await client.query(
        `insert into sellauth_redemptions (sellauth_invoice_id, user_id, email, tier_granted, unique_id, status, invoice_json)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [
          invoiceId,
          user.id,
          emailRaw,
          inferred,
          paid.unique_id ? String(paid.unique_id) : null,
          paid.status ? String(paid.status) : null,
          JSON.stringify(paid.invoice_json || {}),
        ],
      );

      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => {});
      console.error('[redeem]', err);
      return sendJson(res, 500, { error: 'Redeem failed.' });
    } finally {
      client.release();
    }

    const refreshed = await currentUser(req);
    return sendJson(res, 200, { ok: true, user: refreshed, tier: inferred, invoiceId });
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
    const ip = clientIp(req) || 'unknown';
    /** Referral attribution chain. Referral codes are NEVER user-typed —
     *  every account's 6-char code is system-generated and the referrer is
     *  identified only by the link the new user clicked. So we only consult:
     *    1. `lw_ref` cookie — set on every request that carries `?ref=` in
     *       the URL (incl. /r/:code). 30-day TTL on the user's browser.
     *    2. `referral_visits` table by IP — fallback for cleared cookies,
     *       different browsers on the same network, or "browsed for days
     *       then signed up". Holds the LAST code seen for the IP.
     *  Each layer is consulted only when the previous one is empty. */
    const refFromCookie = normalizeReferralCode(parseCookies(req)[LW_REF_COOKIE]);
    const refFromIp = !refFromCookie ? normalizeReferralCode(await lookupReferralByIp(ip)) : '';
    const refNorm = refFromCookie || refFromIp;
    /** Track which source attributed the signup — useful for analytics and
     *  debugging which fallback layers are actually pulling weight. */
    const refSource = refFromCookie ? 'cookie' : refFromIp ? 'ip' : null;

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
              lifetime_tier, revshare_unlocked_at, revshare_rate_bps,
              referral_earned_cents, referral_paid_cents,
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
        /** Anti-fraud: same-IP referrals don't count, and each IP can only
         *  give a referrer credit once. We still write the ledger row so the
         *  link survives in admin views — `counted=false` tells the trigger
         *  not to bump the visible total. */
        const credit = await evaluateReferralCredit(client, referrerId, ip);
        await client.query(
          `insert into referral_signups
             (referrer_user_id, referred_user_id, referral_code_used, counted, fraud_reason)
           values ($1,$2,$3,$4,$5)`,
          [referrerId, newUser.id, refNorm, credit.counted, credit.fraudReason],
        );
        if (credit.counted) {
          await client.query(
            `update users
                set referral_credit_ips = $2::jsonb,
                    updated_at = now()
              where id = $1`,
            [referrerId, JSON.stringify(credit.nextCreditIps)],
          );
          /** Trigger has already bumped the count; now decide if a tier or
           *  revshare unlock fired. Each grant is idempotent — no double
           *  grants if the user crossed multiple thresholds at once. */
          await applyReferralEntitlements(client, referrerId, newUser.id);
        }
      }

      await client.query('commit');
      authThrottleClear(signupThrottle, ip);
      /** Consume the referral artefacts now that this signup is done:
       *    - Burn the cookie so it can't double-attribute on a 2nd account.
       *    - Delete the IP row so a different person on the same NAT/wifi
       *      who later signs up cold (no fresh referral click) doesn't keep
       *      getting attributed to the same stale code.
       *  Both are fire-and-forget; the signup itself is already committed. */
      if (refSource === 'cookie' || refSource === 'ip') {
        const expire = [`${LW_REF_COOKIE}=`, 'Path=/', 'SameSite=Lax', 'Max-Age=0'];
        if (secureCookiesEnabled()) expire.push('Secure');
        const prev = res.getHeader('Set-Cookie');
        res.setHeader(
          'Set-Cookie',
          prev ? (Array.isArray(prev) ? prev.concat(expire.join('; ')) : [prev, expire.join('; ')]) : expire.join('; '),
        );
      }
      if (ip && ip !== 'unknown') {
        dbQuery('delete from referral_visits where ip = $1', [ip]).catch(() => {});
      }
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
              lifetime_tier, revshare_unlocked_at, revshare_rate_bps,
              referral_earned_cents, referral_paid_cents,
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

  /* ─── Public referral API ───────────────────────────────────────────────
   *
   *  /api/referral/program   — static rules (ladder, payouts, telegram).
   *                            Available to guests so the "How it works"
   *                            modal can render without an account.
   *  /api/referral/status    — auth-only; your code, link, count, goals,
   *                            entitlements, earnings.
   *  /api/referral/leaderboard — public weekly top-10 by counted signups.
   *  /api/me/referral/payout-handle — auth-only; save your Telegram handle.
   */
  if (url.pathname === '/api/referral/program' && method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      memo: PROGRAM_RULES.memo,
      tierLadder: TIER_LADDER,
      revshareLadder: REVSHARE_LADDER,
      telegramPayoutUrl: PROGRAM_RULES.telegramPayoutUrl(),
      redditFastUrl: PROGRAM_RULES.redditFastUrl(),
    });
  }

  if (url.pathname === '/api/referral/status' && method === 'GET') {
    const me = await currentUser(req);
    if (!me) return sendJson(res, 401, { error: 'Sign in required.' });
    const count = Number(me.referralSignups || 0);
    const origin =
      String(process.env.LW_PUBLIC_BASE || '').trim() ||
      (req.headers && req.headers.host ? `https://${req.headers.host}` : '');
    const code = me.referralCode || '';
    const shareUrl = code ? `${origin}/r/${code}` : '';
    const longUrl = code && origin ? `${origin}/?ref=${code}` : '';
    const tierGoal = nextTierGoal(count);
    const revGoal = nextRevshareGoal(count);
    return sendJson(res, 200, {
      ok: true,
      code,
      url: shareUrl || longUrl,
      shareUrl,
      longUrl,
      count,
      goal: tierGoal.goal,
      goalLabel: tierGoal.label,
      nextTier: tierGoal.tier,
      revshareUnlocked: !!me.revshareUnlockedAt,
      revshareRateBps: Number(me.revshareRateBps || 0),
      revshareNextGoal: revGoal.goal,
      revshareNextRateBps: revGoal.rateBps,
      lifetimeTier: me.lifetimeTier || null,
      earnedCents: Number(me.referralEarnedCents || 0),
      paidCents: Number(me.referralPaidCents || 0),
      pendingCents: Math.max(0, Number(me.referralEarnedCents || 0) - Number(me.referralPaidCents || 0)),
      telegramPayoutUrl: PROGRAM_RULES.telegramPayoutUrl(),
    });
  }

  if (url.pathname === '/api/referral/leaderboard' && method === 'GET') {
    /** Soft-fail when the DB is unreachable — the leaderboard is non-critical
     *  UX. A 500 here would make the home page look broken; an empty list is
     *  a strictly better default. */
    if (!pool || databaseDisabledReason) {
      return sendJson(res, 200, { ok: true, page: 0, totalPages: 1, entries: [], period: 'weekly' });
    }
    const periodRaw = String(url.searchParams.get('period') || 'weekly').toLowerCase();
    const since = periodRaw === 'alltime' ? null : "now() - interval '7 days'";
    const limit = 10;
    const page = Math.max(0, Math.floor(Number(url.searchParams.get('page') || 0)) || 0);
    const offset = page * limit;
    try {
      const where = since
        ? `where rs.counted = true and rs.created_at > ${since}`
        : 'where rs.counted = true';
      const rows = await dbQuery(
        `select u.username, count(*)::int as c
         from referral_signups rs
         join users u on u.id = rs.referrer_user_id
         ${where}
         group by u.id, u.username
         having count(*) > 0
         order by c desc, u.username asc
         limit $1 offset $2`,
        [limit, offset],
      );
      const totalRow = await dbQuery(
        `select count(*)::int as c from (
           select rs.referrer_user_id
           from referral_signups rs
           ${where}
           group by rs.referrer_user_id
           having count(*) > 0
         ) t`,
      );
      const total = totalRow.rows[0]?.c || 0;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const entries = rows.rows.map((r, i) => ({
        rank: offset + i + 1,
        username: r.username,
        count: Number(r.c || 0),
      }));
      return sendJson(res, 200, { ok: true, page, totalPages, entries, period: periodRaw });
    } catch (err) {
      console.error('[referral leaderboard]', err);
      /** Same as above — never break the home page over a leaderboard query. */
      return sendJson(res, 200, { ok: true, page: 0, totalPages: 1, entries: [], period: periodRaw });
    }
  }

  if (url.pathname === '/api/me/referral/payout-handle' && method === 'POST') {
    const me = await currentUser(req);
    if (!me) return sendJson(res, 401, { error: 'Sign in required.' });
    const body = await readJson(req);
    const handle = String(body.handle || '').trim().slice(0, 64);
    await dbQuery('update users set referral_payout_handle = $2, updated_at = now() where id = $1', [
      me.id,
      handle || null,
    ]);
    return sendJson(res, 200, { ok: true, handle });
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

  /* Admin: list referrers with a pending payout balance.
   *   GET /api/admin/referral-payouts/pending
   *   → [{ userId, username, email, telegramHandle, earnedCents, paidCents,
   *        pendingCents, signups, rateBps }] */
  if (url.pathname === '/api/admin/referral-payouts/pending' && method === 'GET') {
    if (!adminHourly.verifyAdminCookie(req)) {
      return sendJson(res, 401, { error: 'Admin authentication required.' });
    }
    if (!pool) return sendJson(res, 503, { error: 'Database not configured.' });
    try {
      const rows = await dbQuery(
        `select id, username, email, referral_payout_handle,
                referral_signups_count, revshare_rate_bps,
                referral_earned_cents, referral_paid_cents,
                (referral_earned_cents - referral_paid_cents) as pending_cents
         from users
         where referral_earned_cents > referral_paid_cents
         order by (referral_earned_cents - referral_paid_cents) desc
         limit 200`,
      );
      const entries = rows.rows.map((r) => ({
        userId: r.id,
        username: r.username,
        email: r.email,
        telegramHandle: r.referral_payout_handle,
        signups: Number(r.referral_signups_count || 0),
        rateBps: Number(r.revshare_rate_bps || 0),
        earnedCents: Number(r.referral_earned_cents || 0),
        paidCents: Number(r.referral_paid_cents || 0),
        pendingCents: Number(r.pending_cents || 0),
      }));
      return sendJson(res, 200, { ok: true, entries });
    } catch (err) {
      console.error('[admin referral-pending]', err);
      return sendJson(res, 500, { error: 'Query failed.' });
    }
  }

  /* Admin: record a manual payout (Telegram-verified) to a referrer.
   *   POST /api/admin/referral-payout
   *   body: { userId, amountCents, notes? } */
  if (url.pathname === '/api/admin/referral-payout' && method === 'POST') {
    if (!adminHourly.verifyAdminCookie(req)) {
      return sendJson(res, 401, { error: 'Admin authentication required.' });
    }
    if (!pool) return sendJson(res, 503, { error: 'Database not configured.' });
    const body = await readJson(req);
    const userId = String(body.userId || '').trim();
    const amt = Math.max(0, Math.floor(Number(body.amountCents) || 0));
    const notes = String(body.notes || '').slice(0, 480) || null;
    if (!userId || amt <= 0) return sendJson(res, 400, { error: 'userId and amountCents > 0 required.' });
    const client = await pool.connect();
    try {
      await client.query('begin');
      const cur = await client.query(
        'select referral_earned_cents, referral_paid_cents from users where id = $1 limit 1',
        [userId],
      );
      if (!cur.rows[0]) {
        await client.query('rollback');
        return sendJson(res, 404, { error: 'User not found.' });
      }
      const earned = Number(cur.rows[0].referral_earned_cents || 0);
      const paid = Number(cur.rows[0].referral_paid_cents || 0);
      if (paid + amt > earned) {
        await client.query('rollback');
        return sendJson(res, 400, {
          error: `Payout exceeds pending balance. Pending: ${(earned - paid) / 100} USD.`,
        });
      }
      await client.query(
        'update users set referral_paid_cents = referral_paid_cents + $2, updated_at = now() where id = $1',
        [userId, amt],
      );
      await client.query(
        `insert into referral_rewards (referrer_user_id, reward_type, amount_cents, status, notes)
         values ($1, 'cash_payout', $2, 'paid', $3)`,
        [userId, amt, notes],
      );
      /** Mark any pending accruals as paid, oldest first, up to the payout total. */
      await client.query(
        `update referral_rewards
            set status = 'paid'
          where id in (
            select id from referral_rewards
             where referrer_user_id = $1
               and reward_type = 'revshare_accrual'
               and status = 'pending_payout'
             order by created_at asc
             limit 9999
          )
            and (
              select coalesce(sum(amount_cents),0)
              from referral_rewards r2
              where r2.referrer_user_id = $1
                and r2.reward_type = 'revshare_accrual'
                and r2.status = 'paid'
            ) < $2`,
        [userId, paid + amt],
      );
      await client.query('commit');
      return sendJson(res, 200, { ok: true, paidCents: paid + amt });
    } catch (err) {
      await client.query('rollback').catch(() => {});
      console.error('[admin referral-payout]', err);
      return sendJson(res, 500, { error: 'Payout failed.' });
    } finally {
      client.release();
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

  if (url.pathname === '/api/admin/supabase-payments' && method === 'GET') {
    if (!adminHourly.verifyAdminCookie(req)) {
      return sendJson(res, 401, { error: 'Admin authentication required.' });
    }
    if (!supabaseEnabled()) return sendJson(res, 503, { error: 'Supabase is not configured.' });
    const sb = getSupabaseAdminClient();
    if (!sb) return sendJson(res, 503, { error: 'Supabase is not configured.' });
    const limit = Math.min(200, Math.max(10, Number(url.searchParams.get('limit') || 50) || 50));
    const { data, error } = await sb
      .from('sellauth_invoices')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error('[admin supabase payments]', error);
      return sendJson(res, 500, { error: 'Supabase query failed.' });
    }
    return sendJson(res, 200, { ok: true, invoices: data || [] });
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
    const sortRaw = String(url.searchParams.get('sort') || 'default').trim().toLowerCase();
    const sortKey =
      sortRaw === 'trending'
        ? 'trending'
        : sortRaw === 'top_views' || sortRaw === 'topviews' || sortRaw === 'views'
          ? 'top_views'
          : 'default';
    /** Default creator index order = all-time media views (same order as `sort=top_views`). */
    const orderByAllTimeViews = sortKey === 'default' || sortKey === 'top_views';
    /** `?include=all` opts into seeing creators without R2 content (admin/debug). */
    const includeAll = url.searchParams.get('include') === 'all';
    let rows = includeAll ? fallbackCreators : fallbackReadyCreators;
    let creatorsFromDb = false;
    if (pool && (await ensureCatalogSeeded())) {
      try {
        const orderSql =
          sortKey === 'trending'
            ? 'coalesce(trend.views_today, 0) desc, coalesce(views.total_views, 0) desc, c.rank asc'
            : 'coalesce(views.total_views, 0) desc, c.rank asc';
        const trendSelect =
          sortKey === 'trending' ? ', coalesce(trend.views_today, 0)::int as views_today' : '';
        const trendJoin =
          sortKey === 'trending'
            ? `left join (
                 select x.slug, count(*)::int as views_today
                 from (
                   select
                     case
                       when trim(e.path) like 'videos/%' then (regexp_match(split_part(trim(e.path), '?', 1), '^videos/([a-z0-9-]+)/'))[1]
                       when trim(e.path) ~ '^short-.+' then (regexp_match(trim(e.path), '^short-(.+)$'))[1]
                       else null
                     end as slug
                   from analytics_events e
                   where e.event_type = 'media_session_start'
                     and e.category = 'media'
                     and e.created_at >= (date_trunc('day', (now() AT TIME ZONE 'UTC')) AT TIME ZONE 'UTC')
                     and e.created_at < ((date_trunc('day', (now() AT TIME ZONE 'UTC')) + interval '1 day') AT TIME ZONE 'UTC')
                 ) x
                 where x.slug is not null
                 group by x.slug
               ) trend on trend.slug = c.slug`
            : '';
        const viewsJoin = `left join (
                 select m.creator_slug as slug, coalesce(sum(m.views), 0)::bigint as total_views
                 from media_items m
                 where m.status = 'published'
                 group by m.creator_slug
               ) views on views.slug = c.slug`;
        const out = await dbQuery(
          `select c.rank, c.name, c.slug, c.category, c.tagline, c.media_count, c.free_count, c.premium_count, c.heat, c.accent
                 , coalesce(views.total_views, 0)::bigint as views_all_time
                 ${trendSelect}
           from creators c
           ${viewsJoin}
           ${trendJoin}
           where ($1 = '' or lower(c.name) like '%' || $1 || '%')
             and ($2 = '' or c.category = $2)
           order by ${orderSql}`,
          [q, category],
        );
        creatorsFromDb = true;
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
            viewsAllTime: Number(row.views_all_time || 0),
            viewsToday: sortKey === 'trending' ? Number(row.views_today || 0) : undefined,
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
    if (!creatorsFromDb) {
      if (sortKey === 'trending') {
        rows = [...rows].sort(
          (a, b) =>
            (b.viewsAllTime || 0) - (a.viewsAllTime || 0) || (a.rank || 999) - (b.rank || 999),
        );
      } else if (orderByAllTimeViews) {
        rows = [...rows].sort(
          (a, b) =>
            (b.viewsAllTime || 0) - (a.viewsAllTime || 0) || (a.rank || 999) - (b.rank || 999),
        );
      }
    }
    if (orderByAllTimeViews || sortKey === 'trending') {
      rows = rows.map((row, index) => ({ ...row, rank: index + 1 }));
    }
    return sendJson(res, 200, { creators: rows });
  }

  /** Random accessible catalog item for home gallery (tier-filtered like /media). */
  const randomPreviewMatch = url.pathname.match(/^\/api\/creators\/([a-z0-9-]+)\/random-preview$/);
  if (randomPreviewMatch && method === 'GET') {
    const slug = randomPreviewMatch[1];
    const c = creatorBySlug.get(slug);
    if (!c) return sendJson(res, 404, { error: 'Creator not found.' });
    const user = await currentUser(req);
    const allowedTierSet = new Set(userManifestTiers(user));
    const manifest = loadMediaManifest(slug);
    const seed = String(url.searchParams.get('seed') || '').slice(0, 96);
    const rand = seed ? seededRandom(`${slug}:${seed}`) : () => Math.random();

    if (!manifest?.items?.length) {
      return sendJson(res, 200, {
        key: null,
        kind: null,
        tier: null,
        fallbackThumbnail: thumbnailFor(slug),
      });
    }

    const pick = pickRandomPreviewFromManifest(manifest.items, allowedTierSet, rand);
    if (!pick) {
      return sendJson(res, 200, {
        key: null,
        kind: null,
        tier: null,
        fallbackThumbnail: thumbnailFor(slug),
      });
    }
    return sendJson(res, 200, {
      key: pick.key,
      kind: pick.kind || 'other',
      tier: pick.tier,
      name: pick.name,
    });
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
    const pageItems = items.slice(offset, offset + limit);
    const statsByKey = await mediaStatsForStorageKeys(
      pageItems.filter((item) => allowedTierSet.has(item.tier)).map((item) => item.key),
    );
    items = pageItems.map((item, index) => {
      if (allowedTierSet.has(item.tier)) {
        return {
          ...item,
          ...(statsByKey.get(item.key) || { views: 0, likes: 0, dislikes: 0 }),
        };
      }
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
    const limit = Math.min(260, Math.max(1, Number(url.searchParams.get('limit') || 10)));
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
        {
          key: 'basic',
          name: 'Basic',
          tier: 1,
          priceCents: 999,
          mediaAccess:
            'Full basic vault with SD-quality streaming. Free previews everywhere — upgrade when you want deeper archives.',
        },
        {
          key: 'premium',
          name: 'Premium',
          tier: 2,
          priceCents: 2499,
          mediaAccess:
            'HD content across premium videos and photo sets, full archive access, plus priority on creator requests.',
        },
        {
          key: 'ultimate',
          name: 'Ultimate',
          tier: 3,
          priceCents: 3999,
          mediaAccess:
            'Everything in Premium in HD, plus skip-the-queue priority during peak hours — maximum access and polish.',
        },
      ],
      paymentsEnabled: false,
      libraryMatrix: getCheckoutLibraryMatrix(),
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
     *  zero. This endpoint always returns RAW bucket/catalog values. */
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
  if (ext === '.webp') return 'image/webp';
  if (ext === '.otf') return 'font/otf';
  if (ext === '.woff2') return 'font/woff2';
  return 'application/octet-stream';
}

/** Hashed build assets + fonts: long immutable cache. `/thumbnails/`: short TTL so replaced WebP thumbs propagate within a few hours. */
function cacheControlForStaticFile(filePath) {
  const n = String(filePath || '').replace(/\\/g, '/');
  if (n.includes('/thumbnails/')) {
    return 'public, max-age=10800'; /* 3 hours */
  }
  if (n.includes('/assets/') || n.includes('/fonts/')) {
    return 'public, max-age=31536000, immutable';
  }
  return 'public, max-age=300';
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
      'Cache-Control': cacheControlForStaticFile(normalized),
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
  const t0 = Date.now();
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
    const elapsed = Date.now() - t0;
    const slow = elapsed >= 2500 || upstream.status >= 400;
    const sample = Math.random() < 0.067;
    if (slow || sample) {
      console.warn(
        `[r2-worker-proxy] ${slow ? 'slow_or_error' : 'sample'} ms=${elapsed} status=${upstream.status} range=${req.headers.range ? '1' : '0'} key=${rawKey.slice(0, 80)}`,
      );
    }
    Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res);
  } catch (err) {
    const elapsed = Date.now() - t0;
    console.error('[r2-worker-proxy]', err, `after_ms=${elapsed}`);
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
  const privateMedia = requiredTier && requiredTier !== 'free';
  const imageThumb =
    !privateMedia &&
    ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);
  const rclonePublicCache = privateMedia
    ? 'private, max-age=300'
    : imageThumb
      ? 'public, max-age=2592000, immutable'
      : 'public, max-age=300';

  if (req.method === 'HEAD') {
    /** Cheap HEAD: don't actually fetch the body, just acknowledge. */
    res.writeHead(200, {
      'content-type': contentType,
      'accept-ranges': 'none',
      'cache-control': rclonePublicCache,
    });
    return res.end();
  }
  const { spawn } = require('node:child_process');
  const child = spawn('rclone', ['cat', `r2:leakwrld/${rawKey}`], { windowsHide: true });
  let headersSent = false;
  let aborted = false;
  child.stdout.on('data', (chunk) => {
    if (!headersSent) {
      res.writeHead(200, {
        'content-type': contentType,
        'cache-control': rclonePublicCache,
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

const LW_REF_COOKIE = 'lw_ref';
const LW_REF_MAX_AGE_DAYS = 30;

/** In-memory de-dupe so we don't pummel the DB with one upsert per asset
 *  request on the same page load. Keys = `${ip}|${code}`; entries expire
 *  after 60s so retries (e.g. user reopening the same tab) still record. */
const recentReferralVisits = new Map();
const RECENT_VISIT_TTL_MS = 60_000;

/** Persist a referral code → IP association so we can attribute a signup
 *  even if the cookie has been cleared / a different browser is used on
 *  the same network. Fire-and-forget — never blocks the request. */
function recordReferralVisit(ip, code) {
  if (!pool || databaseDisabledReason) return;
  const normIp = String(ip || '').trim();
  const normCode = normalizeReferralCode(code);
  if (!normIp || normIp === 'unknown' || !normCode) return;
  const key = `${normIp}|${normCode}`;
  const now = Date.now();
  const seen = recentReferralVisits.get(key);
  if (seen && now - seen < RECENT_VISIT_TTL_MS) return;
  recentReferralVisits.set(key, now);
  /** Cheap GC — drop stale entries opportunistically so the map can't grow
   *  unbounded under heavy traffic. */
  if (recentReferralVisits.size > 4096) {
    for (const [k, ts] of recentReferralVisits) {
      if (now - ts > RECENT_VISIT_TTL_MS) recentReferralVisits.delete(k);
    }
  }
  /** UPSERT: insert on first sight, otherwise update last_seen + (if a
   *  different code) overwrite the code so the LATEST referral link the
   *  user clicked wins at signup attribution. */
  dbQuery(
    `insert into referral_visits (ip, code)
       values ($1, $2)
       on conflict (ip) do update
         set code = excluded.code,
             last_seen_at = now(),
             first_seen_at = case
               when referral_visits.code = excluded.code then referral_visits.first_seen_at
               else now()
             end`,
    [normIp, normCode],
  ).catch((err) => {
    /** Best-effort — log but never propagate. */
    console.error('[recordReferralVisit]', err.message || err);
  });
}

/** Look up the most recent referral code seen for an IP, in case neither the
 *  body field nor the cookie carry a code at signup time. Returns null on
 *  miss or DB failure. */
async function lookupReferralByIp(ip) {
  if (!pool || databaseDisabledReason) return null;
  const normIp = String(ip || '').trim();
  if (!normIp || normIp === 'unknown') return null;
  try {
    const r = await dbQuery(
      'select code from referral_visits where ip = $1 limit 1',
      [normIp],
    );
    return r.rows[0]?.code || null;
  } catch (err) {
    console.error('[lookupReferralByIp]', err.message || err);
    return null;
  }
}

/** Persist the referral code on first contact so attribution survives multiple
 *  page navigations and tab switches before signup. 30-day TTL.
 *  Also records the IP→code association in `referral_visits` (best-effort)
 *  so attribution survives cookie clearing / cross-device on same network.
 *  Safe to call on every request — bails when the param isn't present. */
function captureReferralCookie(req, res, url) {
  const raw = url.searchParams.get('ref');
  const norm = normalizeReferralCode(raw);
  if (!norm) return;
  /** Always log the IP→code association, even if the cookie is already set —
   *  refreshes `last_seen_at` so stale visits don't beat fresh ones. */
  recordReferralVisit(clientIp(req), norm);
  const existing = parseCookies(req)[LW_REF_COOKIE];
  if (existing === norm) return;
  const cookie = [
    `${LW_REF_COOKIE}=${encodeURIComponent(norm)}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${LW_REF_MAX_AGE_DAYS * 24 * 60 * 60}`,
  ];
  if (secureCookiesEnabled()) cookie.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  res.setHeader(
    'Set-Cookie',
    prev ? (Array.isArray(prev) ? prev.concat(cookie.join('; ')) : [prev, cookie.join('; ')]) : cookie.join('; '),
  );
}

/** /r/:code → 302 to home with ?ref=:code AND a fallback cookie set, so the
 *  link looks less obviously affiliate-y and survives even if the user
 *  copy-pastes the destination URL without the query string. The redirect
 *  target also carries `?auth=signup` so the client auto-opens the signup
 *  modal — referral links are the highest-intent traffic we get. */
function handleReferralShortLink(req, res, url) {
  const raw = decodeURIComponent(url.pathname.slice(3));
  const norm = normalizeReferralCode(raw);
  if (!norm) {
    res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' });
    return res.end();
  }
  /** Set the cookie + log the IP visit on the redirect response. */
  captureReferralCookie(req, res, new URL(`/?ref=${norm}`, `http://${req.headers.host || `${HOST}:${PORT}`}`));
  res.writeHead(302, {
    Location: `/?ref=${norm}&auth=signup`,
    'Cache-Control': 'no-store',
  });
  return res.end();
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    /** Capture ?ref= on EVERY hit so the cookie persists for downstream signups. */
    captureReferralCookie(req, res, url);
    if (url.pathname.startsWith('/api/')) return await routeApi(req, res, url);
    if (url.pathname.startsWith('/r2/')) return await streamR2(req, res, url);
    if (url.pathname.startsWith('/r/') && url.pathname.length > 3) return handleReferralShortLink(req, res, url);
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
