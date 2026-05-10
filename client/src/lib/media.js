/**
 * Media URL helper.
 *
 * Objects live in R2; browsers load them via **`worker/`** (Cloudflare) or the
 * Node **rclone** stream in dev (`server.js` → `/r2/*`), never with bucket keys.
 *
 * **Local dev (default):** `mediaUrl` → `/r2/...` → Vite proxies to Node → rclone
 * (needs `RCLONE_CONFIG_R2_*` in `.env`).
 *
 * **VPS without rclone:** Node returns 503 for `/r2/*` unless you either:
 *   1. Set **`VITE_R2_PUBLIC_BASE`** to your Worker’s **public** HTTPS URL before
 *      `npm run build` (same-origin cookies unaffected; URL is not a secret), or
 *   2. Configure **nginx** `location /r2/` → proxy to that Worker (strip `/r2`
 *      prefix). See README → Deploy.
 */

const RAW_BASE = import.meta.env.VITE_R2_PUBLIC_BASE;
/**
 * Tiered media must stay same-origin so the Node `/r2/*` proxy can read the
 * login cookie and enforce free/tier1/tier2/tier3 access. External Worker URLs
 * bypass that auth layer, so only same-origin path bases are honored here.
 */
const R2_BASE = RAW_BASE && String(RAW_BASE).trim().startsWith('/')
  ? String(RAW_BASE).trim().replace(/\/+$/, '')
  : '/r2';

export function mediaUrl(key) {
  if (!key) return '';
  /** Encode each segment so spaces / parentheses / unicode in object names survive
   *  the URL safely while preserving '/' as a path separator. */
  const safe = String(key).split('/').map(encodeURIComponent).join('/');
  return `${R2_BASE}/${safe}`;
}

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

export function classifyMedia(name) {
  const dot = String(name || '').lastIndexOf('.');
  if (dot < 0) return 'other';
  const ext = name.slice(dot).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return 'other';
}

export const TIER_LABELS = {
  free: 'Free',
  tier1: 'Tier 1',
  tier2: 'Tier 2',
  tier3: 'Tier 3',
  basic: 'Tier 1',
  premium: 'Tier 2',
  ultimate: 'Tier 3 / Ultimate',
  admin: 'Admin',
};

export const MANIFEST_TIER_ORDER = ['free', 'tier1', 'tier2', 'tier3'];
const ACCOUNT_TIER_ALIASES = {
  free: 'free',
  tier1: 'basic',
  basic: 'basic',
  tier2: 'premium',
  premium: 'premium',
  tier3: 'ultimate',
  ultimate: 'ultimate',
  admin: 'admin',
};

export function normalizeAccountTier(accountTier) {
  const key = String(accountTier || 'free').toLowerCase().replace(/[^a-z0-9]/g, '');
  return ACCOUNT_TIER_ALIASES[key] || 'free';
}

export function manifestTiersForAccountTier(accountTier) {
  const tier = normalizeAccountTier(accountTier);
  if (tier === 'admin' || tier === 'ultimate') return MANIFEST_TIER_ORDER;
  if (tier === 'premium') return MANIFEST_TIER_ORDER.slice(0, 3);
  if (tier === 'basic') return MANIFEST_TIER_ORDER.slice(0, 2);
  return ['free'];
}

export function accountTierLabel(accountTier) {
  return TIER_LABELS[normalizeAccountTier(accountTier)] || 'Free';
}

export function canAccessManifestTier(accountTier, manifestTier) {
  return manifestTiersForAccountTier(accountTier).includes(String(manifestTier || 'free').toLowerCase());
}

export function isLockedTier(tier, accountTier = 'free') {
  return !canAccessManifestTier(accountTier, tier);
}
