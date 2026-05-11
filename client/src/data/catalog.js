import THUMBNAIL_SLUGS from './thumbnails.json';
import MEDIA_SUMMARY from './media-summary.json';

const THUMBNAIL_SET = new Set(THUMBNAIL_SLUGS);
const MEDIA_BY_SLUG = new Map(MEDIA_SUMMARY.map((e) => [e.slug, e]));
const CREATOR_THUMB_OVERRIDES = {
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

const CREATOR_NAMES = [
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

export const CATEGORIES = [
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

const ALL_CREATORS = CREATOR_NAMES.map((name, index) => {
  const rank = index + 1;
  const category = CATEGORIES[index % CATEGORIES.length];
  const slug = slugify(name);
  const real = MEDIA_BY_SLUG.get(slug);
  const mediaCount = real ? real.count : seededMetric(rank, 24, 420);
  const freeCount = real ? real.free : seededMetric(rank, 4, 18);
  const premiumCount = real ? Math.max(0, mediaCount - freeCount) : seededMetric(rank, 18, 240);
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
    thumbnail: THUMBNAIL_SET.has(slug) ? `/thumbnails/${slug}.jpg` : null,
    ...(CREATOR_THUMB_OVERRIDES[slug] || {}),
    ready: !!real,
  };
});

/** Public catalog: only creators with real R2 content. The full list is exported
 *  separately for admin / debug surfaces. */
export const CREATORS = ALL_CREATORS.filter((c) => c.ready);
export const ALL_CREATORS_INCLUDING_EMPTY = ALL_CREATORS;

export const SHORTS = ALL_CREATORS.slice(0, 36).map((creator, index) => ({
  id: `short-${creator.slug}`,
  creatorSlug: creator.slug,
  creatorName: creator.name,
  title: `${creator.name} preview ${index + 1}`,
  tier: index % 5 === 0 ? 'premium' : 'free',
  duration: ['0:18', '0:24', '0:32', '0:41'][index % 4],
  views: 0,
  likes: 0,
}));
