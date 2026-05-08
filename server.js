'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { Pool } = require('pg');
const { categoryNames, creators: fallbackCreators, shorts: fallbackShorts } = require('./server/catalog');

const PORT = Number(process.env.PORT || 3002);
const HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const SESSION_COOKIE = 'lw_session';
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.TBW_PEPPER || 'dev-session-secret-change-me';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 14);
const ONLINE_CAPACITY = Math.max(1, Number(process.env.ONLINE_CAPACITY || 100));
const SKIP_QUEUE_PRICE_CENTS = Math.max(0, Number(process.env.SKIP_QUEUE_PRICE_CENTS || 499));
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
  : null;

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
  if (process.env.NODE_ENV === 'production' || process.env.SECURE_COOKIES === '1') parts.push('Secure');
  appendCookie(res, parts.join('; '));
}

function clearSessionCookie(res) {
  appendCookie(res, `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
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
  return pool.query(text, values);
}

async function ensureCatalogSeeded() {
  if (!pool || catalogSeeded) return;
  const check = await dbQuery('select count(*)::int as count from creators');
  if (Number(check.rows[0]?.count || 0) === 0) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      for (const creator of fallbackCreators) {
        await client.query(
          `insert into creators
            (rank, name, slug, category, tagline, media_count, free_count, premium_count, heat, accent)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           on conflict (slug) do nothing`,
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
      for (const item of fallbackShorts) {
        await client.query(
          `insert into media_items
            (id, creator_slug, title, media_type, tier, duration_seconds, views, likes, status)
           values ($1,$2,$3,'short',$4,$5,$6,$7,'published')
           on conflict (id) do nothing`,
          [
            item.id,
            item.creatorSlug,
            item.title,
            item.tier,
            durationToSeconds(item.duration),
            item.views,
            item.likes,
          ],
        );
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }
  catalogSeeded = true;
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
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    tier: row.tier || 'free',
    createdAt: row.created_at,
  };
}

async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await dbQuery(
    'insert into sessions (token_hash, user_id, expires_at, last_seen_at) values ($1,$2,$3,now())',
    [tokenHash(token), userId, expiresAt],
  );
  setSessionCookie(res, token);
}

async function currentUser(req) {
  if (!pool) return null;
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const found = await dbQuery(
    `select u.id, u.email, u.username, u.tier, u.created_at
     from sessions s
     join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now()
     limit 1`,
    [tokenHash(token)],
  );
  if (!found.rows[0]) return null;
  await dbQuery('update sessions set last_seen_at = now() where token_hash = $1', [tokenHash(token)]).catch(() => {});
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
  const email = String(body.email || '').trim().toLowerCase();
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email.';
  if (!/^[a-zA-Z0-9_-]{3,24}$/.test(username)) return 'Username must be 3-24 characters.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  return null;
}

async function routeApi(req, res, url) {
  const method = (req.method || 'GET').toUpperCase();

  if (url.pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, database: !!pool, mode: 'rebuilt' });
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
    const email = String(body.email).trim().toLowerCase();
    const username = String(body.username).trim();
    const password = String(body.password);
    try {
      const inserted = await dbQuery(
        `insert into users (email, username, password_hash)
         values ($1,$2,$3)
         returning id, email, username, tier, created_at`,
        [email, username, passwordHash(password)],
      );
      await createSession(res, inserted.rows[0].id);
      return sendJson(res, 201, { user: normalizeUser(inserted.rows[0]) });
    } catch (err) {
      if (String(err.code) === '23505') return sendJson(res, 409, { error: 'Email or username already exists.' });
      throw err;
    }
  }

  if (url.pathname === '/api/auth/login' && method === 'POST') {
    if (!pool) return sendJson(res, 503, { error: 'Postgres is not configured. Set DATABASE_URL.' });
    const body = await readJson(req);
    const identifier = String(body.identifier || body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!identifier || !password) return sendJson(res, 400, { error: 'Email/username and password are required.' });
    const found = await dbQuery(
      `select id, email, username, password_hash, tier, created_at
       from users
       where lower(email) = $1 or lower(username) = $1
       limit 1`,
      [identifier],
    );
    const row = found.rows[0];
    if (!row || !verifyPassword(password, row.password_hash)) {
      return sendJson(res, 401, { error: 'Invalid credentials.' });
    }
    await createSession(res, row.id);
    return sendJson(res, 200, { user: normalizeUser(row) });
  }

  if (url.pathname === '/api/auth/logout' && method === 'POST') {
    await destroySession(req, res);
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === '/api/queue/status' && method === 'GET') {
    const online = pool
      ? Number((await dbQuery("select count(*)::int as count from sessions where last_seen_at > now() - interval '5 minutes'")).rows[0]?.count || 0)
      : 0;
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
    let rows = fallbackCreators;
    if (pool) {
      await ensureCatalogSeeded();
      const out = await dbQuery(
        `select rank, name, slug, category, tagline, media_count, free_count, premium_count, heat, accent
         from creators
         where ($1 = '' or lower(name) like '%' || $1 || '%')
           and ($2 = '' or category = $2)
         order by rank asc`,
        [q, category],
      );
      rows = out.rows.map((row) => ({
        rank: row.rank,
        name: row.name,
        slug: row.slug,
        category: row.category,
        tagline: row.tagline,
        mediaCount: Number(row.media_count || 0),
        freeCount: Number(row.free_count || 0),
        premiumCount: Number(row.premium_count || 0),
        heat: Number(row.heat || 0),
        accent: row.accent || 'pink',
      }));
    }
    if (!pool) {
      rows = rows.filter((row) => (!q || row.name.toLowerCase().includes(q)) && (!category || row.category === category));
    }
    return sendJson(res, 200, { creators: rows });
  }

  if (url.pathname === '/api/shorts' && method === 'GET') {
    let rows = fallbackShorts;
    if (pool) {
      await ensureCatalogSeeded();
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
        duration: secondsToDuration(row.duration_seconds),
        views: Number(row.views || 0),
        likes: Number(row.likes || 0),
      }));
    }
    return sendJson(res, 200, { shorts: rows });
  }

  if (url.pathname === '/api/checkout/plans' && method === 'GET') {
    return sendJson(res, 200, {
      plans: [
        { key: 'basic', name: 'Basic', tier: 1, priceCents: 999, mediaAccess: 'Free previews plus basic vault access' },
        { key: 'premium', name: 'Premium', tier: 2, priceCents: 2499, mediaAccess: 'Premium videos, photo sets, and request priority' },
        { key: 'ultimate', name: 'Ultimate', tier: 3, priceCents: 3999, mediaAccess: 'Everything plus skip-queue priority when payments go live' },
      ],
      paymentsEnabled: false,
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (url.pathname.startsWith('/api/')) return await routeApi(req, res, url);
    return await sendStatic(req, res, url);
  } catch (err) {
    const status = err.message === 'invalid_json' ? 400 : err.message === 'payload_too_large' ? 413 : 500;
    console.error('[server]', err);
    return sendJson(res, status, { error: status === 500 ? 'Server error' : err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Leak World server running on http://${HOST}:${PORT}`);
  console.log(`Postgres: ${pool ? 'enabled' : 'disabled (set DATABASE_URL)'}`);
});

process.on('SIGTERM', async () => {
  await pool?.end().catch(() => {});
  server.close(() => process.exit(0));
});
