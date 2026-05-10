#!/usr/bin/env node
/**
 * Assigns referral_code to any user row that is still NULL (after migration 001).
 * Run: npm run db:backfill-referrals
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { generateReferralCode } = require('../server/referralCodes.js');

const url = String(process.env.DATABASE_URL || '').trim();
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 2 });

async function pickUniqueCode(client) {
  for (let i = 0; i < 40; i += 1) {
    const code = generateReferralCode();
    const dup = await client.query('select 1 from users where referral_code = $1 limit 1', [code]);
    if (dup.rowCount === 0) return code;
  }
  throw new Error('Could not allocate a unique referral code');
}

async function main() {
  const client = await pool.connect();
  try {
    const need = await client.query(
      'select id from users where referral_code is null order by created_at asc',
    );
    console.log(`Rows needing referral_code: ${need.rows.length}`);
    for (const row of need.rows) {
      await client.query('begin');
      try {
        const code = await pickUniqueCode(client);
        await client.query('update users set referral_code = $2, updated_at = now() where id = $1', [
          row.id,
          code,
        ]);
        await client.query('commit');
        console.log(`Updated ${row.id} -> ${code}`);
      } catch (e) {
        await client.query('rollback');
        throw e;
      }
    }

    await client.query(`
      alter table users alter column referral_code set not null
    `).catch((e) => {
      if (!String(e.message || '').includes('contains null')) throw e;
    });

    await client.query(`
      do $$
      begin
        if not exists (select 1 from pg_constraint where conname = 'users_referral_code_fmt') then
          alter table users add constraint users_referral_code_fmt
            check (referral_code ~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$');
        end if;
      end $$;
    `).catch(() => {});

    console.log('Done.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
