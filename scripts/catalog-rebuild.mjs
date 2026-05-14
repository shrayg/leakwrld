#!/usr/bin/env node
/**
 * Rebuild Postgres precalculated shorts catalog from on-disk manifests.
 *
 *   npm run catalog:rebuild
 *   npm run catalog:rebuild -- --force
 *
 * Requires DATABASE_URL, same repo layout as server (client/public/media/*.json).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pg = require('pg');
const crypto = require('crypto');
const { readyCreators } = require('../server/catalog.js');
const {
  buildCatalogRows,
  fingerprintManifests,
  loadMediaManifest,
  isShortsFeedMedia,
} = require('../server/catalogRebuildCore.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function loadLocalEnv(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] != null) continue;
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    /* optional */
  }
}

loadLocalEnv(path.join(ROOT, '.env'));

const url = String(process.env.DATABASE_URL || '').trim();
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const MEDIA_DIR = path.join(ROOT, 'client', 'public', 'media');
const force = process.argv.includes('--force');

const thumbnailLookup = new Map(
  require('../server/catalog.js').creators.map((c) => [c.slug, c.thumbnail]),
);
function thumbnailFor(slug) {
  return thumbnailLookup.get(slug) || null;
}

async function loadStats(pool, keys) {
  const stats = new Map();
  if (!keys.length) return stats;
  const { rows } = await pool.query(
    `select storage_path, coalesce(views,0)::int as views, coalesce(likes,0)::int as likes,
            coalesce(duration_seconds,0)::int as duration_seconds
     from media_items where storage_path = any($1::text[])`,
    [keys],
  );
  for (const r of rows) {
    stats.set(r.storage_path, {
      views: r.views,
      likes: r.likes,
      duration_seconds: r.duration_seconds,
    });
  }
  return stats;
}

async function main() {
  const slugs = readyCreators.map((c) => c.slug);
  const fp = fingerprintManifests(MEDIA_DIR, slugs);
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const client = await pool.connect();
  try {
    const st = await client.query(
      'select catalog_version, manifest_fingerprint from catalog_ingest_state where id = 1 for update',
    );
    if (st.rowCount === 0) {
      throw new Error('catalog_ingest_state missing — run migration 009');
    }
    const prevFp = String(st.rows[0].manifest_fingerprint || '');
    if (!force && prevFp === fp) {
      console.log('[catalog:rebuild] Manifest fingerprint unchanged; use --force to rebuild anyway.');
      return;
    }

    const ingestSeed = crypto.randomUUID();
    const keys = [];
    for (const c of readyCreators) {
      const m = loadMediaManifest(MEDIA_DIR, c.slug);
      if (!m?.items) continue;
      for (const item of m.items) {
        if (isShortsFeedMedia(item)) keys.push(item.key);
      }
    }
    const statsByKey = await loadStats(pool, keys);
    const built = buildCatalogRows({
      readyCreators,
      mediaDir: MEDIA_DIR,
      thumbnailFor,
      ingestSeed,
      statsByKey,
    });

    const newVersion = Number(st.rows[0].catalog_version || 0) + 1;
    const { rows, creatorFilters, categoryCounts } = built;

    await client.query('begin');
    const pruneBelow = newVersion - 2;
    if (pruneBelow > 0) {
      await client.query('delete from catalog_category_counts where catalog_version < $1', [pruneBelow]);
      await client.query('delete from catalog_shorts where catalog_version < $1', [pruneBelow]);
    }

    const chunk = 250;
    for (let i = 0; i < rows.length; i += chunk) {
      const slice = rows.slice(i, i + chunk);
      const values = [];
      const params = [];
      let p = 1;
      for (const r of slice) {
        values.push(
          `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`,
        );
        params.push(
          newVersion,
          r.key,
          r.creatorSlug,
          r.creatorName,
          r.creatorThumbnail,
          r.name,
          r.title,
          r.kind,
          r.tier,
          r.ext,
          r.sizeBytes,
          r.creatorRank,
          r.creatorHeat,
          r.categorySlugs,
          r.interleave_position,
          r.shuffle_position,
          r.trending_rank,
          r.top_rank,
          r.likes_rank,
          r.featured_shuffle_position,
          null,
          r.views,
          r.likes,
          r.durationSeconds,
          r.hlsMasterKey,
        );
      }
      await client.query(
        `insert into catalog_shorts (
          catalog_version, storage_key, creator_slug, creator_name, creator_thumbnail,
          name, title, kind, tier, ext, size_bytes, creator_rank, creator_heat, category_slugs,
          interleave_position, shuffle_position, trending_rank, top_rank, likes_rank,
          featured_shuffle_position, thumb_path, views, likes, duration_seconds, hls_master_key
        ) values ${values.join(',')}`,
        params,
      );
    }

    for (const [slug, meta] of categoryCounts) {
      await client.query(
        `insert into catalog_category_counts (catalog_version, category_slug, count)
         values ($1,$2,$3)
         on conflict (catalog_version, category_slug) do update set count = excluded.count`,
        [newVersion, slug, meta.count],
      );
    }

    await client.query(
      `update catalog_ingest_state set
         catalog_version = $1,
         ingest_seed = $2,
         manifest_fingerprint = $3,
         row_count = $4,
         updated_at = now()
       where id = 1`,
      [newVersion, ingestSeed, fp, rows.length],
    );

    await client.query('commit');
    console.log(
      `[catalog:rebuild] catalog_version=${newVersion} rows=${rows.length} creators=${creatorFilters.length} fp=${fp.slice(0, 12)}…`,
    );
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
