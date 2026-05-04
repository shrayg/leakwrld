'use strict';

/**
 * Path segments used under each category (no video/photo/gif segment).
 * Includes legacy `elite` so listing and composite keys still resolve old R2 keys.
 */
const VAULT_FOLDERS = ['free', 'basic', 'premium', 'ultimate', 'elite'];

/**
 * Discord-export style path segments under each category (`tier 1` has a space).
 * Used for R2 cache warm / counts / thumbnails (scan all prefixes server-side).
 */
const ALL_LEGACY_DISCORD_TIER_PREFIXES = ['tier 1', 'tier 2', 'tier 3'];

/**
 * Which vault folders a subscriber can read (cumulative).
 * Three paid product tiers (Basic=1, Premium=2, Ultimate=3) plus shared `free/`.
 * Tier 0 = none. Legacy DB tier 4 is clamped to 3.
 *
 * - Basic (1):   `free/` + `basic/`
 * - Premium (2): + `premium/`
 * - Ultimate (3): + `ultimate/` (vault; not a copy of lower tiers) + legacy `elite/` until migrated
 *
 * @param {number} userTier Patreon tier 1–3
 * @returns {string[]}
 */
function accessibleVaultFolders(userTier) {
  const t = Math.min(3, Math.max(0, Math.min(4, Number(userTier) || 0)));
  if (t <= 0) return [];
  if (t === 1) return ['free', 'basic'];
  if (t === 2) return ['free', 'basic', 'premium'];
  return ['free', 'basic', 'premium', 'ultimate', 'elite'];
}

/**
 * Legacy `tier N/` prefixes under each category (R2), gated by Patreon tier.
 * - Basic (1):   tier 1 only
 * - Premium (2): tier 1 + tier 2
 * - Ultimate (3): tier 1 + tier 2 + tier 3 (`tier 3/` is separate from vault `ultimate/`; both are Ultimate-gated)
 *
 * @param {number} userTier Patreon tier 1–3
 * @returns {string[]} segment names like `tier 1` (no slashes)
 */
function accessibleLegacyTierPrefixes(userTier) {
  const t = Math.min(3, Math.max(0, Math.min(4, Number(userTier) || 0)));
  if (t <= 0) return [];
  if (t === 1) return ['tier 1'];
  if (t === 2) return ['tier 1', 'tier 2'];
  return ['tier 1', 'tier 2', 'tier 3'];
}

module.exports = {
  VAULT_FOLDERS,
  ALL_LEGACY_DISCORD_TIER_PREFIXES,
  accessibleVaultFolders,
  accessibleLegacyTierPrefixes,
};
