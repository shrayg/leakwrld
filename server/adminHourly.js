'use strict';

const crypto = require('crypto');
const os = require('os');

const COOKIE_NAME = 'lw_admin';
const HOUR_MS = 60 * 60 * 1000;

function adminHmacSecret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.SESSION_SECRET || 'dev-admin-secret-change-me';
}

function secureCookiesEnabled() {
  return String(process.env.SECURE_COOKIES || '').trim() === '1';
}

/** Human-readable label for Discord (localhost vs live). Override with PUBLIC_SITE_URL. */
function publicSiteLabel() {
  const explicit = String(process.env.PUBLIC_SITE_URL || process.env.SITE_PUBLIC_URL || '').trim();
  if (explicit) return explicit;
  const host = String(process.env.PUBLIC_HOST || '').trim();
  const port = String(process.env.PORT || '3002').trim();
  if (host && host !== '127.0.0.1') return `http://${host}:${port}`;
  return `${os.hostname()} · NODE_ENV=${process.env.NODE_ENV || 'unset'} · port ${port}`;
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

let state = {
  password: null,
  hourEpoch: null,
};

function signCookieToken() {
  const sig = crypto
    .createHmac('sha256', adminHmacSecret())
    .update(`${state.hourEpoch}:${state.password}`)
    .digest('hex');
  return `${state.hourEpoch}.${sig}`;
}

function rotatePassword() {
  const hourEpoch = Math.floor(Date.now() / HOUR_MS);
  const password = crypto.randomBytes(14).toString('base64url');
  state = { password, hourEpoch };
  return { password, hourEpoch };
}

async function postDiscordWebhook(password, nextRotationUtcIso) {
  const url = String(process.env.ADMIN_DISCORD_WEBHOOK_URL || '').trim();
  if (!url) {
    console.warn('[admin] ADMIN_DISCORD_WEBHOOK_URL not set — hourly password not posted to Discord');
    return;
  }

  const origin = publicSiteLabel();
  const payload = {
    username: 'Leak World',
    embeds: [
      {
        title: 'Admin password rotated',
        color: 0xf268b8,
        fields: [
          { name: 'Site / origin', value: `\`${origin}\``, inline: false },
          { name: 'Password (current hour)', value: `\`${password}\``, inline: false },
          { name: 'Next rotation (UTC)', value: nextRotationUtcIso, inline: false },
        ],
      },
    ],
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.error('[admin] Discord webhook HTTP', res.status, t.slice(0, 200));
    }
  } catch (err) {
    console.error('[admin] Discord webhook error', err);
  }
}

async function hourlyTick() {
  const { password } = rotatePassword();
  const nextMs = Math.ceil(Date.now() / HOUR_MS) * HOUR_MS;
  await postDiscordWebhook(password, new Date(nextMs).toISOString());
}

function msUntilNextUtcHourBoundary() {
  const now = Date.now();
  const next = Math.ceil(now / HOUR_MS) * HOUR_MS;
  return Math.max(1000, next - now);
}

function initAdminHourlyScheduler() {
  hourlyTick().catch((err) => console.error('[admin] initial rotation failed', err));

  function scheduleAlignedHour() {
    const delay = msUntilNextUtcHourBoundary();
    const t = setTimeout(async () => {
      await hourlyTick().catch((err) => console.error('[admin] hourly rotation failed', err));
      scheduleAlignedHour();
    }, delay);
    t.unref?.();
  }

  scheduleAlignedHour();
}

function verifyPasswordAttempt(pw) {
  if (!state.password) return false;
  const inputHash = crypto.createHash('sha256').update(String(pw || '')).digest();
  const actualHash = crypto.createHash('sha256').update(state.password).digest();
  return crypto.timingSafeEqual(inputHash, actualHash);
}

function verifyAdminCookie(req) {
  if (!state.password || state.hourEpoch == null) return false;
  const raw = parseCookies(req)[COOKIE_NAME];
  if (!raw) return false;
  const dot = raw.indexOf('.');
  if (dot < 1) return false;
  const epochStr = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (Number(epochStr) !== state.hourEpoch) return false;
  const expected = crypto
    .createHmac('sha256', adminHmacSecret())
    .update(`${state.hourEpoch}:${state.password}`)
    .digest('hex');
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function setAdminAuthCookie(res) {
  const token = signCookieToken();
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=3900',
  ];
  if (secureCookiesEnabled()) parts.push('Secure');
  appendCookie(res, parts.join('; '));
}

function clearAdminAuthCookie(res) {
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secureCookiesEnabled()) parts.push('Secure');
  appendCookie(res, parts.join('; '));
}

module.exports = {
  COOKIE_NAME,
  initAdminHourlyScheduler,
  verifyAdminCookie,
  verifyPasswordAttempt,
  setAdminAuthCookie,
  clearAdminAuthCookie,
  publicSiteLabel,
};
