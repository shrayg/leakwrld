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

const USER_TIER_FILTERS = new Map([
  ['free', 'free'],
  ['tier1', 'basic'],
  ['basic', 'basic'],
  ['tier2', 'premium'],
  ['premium', 'premium'],
  ['tier3', 'ultimate'],
  ['ultimate', 'ultimate'],
  ['admin', 'admin'],
]);

/** Strip LIKE wildcards so search is always substring semantics (no user-controlled % / _). */
function normalizeAdminSearch(raw) {
  const s = String(raw ?? '')
    .trim()
    .slice(0, 220)
    .replace(/\\/g, '')
    .replace(/%/g, '')
    .replace(/_/g, '');
  return s.length ? s : null;
}

function parseTierFilter(raw) {
  const t = String(raw || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return USER_TIER_FILTERS.get(t) || null;
}

function normalizeAccountTierValue(raw) {
  const t = String(raw || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return USER_TIER_FILTERS.get(t) || 'free';
}

function isUuidQuery(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || '').trim(),
  );
}

const REF_CODE_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

function extractReferralCode(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const tryCode = (x) => {
    const u = String(x || '').trim().toUpperCase();
    return REF_CODE_RE.test(u) ? u : null;
  };
  try {
    let urlStr = s;
    if (!/^https?:\/\//i.test(urlStr) && /[/?]/.test(urlStr)) {
      urlStr = `https://noop.invalid${urlStr.startsWith('/') ? '' : '/'}${urlStr}`;
    }
    if (/^https?:\/\//i.test(urlStr)) {
      const u = new URL(urlStr);
      const refQ =
        u.searchParams.get('ref') ||
        u.searchParams.get('referral') ||
        u.searchParams.get('referralCode');
      const fromQ = tryCode(refQ);
      if (fromQ) return fromQ;
      const parts = u.pathname.split('/').filter(Boolean);
      for (let i = parts.length - 1; i >= 0; i -= 1) {
        const c = tryCode(parts[i]);
        if (c) return c;
      }
    }
  } catch {
    /* ignore malformed URLs */
  }
  return tryCode(s.replace(/\s+/g, ''));
}

const DASHBOARD_RANGES = new Set(['1h', '1d', '7d', '30d', '365d']);

function parseDashboardRange(param) {
  const r = String(param || '7d').trim().toLowerCase();
  return DASHBOARD_RANGES.has(r) ? r : '7d';
}

/** UTC bucket start as epoch ms (matches Postgres trend queries). */
function pgTruncTickMs(d, unit) {
  const x = new Date(d);
  if (unit === 'minute') {
    x.setUTCSeconds(0, 0);
    return x.getTime();
  }
  if (unit === 'hour') {
    x.setUTCMinutes(0, 0, 0);
    return x.getTime();
  }
  if (unit === 'day') {
    x.setUTCHours(0, 0, 0, 0);
    return x.getTime();
  }
  if (unit === 'month') {
    return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 1);
  }
  return x.getTime();
}

function truncEpochExpr(tableAlias = 'created_at') {
  return {
    minute: `extract(epoch from date_trunc('minute', timezone('utc', ${tableAlias})))::bigint * 1000`,
    hour: `extract(epoch from date_trunc('hour', timezone('utc', ${tableAlias})))::bigint * 1000`,
    day: `extract(epoch from date_trunc('day', timezone('utc', ${tableAlias})))::bigint * 1000`,
    month: `extract(epoch from date_trunc('month', timezone('utc', ${tableAlias})))::bigint * 1000`,
  };
}

function expectedUtcBuckets(rangeKey) {
  const now = new Date();
  const out = [];
  if (rangeKey === '1h') {
    const end = new Date(now);
    end.setUTCSeconds(0, 0);
    for (let i = 59; i >= 0; i -= 1) {
      const d = new Date(end);
      d.setUTCMinutes(d.getUTCMinutes() - i);
      out.push(d);
    }
    return out;
  }
  if (rangeKey === '1d') {
    const end = new Date(now);
    end.setUTCMinutes(0, 0, 0);
    for (let i = 23; i >= 0; i -= 1) {
      const d = new Date(end);
      d.setUTCHours(d.getUTCHours() - i);
      out.push(d);
    }
    return out;
  }
  if (rangeKey === '7d') {
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() - i);
      out.push(d);
    }
    return out;
  }
  if (rangeKey === '30d') {
    for (let i = 29; i >= 0; i -= 1) {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() - i);
      out.push(d);
    }
    return out;
  }
  /* 365d → monthly buckets, ~13 months */
  const cur = new Date();
  cur.setUTCHours(0, 0, 0, 0);
  cur.setUTCDate(1);
  for (let i = 12; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() - i, 1));
    out.push(d);
  }
  return out;
}

