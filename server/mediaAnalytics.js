'use strict';

const crypto = require('crypto');
const { catalogSlugFromR2FolderSegment } = require('./catalog');

const STORAGE_KEY_RE = /^videos\/([^/]+)\/(free|tier1|tier2|tier3)\/[^/]+$/;
const CATALOG_ID_RE = /^short-[a-z0-9-]+$/;

const PLAYBACK_MEM = new Map();
const PLAYBACK_TTL_MS = 4 * 3600 * 1000;
const PLAYBACK_MEM_CAP = 80_000;

const LIKE_MEM = new Map();
const LIKE_COOLDOWN_MS = 2000;

const RATE = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 240;
let likesTableEnsured = false;
let likesTableEnsurePromise = null;

function prunePlaybackMemory(now) {
  if (PLAYBACK_MEM.size < PLAYBACK_MEM_CAP) return;
  for (const [k, t] of PLAYBACK_MEM) {
    if (now - t > PLAYBACK_TTL_MS) PLAYBACK_MEM.delete(k);
  }
}

function rememberNewPlayback(mediaRef, sessionId, now) {
  const k = `${mediaRef}\0${sessionId}`;
  if (PLAYBACK_MEM.has(k)) return false;
  PLAYBACK_MEM.set(k, now);
  prunePlaybackMemory(now);
  return true;
}

function mediaIpThrottleReject(ip) {
  const now = Date.now();
  let e = RATE.get(ip);
  if (!e || now > e.resetAt) {
    e = { count: 0, resetAt: now + RATE_WINDOW_MS };
    RATE.set(ip, e);
  }
  if (e.count >= RATE_MAX) return true;
  e.count += 1;
  return false;
}

function likeThrottleOk(ip, mediaRef, now) {
  const k = `${ip}\0${mediaRef}`;
  const last = LIKE_MEM.get(k) || 0;
  if (now - last < LIKE_COOLDOWN_MS) return false;
  LIKE_MEM.set(k, now);
  if (LIKE_MEM.size > 50_000) {
    let n = 0;
    for (const kk of LIKE_MEM.keys()) {
      LIKE_MEM.delete(kk);
      n += 1;
      if (n > 10_000) break;
    }
  }
  return true;
}

async function ensureMediaLikesTable(dbQuery) {
  if (likesTableEnsured) return;
  if (likesTableEnsurePromise) {
    await likesTableEnsurePromise;
    return;
  }
  likesTableEnsurePromise = dbQuery(
    `create table if not exists media_item_likes (
      media_item_id text not null references media_items (id) on delete cascade,
      actor_key text not null,
      created_at timestamptz not null default now(),
      primary key (media_item_id, actor_key)
    )`,
  )
    .then(() =>
      dbQuery(
        `create index if not exists media_item_likes_created_idx
         on media_item_likes (created_at desc)`,
      ),
    )
    .then(() => {
      likesTableEnsured = true;
    })
    .finally(() => {
      likesTableEnsurePromise = null;
    });
  await likesTableEnsurePromise;
}

function likeActorKey({ userId, visitorKey, ip }) {
  if (userId) return `u:${userId}`;
  if (visitorKey) return `v:${visitorKey}`;
  if (ip) return `ip:${ip}`;
  return null;
}

function parseVisitorUuid(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) {
    return s;
  }
  return null;
}

function uuidOk(raw) {
  return parseVisitorUuid(raw) != null;
}

function parseStorageKey(key) {
  const s = String(key || '').trim();
  if (!STORAGE_KEY_RE.test(s)) return null;
  const parts = s.split('/');
  const folderSegment = parts[1];
  const creatorSlug = catalogSlugFromR2FolderSegment(folderSegment);
  const tierRaw = parts[2];
  const filename = parts.slice(3).join('/');
  return { creatorSlug, tierRaw, filename, key: s };
}

function normalizeManifestTier(tierRaw) {
  const map = { free: 'free', tier1: 'basic', tier2: 'premium', tier3: 'ultimate' };
  return map[tierRaw] || 'free';
}

function mediaTypeFromKind(kind) {
  const k = String(kind || '').toLowerCase();
  if (k === 'short') return 'short';
  if (k === 'image' || k === 'photo' || k === 'gif') return 'photo';
  return 'video';
}

