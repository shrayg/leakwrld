const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeAccessKey,
  openCheckoutWindow,
  evaluateRedeemRecord,
  withQty,
} = require('../lib/xyzpurchase');

test('checkout link opener uses script-created popup when available', () => {
  let replaced = '';
  const windowLike = {
    open: () => ({ closed: false, location: { replace: (u) => { replaced = u; } } }),
    location: { assign: () => { throw new Error('should not redirect'); } },
  };
  const out = openCheckoutWindow(windowLike, 'https://xyzpurchase.xyz/checkout?slug=x&auto=1&qty=1', 2);
  assert.equal(out.mode, 'popup');
  assert.ok(replaced.includes('qty=2'));
});

test('checkout link opener falls back to current-tab redirect', () => {
  let assigned = '';
  const windowLike = {
    open: () => null,
    location: { assign: (u) => { assigned = u; } },
  };
  const out = openCheckoutWindow(windowLike, 'https://xyzpurchase.xyz/checkout?slug=x&auto=1&qty=1');
  assert.equal(out.mode, 'redirect');
  assert.equal(assigned, out.url);
});

test('redeem success maps basic/premium correctly', () => {
  assert.deepEqual(
    evaluateRedeemRecord({ product_slug: 'xyzpurchase-plugin-basic-tier', redeemed_at: null }),
    { ok: true, plan: 'basic', tier: 1 }
  );
  assert.deepEqual(
    evaluateRedeemRecord({ product_slug: 'xyzpurchase-plugin-premium-tier', redeemed_at: null }),
    { ok: true, plan: 'premium', tier: 2 }
  );
});

test('redeem invalid key returns invalid message', () => {
  const out = evaluateRedeemRecord(null);
  assert.equal(out.ok, false);
  assert.equal(out.code, 'invalid');
});

test('redeem already-used key returns used message', () => {
  const out = evaluateRedeemRecord({ product_slug: 'xyzpurchase-plugin-basic-tier', redeemed_at: '2026-04-17T00:00:00Z' });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'used');
});

test('key normalization keeps dashes and uppercases', () => {
  assert.equal(normalizeAccessKey('  ba-sic__12--xy  '), 'BA-SIC12-XY');
  assert.equal(withQty('https://xyzpurchase.xyz/checkout?slug=abc&auto=1&qty=1', 3).includes('qty=3'), true);
});
