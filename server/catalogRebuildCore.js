'use strict';

const fs = require('fs');
const path = require('path');

const FEED_FILTERS = [
  { slug: 'trending', name: 'Trending' },
  { slug: 'top-videos', name: 'Top videos' },
  { slug: 'featured', name: 'Featured' },
];
const FEED_FILTER_LABELS = new Map(FEED_FILTERS.map((f) => [f.slug, f.name]));

function stableHash(value) {
  let hash = 2166136261;
  const s = String(value || '');
  for (let i = 0; i < s.length; i += 1) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = stableHash(seed) || 0x9e3779b9;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(items, seed) {
  const out = items.slice();
  const rand = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function clipDisplayTitle(fileName) {
  const base = String(fileName || '')
    .replace(/\.[^/.]+$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  if (!base) return 'Short clip';
  return base.length > 80 ? `${base.slice(0, 78)}…` : base;
}

function isShortsFeedMedia(item) {
  const ext = String(item?.ext || '').toLowerCase();
  return item?.kind === 'video' || ext === '.gif';
}

function loadMediaManifest(mediaDir, slug) {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  try {
    const raw = fs.readFileSync(path.join(mediaDir, `${slug}.json`), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function mediaStatsId(storageKey) {
  const { createHash } = require('crypto');
  return createHash('sha1').update(String(storageKey || ''), 'utf8').digest('hex').slice(0, 16);
}

function defaultHlsMasterKey(storageKey) {
  const k = String(storageKey || '');
  if (!k || !/\.(mp4|m4v|mov|webm|mkv)$/i.test(k)) return null;
  const i = k.lastIndexOf('/');
  if (i < 0) return null;
  return `${k.slice(0, i)}/hls/master.m3u8`;
}

/**
 * @param {object} opts
 * @param {Array<{slug:string,name:string,rank:number,heat:number,category:string}>} opts.readyCreators
 * @param {string} opts.mediaDir
 * @param {(slug:string)=>string|null} opts.thumbnailFor
 * @param {string} opts.ingestSeed
 * @param {Map<string,{views:number,likes:number,duration_seconds:number}>} opts.statsByKey
 */
function buildCatalogRows({ readyCreators, mediaDir, thumbnailFor, ingestSeed, statsByKey }) {
  const buckets = [];
  const allEligible = [];
  const creatorFilters = [];

  for (const creator of readyCreators) {
    const manifest = loadMediaManifest(mediaDir, creator.slug);
    if (!manifest) continue;
    const feedMedia = manifest.items.filter(isShortsFeedMedia);
    const videos = feedMedia.map((item) => {
      const st = statsByKey?.get(item.key) || {};
      return {
        id: mediaStatsId(item.key),
        key: item.key,
        name: item.name,
        title: clipDisplayTitle(item.name),
        creatorSlug: creator.slug,
        creatorName: creator.name,
        creatorRank: Number(creator.rank || 999),
        creatorHeat: Number(creator.heat || 0),
        kind: item.ext === '.gif' ? 'image' : item.kind,
        tier: item.tier,
        sizeBytes: Number(item.sizeBytes || 0),
        ext: item.ext || '',
        views: Number(st.views || 0),
        likes: Number(st.likes || 0),
        durationSeconds: Number(st.duration_seconds ?? st.durationSeconds ?? 0),
        creatorThumbnail: thumbnailFor(creator.slug) || null,
        hlsMasterKey: defaultHlsMasterKey(item.key),
      };
    });
    if (!videos.length) continue;
    creatorFilters.push({
      slug: creator.slug,
      name: creator.name,
      category: creator.category,
      count: videos.length,
    });
    buckets.push(videos);
    allEligible.push(...videos);
  }

  const interleaved = [];
  let row = 0;
  while (true) {
    let pushed = false;
    for (const bucket of buckets) {
      if (bucket[row]) {
        interleaved.push(bucket[row]);
        pushed = true;
      }
    }
    if (!pushed) break;
    row += 1;
  }

  const n = allEligible.length;
  const bucketSize = Math.max(8, Math.ceil(n * 0.34));
  const seed = ingestSeed;

  const topVideos = new Set(
    allEligible
      .slice()
      .sort((a, b) => {
        const scoreA =
          Number(a.sizeBytes || 0) +
          Number(a.creatorHeat || 0) * 400000 +
          (stableHash(`${seed}:top:${a.key}`) % 400000);
        const scoreB =
          Number(b.sizeBytes || 0) +
          Number(b.creatorHeat || 0) * 400000 +
          (stableHash(`${seed}:top:${b.key}`) % 400000);
        return scoreB - scoreA;
      })
      .slice(0, bucketSize)
      .map((item) => item.key),
  );
  const trending = new Set(
    allEligible
      .slice()
      .sort((a, b) => {
        const scoreA =
          Number(a.creatorHeat || 0) * 10000 +
          (stableHash(`${seed}:trend:${a.key}`) % 10000) +
          Math.min(2000, Number(a.sizeBytes || 0) / 250000);
        const scoreB =
          Number(b.creatorHeat || 0) * 10000 +
          (stableHash(`${seed}:trend:${b.key}`) % 10000) +
          Math.min(2000, Number(b.sizeBytes || 0) / 250000);
        return scoreB - scoreA;
      })
      .slice(0, bucketSize)
      .map((item) => item.key),
  );
  const featured = new Set(
    interleaved
      .slice()
      .sort((a, b) => {
        const scoreA =
          (1000 - Number(a.creatorRank || 999)) * 1000 + (stableHash(`${seed}:feature:${a.key}`) % 1000);
        const scoreB =
          (1000 - Number(b.creatorRank || 999)) * 1000 + (stableHash(`${seed}:feature:${b.key}`) % 1000);
        return scoreB - scoreA;
      })
      .slice(0, bucketSize)
      .map((item) => item.key),
  );

  const categoryCounts = new Map();
  for (const item of allEligible) {
    const categorySlugs = [];
    if (trending.has(item.key)) categorySlugs.push('trending');
    if (topVideos.has(item.key)) categorySlugs.push('top-videos');
    if (featured.has(item.key)) categorySlugs.push('featured');
    if (!categorySlugs.length) categorySlugs.push('featured');
    item.categorySlugs = categorySlugs;
    for (const slug of categorySlugs) {
      const prev = categoryCounts.get(slug) || { slug, name: FEED_FILTER_LABELS.get(slug) || slug, count: 0 };
      prev.count += 1;
      categoryCounts.set(slug, prev);
    }
  }

  const topScore = (v) =>
    Number(v.sizeBytes || 0) +
    Number(v.creatorHeat || 0) * 400000 +
    (stableHash(`${seed}:tops:${v.key}`) % 400000);
  const trendScore = (v) =>
    Number(v.creatorHeat || 0) * 10000 +
    (stableHash(`${seed}:trends:${v.key}`) % 10000) +
    Math.min(2000, Number(v.sizeBytes || 0) / 250000);

  const interleavedWithIdx = interleaved.map((item, idx) => ({ ...item, interleave_position: idx }));

  const byTrend = interleavedWithIdx.slice().sort((a, b) => trendScore(b) - trendScore(a));
  const trendRank = new Map(byTrend.map((it, i) => [it.key, i]));

  const byTop = interleavedWithIdx.slice().sort((a, b) => topScore(b) - topScore(a));
  const topRankMap = new Map(byTop.map((it, i) => [it.key, i]));

  const byLikes = interleavedWithIdx.slice().sort((a, b) => {
    const d = Number(b.likes || 0) - Number(a.likes || 0);
    if (d !== 0) return d;
    return topScore(b) - topScore(a);
  });
  const likesRankMap = new Map(byLikes.map((it, i) => [it.key, i]));

  const shuffled = seededShuffle(interleavedWithIdx, seed);
  const shuffleMap = new Map(shuffled.map((it, i) => [it.key, i]));

  const topSorted = interleavedWithIdx.slice().sort((a, b) => topScore(b) - topScore(a));
  const halfN = Math.max(1, Math.ceil(topSorted.length * 0.5));
  const featuredHalf = seededShuffle(topSorted.slice(0, halfN), `${seed}:featured`);
  const featuredShuffleMap = new Map(featuredHalf.map((it, i) => [it.key, i]));

  const rows = interleavedWithIdx.map((item) => ({
    ...item,
    interleave_position: item.interleave_position,
    shuffle_position: shuffleMap.get(item.key) ?? 0,
    trending_rank: trendRank.get(item.key) ?? 0,
    top_rank: topRankMap.get(item.key) ?? 0,
    likes_rank: likesRankMap.get(item.key) ?? 0,
    featured_shuffle_position: featuredShuffleMap.has(item.key) ? featuredShuffleMap.get(item.key) : null,
  }));

  return {
    rows,
    creatorFilters,
    categoryCounts,
    fullAccessRaw: allEligible.length,
    /** All tiers in manifests (same as allEligible length for feed media). */
    allowedAccessRaw: allEligible.length,
  };
}

function fingerprintManifests(mediaDir, slugs) {
  const h = require('crypto').createHash('sha256');
  for (const slug of slugs.slice().sort()) {
    const p = path.join(mediaDir, `${slug}.json`);
    try {
      const st = fs.statSync(p);
      h.update(`${slug}:${st.mtimeMs}:${st.size}\n`);
    } catch {
      h.update(`${slug}:missing\n`);
    }
  }
  return h.digest('hex');
}

module.exports = {
  buildCatalogRows,
  fingerprintManifests,
  loadMediaManifest,
  clipDisplayTitle,
  isShortsFeedMedia,
  FEED_FILTERS,
  FEED_FILTER_LABELS,
};
