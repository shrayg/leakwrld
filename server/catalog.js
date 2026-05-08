'use strict';

const creatorNames = [
  'Sophie Rain',
  'Mia Khalifa',
  'Bhad Bhabie',
  'Bella Thorne',
  'Blac Chyna',
  'Iggy Azalea',
  'Cardi B',
  'Tana Mongeau',
  'Belle Delphine',
  'Tyga',
  'Amber Rose',
  'Bonnie Blue',
  'Lily Phillips',
  'Ari Kytsya',
  'Camilla Araujo',
  'Aishah Sofey',
  'Angela White',
  'Mia Malkova',
  'Eva Elfie',
  'Francesca Farago',
  'Lena The Plug',
  'Amouranth',
  'Corinna Kopf',
  'Coco Austin',
  'Trisha Paytas',
  'Pia Mia',
  'Ana Cheri',
  'Francia James',
  'Violet Myers',
  'Bryce Adams',
  'Louisa Khovanski',
  'Skylar Mae',
  'Bruna Lima',
  'Viking Barbie',
  'Emily Elizabeth',
  'Hannah Palmer',
  'Kayla Simmons',
  'Ariella Ferrera',
  'Whitney Johns',
  'Carriejune Anne Bowlby',
  'Heidi Lavon',
  'Gigi Gorgeous Getty',
  'Kerry Katona',
  'Drea de Matteo',
  'Sonja Morgan',
  'Chloe Sims',
  'Renee Gracie',
  'Brittney Palmer',
  'Amanda Ribas',
  'Polyana Viana',
  'Maryana Ro',
  'Yeri Mua',
  'Danyan Cat',
  'Marleny Aleelayn',
  'Daniela Alexis',
  'Emily Ahern',
  'Sofia Gomez',
  'Nara Ford',
  'Janna Breslin',
  'Marcela Moss',
  'Brandi Andrews',
  'Sydney Lint',
  'Lexi Cayla',
  'Diana Maux',
  'Jasmine Gifford',
  'Molly Eskam',
  'Corinne Olympios',
  'Casey Boonstra',
  'CJ Sparxx',
  'Sugey Abrego',
  'Carla Leclercq',
  'Lizzy Capri',
  'Vic Hoa',
  'Willow Harper',
  'Alyssa Griffith',
  'Ashleigh Dunn',
  'Jasmin Montalvo',
  'Kellan Ness',
  'Diana Estrada',
  'Aniela Verbin',
  'Tati Evans',
  'Shayne Jansen',
  'Sabrina Banks',
  'Courtney McClure',
  'Cathilee Zingano',
  'Lewis Buchanan',
  'Sarah Caldeira',
  'Jade Love',
  'Lacey Jayne',
  'Mila',
  'Tara',
  'Angelina Maldonado',
  'Samantha Jerasa',
  'Callie Murphy',
  'Summer Brookes',
  'Elena Belle',
  'SlimGem24',
  'Lexi Luna',
  'Johnny Sins',
  'Alex Adams',
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
  return {
    rank,
    name,
    slug: slugify(name),
    category,
    tagline: `${category} creator collection with free previews and premium media slots ready for Postgres content.`,
    mediaCount: seededMetric(rank, 24, 420),
    freeCount: seededMetric(rank, 4, 18),
    premiumCount: seededMetric(rank, 18, 240),
    heat: Math.max(42, 100 - Math.floor(rank / 2)),
    accent: ['pink', 'gold', 'cyan', 'green'][index % 4],
  };
});

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
  shorts,
  slugify,
};
