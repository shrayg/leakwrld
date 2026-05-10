/**
 * Media URL helper.
 *
 * The browser shouldn't talk to R2 directly (no public URL on the bucket and
 * we want a single seam for tier gating + edge caching). Every media URL is
 * routed through `R2_BASE`, which the Vite dev server and the production
 * deployment forward to the Cloudflare Worker proxy in `worker/`.
 *
 * Local development:
 *   - Vite proxies `/r2/*` -> `${VITE_R2_PUBLIC_BASE}/*` (see vite.config.js)
 *   - Default: `https://leakwrld-r2.<your-subdomain>.workers.dev`
 *   - Override via `.env`: VITE_R2_PUBLIC_BASE=https://cdn.leakwrld.com
 *
 * Production:
 *   - Static deploy points `/r2/*` to the same worker (Cloudflare route or
 *     reverse-proxy), so no client code changes are needed.
 */

const R2_BASE = '/r2';

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
};

export function isLockedTier(tier) {
  return tier !== 'free';
}
