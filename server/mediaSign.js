'use strict';

const crypto = require('crypto');

const SIG_QUERY = 'sig';
const EXP_QUERY = 'exp';

function signingSecret() {
  const s = String(process.env.MEDIA_SIGNING_SECRET || process.env.SESSION_SECRET || '').trim();
  return s || '';
}

/** @param {string} objectKey R2 object key (no leading slash) */
function signMediaUrl(objectKey, expiresAtSec) {
  const secret = signingSecret();
  if (!secret) return null;
  const key = String(objectKey || '').replace(/^\/+/, '');
  if (!key) return null;
  const exp = Math.floor(Number(expiresAtSec) || 0);
  if (exp <= 0) return null;
  const payload = `${key}\n${exp}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return { exp, sig };
}

/**
 * Build absolute URL for browser playback (Worker or dev origin).
 * @param {string} mediaPublicOrigin e.g. https://xxx.workers.dev
 * @param {string} objectKey
 * @param {number} ttlSeconds
 */
function buildSignedMediaUrl(mediaPublicOrigin, objectKey, ttlSeconds = 3600) {
  const base = String(mediaPublicOrigin || '').trim().replace(/\/+$/, '');
  if (!base) return null;
  const exp = Math.floor(Date.now() / 1000) + Math.max(60, Math.min(86400, Number(ttlSeconds) || 3600));
  const signed = signMediaUrl(objectKey, exp);
  if (!signed) return null;
  const path = objectKey.split('/').map((s) => encodeURIComponent(s)).join('/');
  const u = new URL(`${base}/${path}`);
  u.searchParams.set(EXP_QUERY, String(signed.exp));
  u.searchParams.set(SIG_QUERY, signed.sig);
  return u.toString();
}

module.exports = {
  signMediaUrl,
  buildSignedMediaUrl,
  signingSecret,
  SIG_QUERY,
  EXP_QUERY,
};