function rowIdFromStorageKey(storageKey) {
  return `m_${crypto.createHash('sha256').update(storageKey).digest('hex').slice(0, 28)}`;
}

function safeTitle(filename) {
  const base = String(filename || 'media').replace(/[/\\]/g, '').slice(0, 240);
  return base || 'media';
}

async function ensureManifestMediaRow(client, parsed, kind) {
  const id = rowIdFromStorageKey(parsed.key);
  const title = safeTitle(parsed.filename);
  const tier = normalizeManifestTier(parsed.tierRaw);
  const mediaType = mediaTypeFromKind(kind);
  await client.query(
    `insert into media_items (
       id, creator_slug, title, media_type, tier, duration_seconds, storage_path,
       views, likes, watch_seconds_total, watch_sessions, status
     ) values ($1,$2,$3,$4,$5,0,$6,0,0,0,0,'published')
     on conflict (id) do update set
       media_type = case
         when excluded.media_type = 'short' then 'short'
         else media_items.media_type
       end,
       tier = excluded.tier,
       storage_path = excluded.storage_path,
       updated_at = now()`,
    [id, parsed.creatorSlug, title, mediaType, tier, parsed.key],
  );
  return id;
}

/**
 * @param {import('pg').Pool} pool
 * @param {Function} dbQuery — unused; transactions use pool.connect directly
 * @param {object} body — parsed JSON
 * @param {{ res: import('http').ServerResponse, sendJson: Function, clientIp: Function, sessionUserId?: () => Promise<string|null> }} meta
 */