function formatBucketLabel(rangeKey, d) {
  if (rangeKey === '1h') {
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  if (rangeKey === '1d') {
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const h = String(d.getUTCHours()).padStart(2, '0');
    return `${mo}-${day} ${h}h`;
  }
  if (rangeKey === '365d') {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${mo}-${day}`;
}

const RANGE_SQL = {
  '1h': { intervalPg: '1 hour', truncUnit: 'minute', chartTitle: 'Last hour (UTC)' },
  '1d': { intervalPg: '24 hours', truncUnit: 'hour', chartTitle: 'Last 24 hours (UTC)' },
  '7d': { intervalPg: '7 days', truncUnit: 'day', chartTitle: 'Last 7 days (UTC)' },
  '30d': { intervalPg: '30 days', truncUnit: 'day', chartTitle: 'Last 30 days (UTC)' },
  '365d': {
    intervalPg: '365 days',
    truncUnit: 'month',
    chartTitle: 'Last ~13 months (UTC, monthly)',
  },
};

function visitTrendSql(rangeKey) {
  const unit = RANGE_SQL[rangeKey].truncUnit;
  const te = truncEpochExpr('created_at');
  const trunc = te[unit];
  return `
    select (${trunc})::bigint as bkt, count(*)::int as c
    from analytics_visits
    where created_at > now() - $1::interval
    group by 1 order by 1`;
}

function signupTrendSql(rangeKey) {
  const unit = RANGE_SQL[rangeKey].truncUnit;
  const te = truncEpochExpr('created_at');
  const trunc = te[unit];
  return `
    select (${trunc})::bigint as bkt, count(*)::int as c
    from users
    where created_at > now() - $1::interval
    group by 1 order by 1`;
}

function mergeTrafficSeries(rangeKey, visitRows, signupRows) {
  const spec = RANGE_SQL[rangeKey];
  const buckets = expectedUtcBuckets(rangeKey);
  const unit = spec.truncUnit;
  const vm = new Map();
  const sm = new Map();
  for (const r of visitRows) vm.set(Number(r.bkt), Number(r.c) || 0);
  for (const r of signupRows) sm.set(Number(r.bkt), Number(r.c) || 0);
  return buckets.map((dt) => ({
    day: formatBucketLabel(rangeKey, dt),
    visits: vm.get(pgTruncTickMs(dt, unit)) ?? 0,
    signups: sm.get(pgTruncTickMs(dt, unit)) ?? 0,
  }));
}

function buildGeoCountryBars(rows) {
  const list = rows
    .map((r) => ({
      code: String(r.cc || '')
        .trim()
        .toUpperCase(),
      count: Number(r.c) || 0,
    }))
    .filter((x) => x.code.length === 2 && /^[A-Z]{2}$/.test(x.code) && x.count > 0)
    .sort((a, b) => b.count - a.count);

  const totalLocated = list.reduce((s, x) => s + x.count, 0);
  const top = list.slice(0, 10).map((x) => ({ code: x.code, count: x.count }));
  const otherSum = list.slice(10).reduce((s, x) => s + x.count, 0);
  const bars = otherSum > 0 ? [...top, { code: 'OTHER', count: otherSum }] : top;
  return { totalLocated, bars };
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

async function getDashboard(dbQuery, rangeKey = '7d') {
  const rk = parseDashboardRange(rangeKey);
  const intervalPg = RANGE_SQL[rk].intervalPg;

  const [
    userRow,
    visits24,
    visits7,
    visitsTrend,
    signupsTrend,
    tierRows,
    events24,
    visitsWindow,
    signupsWindow,
    eventsWindow,
    sessionsActive,
    sessionsOnline5m,
    eventTypes,
    topMedia,
    topCreatorsByViewsAllTime,
    topCategoriesByVisits,
    topCreatorsByProfileVisits24h,
    referralTotal,
    referral30,
    mediaTotals,
    mediaByTypeRollup,
    geoVisitCountries,
  ] = await Promise.all([
    dbQuery('select count(*)::int as c from users'),
    dbQuery(`select count(*)::int as c from analytics_visits where created_at > now() - interval '24 hours'`),
    dbQuery(`select count(*)::int as c from analytics_visits where created_at > now() - interval '7 days'`),
    dbQuery(visitTrendSql(rk), [intervalPg]),
    dbQuery(signupTrendSql(rk), [intervalPg]),
    dbQuery(`select tier, count(*)::int as c from users group by tier order by c desc`),
    dbQuery(`select count(*)::int as c from analytics_events where created_at > now() - interval '24 hours'`),
    dbQuery(`select count(*)::int as c from analytics_visits where created_at > now() - $1::interval`, [
      intervalPg,
    ]),
    dbQuery(`select count(*)::int as c from users where created_at > now() - $1::interval`, [intervalPg]),
    dbQuery(`select count(*)::int as c from analytics_events where created_at > now() - $1::interval`, [
      intervalPg,
    ]),
    dbQuery(`select count(*)::int as c from sessions where expires_at > now()`),
    dbQuery(
      `select count(*)::int as c from sessions where last_seen_at > now() - interval '5 minutes'`,
    ),
    dbQuery(
      `select event_type, count(*)::int as c from analytics_events
       where created_at > now() - $1::interval
       group by event_type order by c desc limit 14`,
      [intervalPg],
    ),
    dbQuery(`
      select id, creator_slug, title, media_type, views, likes, watch_seconds_total, watch_sessions,
        case when coalesce(views, 0) > 0 then round(100.0 * likes / views, 2) else 0 end as like_ratio,
        case when coalesce(watch_sessions, 0) > 0
          then round(watch_seconds_total::numeric / watch_sessions, 1) else 0 end as avg_watch_seconds
      from media_items
      where status = 'published'
      order by views desc nulls last
      limit 16`),
    dbQuery(`
      select m.creator_slug as slug,
             coalesce(max(c.name), m.creator_slug) as creator_name,
             count(*)::int as items,
             coalesce(sum(m.views), 0)::bigint as total_views
      from media_items m
      left join creators c on c.slug = m.creator_slug
      where m.status = 'published'
      group by m.creator_slug
      order by total_views desc, items desc, slug asc
      limit 32`),
    dbQuery(
      `select coalesce(c.category, 'Unknown') as category_name, count(*)::int as visit_count
       from analytics_visits v
       inner join lateral (
         select (regexp_match(split_part(v.path, '?', 1), '^/creators/([a-z0-9-]+)'))[1] as slug
       ) m on true
       left join creators c on c.slug = m.slug
       where v.created_at > now() - $1::interval
         and m.slug is not null
       group by coalesce(c.category, 'Unknown')
       order by visit_count desc
       limit 24`,
      [intervalPg],
    ),
    dbQuery(`
      select m.slug,
             coalesce(max(c.name), m.slug) as creator_name,
             count(*)::int as visit_count
      from analytics_visits v
      inner join lateral (
        select (regexp_match(split_part(v.path, '?', 1), '^/creators/([a-z0-9-]+)'))[1] as slug
      ) m on true
      left join creators c on c.slug = m.slug
      where v.created_at > now() - interval '24 hours'
        and m.slug is not null
      group by m.slug
      order by visit_count desc
      limit 32`),
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
    dbQuery(
      `select upper(trim(country_code)) as cc, count(*)::int as c
       from analytics_visits
       where created_at > now() - $1::interval
         and country_code is not null
         and length(trim(country_code)) = 2
       group by upper(trim(country_code))
       order by c desc`,
      [intervalPg],
    ),
  ]);

  const mt = mediaTotals.rows[0] || {};
  const ws = Number(mt.watch_sessions) || 0;
  const avgWatchAll = ws > 0 ? Math.round(Number(mt.watch_seconds) / ws) : 0;

  const trafficSeries = mergeTrafficSeries(rk, visitsTrend.rows, signupsTrend.rows);

  const geoCountries = buildGeoCountryBars(geoVisitCountries.rows);

  return {
    chartRange: rk,
    chartRangeTitle: RANGE_SQL[rk].chartTitle,
    trafficSeries,
    kpis: {
      users: userRow.rows[0]?.c ?? 0,
      visits24h: visits24.rows[0]?.c ?? 0,
      visits7d: visits7.rows[0]?.c ?? 0,
      /** Totals inside the selected dashboard chart window (matches traffic & events charts). */
      visitsWindow: visitsWindow.rows[0]?.c ?? 0,
      signupsWindow: signupsWindow.rows[0]?.c ?? 0,
      eventsWindow: eventsWindow.rows[0]?.c ?? 0,
      events24h: events24.rows[0]?.c ?? 0,
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
    topCreatorsByViewsAllTime: topCreatorsByViewsAllTime.rows.map((r) => ({
      slug: String(r.slug || ''),
      name: String(r.creator_name || r.slug || ''),
      items: Number(r.items) || 0,
      totalViews: Number(r.total_views) || 0,
    })),
    topCategoriesByVisits: topCategoriesByVisits.rows.map((r) => ({
      category: String(r.category_name || 'Unknown'),
      visits: Number(r.visit_count) || 0,
    })),
    topCreatorsByProfileVisits24h: topCreatorsByProfileVisits24h.rows.map((r) => ({
      slug: String(r.slug || ''),
      name: String(r.creator_name || r.slug || ''),
      visits: Number(r.visit_count) || 0,
    })),
    geoCountries,
    mediaByType: mapMediaRollupRows(mediaByTypeRollup.rows),
  };
}

async function getUsersPage(dbQuery, page, limit, searchRaw, tierRaw) {
  const offset = (page - 1) * limit;
  const search = normalizeAdminSearch(searchRaw);
  const tierFilter = parseTierFilter(tierRaw);

  const cond = [];
  const vals = [];

  if (tierFilter) {
    vals.push(tierFilter);
    cond.push(`tier = $${vals.length}`);
  }

  if (search && isUuidQuery(search)) {
    vals.push(search.trim());
    cond.push(`id = $${vals.length}::uuid`);
  } else if (search) {
    const pat = `%${search}%`;
    for (let i = 0; i < 7; i += 1) vals.push(pat);
    const b = vals.length - 7;
    cond.push(`(
      username ilike $${b + 1}
      OR (email is not null AND email ilike $${b + 2})
      OR referral_code ilike $${b + 3}
      OR (signup_ip is not null AND signup_ip ilike $${b + 4})
      OR (last_ip is not null AND last_ip ilike $${b + 5})
      OR (phone is not null AND phone ilike $${b + 6})
      OR cast(id as text) ilike $${b + 7}
    )`);
  }

  const whereSql = cond.length ? `where ${cond.join(' AND ')}` : '';
  const countVals = [...vals];
  vals.push(limit, offset);
  const limPl = vals.length - 1;
  const offPl = vals.length;

  const [data, countRow] = await Promise.all([
    dbQuery(
      `select id, username, email, tier, referral_code, referral_signups_count,
        watch_time_seconds, site_time_seconds, plan_label,
        signup_ip, last_ip, created_at, last_active_at, referred_by_user_id,
        banned_at, ban_reason,
        banned_at is not null as banned
       from users
       ${whereSql}
       order by created_at desc
       limit $${limPl} offset $${offPl}`,
      vals,
    ),
    dbQuery(`select count(*)::int as c from users ${whereSql}`, countVals),
  ]);
  return {
    rows: data.rows.map((r) => ({
      id: r.id,
      username: r.username,
      email: r.email,
      tier: normalizeAccountTierValue(r.tier),
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
      bannedAt: r.banned_at,
      banReason: r.ban_reason || '',
    })),
    total: countRow.rows[0]?.c ?? 0,
    page,
    limit,
  };
}

async function getVisitsPage(dbQuery, page, limit, searchRaw) {
  const offset = (page - 1) * limit;
  const search = normalizeAdminSearch(searchRaw);

  const cond = [];
  const vals = [];

  if (search && isUuidQuery(search)) {
    vals.push(search.trim());
    const n = vals.length;
    cond.push(`(user_id = $${n}::uuid OR visitor_key = $${n}::uuid)`);
  } else if (search) {
    const pat = `%${search}%`;
    vals.push(pat, pat, pat, pat, pat, pat, pat);
    const b = vals.length - 7;
    cond.push(`(
      v.path ilike $${b + 1}
      OR coalesce(v.referrer, '') ilike $${b + 2}
      OR coalesce(v.ip, '') ilike $${b + 3}
      OR coalesce(v.country_code::text, '') ilike $${b + 4}
      OR cast(v.id as text) ilike $${b + 5}
      OR coalesce(v.user_agent, '') ilike $${b + 6}
      OR coalesce(u.username, '') ilike $${b + 7}
    )`);
  }

  const whereSql = cond.length ? `where ${cond.join(' AND ')}` : '';
  const countVals = [...vals];
  vals.push(limit, offset);
  const limPl = vals.length - 1;
  const offPl = vals.length;

  const [data, countRow] = await Promise.all([
    dbQuery(
      `select v.id, v.created_at, v.path, v.referrer, v.user_id,
        u.username,
        left(coalesce(v.ip, ''), 45) as ip,
        left(coalesce(v.user_agent, ''), 120) as user_agent
       from analytics_visits v
       left join users u on u.id = v.user_id
       ${whereSql}
       order by v.created_at desc
       limit $${limPl} offset $${offPl}`,
      vals,
    ),
    dbQuery(
      `select count(*)::bigint as c
       from analytics_visits v
       left join users u on u.id = v.user_id
       ${whereSql}`,
      countVals,
    ),
  ]);
  return {
    rows: data.rows,
    total: Number(countRow.rows[0]?.c || 0),
    page,
    limit,
  };
}

async function getEventsPage(dbQuery, page, limit, searchRaw) {
  const offset = (page - 1) * limit;
  const search = normalizeAdminSearch(searchRaw);

  const cond = [];
  const vals = [];

  if (search && isUuidQuery(search)) {
    vals.push(search.trim());
    const n = vals.length;
    cond.push(`(user_id = $${n}::uuid OR visitor_key = $${n}::uuid)`);
  } else if (search) {
    const pat = `%${search}%`;
    vals.push(pat, pat, pat, pat, pat);
    const b = vals.length - 5;
    cond.push(`(
      event_type ilike $${b + 1}
      OR coalesce(path, '') ilike $${b + 2}
      OR coalesce(category, '') ilike $${b + 3}
      OR payload::text ilike $${b + 4}
      OR cast(id as text) ilike $${b + 5}
    )`);
  }

  const whereSql = cond.length ? `where ${cond.join(' AND ')}` : '';
  const countVals = [...vals];
  vals.push(limit, offset);
  const limPl = vals.length - 1;
  const offPl = vals.length;

  const [data, countRow] = await Promise.all([
    dbQuery(
      `select id, created_at, event_type, path, category, user_id,
        left(payload::text, 240) as payload_preview
       from analytics_events
       ${whereSql}
       order by created_at desc
       limit $${limPl} offset $${offPl}`,
      vals,
    ),
    dbQuery(`select count(*)::bigint as c from analytics_events ${whereSql}`, countVals),
  ]);
  return {
    rows: data.rows,
    total: Number(countRow.rows[0]?.c || 0),
    page,
    limit,
  };
}

async function getReferralsPage(dbQuery, page, limit, searchRaw) {
  const offset = (page - 1) * limit;
  const search = normalizeAdminSearch(searchRaw);

  const cond = [];
  const vals = [];

  if (search && isUuidQuery(search)) {
    vals.push(search.trim());
    const n = vals.length;
    cond.push(`(rs.referrer_user_id = $${n}::uuid OR rs.referred_user_id = $${n}::uuid)`);
  } else if (search) {
    const pat = `%${search}%`;
    vals.push(pat, pat, pat);
    const b = vals.length - 3;
    cond.push(`(
      rs.referral_code_used ilike $${b + 1}
      OR ru.username ilike $${b + 2}
      OR u.username ilike $${b + 3}
    )`);
  }

  const whereSql = cond.length ? `where ${cond.join(' AND ')}` : '';
  const countVals = [...vals];
  vals.push(limit, offset);
  const limPl = vals.length - 1;
  const offPl = vals.length;

  const [data, countRow] = await Promise.all([
    dbQuery(
      `select rs.created_at, rs.referral_code_used,
        u.username as referred_username,
        ru.username as referrer_username,
        rs.referred_user_id, rs.referrer_user_id
       from referral_signups rs
       join users u on u.id = rs.referred_user_id
       join users ru on ru.id = rs.referrer_user_id
       ${whereSql}
       order by rs.created_at desc
       limit $${limPl} offset $${offPl}`,
      vals,
    ),
    dbQuery(`select count(*)::int as c from referral_signups rs
       join users u on u.id = rs.referred_user_id
       join users ru on ru.id = rs.referrer_user_id
       ${whereSql}`, countVals),
  ]);
  return {
    rows: data.rows,
    total: countRow.rows[0]?.c ?? 0,
    page,
    limit,
  };
}

async function getReferralLookup(dbQuery, raw) {
  const code = extractReferralCode(raw);
  if (!code) {
    return { ok: false, error: 'Could not parse a 6-character referral code from that input.' };
  }
  const refRow = await dbQuery(
    `select id, username, email, referral_code, referral_signups_count, created_at, tier
     from users where referral_code = $1 limit 1`,
    [code],
  );
  if (!refRow.rows[0]) {
    return {
      ok: true,
      code,
      referrer: null,
      signups: [],
      message: 'No user owns that referral code.',
    };
  }
  const ru = refRow.rows[0];
  const recent = await dbQuery(
    `select rs.created_at, rs.referral_code_used, u.username as referred_username, rs.referred_user_id
     from referral_signups rs
     join users u on u.id = rs.referred_user_id
     where rs.referrer_user_id = $1
     order by rs.created_at desc
     limit 80`,
    [ru.id],
  );
  return {
    ok: true,
    code,
    referrer: {
      id: ru.id,
      username: ru.username,
      email: ru.email,
      referralCode: ru.referral_code,
      referralSignups: ru.referral_signups_count,
      tier: ru.tier,
      createdAt: ru.created_at,
    },
    signups: recent.rows,
  };
}

async function getMediaItemsPage(dbQuery, page, limit, searchRaw) {
  const offset = (page - 1) * limit;
  const search = normalizeAdminSearch(searchRaw);

  const cond = [`status = 'published'`];
  const vals = [];

  if (search) {
    const pat = `%${search}%`;
    vals.push(pat, pat, pat);
    const b = vals.length - 3;
    cond.push(`(
      title ilike $${b + 1}
      OR creator_slug ilike $${b + 2}
      OR id ilike $${b + 3}
    )`);
  }

  const whereSql = `where ${cond.join(' AND ')}`;
  const countVals = [...vals];
  vals.push(limit, offset);
  const limPl = vals.length - 1;
  const offPl = vals.length;

  const [data, countRow] = await Promise.all([
    dbQuery(
      `select id, creator_slug, title, media_type, views, likes, watch_seconds_total, watch_sessions,
        case when coalesce(watch_sessions, 0) > 0
          then round(watch_seconds_total::numeric / watch_sessions, 1) else 0 end as avg_watch_seconds
       from media_items
       ${whereSql}
       order by views desc nulls last
       limit $${limPl} offset $${offPl}`,
      vals,
    ),
    dbQuery(`select count(*)::int as c from media_items ${whereSql}`, countVals),
  ]);

  return {
    rows: data.rows.map((r) => ({
      id: r.id,
      creatorSlug: r.creator_slug,
      title: r.title,
      mediaType: r.media_type,
      views: r.views,
      likes: r.likes,
      avgWatchSeconds: Number(r.avg_watch_seconds),
      watchSessions: r.watch_sessions,
    })),
    total: countRow.rows[0]?.c ?? 0,
    page,
    limit,
  };
}

const PAYMENT_ADMIN_RANGES = new Set(['all', '24h', '7d', '30d']);

function parsePaymentAdminRange(param) {
  const r = String(param || 'all').trim().toLowerCase();
  return PAYMENT_ADMIN_RANGES.has(r) ? r : 'all';
}

/** SQL predicate for `where`; enum-derived — safe to splice */
function paymentTimePredicate(rangeKey) {
  const rk = parsePaymentAdminRange(rangeKey);
  if (rk === '24h') return `created_at > now() - interval '24 hours'`;
  if (rk === '7d') return `created_at > now() - interval '7 days'`;
  if (rk === '30d') return `created_at > now() - interval '30 days'`;
  return `true`;
}

async function getPaymentsAdminSummary(dbQuery, rangeKey) {
  const rk = parsePaymentAdminRange(rangeKey);
  const pred = paymentTimePredicate(rk);

  const totals = await dbQuery(
    `select count(*)::int as n, coalesce(sum(amount_cents), 0)::bigint as cents from payments where ${pred}`,
  );

  const byTier = await dbQuery(
    `select tier_granted, count(*)::int as n, coalesce(sum(amount_cents), 0)::bigint as cents
     from payments where ${pred}
     group by tier_granted order by tier_granted`,
  );

  let trendSql;
  if (rk === '24h') {
    trendSql = `
      select (extract(epoch from date_trunc('hour', timezone('utc', created_at)))::bigint * 1000) as bkt,
        count(*)::int as c, coalesce(sum(amount_cents), 0)::bigint as cents
      from payments where ${pred}
      group by 1 order by 1`;
  } else if (rk === '7d' || rk === '30d') {
    trendSql = `
      select (extract(epoch from date_trunc('day', timezone('utc', created_at)))::bigint * 1000) as bkt,
        count(*)::int as c, coalesce(sum(amount_cents), 0)::bigint as cents
      from payments where ${pred}
      group by 1 order by 1`;
  } else {
    trendSql = `
      select (extract(epoch from date_trunc('month', timezone('utc', created_at)))::bigint * 1000) as bkt,
        count(*)::int as c, coalesce(sum(amount_cents), 0)::bigint as cents
      from payments
      group by 1 order by 1`;
  }

  const trend = await dbQuery(trendSql);

  const row = totals.rows[0] || {};
  return {
    range: rk,
    count: Number(row.n) || 0,
    revenueCents: Number(row.cents) || 0,
    tierBreakdown: byTier.rows.map((r) => ({
      tier: r.tier_granted,
      count: Number(r.n) || 0,
      revenueCents: Number(r.cents) || 0,
    })),
    trend: trend.rows.map((r) => ({
      bucketMs: Number(r.bkt),
      count: Number(r.c) || 0,
      revenueCents: Number(r.cents) || 0,
    })),
  };
}

async function getPaymentsPage(dbQuery, page, limit, searchRaw, rangeKey) {
  const offset = (page - 1) * limit;
  const search = normalizeAdminSearch(searchRaw);
  const pred = paymentTimePredicate(parsePaymentAdminRange(rangeKey));

  const cond = [`(${pred})`];
  const vals = [];

  if (search) {
    const pat = `%${search}%`;
    vals.push(pat, pat, pat, pat);
    const b = vals.length - 4;
    cond.push(`(
      u.username ilike $${b + 1}
      OR p.plan_label ilike $${b + 2}
      OR p.provider ilike $${b + 3}
      OR cast(p.id as text) ilike $${b + 4}
    )`);
  }

  const whereSql = `where ${cond.join(' AND ')}`;
  const countVals = [...vals];
  vals.push(limit, offset);
  const limPl = vals.length - 1;
  const offPl = vals.length;

  const [data, countRow] = await Promise.all([
    dbQuery(
      `select p.id, p.created_at, p.amount_cents, p.currency, p.plan_label, p.tier_granted,
        p.provider, left(coalesce(p.notes, ''), 160) as notes,
        u.username
       from payments p
       join users u on u.id = p.user_id
       ${whereSql}
       order by p.created_at desc
       limit $${limPl} offset $${offPl}`,
      vals,
    ),
    dbQuery(
      `select count(*)::int as c from payments p
       join users u on u.id = p.user_id
       ${whereSql}`,
      countVals,
    ),
  ]);

  return {
    rows: data.rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      amountCents: r.amount_cents,
      currency: r.currency || 'USD',
      planLabel: r.plan_label,
      tierGranted: r.tier_granted,
      provider: r.provider,
      notes: r.notes || '',
      username: r.username,
    })),
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

const TRAFFIC_SOURCES_RANGES = new Set(['24h', '48h', '7d', '30d', 'all']);

function parseTrafficSourcesRange(param) {
  const r = String(param || '48h').trim().toLowerCase();
  return TRAFFIC_SOURCES_RANGES.has(r) ? r : '48h';
}

/** SQL predicate on `users u` — enum-derived, safe to splice into raw queries */
function trafficSourcesSignupPredicate(rangeKey) {
  const rk = parseTrafficSourcesRange(rangeKey);
  if (rk === '24h') return `u.created_at > now() - interval '24 hours'`;
  if (rk === '48h') return `u.created_at > now() - interval '48 hours'`;
  if (rk === '7d') return `u.created_at > now() - interval '7 days'`;
  if (rk === '30d') return `u.created_at > now() - interval '30 days'`;
  return 'true';
}

/** Derive rollup host key from latest signup beacon `analytics_visits.referrer` */
function trafficSourcesHostKeyExpr(refAlias) {
  return `CASE
      WHEN ${refAlias}.http_referrer IS NULL OR btrim(${refAlias}.http_referrer) = '' THEN '__direct__'
      WHEN (regexp_match(btrim(${refAlias}.http_referrer), '^https?://([^/?#:]+)', 'i'))[1] IS NOT NULL THEN
        regexp_replace(lower((regexp_match(btrim(${refAlias}.http_referrer), '^https?://([^/?#:]+)', 'i'))[1]), '^www\\.', '')
      WHEN (regexp_match(btrim(${refAlias}.http_referrer), '^android-app://([^/?#:]+)', 'i'))[1] IS NOT NULL THEN
        lower((regexp_match(btrim(${refAlias}.http_referrer), '^android-app://([^/?#:]+)', 'i'))[1])
      ELSE '__unknown__'
    END`;
}

function trafficSourcesHostLabel(hostKey) {
  if (hostKey === '__direct__') return '(direct / no referrer)';
  if (hostKey === '__unknown__') return '(referrer present — host unknown)';
  return hostKey;
}

async function getTrafficSourcesReport(dbQuery, rangeKey) {
  const rk = parseTrafficSourcesRange(rangeKey);
  const pred = trafficSourcesSignupPredicate(rk);
  const hostExpr = trafficSourcesHostKeyExpr('su');

  const signupVisitSql = `(SELECT av.referrer FROM analytics_visits av
          WHERE av.user_id = u.id AND av.path = '/signup'
          ORDER BY av.created_at DESC LIMIT 1)`;

  const summarySql = `
    WITH su AS (
      SELECT u.id,
        u.referred_by_user_id IS NOT NULL AS used_code,
        ${signupVisitSql} AS http_referrer
      FROM users u
      WHERE (${pred})
    )
    SELECT
      count(*)::int AS total_signups,
      count(*) FILTER (
        WHERE http_referrer IS NOT NULL AND btrim(coalesce(http_referrer, '')) <> ''
      )::int AS with_http_referrer,
      count(*) FILTER (WHERE used_code)::int AS with_referral_code
    FROM su`;

  const hostsSql = `
    WITH su AS (
      SELECT u.id, u.referred_by_user_id,
        ${signupVisitSql} AS http_referrer
      FROM users u
      WHERE (${pred})
    ),
    sh AS (
      SELECT su.*, ${hostExpr} AS host_key FROM su
    )
    SELECT host_key,
      count(*)::int AS signups,
      count(*) FILTER (WHERE referred_by_user_id IS NOT NULL)::int AS with_code
    FROM sh
    GROUP BY host_key
    ORDER BY signups DESC
    LIMIT 120`;

  const codesSql = `
    WITH su AS (
      SELECT u.id, u.referred_by_user_id,
        rs.referral_code_used,
        ref.username AS ref_username,
        ref.referral_code AS ref_fallback_code,
        ${signupVisitSql} AS http_referrer
      FROM users u
      LEFT JOIN referral_signups rs ON rs.referred_user_id = u.id
      LEFT JOIN users ref ON ref.id = u.referred_by_user_id
      WHERE (${pred})
    ),
    sh AS (
      SELECT su.*, ${hostExpr} AS host_key FROM su
    ),
    agg AS (
      SELECT sh.host_key,
        upper(trim(coalesce(
          nullif(trim(sh.referral_code_used), ''),
          nullif(trim(sh.ref_fallback_code), '')
        ))) AS code_used,
        max(sh.ref_username) AS referrer_username,
        count(*)::int AS cnt
      FROM sh
      WHERE sh.referred_by_user_id IS NOT NULL
        AND coalesce(
          nullif(trim(sh.referral_code_used), ''),
          nullif(trim(sh.ref_fallback_code), '')
        ) IS NOT NULL
      GROUP BY sh.host_key,
        upper(trim(coalesce(
          nullif(trim(sh.referral_code_used), ''),
          nullif(trim(sh.ref_fallback_code), '')
        )))
    )
    SELECT host_key, code_used, referrer_username, cnt FROM agg`;

  const [sumRes, hostsRes, codesRes] = await Promise.all([
    dbQuery(summarySql),
    dbQuery(hostsSql),
    dbQuery(codesSql),
  ]);

  const srow = sumRes.rows[0] || {};
  const totalSignups = Number(srow.total_signups) || 0;
  const signupsWithCapturedReferrer = Number(srow.with_http_referrer) || 0;
  const signupsWithReferralCode = Number(srow.with_referral_code) || 0;

  /** @type {Map<string, Array<{ code: string, referrerUsername: string, count: number }>>} */
  const codesByHost = new Map();
  for (const row of codesRes.rows) {
    const hk = row.host_key;
    const code = row.code_used ? String(row.code_used).trim() : '';
    if (!hk || !code) continue;
    const entry = {
      code,
      referrerUsername: row.referrer_username ? String(row.referrer_username) : '',
      count: Number(row.cnt) || 0,
    };
    if (!codesByHost.has(hk)) codesByHost.set(hk, []);
    codesByHost.get(hk).push(entry);
  }
  for (const arr of codesByHost.values()) {
    arr.sort((a, b) => b.count - a.count);
    arr.splice(5);
  }

  const hosts = hostsRes.rows.map((r) => {
    const hostKey = String(r.host_key || '');
    return {
      hostKey,
      hostLabel: trafficSourcesHostLabel(hostKey),
      signups: Number(r.signups) || 0,
      withCode: Number(r.with_code) || 0,
      topCodes: codesByHost.get(hostKey) || [],
    };
  });

  return {
    range: rk,
    totalSignups,
    signupsWithCapturedReferrer,
    signupsWithReferralCode,
    hosts,
  };
}

module.exports = {
  clampPage,
  clampLimit,
  parseDashboardRange,
  normalizeAdminSearch,
  getDashboard,
  getUsersPage,
  getVisitsPage,
  getEventsPage,
  getReferralsPage,
  getReferralLookup,
  getMediaItemsPage,
  getMediaRollup,
  parsePaymentAdminRange,
  getPaymentsAdminSummary,
  getPaymentsPage,
  parseTrafficSourcesRange,
  getTrafficSourcesReport,
};
