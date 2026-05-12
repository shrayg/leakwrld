/**
 * One-off helper to apply a single SQL migration without needing `psql` on PATH.
 * Usage:  node scripts/apply-migration.mjs database/migrations/008_referral_visits.sql
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/apply-migration.mjs <path/to/migration.sql>');
  process.exit(1);
}

const dotenv = await import('node:fs/promises').then(async (m) => {
  try {
    const raw = await m.readFile(path.resolve(process.cwd(), '.env'), 'utf8');
    const out = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      const hash = value.indexOf(' #');
      if (hash > 0) value = value.slice(0, hash).trim();
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
});

const connectionString = process.env.DATABASE_URL || dotenv.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL not set (env or .env)');
  process.exit(2);
}

const sql = await fs.readFile(path.resolve(process.cwd(), file), 'utf8');
const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query(sql);
  const tableMatch = sql.match(/create\s+table[^a-z_]*([a-z_][a-z_0-9]*)/i);
  if (tableMatch) {
    const cols = await client.query(
      `select column_name, data_type from information_schema.columns where table_name = $1 order by ordinal_position`,
      [tableMatch[1]],
    );
    console.log(`migration applied: ${file}\nschema of ${tableMatch[1]}:`);
    console.table(cols.rows);
  } else {
    console.log(`migration applied: ${file}`);
  }
} finally {
  await client.end();
}
