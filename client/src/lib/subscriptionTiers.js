/**
 * Paid subscription ordering for checkout / upgrade UX.
 * Aligns with server `normalizeAccountTier` (free < basic < premium < ultimate < admin).
 */

/** @param {string | undefined} tier */
export function userSubscriptionRank(tier) {
  const t = String(tier || 'free').toLowerCase();
  if (t === 'admin') return 4;
  if (t === 'ultimate') return 3;
  if (t === 'premium') return 2;
  if (t === 'basic') return 1;
  return 0;
}

/**
 * @param {number} planTier 0 = free, 1–3 = paid columns
 * @param {string | undefined} userTier effective tier from session
 * @returns {'upgrade' | 'current' | 'below'}
 */
export function planPurchaseState(planTier, userTier) {
  const u = userSubscriptionRank(userTier);
  if (planTier < u) return 'below';
  if (planTier === u) return 'current';
  return 'upgrade';
}
