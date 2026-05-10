'use strict';

function clampPage(n, fallback = 1) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 1) return fallback;
  return Math.floor(x);
}

function clampLimit(n, fallback = 50, max = 100) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(max, Math.max(10, Math.floor(x)));
}

function dayKey(d) {
  if (!d) return '';
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  const s = String(d);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function fillLast14Days(rows) {
  const map = new Map();
  for (const r of rows) {
    map.set(dayKey(r.d), Number(r.c) || 0);
  }
  const out = [];
  for (let i = 13; i >= 0; i -= 1) {
    const dt = new Date();
    dt.setUTCHours(0, 0, 0, 0);
    dt.setUTCDate(dt.getUTCDate() - i);
    const key = dt.toISOString().slice(0, 10);
    out.push({ date: key, count: map.get(key) ?? 0 });
  }
  return out;
}

function mapMediaRollupRows(rows) {
  return rows.map((r) => {
    const ws = Number(r.watch_sessions) || 0;
    return {
      mediaType: r.media_type,
      items: r.items,
      views: Number(r.views),
      likes: Number(r.likes),
      avgWatchSeconds: ws > 0 ? Math.round(Number(r.watch_seconds) / ws) : 0,
      likeRatioPercent: r.views > 0 ? Math.round((100 * Number(r.likes)) / Number(r.views)) : 0,
    };
  });
}

async function getDashboard(dbQuery) {
  const [
    userRow,
    visits24,
    visits7,
    visits14series,
    signups14series,
    tierRows,
    events24,
    events7,
    sessionsActive,
    sessionsOnline5m,
    eventTypes,
    topMedia,
    referralTotal,
    referral30,
    mediaTotals,
    mediaByTypeRollup,
  ] = await Promise.all([
    dbQuery('select count(*)::int as c from users'),
    dbQuery(`select count(*)::int as c from analytics_visits where created_at > now() - interval '24 hours'`),
    dbQuery(`select count(*)::int as c from analytics_visits where created_at > now() - interval '7 days'`),
    dbQuery(`
      select (created_at at time zone 'UTC')::date as d, count(*)::int as c
      from analytics_visits
      where created_at > now() - interval '14 days'
      group by 1 order by 1`),
    dbQuery(`
      select (created_at at time zone 'UTC')::date as d, count(*)::int as c
      from users
      where created_at > now() - interval '14 days'
      group by 1 order by 1`),
    dbQuery(`select tier, count(*)::int as c from users group by tier order by c desc`),
    dbQuery(`select count(*)::int as c from analytics_events where created_at > now() - interval '24 hours'`),
    dbQuery(`select count(*)::int as c from analytics_events where created_at > now() - interval '7 days'`),
    dbQuery(`select count(*)::int as c from sessions where expires_at > now()`),
    dbQuery(
      `select count(*)::int as c from sessions where last_seen_at > now() - interval '5 minutes'`,
    ),
    dbQuery(`
      select event_type, count(*)::int as c from analytics_events
      where created_at > now() - interval '7 days'
      group by event_type order by c desc limit 14`),
    dbQuery(`
      select id, creator_slug, title, media_type, views, likes, watch_seconds_total, watch_sessions,
        case when coalesce(views, 0) > 0 then round(100.0 * likes / views, 2) else 0 end as like_ratio,
        case when coalesce(watch_sessions, 0) > 0
          then round(watch_seconds_total::numeric / watch_sessions, 1) else 0 end as avg_watch_seconds
      from media_items
      where status = 'published'
      order by views desc nulls last
      limit 16`),
    dbQuery(`select count(*)::int as c from referral_signups`),
    dbQuery(`select count(*)::int as c from referral_signups where created_at > now() - interval '30 days'`),
    dbQuery(`
      select
        count(*)::int as items,
        coalesce(sum(views), 0)::bigint as views,
        coalesce(sum(likes), 0)::bigint as likes,
        coalesce(sum(watch_seconds_total), 0)::bigint as watch_seconds,
        coalesce(sum(watch_sessions), 0)::bigint as watch_sessions
      from media_items where status = 'published'`),
    dbQuery(`
      select media_type,
        count(*)::int as items,
        coalesce(sum(views), 0)::bigint as views,
        coalesce(sum(likes), 0)::bigint as likes,
        coalesce(sum(watch_seconds_total), 0)::bigint as watch_seconds,
        coalesce(sum(watch_sessions), 0)::bigint as watch_sessions
      from media_items
      where status = 'published'
      group by media_type
      order by media_type`),
  ]);

  const mt = mediaTotals.rows[0] || {};
  const ws = Number(mt.watch_sessions) || 0;
  const avgWatchAll = ws > 0 ? Math.round(Number(mt.watch_seconds) / ws) : 0;

  return {
    kpis: {
      users: userRow.rows[0]?.c ?? 0,
      visits24h: visits24.rows[0]?.c ?? 0,
      visits7d: visits7.rows[0]?.c ?? 0,
      events24h: events24.rows[0]?.c ?? 0,
      events7d: events7.rows[0]?.c ?? 0,
      sessionsActive: sessionsActive.rows[0]?.c ?? 0,
      sessionsOnline5m: sessionsOnline5m.rows[0]?.c ?? 0,
      referralsTotal: referralTotal.rows[0]?.c ?? 0,
      referrals30d: referral30.rows[0]?.c ?? 0,
      mediaItems: mt.items ?? 0,
      mediaViewsTotal: Number(mt.views) || 0,
      mediaAvgWatchSecondsAll: avgWatchAll,
      mediaLikeRatioApprox:
        mt.views > 0 ? Math.round((100 * Number(mt.likes)) / Number(mt.views)) : 0,
    },
    visitsByDay: fillLast14Days(visits14series.rows),
    signupsByDay: fillLast14Days(signups14series.rows),
    tierMix: tierRows.rows.map((r) => ({ tier: r.tier, count: r.c })),
    eventTypes: eventTypes.rows.map((r) => ({ type: r.event_type, count: r.c })),
    topMedia: topMedia.rows.map((r) => ({
      id: r.id,
      creatorSlug: r.creator_slug,
      title: r.title,
      mediaType: r.media_type,
      views: r.views,
      likes: r.likes,
      likeRatio: Number(r.like_ratio),
      avgWatchSeconds: Number(r.avg_watch_seconds),
      watchSessions: r.watch_sessions,
    })),
    mediaByType: mapMediaRollupRows(mediaByTypeRollup.rows),
  };
}

async function getUsersPage(dbQuery, page, limit) {
  const offset = (page - 1) * limit;
  const [data, countRow] = await Promise.all([
    dbQuery(
      `select id, username, email, tier, referral_code, referral_signups_count,
        watch_time_seconds, site_time_seconds, plan_label,
        signup_ip, last_ip, created_at, last_active_at, referred_by_user_id,
        banned_at is not null as banned
       from users
       order by created_at desc
       limit $1 offset $2`,
      [limit, offset],
    ),
    dbQuery('select count(*)::int as c from users'),
  ]);
  return {
    rows: data.rows.map((r) => ({
      id: r.id,
      username: r.username,
      email: r.email,
      tier: r.tier,
      referralCode: r.referral_code,
      referralSignups: r.referral_signups_count,
      watchTimeSeconds: Number(r.watch_time_seconds || 0),
      siteTimeSeconds: Number(r.site_time_seconds || 0),
      planLabel: r.plan_label,
      signupIp: r.signup_ip,
      lastIp: r.last_ip,
      createdAt: r.created_at,
      lastActiveAt: r.last_active_at,
      referredByUserId: r.referred_by_user_id,
      banned: !!r.banned,
    })),
    total: countRow.rows[0]?.c ?? 0,
    page,
    limit,
  };
}

async function getVisitsPage(dbQuery, page, limit) {
  const offset = (page - 1) * limit;
  const [data, countRow] = await Promise.all([
    dbQuery(
      `select id, created_at, path, referrer, user_id,
        left(coalesce(ip, ''), 45) as ip,
        left(coalesce(user_agent, ''), 120) as user_agent
       from analytics_visits
       order by created_at desc
       limit $1 offset $2`,
      [limit, offset],
    ),
    dbQuery('select count(*)::bigint as c from analytics_visits'),
  ]);
  return {
    rows: data.rows,
    total: Number(countRow.rows[0]?.c || 0),
    page,
    limit,
  };
}

async function getEventsPage(dbQuery, page, limit) {
  const offset = (page - 1) * limit;
  const [data, countRow] = await Promise.all([
    dbQuery(
      `select id, created_at, event_type, path, category, user_id,
        left(payload::text, 240) as payload_preview
       from analytics_events
       order by created_at desc
       limit $1 offset $2`,
      [limit, offset],
    ),
    dbQuery('select count(*)::bigint as c from analytics_events'),
  ]);
  return {
    rows: data.rows,
    total: Number(countRow.rows[0]?.c || 0),
    page,
    limit,
  };
}

async function getReferralsPage(dbQuery, page, limit) {
  const offset = (page - 1) * limit;
  const [data, countRow] = await Promise.all([
    dbQuery(
      `select rs.created_at, rs.referral_code_used,
        u.username as referred_username,
        ru.username as referrer_username,
        rs.referred_user_id, rs.referrer_user_id
       from referral_signups rs
       join users u on u.id = rs.referred_user_id
       join users ru on ru.id = rs.referrer_user_id
       order by rs.created_at desc
       limit $1 offset $2`,
      [limit, offset],
    ),
    dbQuery('select count(*)::int as c from referral_signups'),
  ]);
  return {
    rows: data.rows,
    total: countRow.rows[0]?.c ?? 0,
    page,
    limit,
  };
}

async function getMediaRollup(dbQuery) {
  const { rows } = await dbQuery(`
    select media_type,
      count(*)::int as items,
      coalesce(sum(views), 0)::bigint as views,
      coalesce(sum(likes), 0)::bigint as likes,
      coalesce(sum(watch_seconds_total), 0)::bigint as watch_seconds,
      coalesce(sum(watch_sessions), 0)::bigint as watch_sessions
    from media_items
    where status = 'published'
    group by media_type
    order by media_type`);
  return mapMediaRollupRows(rows);
}

module.exports = {
  clampPage,
  clampLimit,
  getDashboard,
  getUsersPage,
  getVisitsPage,
  getEventsPage,
  getReferralsPage,
  getMediaRollup,
};
