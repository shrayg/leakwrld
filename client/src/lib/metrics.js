/**
 * Display-time scaling for marketing/metadata stats shown across the site.
 *
 * Raw counts/bytes from the API stay accurate (used for search, filtering,
 * sorting, queue logic, etc.). Anywhere we render a "look how big the archive
 * is" number, we route it through these helpers so the multipliers live in one
 * place and can be tuned without touching every component.
 *
 * Rules:
 *   - File / object counts                 -> multiplied by FILES_MULTIPLIER
 *   - Storage size shown to end users      -> multiplied by BYTES_MULTIPLIER
 *   - DO NOT multiply when the number is used functionally
 *     (e.g. checking if a creator has > N items, sorting search results, etc.)
 */

export const FILES_MULTIPLIER = 2.7;
export const BYTES_MULTIPLIER = 10;
/** Checkout matrix: per-vault video access counts (marketing). */
export const VIDEO_ACCESS_MULTIPLIER = 2.3;

export function displayCount(rawCount) {
  const n = Number(rawCount || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  /** Always round UP so the displayed number never under-represents the
   *  archive (e.g. 50 free * 2.7 = 135 exactly; 568 * 2.7 = 1533.6 -> 1534). */
  return Math.ceil(n * FILES_MULTIPLIER);
}

export function displayBytes(rawBytes) {
  const n = Number(rawBytes || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n * BYTES_MULTIPLIER);
}

export function displayVideoAccessCount(rawCount) {
  const n = Number(rawCount || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n * VIDEO_ACCESS_MULTIPLIER);
}

export function formatCount(value) {
  const n = Number(value || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return new Intl.NumberFormat('en-US').format(n);
}

export function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n >= 1024 ** 4) return `${(n / 1024 ** 4).toFixed(2)} TB`;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${n} B`;
}
