'use strict';

/**
 * Leak World referral program — pure rules layer.
 *
 *  Tier ladder (free signups via your referral link):
 *      3   counted signups  → lifetime Basic    (T1)
 *     15   counted signups  → lifetime Premium  (T2)
 *     30   counted signups  → lifetime Ultimate (T3)
 *
 *  Cash kickback:
 *     10   counted signups  → revshare UNLOCKED at 10% of referred users' payments
 *     30   counted signups  → revshare bumps to 20%
 *
 *  Payouts: manual via Telegram. Admin credits via the admin dashboard.
 *
 *  This file is the single source of truth — every other module (server,
 *  client/account, client/home, admin) imports from here so the ladder
 *  numbers can be tuned in one place.
 */

const TIER_LADDER = [
  { threshold: 3, tier: 'basic', label: 'Lifetime Tier 1' },
  { threshold: 15, tier: 'premium', label: 'Lifetime Tier 2' },
  { threshold: 30, tier: 'ultimate', label: 'Lifetime Tier 3' },
];

const REVSHARE_LADDER = [
  { threshold: 10, rateBps: 1000, label: '10% revshare' }, /** 10.00 % */
  { threshold: 30, rateBps: 2000, label: '20% revshare' }, /** 20.00 % */
];

/** Tier numeric rank so we can take the max(current, granted) when promoting. */
const TIER_RANK = { free: 0, basic: 1, premium: 2, ultimate: 3, admin: 4 };

const MAX_CREDIT_IPS = 256;

/** Goals shown on the home-page progress bar. The bar walks the next-unfulfilled
 *  milestone (T1 → T2 → T3 → "you've maxed it"). */
function nextTierGoal(count) {
  for (const step of TIER_LADDER) {
    if (count < step.threshold) {
      return { goal: step.threshold, tier: step.tier, label: step.label };
    }
  }
  return { goal: TIER_LADDER[TIER_LADDER.length - 1].threshold, tier: 'ultimate', label: 'Maxed' };
}

function nextRevshareGoal(count) {
  for (const step of REVSHARE_LADDER) {
    if (count < step.threshold) {
      return { goal: step.threshold, rateBps: step.rateBps, label: step.label };
    }
  }
  return { goal: REVSHARE_LADDER[REVSHARE_LADDER.length - 1].threshold, rateBps: 2000, label: 'Max revshare' };
}

/** Given an authoritative count, return the (lifetimeTier, revshareRateBps)
 *  the user *should* have. Caller decides whether to actually grant. */
function entitlementsFor(count) {
  let lifetimeTier = null;
  for (const step of TIER_LADDER) {
    if (count >= step.threshold) lifetimeTier = step.tier;
  }
  let revshareRateBps = 0;
  for (const step of REVSHARE_LADDER) {
    if (count >= step.threshold) revshareRateBps = step.rateBps;
  }
  return { lifetimeTier, revshareRateBps };
}

function effectiveTier(currentTier, lifetimeTier) {
  const a = TIER_RANK[currentTier] ?? 0;
  const b = TIER_RANK[lifetimeTier] ?? 0;
  if (a >= b) return currentTier;
  return lifetimeTier;
}

/** Deduplicate + bound the per-user IP credit list (anti-fraud). */
function trackCreditIp(existing, ip) {
  if (!ip || typeof ip !== 'string') return { list: existing || [], duplicate: false };
  const list = Array.isArray(existing) ? existing.slice() : [];
  const norm = ip.trim();
  if (!norm) return { list, duplicate: false };
  if (list.includes(norm)) return { list, duplicate: true };
  list.push(norm);
  while (list.length > MAX_CREDIT_IPS) list.shift();
  return { list, duplicate: false };
}

/** Canonical Leak World Telegram URL. Used for payout requests, support, and
 *  every "contact us" surface across the site. Single source of truth so we
 *  don't end up with stale links scattered through the codebase. Override in
 *  production via LW_TELEGRAM_PAYOUT_URL if it ever needs to point somewhere
 *  else. */
const TELEGRAM_URL_DEFAULT = 'https://t.me/leakwrldcom';

const PROGRAM_RULES = {
  tierLadder: TIER_LADDER,
  revshareLadder: REVSHARE_LADDER,
  /** Telegram deep-link surfaced as "Message us on Telegram" / "Contact
   *  support" buttons. Defaults to @leakwrldcom. */
  telegramPayoutUrl: () =>
    String(process.env.LW_TELEGRAM_PAYOUT_URL || TELEGRAM_URL_DEFAULT).trim(),
  /** Public reddit search link the "Get referrals fast" modal sends users to. */
  redditFastUrl: () =>
    String(process.env.LW_REDDIT_FAST_URL || 'https://www.reddit.com/search/?q=leaks&type=posts&t=week').trim(),
  memo: {
    pitch: 'Earn access AND earn money. Every signup through your link unlocks more of the archive — and once you hit 10 referrals, you start earning a share of what your referrals pay.',
    payout: 'To request a cash payout, DM us on Telegram with your username and we\'ll verify your balance.',
  },
};

module.exports = {
  TIER_LADDER,
  REVSHARE_LADDER,
  TIER_RANK,
  MAX_CREDIT_IPS,
  PROGRAM_RULES,
  TELEGRAM_URL_DEFAULT,
  nextTierGoal,
  nextRevshareGoal,
  entitlementsFor,
  effectiveTier,
  trackCreditIp,
};
