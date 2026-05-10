'use strict';

const TIER_ALIASES = {
  free: 'free',
  tier1: 'basic',
  basic: 'basic',
  tier2: 'premium',
  premium: 'premium',
  tier3: 'ultimate',
  ultimate: 'ultimate',
  admin: 'admin',
};
const ALLOWED_TIERS = new Set(Object.keys(TIER_ALIASES));

function normalizeAccountTier(tier) {
  const key = String(tier || 'free').toLowerCase().replace(/[^a-z0-9]/g, '');
  return TIER_ALIASES[key] || null;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function matchAdminUserRoute(pathname) {
  const reset = pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/i);
  if (reset && UUID.test(reset[1])) {
    return { userId: reset[1].toLowerCase(), sub: 'reset-password' };
  }
  const base = pathname.match(/^\/api\/admin\/users\/([^/]+)$/i);
  if (base && UUID.test(base[1])) {
    return { userId: base[1].toLowerCase(), sub: null };
  }
  return null;
}

async function patchUser(dbQuery, userId, body) {
  const exists = await dbQuery('select username from users where id = $1', [userId]);
  if (!exists.rows[0]) return { status: 404, error: 'User not found.' };

  const sets = [];
  const vals = [];
  let n = 1;

  if (body.tier !== undefined && body.tier !== null && String(body.tier).trim() !== '') {
    const t = normalizeAccountTier(body.tier);
    if (!t) return { status: 400, error: 'Invalid tier.' };
    sets.push(`tier = $${n++}`);
    vals.push(t);
  }

  if (body.banned !== undefined) {
    const ban = body.banned === true || body.banned === 'true' || body.banned === 1;
    if (ban) {
      sets.push(`banned_at = coalesce(banned_at, now())`);
      const reason =
        body.banReason != null ? String(body.banReason).trim().slice(0, 500) : '';
      sets.push(`ban_reason = $${n++}`);
      vals.push(reason || null);
    } else {
      sets.push(`banned_at = null`);
      sets.push(`ban_reason = null`);
    }
  }

  if (sets.length === 0) return { status: 400, error: 'No valid fields to update.' };

  sets.push('updated_at = now()');
  vals.push(userId);
  await dbQuery(`update users set ${sets.join(', ')} where id = $${n}`, vals);
  return { status: 200 };
}

async function deleteUser(dbQuery, userId, body) {
  const confirm = String(body.confirmUsername || '').trim();
  if (!confirm) return { status: 400, error: 'confirmUsername is required.' };

  const row = await dbQuery('select username from users where id = $1', [userId]);
  if (!row.rows[0]) return { status: 404, error: 'User not found.' };
  if (row.rows[0].username !== confirm) {
    return { status: 400, error: 'Username confirmation does not match.' };
  }

  await dbQuery('delete from users where id = $1', [userId]);
  return { status: 200 };
}

async function resetPassword(dbQuery, passwordHash, userId, body) {
  const pw = String(body.newPassword ?? body.password ?? '');
  const cf = String(body.confirmPassword ?? body.confirm_password ?? '');
  if (pw.length < 8) return { status: 400, error: 'Password must be at least 8 characters.' };
  if (pw !== cf) return { status: 400, error: 'Passwords do not match.' };

  const row = await dbQuery('select id from users where id = $1', [userId]);
  if (!row.rows[0]) return { status: 404, error: 'User not found.' };

  const hash = passwordHash(pw);
  await dbQuery(
    'update users set password_hash = $2, updated_at = now() where id = $1',
    [userId, hash],
  );
  return { status: 200 };
}

/**
 * @returns {Promise<{ status: number, error?: string }>}
 */
async function processAdminUserAction({ method, userId, sub, body, dbQuery, passwordHash }) {
  if (sub === 'reset-password') {
    if (method !== 'POST') return { status: 405, error: 'Method not allowed.' };
    return resetPassword(dbQuery, passwordHash, userId, body);
  }

  if (method === 'PATCH') return patchUser(dbQuery, userId, body);
  if (method === 'DELETE') return deleteUser(dbQuery, userId, body);

  return { status: 405, error: 'Method not allowed.' };
}

module.exports = {
  ALLOWED_TIERS,
  normalizeAccountTier,
  matchAdminUserRoute,
  processAdminUserAction,
};
