'use strict';

/** Lazy optional — geoip-lite may fail to load in stripped installs; CDN headers still work. */
let geoip = null;
try {
  geoip = require('geoip-lite');
} catch {
  geoip = null;
}

function normalizeIpForGeo(ip) {
  let s = String(ip || '').trim();
  if (!s || s.toLowerCase() === 'unknown') return '';
  if (s.startsWith('::ffff:')) s = s.slice(7);
  /** geoip-lite is IPv4-oriented; skip raw IPv6 for now */
  if (s.includes(':')) return '';
  return s.slice(0, 45);
}

function countryFromHeaders(req) {
  const h = req.headers || {};
  const keys = [
    'cf-ipcountry',
    'cloudfront-viewer-country',
    'x-vercel-ip-country',
    'x-appengine-country',
  ];
  for (const k of keys) {
    const v = h[k];
    if (v == null) continue;
    const code = String(v).trim().toUpperCase();
    if (code.length === 2 && /^[A-Z]{2}$/.test(code) && code !== 'XX') return code;
  }
  return null;
}

function countryFromGeoLite(ip) {
  if (!geoip || !ip) return null;
  try {
    const rec = geoip.lookup(ip);
    const c = rec && rec.country ? String(rec.country).toUpperCase() : '';
    return /^[A-Z]{2}$/.test(c) ? c : null;
  } catch {
    return null;
  }
}

/** ISO 3166-1 alpha-2 or null */
function resolveCountryCode(req, ipHint) {
  const fromHdr = countryFromHeaders(req);
  if (fromHdr) return fromHdr;
  const ip = normalizeIpForGeo(ipHint);
  return countryFromGeoLite(ip);
}

module.exports = { resolveCountryCode, normalizeIpForGeo };
