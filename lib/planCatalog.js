'use strict';

/**
 * Canonical monthly Patreon plan catalog (three paid tiers).
 * Prices are cents USD; labels match checkout copy.
 */
const PLANS = {
  basic: { key: 'basic', tier: 1, label: 'Basic', priceCents: 999 },
  premium: { key: 'premium', tier: 2, label: 'Premium', priceCents: 2499 },
  ultimate: { key: 'ultimate', tier: 3, label: 'Ultimate', priceCents: 3999 },
};

const TIER_TO_PLAN_KEY = { 1: 'basic', 2: 'premium', 3: 'ultimate', 4: 'ultimate' };

function planAmountCents(plan) {
  const k = String(plan || '').toLowerCase();
  if (k === 'elite' || k === 'sovereign') return PLANS.ultimate.priceCents;
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

/** @deprecated Use lib/r2VaultLayout accessibleVaultFolders — kept for older call sites. */
function effectiveVaultTier(userTier) {
  const t = Math.max(0, Math.min(4, Number(userTier) || 0));
  if (t <= 0) return 0;
  return Math.min(t, 3);
}

function hasPremiumVaultAccess(userTier) {
  return (Number(userTier) || 0) >= 2;
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
    elite: 3,
    sovereign: 3,
    tier4: 3,
    tier_4: 3,
    max: 3,
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
