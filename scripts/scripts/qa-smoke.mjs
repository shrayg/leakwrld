#!/usr/bin/env node
/**
 * HTTP smoke tests against a running server (default http://127.0.0.1:3002).
 * Usage: QA_BASE_URL=https://staging.example.com node scripts/qa-smoke.mjs
 */
const BASE = (process.env.QA_BASE_URL || 'http://127.0.0.1:3002').replace(/\/+$/, '');

async function req(path, opts = {}) {
  const url = BASE + path;
  const r = await fetch(url, {
    redirect: opts.redirect ?? 'follow',
    ...opts,
  });
  return r;
}

function ok(name, condition, detail = '') {
  const pass = condition ? 'PASS' : 'FAIL';
  console.log(`[${pass}] ${name}${detail ? ': ' + detail : ''}`);
  return condition;
}

let failed = 0;

async function main() {
  console.log(`QA smoke against ${BASE}\n`);

  try {
    let r = await req('/api/health');
    if (!ok('/api/health', r.ok, String(r.status))) failed++;

    r = await req('/api/ping');
    if (!ok('/api/ping', r.ok, String(r.status))) failed++;

    r = await req('/api/me');
    const meOk = r.status === 200 || r.status === 401;
    if (!ok('/api/me (200 or 401)', meOk, String(r.status))) failed++;

    r = await req('/api/folder-counts');
    if (!ok('/api/folder-counts', r.ok, String(r.status))) failed++;

    r = await req('/sitemap.xml');
    if (!ok('/sitemap.xml', r.ok, String(r.status))) failed++;

    r = await req('/', { method: 'GET' });
    const indexOk = r.ok && (await r.text()).includes('html');
    if (!ok('GET / (HTML shell)', indexOk, String(r.status))) failed++;

    r = await req('/omegle-wins');
    const spaOk = r.ok && (await r.text()).toLowerCase().includes('html');
    if (!ok('GET /omegle-wins (HTML)', spaOk, String(r.status))) failed++;

    r = await req('/api/list?folder=' + encodeURIComponent('Omegle'));
    const listOk = r.status === 200 || r.status === 401 || r.status === 403;
    if (!ok('/api/list?folder=Omegle (200|401|403)', listOk, String(r.status))) failed++;

    r = await req('/checkout');
    if (!ok('GET /checkout', r.ok, String(r.status))) failed++;

    r = await fetch(BASE + '/checkout.html', { redirect: 'manual' });
    const checkoutLegacy = r.status === 302 || r.status === 301;
    const checkoutLoc = (r.headers.get('location') || '').replace(/\/+$/, '');
    if (
      !ok(
        'GET /checkout.html → /checkout',
        checkoutLegacy && (checkoutLoc === '/checkout' || checkoutLoc.endsWith('/checkout')),
        `${r.status} Location: ${checkoutLoc}`,
      )
    )
      failed++;

    r = await req('/admin');
    const adminShellOk = r.ok && (await r.text()).toLowerCase().includes('html');
    if (!ok('GET /admin (SPA shell)', adminShellOk, String(r.status))) failed++;

    r = await req('/api/random-videos?limit=1');
    if (!ok('/api/random-videos?limit=1', r.ok, String(r.status))) failed++;

    // Routes: legacy HTML names and SPA shells (redirect manual)
    r = await fetch(BASE + '/shorts.html', { redirect: 'manual' });
    const shortsLegacy =
      r.status === 301 ||
      r.status === 302 ||
      r.status === 200 ||
      (r.status === 308);
    if (!ok('GET /shorts.html (301|302|200)', shortsLegacy, String(r.status))) failed++;

    r = await fetch(BASE + '/zzzz-not-a-page-qa-404', { redirect: 'manual' });
    const notFound = r.status === 404 || r.status === 200;
    if (!ok('unknown path (404 or SPA shell)', notFound, String(r.status))) failed++;

    r = await req('/api/preview/list?folder=' + encodeURIComponent('Omegle'));
    const previewOk = r.ok || r.status === 401 || r.status === 403;
    if (!ok('/api/preview/list?folder=Omegle', previewOk, String(r.status))) failed++;

    r = await req(
      '/api/resolve-clean-video?category=' +
        encodeURIComponent('omegle-wins') +
        '&video=' +
        encodeURIComponent('nonexistent-slug-qa'),
    );
    const resolveOk = r.status === 404 || r.status === 400 || r.status === 200;
    if (!ok('/api/resolve-clean-video (smoke)', resolveOk, String(r.status))) failed++;
  } catch (e) {
    console.error('[FAIL] fetch error — is the server running?', e && e.message ? e.message : e);
    failed++;
  }

  console.log(failed ? `\nDone: ${failed} check(s) failed` : '\nDone: all checks passed');
  process.exit(failed ? 1 : 0);
}

main();
