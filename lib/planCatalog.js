'use strict';

/**
 * Canonical monthly Patreon plan catalog (tier 1–4).
 * Prices are cents USD; labels match checkout copy.
 */
const PLANS = {
  basic: { key: 'basic', tier: 1, label: 'Basic', priceCents: 499 },
  premium: { key: 'premium', tier: 2, label: 'Premium', priceCents: 999 },
  ultimate: { key: 'ultimate', tier: 3, label: 'Ultimate', priceCents: 1999 },
  elite: { key: 'elite', tier: 4, label: 'Elite', priceCents: 4999 },
};

const TIER_TO_PLAN_KEY = { 1: 'basic', 2: 'premium', 3: 'ultimate', 4: 'elite' };

function planAmountCents(plan) {
  const k = String(plan || '').toLowerCase();
  const entry = PLANS[k];
  return entry ? entry.priceCents : 0;
}

function planKeyForTier(tier) {
  return TIER_TO_PLAN_KEY[Number(tier)] || null;
}

function displayLabelForTier(tier) {
  const k = TIER_TO_PLAN_KEY[Number(tier)];
  if (k && PLANS[k]) return PLANS[k].label;
  const t = Number(tier);
  return t >= 1 ? `Tier ${t}` : 'Free';
}

function displayPriceForTier(tier) {
  const k = TIER_TO_PLAN_KEY[Number(tier)];
  if (!k || !PLANS[k]) return '';
  const c = PLANS[k].priceCents;
  return '$' + (c / 100).toFixed(2);
}

/** R2/vault only has tier 1 & tier 2 prefixes — map user tiers 3–4 to tier-2 library access. */
function effectiveVaultTier(userTier) {
  const t = Math.max(0, Math.min(4, Number(userTier) || 0));
  if (t <= 0) return 0;
  return Math.min(t, 2);
}

function hasPremiumVaultAccess(userTier) {
  return effectiveVaultTier(userTier) >= 2;
}

/** OmegaPay / external card webhook plan slug → users.tier */
function omeglePayTierFromPlan(plan) {
  const p = String(plan || '').toLowerCase();
  const map = {
    basic: 1,
    tier1: 1,
    tier_1: 1,
    premium: 2,
    tier2: 2,
    tier_2: 2,
    ultimate: 3,
    tier3: 3,
    tier_3: 3,
    elite: 4,
    sovereign: 4,
    tier4: 4,
    tier_4: 4,
    max: 4,
  };
  const t = map[p];
  return typeof t === 'number' ? t : null;
}

module.exports = {
  PLANS,
  planAmountCents,
  planKeyForTier,
  displayLabelForTier,
  displayPriceForTier,
  effectiveVaultTier,
  hasPremiumVaultAccess,
  omeglePayTierFromPlan,
};
