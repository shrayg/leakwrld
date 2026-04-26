function normalizeAccessKey(input) {
  return String(input || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-{2,}/g, '-');
}

function planFromProductSlug(slug) {
  const s = String(slug || '').toLowerCase();
  if (s.includes('premium')) return 'premium';
  if (s.includes('basic')) return 'basic';
  return '';
}

function tierForPaidPlan(plan) {
  return plan === 'premium' ? 2 : plan === 'basic' ? 1 : 0;
}

function withQty(url, qty) {
  const n = parseInt(String(qty || ''), 10);
  if (!Number.isFinite(n) || n <= 0) return url;
  try {
    const u = new URL(url, 'https://local.invalid');
    u.searchParams.set('qty', String(n));
    return u.toString().replace('https://local.invalid', '');
  } catch {
    return url;
  }
}

function openCheckoutWindow(windowLike, url, qty) {
  const targetUrl = withQty(url, qty);
  const popup = windowLike.open('about:blank', '_blank', 'noopener,noreferrer');
  if (popup && !popup.closed) {
    popup.location.replace(targetUrl);
    return { mode: 'popup', url: targetUrl };
  }
  windowLike.location.assign(targetUrl);
  return { mode: 'redirect', url: targetUrl };
}

function evaluateRedeemRecord(record) {
  if (!record) return { ok: false, code: 'invalid', message: 'Invalid access key.' };
  if (record.redeemed_at) return { ok: false, code: 'used', message: 'This key has already been redeemed.' };
  const plan = planFromProductSlug(record.product_slug || record.product_title || '');
  const tier = tierForPaidPlan(plan);
  if (!tier) return { ok: false, code: 'invalid', message: 'Invalid access key.' };
  return { ok: true, plan, tier };
}

module.exports = {
  normalizeAccessKey,
  planFromProductSlug,
  tierForPaidPlan,
  withQty,
  openCheckoutWindow,
  evaluateRedeemRecord,
};