async function handleMediaAnalytics(pool, dbQuery, body, meta) {
  const { res, sendJson, clientIp, sessionUserId } = meta;
  if (!pool) return sendJson(res, 503, { error: 'Postgres is not configured.' });

  const ip = clientIp() || '';
  if (mediaIpThrottleReject(ip)) {
    return sendJson(res, 429, { error: 'Too many media analytics requests. Slow down.' });
  }

  const action = String(body.action || '').trim().toLowerCase();
  const storageKeyRaw = body.storageKey != null ? String(body.storageKey).trim() : '';
  const catalogId = body.mediaItemId != null ? String(body.mediaItemId).trim() : '';

  if (!['session_start', 'progress', 'like'].includes(action)) {
    return sendJson(res, 400, { error: 'Invalid action.' });
  }

  const playbackSessionId =
    body.playbackSessionId != null ? String(body.playbackSessionId).trim() : '';

  if (action === 'session_start' && !uuidOk(playbackSessionId)) {
    return sendJson(res, 400, { error: 'playbackSessionId (uuid) is required for session_start.' });
  }

  let mediaRef = '';
  let rowId = '';

  if (storageKeyRaw) {
    const parsed = parseStorageKey(storageKeyRaw);
    if (!parsed) return sendJson(res, 400, { error: 'Invalid storageKey.' });
    const creatorSlugBody = body.creatorSlug != null ? String(body.creatorSlug).trim() : '';
    if (creatorSlugBody && creatorSlugBody !== parsed.creatorSlug) {
      return sendJson(res, 400, { error: 'creatorSlug does not match storageKey.' });
    }
    mediaRef = parsed.key;
    rowId = rowIdFromStorageKey(parsed.key);
  } else if (catalogId) {
    if (!CATALOG_ID_RE.test(catalogId)) return sendJson(res, 400, { error: 'Invalid mediaItemId.' });
    mediaRef = catalogId;
    rowId = catalogId;
  } else {
    return sendJson(res, 400, { error: 'Provide storageKey or mediaItemId.' });
  }

  const secondsDelta = Math.min(
    120,
    Math.max(0, Math.floor(Number(body.secondsDelta ?? body.seconds_delta ?? 0))),
  );

  const durHint = Math.min(86400, Math.max(0, Math.floor(Number(body.durationSeconds ?? 0))));

  const now = Date.now();
  if (action === 'session_start') {
    if (!rememberNewPlayback(mediaRef, playbackSessionId, now)) {
      return sendJson(res, 200, { ok: true, deduped: true });
    }
  }

  let uid = null;
  if (typeof sessionUserId === 'function') {
    try {
      uid = await sessionUserId();
    } catch {
      uid = null;
    }
  }

  const visitorKey = parseVisitorUuid(body.visitorKey ?? body.visitor_key);
  const actorKey = likeActorKey({ userId: uid, visitorKey, ip });

  let incViews = 0;
  let incSessions = 0;
  let incSeconds = 0;
  let incLikes = 0;

  if (action === 'session_start') {
    incViews = 1;
    incSessions = 1;
  } else if (action === 'progress') {
    incSeconds = secondsDelta;
  } else if (action === 'like') {
    incLikes = 1;
  }

  if (action === 'like' && !likeThrottleOk(ip, mediaRef, now)) {
    return sendJson(res, 200, { ok: true, throttled: true });
  }
  if (action === 'like' && !actorKey) {
    return sendJson(res, 200, { ok: true, ignored: true });
  }

  const durationOnlyProgress = action === 'progress' && secondsDelta <= 0 && durHint > 0;

  if (action === 'progress' && secondsDelta <= 0 && durHint <= 0) {
    return sendJson(res, 200, { ok: true, noop: true });
  }

  const client = await pool.connect();
  try {
    await client.query('begin');

    if (storageKeyRaw) {
      const parsed = parseStorageKey(storageKeyRaw);
      const kind = body.kind != null ? String(body.kind) : 'video';
      await ensureManifestMediaRow(client, parsed, kind);
    }

    if (durationOnlyProgress) {
      const upd = await client.query(
        `update media_items set
          duration_seconds = greatest(media_items.duration_seconds, $2::integer),
          updated_at = now()
        where id = $1`,
        [rowId, durHint],
      );
      if (upd.rowCount === 0 && catalogId) {
        await client.query('rollback');
        return sendJson(res, 404, { error: 'Unknown catalog media item.' });
      }
      if (upd.rowCount === 0) {
        await client.query('rollback');
        return sendJson(res, 500, { error: 'Media row missing.' });
      }
      await client.query('commit');
      return sendJson(res, 200, { ok: true });
    }

    if (action === 'like') {
      await ensureMediaLikesTable(dbQuery);
      const likeInsert = await client.query(
        `insert into media_item_likes (media_item_id, actor_key)
         values ($1, $2)
         on conflict do nothing`,
        [rowId, actorKey],
      );
      // Count only first like per actor/media; re-clicks become no-op.
      if (likeInsert.rowCount === 0) incLikes = 0;
    }

    const params = [rowId, incViews, incSessions, BigInt(incSeconds), incLikes];
    let sql = `
      update media_items set
        views = views + $2::integer,
        watch_sessions = watch_sessions + $3::integer,
        watch_seconds_total = watch_seconds_total + $4::bigint,
        likes = likes + $5::integer,
        updated_at = now()
      where id = $1`;

    if (action === 'session_start' && durHint > 0) {
      sql = `
        update media_items set
          views = views + $2::integer,
          watch_sessions = watch_sessions + $3::integer,
          watch_seconds_total = watch_seconds_total + $4::bigint,
          likes = likes + $5::integer,
          duration_seconds = greatest(media_items.duration_seconds, $6::integer),
          updated_at = now()
        where id = $1`;
      params.push(durHint);
    }

    const upd = await client.query(sql, params);

    if (upd.rowCount === 0 && catalogId) {
      await client.query('rollback');
      return sendJson(res, 404, { error: 'Unknown catalog media item.' });
    }

    if (upd.rowCount === 0) {
      await client.query('rollback');
      return sendJson(res, 500, { error: 'Media row missing after upsert.' });
    }

    await client.query(
      `insert into analytics_events (user_id, visitor_key, event_type, path, category, payload)
       values ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        uid,
        visitorKey,
        `media_${action}`,
        storageKeyRaw || catalogId || '/',
        'media',
        JSON.stringify({
          mediaRef,
          secondsDelta: incSeconds,
          playbackSessionId: playbackSessionId || null,
        }),
      ],
    ).catch(() => {});

    await client.query('commit');
    return sendJson(res, 200, { ok: true });
  } catch (err) {
    await client.query('rollback').catch(() => {});
    console.error('[media analytics]', err);
    return sendJson(res, 500, { error: 'Media analytics failed.' });
  } finally {
    client.release();
  }
}

module.exports = {
  handleMediaAnalytics,
  parseStorageKey,
  rowIdFromStorageKey,
};
