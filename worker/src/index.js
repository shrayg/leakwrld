/**
 * leakwrld R2 proxy
 *
 * Routes any path /<key> to the leakwrld R2 bucket. Streams response, supports
 * HTTP range requests (for video seek), caches at the edge, and is the future
 * insertion point for tier gating (free / tier1 / tier2 / tier3).
 *
 * Bindings (defined in wrangler.jsonc):
 *   - R2: the leakwrld bucket
 *
 * Routes (current):
 *   GET  /                     -> health text
 *   HEAD /<key>                -> headers only
 *   GET  /<key>                -> stream object body
 *   OPTIONS /<key>             -> CORS preflight
 *
 * Tier gating (TODO — wired to a future /api/auth check on leakwrld.com):
 *   /videos/<slug>/free/*      -> open
 *   /videos/<slug>/tier{1..3}/* -> requires session cookie + plan check
 */

/** @typedef {{ R2: R2Bucket }} Env */

const TIER_PATTERN = /^videos\/[^/]+\/(free|tier1|tier2|tier3)\//;

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  /** Browsers may send extra headers on Range/preflight when `<video crossOrigin>` hits workers.dev */
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

/** Parse `Range: bytes=A-B` or `bytes=A-`. Returns an R2 range option or null. */
function parseRange(header, totalKnown = undefined) {
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

/**
 * Tier authorization stub. Currently allows everything; intended to be
 * replaced by a real check (cookie -> session -> plan -> tier mapping)
 * when payments go live.
 */
function authorizeTier(_request, tier) {
  if (tier === 'free' || tier === null) return { ok: true };
  // TODO: gate tier1/2/3 once the leakwrld auth bridge is in place.
  return { ok: true };
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

    const tier = classifyTier(key);
    const auth = authorizeTier(request, tier);
    if (!auth.ok) return corsResponse(401, 'Unauthorized');

    const cache = caches.default;
    /** Range requests are not safely cacheable as 200 responses, so we cache only full-body GETs. */
    const isCacheable = request.method === 'GET' && !request.headers.has('range');
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

    /** R2 returns an `R2Object` (no body) when an `onlyIf` precondition fails. */
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
    /** Catalog/utility objects (.keep, manifests, etc.) — short cache. */
    return 'public, max-age=300';
  }
  /** Media files are content-addressed by name, treat as immutable. */
  return 'public, max-age=2592000, s-maxage=2592000, immutable';
}
