/** First `/api/shorts/feed` response — keeps JSON small; more rows loaded incrementally on Shorts. */
export const SHORTS_FEED_INITIAL_LIMIT = 10;
/** Each pagination request after swipe — one short at a time (still only 3 slides rendered). */
export const SHORTS_FEED_LOAD_MORE_LIMIT = 1;

/** @deprecated Use SHORTS_FEED_INITIAL_LIMIT (same value). Home / legacy imports. */
export const SHORTS_FEED_PAGE_SIZE = SHORTS_FEED_INITIAL_LIMIT;

/**
 * @param {{
 *   limit: number,
 *   offset: number,
 *   seed: string,
 *   allCreatorSlugs: string[],
 *   allCategorySlugs: string[],
 *   selectedCreators: Set<string> | null,
 *   selectedCategories: Set<string> | null,
 *   sort?: 'random' | 'trending' | 'featured' | 'top' | 'likes',
 * }} p
 */
export function buildShortsFeedQueryString(p) {
  const qs = new URLSearchParams();
  const lim = Number(p.limit);
  qs.set(
    'limit',
    String(Math.max(1, Math.min(260, Number.isFinite(lim) && lim > 0 ? lim : SHORTS_FEED_INITIAL_LIMIT))),
  );
  qs.set('offset', String(Math.max(0, Number(p.offset) || 0)));
  qs.set('seed', String(p.seed || '').slice(0, 96));

  const allC = p.allCreatorSlugs || [];
  const allCat = p.allCategorySlugs || [];
  const sc = p.selectedCreators;
  const sct = p.selectedCategories;

  if (sc != null && sc.size > 0 && allC.length > 0 && sc.size < allC.length) {
    qs.set('creators', [...sc].filter((s) => /^[a-z0-9-]+$/.test(s)).sort().join(','));
  }
  if (sct != null && sct.size > 0 && allCat.length > 0 && sct.size < allCat.length) {
    qs.set('categories', [...sct].map((s) => String(s).trim().toLowerCase()).filter(Boolean).sort().join(','));
  }

  const sort = p.sort != null ? String(p.sort).trim().toLowerCase() : '';
  if (sort && /^(random|trending|featured|top|likes)$/.test(sort)) {
    qs.set('sort', sort);
  }

  return qs.toString();
}
