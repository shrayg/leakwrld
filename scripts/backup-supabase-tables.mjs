import fs from 'node:fs/promises';
import path from 'node:path';

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '');
const OUT_DIR = path.resolve(process.cwd(), 'backups');
const TS = new Date().toISOString().replace(/[:.]/g, '-');

const TABLES = [
  'profiles',
  'channels',
  'categories',
  'tags',
  'video_tags',
  'subscriptions',
  'playlists',
  'playlist_items',
  'reports',
  'moderation_flags',
  'consent_preferences',
  'copyright_claims',
  'transcode_jobs',
  'video_metrics_daily',
  'account_profiles',
  'discord_account_links',
  'access_entitlements',
];

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or service role key.');
  process.exit(1);
}

async function supabaseFetch(route) {
  const res = await fetch(`${SUPABASE_URL}${route}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${route} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

await fs.mkdir(OUT_DIR, { recursive: true });
for (const table of TABLES) {
  try {
    const rows = await supabaseFetch(`/rest/v1/${encodeURIComponent(table)}?select=*&limit=100000`);
    const file = path.join(OUT_DIR, `${TS}-${table}.json`);
    await fs.writeFile(file, JSON.stringify(rows, null, 2), 'utf8');
    console.log(`Backed up ${table}: ${Array.isArray(rows) ? rows.length : 0} rows`);
  } catch (err) {
    console.warn(`Skipped ${table}: ${err.message}`);
  }
}

console.log('Backup export complete.');
