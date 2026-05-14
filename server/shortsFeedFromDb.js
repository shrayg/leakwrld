'use strict';

const FEED_FILTERS = [
  { slug: 'trending', name: 'Trending' },
  { slug: 'top-videos', name: 'Top videos' },
  { slug: 'featured', name: 'Featured' },
];

function secondsToDuration(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? `${m}:${String(r).padStart(2, '0')}` : `0:${String(r).padStart(2, '0')}`;
}

function orderClause(sortMode) {
  if (sortMode === 'likes') return 'cs.likes_rank asc, cs.storage_key asc';
  if (sortMode === 'top') return 'cs.top_rank asc, cs.storage_key asc';
  if (sortMode === 'trending') return 'cs.trending_rank asc, cs.storage_key asc';
  if (sortMode === 'featured') return 'cs.featured_shuffle_position asc nulls last, cs.storage_key asc';
  return 'cs.shuffle_position asc, cs.storage_key asc';
}

/**
 * @param {import('pg').Pool} pool
 * @param {object} opts
 */
async function getCatalogVersion(pool) {
  const { rows } = await pool.query(
    'select catalog_version, row_count from catalog_ingest_state where id = 1 limit 1',
  );
  if (!rows.length) return { catalogVersion: 0, rowCount: 0 };
  return { catalogVersion: Number(rows[0].catalog_version || 0), rowCount: Number(rows[0].row_count || 0) };
}

async function shortsFeedFromPrecalc(pool, opts) {
  const {
    catalogVersion,
    allowedTiers,
    limit,
    offset,
    sortMode,
    wantedCategories,
    wantedCreators,
    mediaStatsId,
  } = opts;
  const tiers = allowedTiers.filter(Boolean);
  if (!tiers.length || !catalogVersion) return null;

  const creatorsList = [...wantedCreators];
  const categoriesList = [...wantedCategories];

  const where = [
    'cs.catalog_version = $1',
    'cs.tier = any($2::text[])',
  ];
  const params = [catalogVersion, tiers];
  let p = 3;

  if (creatorsList.length) {
    where.push(`cs.creator_slug = any($${p}::text[])`);
    params.push(creatorsList);
    p += 1;
  }
  if (categoriesList.length) {
    where.push(`cs.category_slugs && $${p}::text[]`);
    params.push(categoriesList);
    p += 1;
  }
  if (sortMode === 'featured') {
    where.push('cs.featured_shuffle_position is not null');
  }

  const whereSql = where.join(' and ');
  const order = orderClause(sortMode);

  const countSql = `select count(*)::int as c from catalog_shorts cs where ${whereSql}`;
  const { rows: countRows } = await pool.query(countSql, params);
  const total = Number(countRows[0]?.c || 0);

  const dataSql = `
    select cs.storage_key as key, cs.name, cs.title, cs.kind, cs.tier, cs.ext,
           cs.size_bytes as "sizeBytes", cs.creator_slug as "creatorSlug",
           cs.creator_name as "creatorName", cs.creator_rank as "creatorRank",
           cs.creator_heat as "creatorHeat", cs.creator_thumbnail as "creatorThumbnail",
           cs.category_slugs as "categorySlugs", cs.views, cs.likes, cs.duration_seconds as "durationSeconds",
           cs.hls_master_key as "hlsMasterKey", cs.thumb_path as "thumbPath"
    from catalog_shorts cs
    where ${whereSql}
    order by ${order}
    limit $${p} offset $${p + 1}
  `;
  params.push(limit, offset);
  const { rows } = await pool.query(dataSql, params);

  const shorts = rows.map((r) => {
    const categorySlugs = Array.isArray(r.categorySlugs) ? r.categorySlugs : [];
    const categoryLabels = categorySlugs.map((slug) =>
      FEED_FILTERS.find((f) => f.slug === slug)?.name || slug,
    );
    const thumbUrl = r.thumbPath ? `/cache/thumbs/${r.thumbPath}` : null;
    return {
      id: mediaStatsId(r.key),
      key: r.key,
      name: r.name,
      title: r.title,
      creatorSlug: r.creatorSlug,
      creatorName: r.creatorName,
      creatorRank: Number(r.creatorRank || 999),
      creatorHeat: Number(r.creatorHeat || 0),
      kind: r.kind,
      tier: r.tier,
      sizeBytes: Number(r.sizeBytes || 0),
      ext: r.ext || '',
      views: Number(r.views || 0),
      likes: Number(r.likes || 0),
      durationSeconds: Number(r.durationSeconds || 0),
      duration: secondsToDuration(r.durationSeconds),
      creatorThumbnail: r.creatorThumbnail || null,
      categorySlugs,
      categoryLabels,
      categorySlug: categorySlugs[0] || 'featured',
      category: categoryLabels[0] || 'Featured',
      hlsMasterKey: r.hlsMasterKey || null,
      thumbUrl,
    };
  });

  const { rows: cfRows } = await pool.query(
    `select cs.creator_slug as slug, max(cs.creator_name) as name, max(c.category) as category, count(*)::int as count
     from catalog_shorts cs
     join creators c on c.slug = cs.creator_slug
     where cs.catalog_version = $1 and cs.tier = any($2::text[])
     group by cs.creator_slug
     order by max(cs.creator_name) asc`,
    [catalogVersion, tiers],
  );
  const creatorFilters = cfRows.map((r) => ({
    slug: r.slug,
    name: r.name,
    category: r.category,
    count: Number(r.count || 0),
  }));

  const { rows: catRows } = await pool.query(
    'select category_slug as slug, count from catalog_category_counts where catalog_version = $1',
    [catalogVersion],
  );
  const countMap = new Map(catRows.map((r) => [r.slug, Number(r.count || 0)]));
  const categories = FEED_FILTERS.map((filter) => ({
    ...filter,
    count: countMap.get(filter.slug) || 0,
  }));

  let fullAccessRaw = total;
  let allowedAccessRaw = total;
  try {
    const { rows: rawRows } = await pool.query(
      `select count(*)::int as c from catalog_shorts where catalog_version = $1`,
      [catalogVersion],
    );
    fullAccessRaw = Number(rawRows[0]?.c || total);
    const { rows: alRows } = await pool.query(
      `select count(*)::int as c from catalog_shorts where catalog_version = $1 and tier = any($2::text[])`,
      [catalogVersion, tiers],
    );
    allowedAccessRaw = Number(alRows[0]?.c || total);
  } catch {
    /* optional */
  }

  return {
    shorts,
    total,
    creatorFilters,
    categories,
    fullAccessRaw,
    allowedAccessRaw,
  };
}

module.exports = {
  shortsFeedFromPrecalc,
  getCatalogVersion,
  secondsToDuration,
  FEED_FILTERS,
};
