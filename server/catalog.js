'use strict';

const path = require('path');
const fs = require('fs');

let thumbnailSlugs = new Set();
try {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'client', 'src', 'data', 'thumbnails.json'), 'utf8');
  thumbnailSlugs = new Set(JSON.parse(raw));
} catch {
  thumbnailSlugs = new Set();
}

/**
 * Per-creator media summary from `npm run media:sync` / checked-in manifests.
 * We merge **both** paths so production (VPS) matches the SPA catalog:
 *   - `data/media-summary.json` — optional CI/server dump `{ creators: [...] }`
 *   - `client/src/data/media-summary.json` — array `[{ slug, count, ... }, ...]`
 * Without this, only `data/media-summary.json` was read and stayed empty on
 * deploy → every creator looked "not ready" → `/api/creators` returned [].
 */
function loadMediaSummaryMap() {
  const map = new Map();
  const paths = [
    path.join(__dirname, '..', 'data', 'media-summary.json'),
    path.join(__dirname, '..', 'client', 'src', 'data', 'media-summary.json'),
  ];
  for (const filePath of paths) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : parsed.creators || [];
      for (const entry of list) {
        if (entry && entry.slug) map.set(entry.slug, entry);
      }
    } catch {
      /* missing or invalid */
    }
  }
  return map;
}

const mediaSummary = loadMediaSummaryMap();
const creatorThumbOverrides = {
  'sophie-rain': { thumbnailPosition: '50% 10%' },
  'bhad-bhabie': { thumbnailPosition: '50% 10%' },
  'belle-delphine': { thumbnailPosition: '58% 28%' },
  'lil-tay': { thumbnailPosition: '50% 12%' },
  'corinna-kopf': { thumbnailPosition: '50% 20%' },
  'amber-ajami': { thumbnailPosition: '50% 10%' },
  'bunni-emmie': { thumbnailPosition: '50% 8%' },
  'lela-sohna': { thumbnailPosition: '50% 10%' },
  'piper-rockelle': { thumbnailPosition: '50% 14%' },
};

const creatorNames = [
  'Sophie Rain',
  'Lil Tay',
  'Bhad Bhabie',
  'Bonnie Blue',
  'Lily Phillips',
  'Corinna Kopf',
  'Belle Delphine',
  'Camilla Araujo',
  'Aishah Sofey',
  'Ari Kytsya',
  'Tana Mongeau',
  'Amouranth',
  'Mia Khalifa',
  'Amber Rose',
  'Iggy Azalea',
  'Skylar Mae',
  'Marie Temara',
  'Vera Dijkmans',
  'Jameliz Smith',
  'Pia Mia',
  'Erica Mena',
  'Farrah Abraham',
  'Chloe Khan',
  'Sofia Gomez',
  'Amber Ajami',
  'Alinaxrose',
  'Breckie Hill',
  'Kira Pregiato',
  'Bunni Emmie',
  'Lela Sohna',
  'Piper Rockelle',
  'Alice Rosenblum',
  'Jameliz',
  'Julia Filippo',
  'Katiana Kay',
  'Summerxiris',
  'Waifumia',
  'Yumi Eto',
  'Lexi Marvel',
  'Honeybeepott',
  'Brooke Monk',
  'Overtime Megan',
  'Bbyanni',
];

const categoryNames = [
  'Featured',
  'Trending',
  'New Drops',
  'Shorts',
  'Photos',
  'Premium Vault',
  'Creator Requests',
  'Free Previews',
];

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function seededMetric(rank, base, spread) {
  return base + ((rank * 37) % spread);
}

const creators = creatorNames.map((name, index) => {
  const rank = index + 1;
  const category = categoryNames[index % categoryNames.length];
  const slug = slugify(name);
  const real = mediaSummary.get(slug);
  /** Real R2 counts when available; fall back to seeded values for creators
   *  without a manifest (so the seeded card never shows zero). */
  const mediaCount = real ? real.count : seededMetric(rank, 24, 420);
  const freeCount = real
    ? Number(real.byTier?.free?.count ?? real.free ?? 0)
    : seededMetric(rank, 4, 18);
  const premiumCount = real
    ? mediaCount - freeCount
    : seededMetric(rank, 18, 240);
  const viewsAllTime = Math.max(0, Math.floor(mediaCount * 142 + freeCount * 88 + rank * 400));
  return {
    rank,
    name,
    slug,
    category,
    tagline: `${category} archive with free previews and a fully mirrored premium vault.`,
    mediaCount,
    freeCount,
    premiumCount,
    viewsAllTime,
    heat: Math.max(42, 100 - Math.floor(rank / 2)),
    accent: ['pink', 'gold', 'cyan', 'green'][index % 4],
    thumbnail: thumbnailSlugs.has(slug) ? `/thumbnails/${slug}.webp` : null,
    ...(creatorThumbOverrides[slug] || {}),
    /** "ready" = R2 has real content for this creator; the public catalog
     *  filters on this so empty placeholders don't appear in the grid. */
    ready: !!real,
  };
});

/** Public-facing list: only creators with real R2 content. */
const readyCreators = creators.filter((c) => c.ready);

const shorts = creators.slice(0, 36).map((creator, index) => ({
  id: `short-${creator.slug}`,
  creatorSlug: creator.slug,
  creatorName: creator.name,
  title: `${creator.name} preview ${index + 1}`,
  tier: index % 5 === 0 ? 'premium' : 'free',
  duration: ['0:18', '0:24', '0:32', '0:41'][index % 4],
  /** Real engagement comes from DB/media telemetry after catalog seed — no demo counts. */
  views: 0,
  likes: 0,
}));

module.exports = {
  categoryNames,
  creators,
  readyCreators,
  shorts,
  slugify,
};
