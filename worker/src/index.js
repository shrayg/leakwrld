/**
 * leakwrld R2 proxy + HMAC-signed direct playback + HLS playlist rewrite.
 *
 * Signed GET: /<key>?exp=<unix>&sig=<hex> — verified with MEDIA_SIGNING_SECRET
 * (same secret as Node `MEDIA_SIGNING_SECRET` / `SESSION_SECRET` fallback).
 *
 * HLS: .m3u8 bodies are rewritten so segment/variant lines get absolute signed URLs.
 */

/** @typedef {{ R2: R2Bucket; MEDIA_SIGNING_SECRET?: string }} Env */

import { createHmac, timingSafeEqual } from 'node:crypto';

const TIER_PATTERN = /^videos\/[^/]+\/(free|tier1|tier2|tier3)\//;

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'Range, Content-Type, Accept, Accept-Encoding, Origin',
  'access-control-expose-headers': 'Content-Length, Content-Range, Accept-Ranges, ETag',
  'access-control-max-age': '86400',
};

function corsResponse(status, body, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...CORS_HEADERS, ...extraHeaders },
  });
}

function parseRange(header) {
  if (!header) return null;
  const m = /^bytes=(\d+)-(\d+)?$/.exec(header.trim());
  if (!m) return null;
  const offset = Number(m[1]);
  if (!Number.isFinite(offset) || offset < 0) return null;
  if (m[2] === undefined) return { offset };
  const end = Number(m[2]);
  if (!Number.isFinite(end) || end < offset) return null;
  return { offset, length: end - offset + 1 };
}

function classifyTier(key) {
  const m = TIER_PATTERN.exec(key);
  return m ? m[1] : null;
}

function authorizeTier(_request, tier) {
  if (tier === 'free' || tier === null) return { ok: true };
  return { ok: true };
}

function signPayload(secret, objectKey, exp) {
  const payload = `${objectKey}\n${exp}`;
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

function verifySignedUrl(env, objectKey, url) {
  const secret = String(env.MEDIA_SIGNING_SECRET || '').trim();
  if (!secret) return false;
  const sig = url.searchParams.get('sig');
  const expRaw = url.searchParams.get('exp');
  if (!sig || !expRaw) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = signPayload(secret, objectKey, exp);
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(String(sig).trim(), 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function resolveChildKey(masterKey, ref) {
  const r = String(ref || '').trim();
  if (!r || r.startsWith('#')) return '';
  const clean = r.split('?')[0];
  if (/^https?:\/\//i.test(clean)) return '';
  if (clean.startsWith('/')) return clean.replace(/^\/+/, '');
  const i = masterKey.lastIndexOf('/');
  const baseDir = i >= 0 ? masterKey.slice(0, i + 1) : '';
  return `${baseDir}${clean}`;
}

function rewriteM3u8(text, masterKey, exp, secret, origin) {
  const lines = text.split(/\n/);
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) {
      out.push(line);
      continue;
    }
    if (/^https?:\/\//i.test(t)) {
      out.push(line);
      continue;
    }
    const childKey = resolveChildKey(masterKey, t);
    if (!childKey) {
      out.push(line);
      continue;
    }
    const sig = signPayload(secret, childKey, exp);
    const abs = `${origin}/${childKey.split('/').map((s) => encodeURIComponent(s)).join('/')}?exp=${exp}&sig=${sig}`;
    out.push(abs);
  }
  return out.join('\n');
}

function parseConditional(request) {
  const ifNoneMatch = request.headers.get('if-none-match');
  const ifModifiedSince = request.headers.get('if-modified-since');
  const out = {};
  if (ifNoneMatch) out.etagDoesNotMatch = ifNoneMatch.replace(/^W\//, '').replace(/^"|"$/g, '');
  if (ifModifiedSince) {
    const d = new Date(ifModifiedSince);
    if (!Number.isNaN(d.getTime())) out.uploadedAfter = d;
  }
  return Object.keys(out).length ? out : undefined;
}

function cacheControlFor(key, tier) {
  if (tier === null) {
    return 'public, max-age=300';
  }
  return 'public, max-age=2592000, s-maxage=2592000, immutable';
}

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   * @param {ExecutionContext} ctx
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return corsResponse(405, 'Method not allowed');
    }

    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!key) return corsResponse(200, 'leakwrld R2 proxy');

    const signedOk = verifySignedUrl(env, key, url);
    if (!signedOk) {
      const tier = classifyTier(key);
      const auth = authorizeTier(request, tier);
      if (!auth.ok) return corsResponse(401, 'Unauthorized');
    }

    const tier = classifyTier(key);
    const cache = caches.default;
    const isSigned = url.searchParams.has('sig') && url.searchParams.has('exp');
    const isCacheable = request.method === 'GET' && !request.headers.has('range') && !isSigned;
    if (isCacheable) {
      const cached = await cache.match(request);
      if (cached) return cached;
    }

    const range = parseRange(request.headers.get('range'));
    const obj = range
      ? await env.R2.get(key, { range, onlyIf: parseConditional(request) })
      : await env.R2.get(key, { onlyIf: parseConditional(request) });

    if (!obj) {
      return corsResponse(404, 'Not found');
    }

    if (!('body' in obj)) {
      const headers = new Headers(CORS_HEADERS);
      obj.writeHttpMetadata(headers);
      headers.set('etag', obj.httpEtag);
      return new Response(null, { status: 304, headers });
    }

    const headers = new Headers(CORS_HEADERS);
    obj.writeHttpMetadata(headers);
    headers.set('etag', obj.httpEtag);
    headers.set('accept-ranges', 'bytes');
    headers.set('cache-control', cacheControlFor(key, tier));

    if (range) {
      const total = obj.size;
      const offset = range.offset;
      const length = range.length ?? total - offset;
      headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${total}`);
      headers.set('content-length', String(length));
      return new Response(request.method === 'HEAD' ? null : obj.body, {
        status: 206,
        headers,
      });
    }

    if (
      signedOk &&
      request.method === 'GET' &&
      /\.m3u8$/i.test(key) &&
      env.MEDIA_SIGNING_SECRET &&
      !range
    ) {
      const text = await new Response(obj.body).text();
      const exp = url.searchParams.get('exp') || '';
      const origin = url.origin;
      const rewritten = rewriteM3u8(text, key, exp, String(env.MEDIA_SIGNING_SECRET), origin);
      headers.set('content-type', 'application/vnd.apple.mpegurl; charset=utf-8');
      headers.delete('content-length');
      return new Response(rewritten, { status: 200, headers });
    }

    headers.set('content-length', String(obj.size));
    const response = new Response(request.method === 'HEAD' ? null : obj.body, {
      status: 200,
      headers,
    });

    if (isCacheable) {
      ctx.waitUntil(cache.put(request, response.clone()));
    }
    return response;
  },
};
