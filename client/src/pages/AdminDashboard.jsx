import { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const PIE_COLORS = ['#f268b8', '#61e4ff', '#ffd700', '#64f0a6', '#a78bfa', '#fb7185', '#94a3b8'];

function formatDuration(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = Math.floor(s % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
}

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

async function adminFetch(path) {
  const res = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export function AdminDashboard({ siteLabel, onLogout }) {
  const [tab, setTab] = useState('overview');
  const [dash, setDash] = useState(null);
  const [dashErr, setDashErr] = useState('');
  const [page, setPage] = useState(1);
  const [tableRows, setTableRows] = useState([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [tableLoading, setTableLoading] = useState(false);
  const limit = 40;

  const loadDashboard = useCallback(async () => {
    setDashErr('');
    const { ok, data } = await adminFetch('/api/admin/dashboard');
    if (!ok) {
      setDash(null);
      setDashErr(data.error || 'Could not load dashboard');
      return;
    }
    setDash(data);
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const loadTable = useCallback(async () => {
    const paths = {
      users: `/api/admin/users?page=${page}&limit=${limit}`,
      visits: `/api/admin/visits?page=${page}&limit=${limit}`,
      events: `/api/admin/events?page=${page}&limit=${limit}`,
      referrals: `/api/admin/referrals?page=${page}&limit=${limit}`,
    };
    const path = paths[tab];
    if (!path) return;
    setTableLoading(true);
    try {
      const { ok, data } = await adminFetch(path);
      if (!ok) {
        setTableRows([]);
        setTableTotal(0);
        return;
      }
      setTableRows(data.rows || []);
      setTableTotal(Number(data.total) || 0);
    } finally {
      setTableLoading(false);
    }
  }, [tab, page]);

  useEffect(() => {
    if (tab === 'overview' || tab === 'media') return;
    loadTable();
  }, [tab, page, loadTable]);

  const mergedTrend =
    dash?.visitsByDay?.map((v, i) => ({
      day: v.date.slice(5),
      visits: v.count,
      signups: dash.signupsByDay[i]?.count ?? 0,
    })) ?? [];

  const totalPages = Math.max(1, Math.ceil(tableTotal / limit));

  return (
    <div className="lw-admin-dash mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-white">Admin dashboard</h1>
          <p className="mt-1 text-sm text-white/55">
            Single Postgres: users, referrals, media aggregates, traffic (
            <code className="text-[var(--color-primary-light)]">analytics_visits</code> /{' '}
            <code className="text-[var(--color-primary-light)]">analytics_events</code>
            ).
          </p>
          {siteLabel ? (
            <p className="mt-2 text-sm text-white/65">
              Origin: <span className="text-white/90">{siteLabel}</span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="lw-btn ghost text-sm" onClick={() => loadDashboard()}>
            Refresh data
          </button>
          <button type="button" className="lw-btn ghost text-sm" onClick={onLogout}>
            Admin logout
          </button>
        </div>
      </header>

      <div className="lw-admin-tabbar" role="tablist" aria-label="Admin sections">
        {[
          ['overview', 'Overview'],
          ['users', 'Users'],
          ['visits', 'Visits'],
          ['events', 'Events'],
          ['referrals', 'Referrals'],
          ['media', 'Media stats'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`lw-admin-tab ${tab === id ? 'active' : ''}`}
            onClick={() => {
              setPage(1);
              setTab(id);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <>
          {dashErr ? <p className="lw-form-error mb-6">{dashErr}</p> : null}
          {!dash && !dashErr ? (
            <p className="text-white/55">Loading dashboard…</p>
          ) : dash ? (
            <>
              <div className="lw-admin-kpi-grid mb-10">
                {[
                  ['Registered users', dash.kpis.users],
                  ['Visits (24h)', dash.kpis.visits24h],
                  ['Visits (7d)', dash.kpis.visits7d],
                  ['Events (24h)', dash.kpis.events24h],
                  ['Sessions (valid)', dash.kpis.sessionsActive],
                  ['Online (~5m)', dash.kpis.sessionsOnline5m],
                  ['Referrals (all)', dash.kpis.referralsTotal],
                  ['Referrals (30d)', dash.kpis.referrals30d],
                  ['Published media', dash.kpis.mediaItems],
                  ['Media views (Σ)', dash.kpis.mediaViewsTotal],
                  ['Avg watch / session', formatDuration(dash.kpis.mediaAvgWatchSecondsAll)],
                  ['Like / view (approx)', `${dash.kpis.mediaLikeRatioApprox}%`],
                ].map(([label, val]) => (
                  <div key={label} className="lw-admin-kpi">
                    <span className="text-xs font-medium uppercase tracking-wide text-white/45">{label}</span>
                    <b className="mt-1 block text-xl text-white">{val}</b>
                  </div>
                ))}
              </div>

              <div className="mb-10 grid gap-6 lg:grid-cols-2">
                <div className="lw-admin-chart border border-[var(--color-border)] bg-[rgba(48,47,47,0.76)] p-4">
                  <h3 className="mb-3 text-sm font-semibold text-white">Traffic & signups (14d UTC)</h3>
                  <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={mergedTrend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff18" />
                        <XAxis dataKey="day" tick={{ fill: '#bbb', fontSize: 11 }} />
                        <YAxis tick={{ fill: '#bbb', fontSize: 11 }} width={36} />
                        <Tooltip
                          contentStyle={{ background: '#2a2829', border: '1px solid #444', borderRadius: 8 }}
                          labelStyle={{ color: '#eee' }}
                        />
                        <Legend />
                        <Line type="monotone" dataKey="visits" stroke="#f268b8" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="signups" stroke="#61e4ff" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="lw-admin-chart border border-[var(--color-border)] bg-[rgba(48,47,47,0.76)] p-4">
                  <h3 className="mb-3 text-sm font-semibold text-white">Users by tier</h3>
                  <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={dash.tierMix}
                          dataKey="count"
                          nameKey="tier"
                          cx="50%"
                          cy="50%"
                          outerRadius={100}
                          label={({ tier, count }) => `${tier}: ${count}`}
                        >
                          {dash.tierMix.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ background: '#2a2829', border: '1px solid #444', borderRadius: 8 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              <div className="mb-10 grid gap-6 lg:grid-cols-2">
                <div className="lw-admin-chart border border-[var(--color-border)] bg-[rgba(48,47,47,0.76)] p-4">
                  <h3 className="mb-3 text-sm font-semibold text-white">Events by type (7d)</h3>
                  <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dash.eventTypes} layout="vertical" margin={{ left: 8, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff18" />
                        <XAxis type="number" tick={{ fill: '#bbb', fontSize: 11 }} />
                        <YAxis type="category" dataKey="type" width={120} tick={{ fill: '#bbb', fontSize: 10 }} />
                        <Tooltip
                          contentStyle={{ background: '#2a2829', border: '1px solid #444', borderRadius: 8 }}
                        />
                        <Bar dataKey="count" fill="#f268b8" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="lw-admin-chart border border-[var(--color-border)] bg-[rgba(48,47,47,0.76)] p-4">
                  <h3 className="mb-3 text-sm font-semibold text-white">Published media by type</h3>
                  <div className="lw-admin-table-wrap">
                    <table className="lw-admin-table">
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>Items</th>
                          <th>Views</th>
                          <th>Likes</th>
                          <th>Avg watch</th>
                          <th>Like/view</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(dash.mediaByType || []).map((r) => (
                          <tr key={r.mediaType}>
                            <td className="capitalize">{r.mediaType}</td>
                            <td>{r.items}</td>
                            <td>{r.views}</td>
                            <td>{r.likes}</td>
                            <td>{formatDuration(r.avgWatchSeconds)}</td>
                            <td>{r.likeRatioPercent}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="border border-[var(--color-border)] bg-[rgba(48,47,47,0.76)] p-4">
                <h3 className="mb-3 text-sm font-semibold text-white">Top media by views</h3>
                <div className="lw-admin-table-wrap">
                  <table className="lw-admin-table">
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th>Creator</th>
                        <th>Type</th>
                        <th>Views</th>
                        <th>Likes</th>
                        <th>Like %</th>
                        <th>Avg watch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(dash.topMedia || []).map((r) => (
                        <tr key={r.id}>
                          <td className="max-w-[180px] truncate" title={r.title}>
                            {r.title}
                          </td>
                          <td>{r.creatorSlug}</td>
                          <td className="capitalize">{r.mediaType}</td>
                          <td>{r.views}</td>
                          <td>{r.likes}</td>
                          <td>{r.likeRatio}%</td>
                          <td>{formatDuration(r.avgWatchSeconds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {tab === 'media' && dash ? (
        <div className="space-y-6">
          <div className="lw-admin-kpi-grid">
            {[
              ['Published items', dash.kpis.mediaItems],
              ['Total views', dash.kpis.mediaViewsTotal],
              ['Avg watch / session', formatDuration(dash.kpis.mediaAvgWatchSecondsAll)],
              ['Like / view', `${dash.kpis.mediaLikeRatioApprox}%`],
            ].map(([label, val]) => (
              <div key={label} className="lw-admin-kpi">
                <span className="text-xs font-medium uppercase tracking-wide text-white/45">{label}</span>
                <b className="mt-1 block text-xl text-white">{val}</b>
              </div>
            ))}
          </div>
          <div className="lw-admin-table-wrap border border-[var(--color-border)] bg-[rgba(48,47,47,0.76)]">
            <table className="lw-admin-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Items</th>
                  <th>Views</th>
                  <th>Likes</th>
                  <th>Avg watch</th>
                  <th>Like/view</th>
                </tr>
              </thead>
              <tbody>
                {(dash.mediaByType || []).map((r) => (
                  <tr key={r.mediaType}>
                    <td className="capitalize">{r.mediaType}</td>
                    <td>{r.items}</td>
                    <td>{r.views}</td>
                    <td>{r.likes}</td>
                    <td>{formatDuration(r.avgWatchSeconds)}</td>
                    <td>{r.likeRatioPercent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="lw-admin-table-wrap border border-[var(--color-border)] bg-[rgba(48,47,47,0.76)]">
            <h3 className="border-b border-white/10 px-4 py-3 text-sm font-semibold text-white">Top items</h3>
            <table className="lw-admin-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Creator</th>
                  <th>Type</th>
                  <th>Views</th>
                  <th>Avg watch</th>
                </tr>
              </thead>
              <tbody>
                {(dash.topMedia || []).map((r) => (
                  <tr key={r.id}>
                    <td className="max-w-[200px] truncate">{r.title}</td>
                    <td>{r.creatorSlug}</td>
                    <td>{r.mediaType}</td>
                    <td>{r.views}</td>
                    <td>{formatDuration(r.avgWatchSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'media' && !dash && !dashErr ? <p className="text-white/55">Loading…</p> : null}

      {['users', 'visits', 'events', 'referrals'].includes(tab) ? (
        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-white/55">
              {tableTotal.toLocaleString()} total · page {page} / {totalPages}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="lw-btn ghost text-sm"
                disabled={page <= 1 || tableLoading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="lw-btn ghost text-sm"
                disabled={page >= totalPages || tableLoading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
          {tableLoading ? (
            <p className="text-white/55">Loading…</p>
          ) : (
            <div className="lw-admin-table-wrap border border-[var(--color-border)] bg-[rgba(48,47,47,0.76)]">
              {tab === 'users' ? (
                <table className="lw-admin-table">
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>Email</th>
                      <th>Tier</th>
                      <th>Referral</th>
                      <th>#Refs</th>
                      <th>Watch</th>
                      <th>Site time</th>
                      <th>Created</th>
                      <th>Banned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((u) => (
                      <tr key={u.id}>
                        <td>{u.username}</td>
                        <td className="max-w-[140px] truncate">{u.email || '—'}</td>
                        <td>{u.tier}</td>
                        <td className="font-mono text-xs">{u.referralCode}</td>
                        <td>{u.referralSignups}</td>
                        <td>{formatDuration(u.watchTimeSeconds)}</td>
                        <td>{formatDuration(u.siteTimeSeconds)}</td>
                        <td className="whitespace-nowrap text-xs">{fmtTime(u.createdAt)}</td>
                        <td>{u.banned ? 'yes' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {tab === 'visits' ? (
                <table className="lw-admin-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Path</th>
                      <th>User</th>
                      <th>IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((v) => (
                      <tr key={v.id}>
                        <td className="whitespace-nowrap text-xs">{fmtTime(v.created_at)}</td>
                        <td className="max-w-[160px] truncate">{v.path}</td>
                        <td>{v.user_id ? 'yes' : 'guest'}</td>
                        <td className="font-mono text-xs">{v.ip || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {tab === 'events' ? (
                <table className="lw-admin-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Type</th>
                      <th>Path</th>
                      <th>Payload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((e) => (
                      <tr key={e.id}>
                        <td className="whitespace-nowrap text-xs">{fmtTime(e.created_at)}</td>
                        <td>{e.event_type}</td>
                        <td className="max-w-[120px] truncate">{e.path || '—'}</td>
                        <td className="max-w-[280px] truncate font-mono text-xs">{e.payload_preview || '{}'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {tab === 'referrals' ? (
                <table className="lw-admin-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Referrer</th>
                      <th>New user</th>
                      <th>Code</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((r, i) => (
                      <tr key={`${r.referred_user_id}-${i}`}>
                        <td className="whitespace-nowrap text-xs">{fmtTime(r.created_at)}</td>
                        <td>{r.referrer_username}</td>
                        <td>{r.referred_username}</td>
                        <td className="font-mono text-xs">{r.referral_code_used}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      <p className="mt-12 text-center text-sm text-white/40">
        <a href="/" className="text-[var(--color-primary-light)] hover:underline">
          ← Back to site
        </a>
      </p>
    </div>
  );
}
