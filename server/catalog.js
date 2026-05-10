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
 * Per-creator media summary built by `npm run media:sync`. The summary maps each
 * slug -> real R2 object counts so creators with no real content (only the
 * `.keep` placeholder) can be hidden from public APIs and the seeded marketing
 * counts can be overridden by real data wherever it exists.
 */
let mediaSummary = new Map();
try {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'data', 'media-summary.json'), 'utf8');
  const parsed = JSON.parse(raw);
  for (const entry of parsed.creators || []) mediaSummary.set(entry.slug, entry);
} catch {
  mediaSummary = new Map();
}

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
  const freeCount = real ? (real.byTier?.free?.count || 0) : seededMetric(rank, 4, 18);
  const premiumCount = real
    ? mediaCount - freeCount
    : seededMetric(rank, 18, 240);
  return {
    rank,
    name,
    slug,
    category,
    tagline: `${category} archive with free previews and a fully mirrored premium vault.`,
    mediaCount,
    freeCount,
    premiumCount,
    heat: Math.max(42, 100 - Math.floor(rank / 2)),
    accent: ['pink', 'gold', 'cyan', 'green'][index % 4],
    thumbnail: thumbnailSlugs.has(slug) ? `/thumbnails/${slug}.jpg` : null,
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
  views: seededMetric(index + 1, 1200, 88000),
  likes: seededMetric(index + 1, 140, 6800),
}));

module.exports = {
  categoryNames,
  creators,
  readyCreators,
  shorts,
  slugify,
};
