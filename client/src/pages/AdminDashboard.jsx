import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { recordEvent } from '../lib/analytics';
import { money } from '../api';
import { ArrowLeft, RefreshCw, X } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const PIE_COLORS = ['#f268b8', '#61e4ff', '#ffd700', '#64f0a6', '#a78bfa', '#fb7185', '#94a3b8'];

const CHART_RANGE_OPTIONS = [
  { key: '1h', label: '1h' },
  { key: '1d', label: '1d' },
  { key: '7d', label: '1w' },
  { key: '30d', label: '1mo' },
  { key: '365d', label: '1yr' },
];

const PAYMENT_RANGE_OPTIONS = [
  { key: 'all', label: 'All time' },
  { key: '24h', label: '24h' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
];

const TRAFFIC_SOURCES_RANGE_OPTIONS = [
  { key: '24h', label: '24h' },
  { key: '48h', label: '48h' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: 'all', label: 'All' },
];

function trafficHostCategory(hostKey) {
  const k = String(hostKey || '');
  if (k === '__direct__') return 'direct';
  if (k === '__unknown__') return 'unknown';
  const h = k.toLowerCase();
  if (h.includes('reddit')) return 'reddit';
  if (h.includes('google') || h.includes('gstatic')) return 'google';
  if (h.includes('twitter') || h.includes('t.co') || h === 'x.com') return 'twitter';
  if (h.includes('facebook') || h.includes('instagram') || h.includes('fb.')) return 'social';
  return 'other';
}

function TrafficHostBadge({ hostKey }) {
  const cat = trafficHostCategory(hostKey);
  const label =
    cat === 'direct'
      ? 'direct'
      : cat === 'unknown'
        ? 'unknown'
        : cat === 'reddit'
          ? 'reddit'
          : cat === 'google'
            ? 'google'
            : cat === 'twitter'
              ? 'twitter'
              : cat === 'social'
                ? 'social'
                : 'web';
  const cls =
    cat === 'direct'
      ? 'border-white/15 bg-white/10 text-white/65'
      : cat === 'unknown'
        ? 'border-white/15 bg-white/8 text-white/45'
        : cat === 'reddit'
          ? 'border-orange-500/35 bg-orange-500/15 text-orange-200'
          : cat === 'google'
            ? 'border-sky-500/35 bg-sky-500/15 text-sky-200'
            : cat === 'twitter'
              ? 'border-slate-400/35 bg-slate-500/15 text-slate-200'
              : cat === 'social'
                ? 'border-pink-500/35 bg-pink-500/15 text-pink-200'
                : 'border-[var(--color-primary)]/35 bg-[var(--color-primary)]/12 text-[var(--color-primary-light)]';
  return (
    <span
      className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {label}
    </span>
  );
}

function formatPaymentTrendLabel(rangeKey, bucketMs) {
  const d = new Date(Number(bucketMs));
  if (rangeKey === '24h') {
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}Z`;
  }
  if (rangeKey === '7d' || rangeKey === '30d') {
    return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

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

function flagEmoji(cc) {
  const up = String(cc || '').toUpperCase();
  if (up.length !== 2 || !/^[A-Z]{2}$/.test(up)) return '🏳️';
  const A = 0x1f1e6;
  return String.fromCodePoint(A + up.charCodeAt(0) - 65) + String.fromCodePoint(A + up.charCodeAt(1) - 65);
}

/** Recharts X-axis tick: ISO country code + flag emoji (OTHER → globe). */
function GeoCountryTick({ x, y, payload }) {
  const code = String(payload?.value ?? '');
  const label = code === 'OTHER' ? 'Other' : code;
  const glyph = code === 'OTHER' ? '🌐' : flagEmoji(code);
  return (
    <g transform={`translate(${x},${y})`}>
      <text textAnchor="middle" fill="#e6e6e6" fontSize={12} dy={14}>
        {glyph} {label}
      </text>
    </g>
  );
}

async function adminFetch(path) {
  const res = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

async function adminMutation(url, method, body) {
  const init = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  };
  if (body !== undefined && body !== null) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

const USER_TIER_OPTIONS = [
  { value: 'free', label: 'Free' },
  { value: 'basic', label: 'Tier 1' },
  { value: 'premium', label: 'Tier 2' },
  { value: 'ultimate', label: 'Tier 3 / Ultimate' },
  { value: 'admin', label: 'Admin' },
];

function UserModerateModal({ user, onClose, onSaved }) {
  const [tierDraft, setTierDraft] = useState(user.tier);
  const [bannedDraft, setBannedDraft] = useState(user.banned);
  const [banReasonDraft, setBanReasonDraft] = useState(user.banReason || '');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    setTierDraft(user.tier);
    setBannedDraft(user.banned);
    setBanReasonDraft(user.banReason || '');
    setNewPw('');
    setConfirmPw('');
    setDeleteConfirm('');
    setErr('');
    setSuccess('');
    setBusy('');
  }, [user]);

  async function saveAccount() {
    setErr('');
    setSuccess('');
    setBusy('account');
    try {
      const { ok, data } = await adminMutation(`/api/admin/users/${user.id}`, 'PATCH', {
        tier: tierDraft,
        banned: bannedDraft,
        banReason: bannedDraft ? banReasonDraft : null,
      });
      if (!ok) throw new Error(data.error || 'Could not save.');
      onSaved();
      onClose();
    } catch (e) {
      setErr(e.message || 'Save failed.');
    } finally {
      setBusy('');
    }
  }

  async function resetPassword() {
    setErr('');
    setSuccess('');
    setBusy('password');
    try {
      const { ok, data } = await adminMutation(`/api/admin/users/${user.id}/reset-password`, 'POST', {
        newPassword: newPw,
        confirmPassword: confirmPw,
      });
      if (!ok) throw new Error(data.error || 'Could not reset password.');
      setNewPw('');
      setConfirmPw('');
      setSuccess('Password updated.');
      onSaved();
    } catch (e) {
      setErr(e.message || 'Reset failed.');
    } finally {
      setBusy('');
    }
  }

  async function deleteUser() {
    setErr('');
    setSuccess('');
    setBusy('delete');
    try {
      const { ok, data } = await adminMutation(`/api/admin/users/${user.id}`, 'DELETE', {
        confirmUsername: deleteConfirm,
      });
      if (!ok) throw new Error(data.error || 'Could not delete.');
      onSaved();
      onClose();
    } catch (e) {
      setErr(e.message || 'Delete failed.');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="lw-auth-modal-root" role="presentation" style={{ zIndex: 310 }}>
      <div className="lw-auth-modal-backdrop" aria-hidden onClick={onClose} />
      <div
        className="lw-auth-modal-panel"
        style={{ maxWidth: 520 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lw-admin-mod-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="lw-auth-modal-close" onClick={onClose} aria-label="Close">
          <X size={18} strokeWidth={2} />
        </button>
        <h2 id="lw-admin-mod-title" className="lw-auth-modal-title">
          Moderate user
        </h2>
        <p className="lw-auth-modal-lede">
          <span className="font-mono text-white/90">{user.username}</span>
          <span className="text-white/45"> · </span>
          <span>{user.email || 'no email'}</span>
        </p>

        {err ? <p className="lw-form-error mb-3">{err}</p> : null}
        {success ? <p className="mb-3 text-sm text-emerald-400">{success}</p> : null}

        <div className="lw-form lw-auth-modal-form space-y-4">
          <fieldset className="space-y-3 rounded-lg border border-white/10 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-white/50">
              Account &amp; access
            </legend>
            <label className="block text-sm text-white/75">
              Tier
              <select
                className="mt-1 w-full rounded-lg border border-white/15 bg-black/25 px-3 py-2 text-white"
                value={tierDraft}
                onChange={(e) => setTierDraft(e.target.value)}
              >
                {USER_TIER_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-white/80">
              <input
                type="checkbox"
                checked={bannedDraft}
                onChange={(e) => setBannedDraft(e.target.checked)}
              />
              Banned (cannot log in)
            </label>
            {bannedDraft ? (
              <label className="block text-sm text-white/75">
                Ban reason (optional)
                <textarea
                  className="mt-1 w-full rounded-lg border border-white/15 bg-black/25 px-3 py-2 text-sm text-white"
                  rows={2}
                  value={banReasonDraft}
                  onChange={(e) => setBanReasonDraft(e.target.value)}
                  placeholder="Shown internally / for audit"
                />
              </label>
            ) : null}
            <button
              type="button"
              className="lw-btn primary w-full justify-center text-sm"
              disabled={Boolean(busy)}
              onClick={saveAccount}
            >
              {busy === 'account' ? 'Saving…' : 'Save tier & ban'}
            </button>
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border border-white/10 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-white/50">
              Reset password
            </legend>
            <label className="block text-sm text-white/75">
              New password
              <input
                type="password"
                autoComplete="new-password"
                className="mt-1 w-full rounded-lg border border-white/15 bg-black/25 px-3 py-2 text-white"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                minLength={8}
              />
            </label>
            <label className="block text-sm text-white/75">
              Confirm
              <input
                type="password"
                autoComplete="new-password"
                className="mt-1 w-full rounded-lg border border-white/15 bg-black/25 px-3 py-2 text-white"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                minLength={8}
              />
            </label>
            <button
              type="button"
              className="lw-btn ghost w-full justify-center text-sm"
              disabled={Boolean(busy) || newPw.length < 8}
              onClick={resetPassword}
            >
              {busy === 'password' ? 'Updating…' : 'Set new password'}
            </button>
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border border-red-900/40 bg-red-950/20 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-red-300/90">
              Danger zone
            </legend>
            <p className="text-xs text-white/55">
              Deletes the account and related sessions. Referral edges may be removed per database rules.
              Type the username <span className="font-mono text-white">{user.username}</span> to confirm.
            </p>
            <input
              type="text"
              className="w-full rounded-lg border border-white/15 bg-black/25 px-3 py-2 font-mono text-sm text-white"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="Exact username"
              autoComplete="off"
            />
            <button
              type="button"
              className="lw-btn ghost w-full justify-center border border-red-500/35 text-sm text-red-200 hover:bg-red-950/40"
              disabled={Boolean(busy) || deleteConfirm !== user.username}
              onClick={deleteUser}
            >
              {busy === 'delete' ? 'Deleting…' : 'Delete user permanently'}
            </button>
          </fieldset>
        </div>
      </div>
    </div>
  );
}

export function AdminDashboard({ siteLabel, onLogout }) {
  const [tab, setTab] = useState('overview');
  const [chartRange, setChartRange] = useState('7d');
  const [dash, setDash] = useState(null);
  const [dashErr, setDashErr] = useState('');
  const [page, setPage] = useState(1);
  const [tableRows, setTableRows] = useState([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [tableLoading, setTableLoading] = useState(false);
  const [moderateUser, setModerateUser] = useState(null);
  const limit = 40;

  const [tableSearchDraft, setTableSearchDraft] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  const [userTierFilter, setUserTierFilter] = useState('');
  const [referralDraft, setReferralDraft] = useState('');
  const [referralLookup, setReferralLookup] = useState(null);
  const [referralLookupErr, setReferralLookupErr] = useState('');
  const [referralLookupBusy, setReferralLookupBusy] = useState(false);

  const [mediaSearchDraft, setMediaSearchDraft] = useState('');
  const [mediaSearch, setMediaSearch] = useState('');
  const [mediaPage, setMediaPage] = useState(1);
  const [mediaRows, setMediaRows] = useState([]);
  const [mediaTotal, setMediaTotal] = useState(0);
  const [mediaLoading, setMediaLoading] = useState(false);

  const [paymentsRange, setPaymentsRange] = useState('all');
  const [paymentsSummary, setPaymentsSummary] = useState(null);
  const [paymentsSummaryErr, setPaymentsSummaryErr] = useState('');
  const [paymentsSummaryBusy, setPaymentsSummaryBusy] = useState(false);
  const [paymentsUpdatedAt, setPaymentsUpdatedAt] = useState('');
  const [paymentsSearchDraft, setPaymentsSearchDraft] = useState('');
  const [paymentsSearch, setPaymentsSearch] = useState('');
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [paymentsRows, setPaymentsRows] = useState([]);
  const [paymentsTotal, setPaymentsTotal] = useState(0);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [supabaseInvoicesRows, setSupabaseInvoicesRows] = useState([]);
  const [supabaseInvoicesErr, setSupabaseInvoicesErr] = useState('');
  const [supabaseInvoicesLoading, setSupabaseInvoicesLoading] = useState(false);

  const [trafficRange, setTrafficRange] = useState('48h');
  const [trafficReport, setTrafficReport] = useState(null);
  const [trafficErr, setTrafficErr] = useState('');
  const [trafficBusy, setTrafficBusy] = useState(false);
  const [trafficUpdatedAt, setTrafficUpdatedAt] = useState('');

  const loadDashboard = useCallback(async () => {
    setDashErr('');
    const { ok, data } = await adminFetch(
      `/api/admin/dashboard?range=${encodeURIComponent(chartRange)}`,
    );
    if (!ok) {
      setDash(null);
      setDashErr(data.error || 'Could not load dashboard');
      return;
    }
    setDash(data);
  }, [chartRange]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    recordEvent('admin_tab', {
      category: 'admin',
      path: '/admin',
      payload: { tab },
    });
  }, [tab]);

  useEffect(() => {
    setPage(1);
    setTableSearchDraft('');
    setTableSearch('');
    setUserTierFilter('');
    setReferralLookup(null);
    setReferralLookupErr('');
    setReferralDraft('');
    if (tab === 'media') {
      setMediaPage(1);
      setMediaSearchDraft('');
      setMediaSearch('');
    }
    if (tab === 'payments') {
      setPaymentsPage(1);
      setPaymentsSearchDraft('');
      setPaymentsSearch('');
    }
  }, [tab]);

  const loadTable = useCallback(async () => {
    const qEnc = encodeURIComponent(tableSearch);
    const tierEnc = encodeURIComponent(userTierFilter);
    const paths = {
      users: `/api/admin/users?page=${page}&limit=${limit}&q=${qEnc}&tier=${tierEnc}`,
      visits: `/api/admin/visits?page=${page}&limit=${limit}&q=${qEnc}`,
      events: `/api/admin/events?page=${page}&limit=${limit}&q=${qEnc}`,
      referrals: `/api/admin/referrals?page=${page}&limit=${limit}&q=${qEnc}`,
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
  }, [tab, page, limit, tableSearch, userTierFilter]);

  useEffect(() => {
    if (tab === 'overview' || tab === 'media' || tab === 'payments' || tab === 'traffic') return;
    loadTable();
  }, [tab, page, loadTable]);

  const loadPaymentsSummary = useCallback(async () => {
    if (tab !== 'payments') return;
    setPaymentsSummaryBusy(true);
    setPaymentsSummaryErr('');
    try {
      const { ok, data } = await adminFetch(
        `/api/admin/payments/summary?range=${encodeURIComponent(paymentsRange)}`,
      );
      if (!ok) {
        setPaymentsSummary(null);
        setPaymentsSummaryErr(data.error || 'Could not load payments summary');
        return;
      }
      setPaymentsSummary(data);
      setPaymentsUpdatedAt(new Date().toLocaleTimeString());
    } finally {
      setPaymentsSummaryBusy(false);
    }
  }, [tab, paymentsRange]);

  const loadPaymentsPage = useCallback(async () => {
    if (tab !== 'payments') return;
    setPaymentsLoading(true);
    try {
      const { ok, data } = await adminFetch(
        `/api/admin/payments?page=${paymentsPage}&limit=40&q=${encodeURIComponent(paymentsSearch)}&range=${encodeURIComponent(paymentsRange)}`,
      );
      if (!ok) {
        setPaymentsRows([]);
        setPaymentsTotal(0);
        return;
      }
      setPaymentsRows(data.rows || []);
      setPaymentsTotal(Number(data.total) || 0);
    } finally {
      setPaymentsLoading(false);
    }
  }, [tab, paymentsPage, paymentsSearch, paymentsRange]);

  const loadSupabaseInvoices = useCallback(async () => {
    if (tab !== 'payments') return;
    setSupabaseInvoicesLoading(true);
    setSupabaseInvoicesErr('');
    const { ok, data } = await adminFetch(`/api/admin/supabase-payments?limit=80`);
    if (!ok) {
      setSupabaseInvoicesRows([]);
      setSupabaseInvoicesErr(data.error || 'Could not load Supabase invoices');
      setSupabaseInvoicesLoading(false);
      return;
    }
    setSupabaseInvoicesRows(Array.isArray(data.invoices) ? data.invoices : []);
    setSupabaseInvoicesLoading(false);
  }, [tab]);

  useEffect(() => {
    if (tab !== 'payments') return;
    loadPaymentsSummary();
  }, [tab, paymentsRange, loadPaymentsSummary]);

  useEffect(() => {
    if (tab !== 'payments') return;
    loadPaymentsPage();
  }, [tab, loadPaymentsPage]);

  useEffect(() => {
    if (tab !== 'payments') return;
    loadSupabaseInvoices();
  }, [tab, loadSupabaseInvoices]);

  function refreshPayments() {
    loadPaymentsSummary();
    loadPaymentsPage();
  }

  const loadTrafficSources = useCallback(async () => {
    if (tab !== 'traffic') return;
    setTrafficBusy(true);
    setTrafficErr('');
    try {
      const { ok, data } = await adminFetch(
        `/api/admin/traffic-sources?range=${encodeURIComponent(trafficRange)}`,
      );
      if (!ok) {
        setTrafficReport(null);
        setTrafficErr(data.error || 'Could not load traffic sources');
        return;
      }
      setTrafficReport(data);
      setTrafficUpdatedAt(new Date().toLocaleTimeString());
    } finally {
      setTrafficBusy(false);
    }
  }, [tab, trafficRange]);

  useEffect(() => {
    if (tab !== 'traffic') return;
    loadTrafficSources();
  }, [tab, trafficRange, loadTrafficSources]);

  function refreshTrafficSources() {
    loadTrafficSources();
  }

  function applyPaymentsSearch() {
    setPaymentsSearch(paymentsSearchDraft.trim());
    setPaymentsPage(1);
  }

  function clearPaymentsSearch() {
    setPaymentsSearchDraft('');
    setPaymentsSearch('');
    setPaymentsPage(1);
  }

  const loadMediaItems = useCallback(async () => {
    if (tab !== 'media') return;
    setMediaLoading(true);
    try {
      const { ok, data } = await adminFetch(
        `/api/admin/media-items?page=${mediaPage}&limit=40&q=${encodeURIComponent(mediaSearch)}`,
      );
      if (!ok) {
        setMediaRows([]);
        setMediaTotal(0);
        return;
      }
      setMediaRows(data.rows || []);
      setMediaTotal(Number(data.total) || 0);
    } finally {
      setMediaLoading(false);
    }
  }, [tab, mediaPage, mediaSearch]);

  useEffect(() => {
    if (tab !== 'media') return;
    loadMediaItems();
  }, [tab, loadMediaItems]);

  function applyTableSearch() {
    setTableSearch(tableSearchDraft.trim());
    setPage(1);
  }

  function clearTableFilters() {
    setTableSearchDraft('');
    setTableSearch('');
    setUserTierFilter('');
    setPage(1);
  }

  async function runReferralLookup() {
    setReferralLookupBusy(true);
    setReferralLookupErr('');
    setReferralLookup(null);
    try {
      const { ok, data } = await adminFetch(
        `/api/admin/referral-lookup?q=${encodeURIComponent(referralDraft.trim())}`,
      );
      if (!ok) {
        setReferralLookupErr(data.error || 'Lookup failed');
        return;
      }
      setReferralLookup(data);
    } catch {
      setReferralLookupErr('Network error');
    } finally {
      setReferralLookupBusy(false);
    }
  }

  function applyMediaSearch() {
    setMediaSearch(mediaSearchDraft.trim());
    setMediaPage(1);
  }

  function clearMediaFilters() {
    setMediaSearchDraft('');
    setMediaSearch('');
    setMediaPage(1);
  }

  const mergedTrend = dash?.trafficSeries ?? [];

  const totalPages = Math.max(1, Math.ceil(tableTotal / limit));
  const mediaLimit = 40;
  const mediaTotalPages = Math.max(1, Math.ceil(mediaTotal / mediaLimit));
  const paymentsLimit = 40;
  const paymentsTotalPages = Math.max(1, Math.ceil(paymentsTotal / paymentsLimit));

  const tableSearchPlaceholder =
    tab === 'users'
      ? 'Search username, email, user id, phone, IP, or referral code…'
      : tab === 'visits'
        ? 'Path, IP, country code, referrer, user id, visitor id…'
        : tab === 'events'
          ? 'Event type, path, category, payload text…'
          : tab === 'referrals'
            ? 'Referral code, referrer username, or new user username…'
            : 'Search…';

  return (
    <div className="lw-admin-dash mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            to="/"
            className="lw-admin-back mb-4 inline-flex items-center gap-2 text-sm font-medium text-[var(--color-primary-light)] hover:underline"
          >
            <ArrowLeft size={18} aria-hidden />
            Back to home
          </Link>
          <h1 className="text-3xl font-semibold text-white">Admin dashboard</h1>
          <p className="mt-1 text-sm text-white/55">
            Single Postgres: users, referrals, media aggregates, traffic (
            <code className="text-[var(--color-primary-light)]">analytics_visits</code> /{' '}
            <code className="text-[var(--color-primary-light)]">analytics_events</code>
            ). The Traffic sources tab rolls up signup HTTP referrers and referral codes by host.
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
          ['traffic', 'Traffic sources'],
          ['users', 'Users'],
          ['visits', 'Visits'],
          ['events', 'Events'],
          ['referrals', 'Referrals'],
          ['payments', 'Payments'],
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
          <p className="mb-6 text-xs text-white/40">
            Use <strong className="text-white/55">Search</strong> on Users, Visits, Events, Referrals, and Media stats to
            filter rows; open <strong className="text-white/55">Payments</strong> for tier redemption revenue. Referral
            lookup is on Users.
          </p>
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
                  ['Visits (chart window)', dash.kpis.visitsWindow],
                  ['Signups (chart window)', dash.kpis.signupsWindow],
                  ['Events (chart window)', dash.kpis.eventsWindow],
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

              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-white/45">
                  Chart window
                </span>
                <div
                  className="flex flex-wrap gap-1 rounded-lg border border-white/10 bg-black/20 p-1"
                  role="group"
                  aria-label="Dashboard chart time range"
                >
                  {CHART_RANGE_OPTIONS.map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                        chartRange === key
                          ? 'bg-[var(--color-primary)]/35 text-white'
                          : 'text-white/55 hover:bg-white/10 hover:text-white/85'
                      }`}
                      aria-pressed={chartRange === key}
                      onClick={() => setChartRange(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-white/40">{dash.chartRangeTitle}</span>
              </div>

              <div className="mb-10 grid gap-6 lg:grid-cols-2">
                <div className="lw-admin-chart border border-[var(--color-border)] bg-[rgba(48,47,47,0.76)] p-4">
                  <h3 className="mb-3 text-sm font-semibold text-white">
                    Traffic & signups · {dash.chartRangeTitle}
                  </h3>
                  <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={mergedTrend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff18" />
                        <XAxis dataKey="day" tick={{ fill: '#bbb', fontSize: 11 }} />
                        <YAxis
                          allowDecimals={false}
                          tick={{ fill: '#bbb', fontSize: 11 }}
                          width={36}
                        />
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

              <div className="lw-admin-chart mb-10 border border-[var(--color-border)] bg-[rgba(48,47,47,0.76)] p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-sm font-semibold text-white">Geolocation</h3>
                    <span
                      className="rounded-full border border-[var(--color-primary)]/45 bg-[var(--color-primary)]/18 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-white"
                      title="Visits with a resolved country code in this chart window"
                    >
                      {(dash.geoCountries?.totalLocated ?? 0).toLocaleString()}
                    </span>
                  </div>
                  <span className="rounded border border-white/15 bg-white/[0.06] px-2 py-0.5 text-[11px] text-white/55">
                    Top 10 + Other
                  </span>
                </div>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-white/50">Top countries</h4>
                <p className="mb-3 text-xs text-white/45">
                  Uses <code className="text-[var(--color-primary-light)]">analytics_visits.country_code</code> — CDN country
                  headers (e.g. <code className="text-white/60">CF-IPCountry</code>) when present, otherwise GeoIP from the
                  client IP · {dash.chartRangeTitle}
                </p>
                <div className="h-[340px] w-full">
                  {!dash.geoCountries?.bars?.length ? (
                    <div className="flex h-full min-h-[240px] flex-col items-center justify-center rounded-lg border border-dashed border-white/20 px-4 text-center text-sm text-white/50">
                      No geolocated visits in this window yet. Traffic after deploy will appear here.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dash.geoCountries.bars} margin={{ top: 28, right: 12, left: 6, bottom: 6 }}>
                        <defs>
                          <linearGradient id="lwGeoBarGrad" x1="0" y1="1" x2="0" y2="0">
                            <stop offset="0%" stopColor="#38bdf8" />
                            <stop offset="100%" stopColor="#a855f7" />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff18" vertical={false} />
                        <XAxis dataKey="code" tick={<GeoCountryTick />} interval={0} height={48} />
                        <YAxis tick={{ fill: '#bbb', fontSize: 11 }} width={44} allowDecimals={false} />
                        <Tooltip
                          formatter={(value, _name, item) => [
                            Number(value).toLocaleString(),
                            item?.payload?.code === 'OTHER' ? 'Visits (Other)' : 'Visits',
                          ]}
                          labelFormatter={(label) => (label === 'OTHER' ? 'Other (aggregated)' : String(label))}
                          contentStyle={{ background: '#2a2829', border: '1px solid #444', borderRadius: 8 }}
                        />
                        <Bar dataKey="count" fill="url(#lwGeoBarGrad)" radius={[10, 10, 0, 0]} maxBarSize={76}>
                          <LabelList
                            dataKey="count"
                            position="top"
                            fill="#f0f0f0"
                            fontSize={11}
                            formatter={(v) => Number(v).toLocaleString()}
                          />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div className="mb-10 grid gap-6 lg:grid-cols-2">
                <div className="lw-admin-chart border border-[var(--color-border)] bg-[rgba(48,47,47,0.76)] p-4">
                  <h3 className="mb-3 text-sm font-semibold text-white">
                    Events by type · {dash.chartRangeTitle}
                  </h3>
                  <p className="mb-2 text-xs text-white/45">
                    Counts from <code className="text-[var(--color-primary-light)]">analytics_events</code>{' '}
                    (every SPA navigation logs <code className="text-white/70">page_view</code>; signup/login log{' '}
                    <code className="text-white/70">signup</code> / <code className="text-white/70">login</code>
                    ).
                  </p>
                  <div className="h-[260px] w-full">
                    {(dash.eventTypes || []).length === 0 ? (
                      <div className="flex h-full min-h-[200px] flex-col items-center justify-center rounded-lg border border-dashed border-white/20 px-4 text-center text-sm text-white/50">
                        No events in this window yet.
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={dash.eventTypes} layout="vertical" margin={{ left: 8, right: 16 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff18" />
                          <XAxis type="number" allowDecimals={false} tick={{ fill: '#bbb', fontSize: 11 }} />
                          <YAxis
                            type="category"
                            dataKey="type"
                            width={120}
                            tick={{ fill: '#bbb', fontSize: 10 }}
                          />
                          <Tooltip
                            contentStyle={{
                              background: '#2a2829',
                              border: '1px solid #444',
                              borderRadius: 8,
                            }}
                          />
                          <Bar dataKey="count" fill="#f268b8" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
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

              <div className="grid gap-6 xl:grid-cols-2">
                <div className="lw-admin-chart border border-[var(--color-border)] bg-[rgba(48,47,47,0.76)] p-4">
                  <h3 className="mb-3 text-sm font-semibold text-white">Most visited categories</h3>
                  <p className="mb-2 text-xs text-white/45">
                    Page views whose path matches <code className="text-white/70">/creators/&lt;slug&gt;</code>, grouped by
                    that creator&apos;s catalog category in{' '}
                    <code className="text-[var(--color-primary-light)]">creators.category</code>
                    · {dash.chartRangeTitle}
                  </p>
                  <div className="h-[min(520px,70vh)] w-full min-h-[240px]">
                    {(dash.topCategoriesByVisits || []).length === 0 ? (
                      <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-white/20 px-4 text-center text-sm text-white/50">
                        No creator profile visits in this window yet.
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={[...(dash.topCategoriesByVisits || [])].reverse()}
                          layout="vertical"
                          margin={{ left: 4, right: 16, top: 4, bottom: 4 }}
                        >
                          <defs>
                            <linearGradient id="lwAdminCatBarGrad" x1="0" y1="0" x2="1" y2="0">
                              <stop offset="0%" stopColor="#38bdf8" />
                              <stop offset="100%" stopColor="#a855f7" />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff18" horizontal={false} />
                          <XAxis type="number" allowDecimals={false} tick={{ fill: '#bbb', fontSize: 11 }} />
                          <YAxis
                            type="category"
                            dataKey="category"
                            width={132}
                            tick={{ fill: '#ddd', fontSize: 11 }}
                            tickFormatter={(v) => (String(v).length > 18 ? `${String(v).slice(0, 16)}…` : v)}
                          />
                          <Tooltip
                            formatter={(value) => [Number(value).toLocaleString(), 'Visits']}
                            contentStyle={{
                              background: '#2a2829',
                              border: '1px solid #444',
                              borderRadius: 8,
                            }}
                          />
                          <Bar dataKey="visits" fill="url(#lwAdminCatBarGrad)" radius={[0, 8, 8, 0]} maxBarSize={28} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-6 xl:min-w-0">
                  <div className="border border-[var(--color-border)] bg-[rgba(48,47,47,0.76)] p-4">
                    <h3 className="mb-3 text-sm font-semibold text-white">Top creators by all-time views</h3>
                    <p className="mb-2 text-xs text-white/45">
                      Sum of <code className="text-[var(--color-primary-light)]">media_items.views</code> grouped by creator
                      across all published media.
                    </p>
                    <div className="lw-admin-table-wrap max-h-[min(280px,40vh)] overflow-y-auto">
                      <table className="lw-admin-table">
                        <thead>
                          <tr>
                            <th>Creator</th>
                            <th>Slug</th>
                            <th>Views</th>
                            <th>Items</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(dash.topCreatorsByViewsAllTime || []).length === 0 ? (
                            <tr>
                              <td colSpan={4} className="text-center text-sm text-white/45">
                                No creator media view totals yet.
                              </td>
                            </tr>
                          ) : (
                            (dash.topCreatorsByViewsAllTime || []).map((r) => (
                              <tr key={r.slug}>
                                <td className="max-w-[160px] truncate" title={r.name}>
                                  {r.name}
                                </td>
                                <td className="font-mono text-xs text-white/70">
                                  <a className="text-[var(--color-primary-light)] hover:underline" href={`/creators/${r.slug}`}>
                                    {r.slug}
                                  </a>
                                </td>
                                <td>{Number(r.totalViews).toLocaleString()}</td>
                                <td>{Number(r.items).toLocaleString()}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="border border-[var(--color-border)] bg-[rgba(48,47,47,0.76)] p-4">
                    <h3 className="mb-3 text-sm font-semibold text-white">Trending creators (24h)</h3>
                    <p className="mb-2 text-xs text-white/45">
                      Profile-page visits matching{' '}
                      <code className="text-white/70">/creators/&lt;slug&gt;</code> in the last rolling 24 hours. The public
                      creator index <strong className="text-white/80">Trending</strong> tab instead ranks by{' '}
                      <strong className="text-white/80">media plays today</strong> (UTC day,{' '}
                      <code className="text-white/70">media_session_start</code> events).
                    </p>
                    <div className="lw-admin-table-wrap max-h-[min(280px,40vh)] overflow-y-auto">
                      <table className="lw-admin-table">
                        <thead>
                          <tr>
                            <th>Creator</th>
                            <th>Slug</th>
                            <th>Visits</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(dash.topCreatorsByProfileVisits24h || []).length === 0 ? (
                            <tr>
                              <td colSpan={3} className="text-center text-sm text-white/45">
                                No profile visits in the last 24 hours yet.
                              </td>
                            </tr>
                          ) : (
                            (dash.topCreatorsByProfileVisits24h || []).map((r) => (
                              <tr key={r.slug}>
                                <td className="max-w-[160px] truncate" title={r.name}>
                                  {r.name}
                                </td>
                                <td className="font-mono text-xs text-white/70">
                                  <a className="text-[var(--color-primary-light)] hover:underline" href={`/creators/${r.slug}`}>
                                    {r.slug}
                                  </a>
                                </td>
                                <td>{Number(r.visits).toLocaleString()}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="border border-[var(--color-border)] bg-[rgba(48,47,47,0.76)] p-4 xl:min-w-0">
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
          <div className="lw-admin-search-panel mb-4 space-y-3 rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-[220px] flex-[2] space-y-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">
                  Search published media
                </span>
                <input
                  type="search"
                  className="lw-input w-full rounded-lg border border-white/15 bg-[rgba(30,29,29,0.9)] px-3 py-2 text-sm text-white placeholder:text-white/35"
                  placeholder="Title, creator slug, or media id…"
                  value={mediaSearchDraft}
                  onChange={(e) => setMediaSearchDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') applyMediaSearch();
                  }}
                  autoComplete="off"
                  aria-label="Search media items"
                />
              </label>
              <button type="button" className="lw-btn primary shrink-0 px-5 py-2 text-sm" onClick={applyMediaSearch}>
                Search
              </button>
              <button type="button" className="lw-btn ghost shrink-0 px-4 py-2 text-sm" onClick={clearMediaFilters}>
                Clear
              </button>
            </div>
          </div>

          <div className="lw-admin-table-wrap border border-[var(--color-border)] bg-[rgba(48,47,47,0.76)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <h3 className="text-sm font-semibold text-white">Media items</h3>
              <p className="text-xs text-white/45">
                {mediaTotal.toLocaleString()} total · page {mediaPage} / {mediaTotalPages}
                {mediaSearch ? <span className="ml-2 text-white/35">· filtered</span> : null}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="lw-btn ghost text-xs"
                  disabled={mediaPage <= 1 || mediaLoading}
                  onClick={() => setMediaPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="lw-btn ghost text-xs"
                  disabled={mediaPage >= mediaTotalPages || mediaLoading}
                  onClick={() => setMediaPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
            {mediaLoading ? (
              <p className="px-4 py-6 text-sm text-white/55">Loading…</p>
            ) : (
              <table className="lw-admin-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Creator</th>
                    <th>Type</th>
                    <th>Views</th>
                    <th>Likes</th>
                    <th>Avg watch</th>
                  </tr>
                </thead>
                <tbody>
                  {mediaRows.map((r) => (
                    <tr key={r.id}>
                      <td className="max-w-[200px] truncate" title={r.title}>
                        {r.title}
                      </td>
                      <td>{r.creatorSlug}</td>
                      <td className="capitalize">{r.mediaType}</td>
                      <td>{r.views}</td>
                      <td>{r.likes}</td>
                      <td>{formatDuration(r.avgWatchSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!mediaLoading && mediaRows.length === 0 ? (
              <p className="px-4 py-6 text-sm text-white/50">No rows match this search.</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === 'media' && !dash && !dashErr ? <p className="text-white/55">Loading…</p> : null}

      {tab === 'payments' ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-semibold text-white">Payments</h2>
                {paymentsSummary ? (
                  <span className="rounded-full border border-[var(--color-primary)]/45 bg-[var(--color-primary)]/18 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-white">
                    {(paymentsSummary.count ?? 0).toLocaleString()}
                  </span>
                ) : null}
                <span className="flex items-center gap-2 text-xs text-white/45">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" aria-hidden />
                  {paymentsUpdatedAt ? <>Updated {paymentsUpdatedAt}</> : <span>…</span>}
                </span>
              </div>
              <p className="mt-1 max-w-xl text-xs text-white/45">
                Tier grants recorded in{' '}
                <code className="text-[var(--color-primary-light)]">payments</code> — sums match the selected window.
              </p>
            </div>
            <button
              type="button"
              className="lw-btn ghost inline-flex items-center gap-2 text-sm"
              disabled={paymentsSummaryBusy || paymentsLoading}
              onClick={refreshPayments}
            >
              <RefreshCw size={15} className={paymentsSummaryBusy ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
            <div
              className="flex flex-wrap gap-1 rounded-lg border border-white/10 bg-black/25 p-1"
              role="group"
              aria-label="Payments time range"
            >
              {PAYMENT_RANGE_OPTIONS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                    paymentsRange === key
                      ? 'bg-[var(--color-primary)]/40 text-white'
                      : 'text-white/55 hover:bg-white/10 hover:text-white/85'
                  }`}
                  aria-pressed={paymentsRange === key}
                  onClick={() => {
                    setPaymentsRange(key);
                    setPaymentsPage(1);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="rounded-full border border-emerald-500/35 bg-emerald-500/15 px-5 py-2 text-lg font-bold tabular-nums text-emerald-300">
              {paymentsSummary ? money(paymentsSummary.revenueCents) : '—'}
            </div>
          </div>

          {paymentsSummaryErr ? <p className="lw-form-error">{paymentsSummaryErr}</p> : null}

          <div className="lw-admin-chart border border-[var(--color-border)] bg-[rgba(48,47,47,0.76)] p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-white">SellAuth invoices (latest)</h3>
              <button
                type="button"
                className="lw-btn ghost inline-flex items-center gap-2 px-4 py-2 text-xs"
                disabled={supabaseInvoicesLoading}
                onClick={loadSupabaseInvoices}
              >
                <RefreshCw size={14} className={supabaseInvoicesLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
            <p className="mb-3 text-xs text-white/45">
              Records from <code className="text-[var(--color-primary-light)]">public.sellauth_invoices</code> in Supabase (used
              for email-based tier redemption).
            </p>
            {supabaseInvoicesErr ? <p className="lw-form-error">{supabaseInvoicesErr}</p> : null}
            {supabaseInvoicesLoading ? (
              <p className="text-sm text-white/55">Loading SellAuth invoices…</p>
            ) : supabaseInvoicesRows.length === 0 ? (
              <p className="text-sm text-white/50">No SellAuth invoices found yet.</p>
            ) : (
              <div className="lw-admin-table-wrap max-h-[min(320px,50vh)] overflow-y-auto">
                <table className="lw-admin-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Created</th>
                      <th>Email</th>
                      <th>Status</th>
                      <th>Tier</th>
                      <th>Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {supabaseInvoicesRows.map((r) => (
                      <tr key={r.sellauth_invoice_id}>
                        <td className="font-mono text-xs text-white/65">{r.sellauth_invoice_id}</td>
                        <td className="whitespace-nowrap text-xs text-white/70">
                          {r.created_at ? String(r.created_at).replace('T', ' ').replace('Z', '') : '—'}
                        </td>
                        <td className="max-w-[220px] truncate" title={r.email}>
                          {r.email}
                        </td>
                        <td className="capitalize">{r.status || '—'}</td>
                        <td className="max-w-[220px] truncate font-mono text-xs text-white/60" title={r.unique_id || ''}>
                          {r.unique_id || '—'}
                        </td>
                        <td className="text-xs text-white/70">{r.paid_usd || r.price_usd || r.price || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {paymentsSummaryBusy && !paymentsSummary ? (
            <p className="text-white/55">Loading payments…</p>
          ) : paymentsSummary ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="lw-admin-chart border border-[var(--color-border)] bg-[rgba(48,47,47,0.76)] p-4">
                <h3 className="mb-3 text-sm font-semibold text-white">Revenue & volume</h3>
                <div className="h-[280px] w-full">
                  {(paymentsSummary.trend || []).length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-white/45">
                      No payments in this window.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={(paymentsSummary.trend || []).map((r) => ({
                          label: formatPaymentTrendLabel(paymentsRange, r.bucketMs),
                          revenueDollars: Number(r.revenueCents) / 100,
                          payments: r.count,
                        }))}
                        margin={{ left: 4, right: 12, top: 8, bottom: 4 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff18" />
                        <XAxis dataKey="label" tick={{ fill: '#aaa', fontSize: 10 }} interval="preserveStartEnd" />
                        <YAxis
                          yAxisId="left"
                          tick={{ fill: '#bbb', fontSize: 11 }}
                          width={48}
                          tickFormatter={(v) => `$${v}`}
                        />
                        <YAxis yAxisId="right" orientation="right" tick={{ fill: '#887', fontSize: 11 }} width={36} />
                        <Tooltip
                          contentStyle={{ background: '#2a2829', border: '1px solid #444', borderRadius: 8 }}
                          labelStyle={{ color: '#eee' }}
                          formatter={(value, name) =>
                            name === 'Revenue ($)'
                              ? [money(Math.round(Number(value) * 100)), 'Revenue']
                              : [value, 'Payments']
                          }
                        />
                        <Legend />
                        <Line
                          yAxisId="left"
                          type="monotone"
                          dataKey="revenueDollars"
                          name="Revenue ($)"
                          stroke="#34d399"
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="payments"
                          name="Payments"
                          stroke="#a78bfa"
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div className="lw-admin-chart border border-[var(--color-border)] bg-[rgba(48,47,47,0.76)] p-4">
                <h3 className="mb-3 text-sm font-semibold text-white">Revenue by tier granted</h3>
                <div className="h-[280px] w-full">
                  {(paymentsSummary.tierBreakdown || []).every((x) => !x.count) ? (
                    <div className="flex h-full items-center justify-center text-sm text-white/45">
                      No tier splits in range.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={(paymentsSummary.tierBreakdown || [])
                            .filter((x) => x.count > 0)
                            .map((x) => ({
                              name: x.tier,
                              value: Number(x.revenueCents) / 100,
                              count: x.count,
                            }))}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={92}
                          label={({ name, value }) => `${name}: $${Number(value).toFixed(0)}`}
                        >
                          {(paymentsSummary.tierBreakdown || [])
                            .filter((x) => x.count > 0)
                            .map((_, i) => (
                              <Cell key={`tier-${i}`} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                        </Pie>
                        <Tooltip
                          formatter={(value, _n, item) => [
                            `$${Number(value).toFixed(2)}`,
                            `${item?.payload?.count ?? 0} payments`,
                          ]}
                          contentStyle={{ background: '#2a2829', border: '1px solid #444', borderRadius: 8 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          <div className="lw-admin-search-panel space-y-3 rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-[220px] flex-[2] space-y-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">Search rows</span>
                <input
                  type="search"
                  className="lw-input w-full rounded-lg border border-white/15 bg-[rgba(30,29,29,0.9)] px-3 py-2 text-sm text-white placeholder:text-white/35"
                  placeholder="Username, plan label, provider, payment id…"
                  value={paymentsSearchDraft}
                  onChange={(e) => setPaymentsSearchDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') applyPaymentsSearch();
                  }}
                  autoComplete="off"
                  aria-label="Search payments"
                />
              </label>
              <button type="button" className="lw-btn primary shrink-0 px-5 py-2 text-sm" onClick={applyPaymentsSearch}>
                Search
              </button>
              <button type="button" className="lw-btn ghost shrink-0 px-4 py-2 text-sm" onClick={clearPaymentsSearch}>
                Clear
              </button>
            </div>
          </div>

          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-white/55">
              {paymentsTotal.toLocaleString()} rows · page {paymentsPage} / {paymentsTotalPages}
              {paymentsSearch ? <span className="ml-2 text-white/35">· filtered</span> : null}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="lw-btn ghost text-sm"
                disabled={paymentsPage <= 1 || paymentsLoading}
                onClick={() => setPaymentsPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="lw-btn ghost text-sm"
                disabled={paymentsPage >= paymentsTotalPages || paymentsLoading}
                onClick={() => setPaymentsPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>

          {paymentsLoading ? (
            <p className="text-white/55">Loading table…</p>
          ) : (
            <div className="lw-admin-table-wrap border border-[var(--color-border)] bg-[rgba(48,47,47,0.76)]">
              <table className="lw-admin-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>User</th>
                    <th>Amount</th>
                    <th>Tier</th>
                    <th>Plan</th>
                    <th>Provider</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentsRows.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap text-xs">{fmtTime(r.createdAt)}</td>
                      <td>{r.username}</td>
                      <td className="font-mono text-emerald-200">{money(r.amountCents)}</td>
                      <td>{r.tierGranted}</td>
                      <td className="max-w-[140px] truncate" title={r.planLabel}>
                        {r.planLabel}
                      </td>
                      <td className="font-mono text-xs">{r.provider}</td>
                      <td className="max-w-[200px] truncate text-xs text-white/70">{r.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!paymentsLoading && paymentsRows.length === 0 ? (
            <p className="text-sm text-white/45">No payment rows for this range and search.</p>
          ) : null}
        </div>
      ) : null}

      {tab === 'traffic' ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-semibold text-white">Traffic sources</h2>
                {trafficReport ? (
                  <span className="rounded-full border border-[var(--color-primary)]/45 bg-[var(--color-primary)]/18 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-white">
                    {(trafficReport.totalSignups ?? 0).toLocaleString()} signups
                  </span>
                ) : null}
                <span className="flex items-center gap-2 text-xs text-white/45">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" aria-hidden />
                  {trafficUpdatedAt ? <>Updated {trafficUpdatedAt}</> : <span>…</span>}
                </span>
              </div>
              <p className="mt-1 max-w-2xl text-xs text-white/45">
                New accounts in the window (
                <code className="text-[var(--color-primary-light)]">users.created_at</code>
                ). HTTP referrer from the latest{' '}
                <code className="text-[var(--color-primary-light)]">analytics_visits</code> row with{' '}
                <code className="text-[var(--color-primary-light)]">path = &apos;/signup&apos;</code>. Referral codes from{' '}
                <code className="text-[var(--color-primary-light)]">users.referred_by_user_id</code> /
                <code className="text-[var(--color-primary-light)]"> referral_signups</code>.
              </p>
            </div>
            <button
              type="button"
              className="lw-btn ghost inline-flex items-center gap-2 text-sm"
              disabled={trafficBusy}
              onClick={refreshTrafficSources}
            >
              <RefreshCw size={15} className={trafficBusy ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
            <div
              className="flex flex-wrap gap-1 rounded-lg border border-white/10 bg-black/25 p-1"
              role="group"
              aria-label="Signup attribution time range"
            >
              {TRAFFIC_SOURCES_RANGE_OPTIONS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                    trafficRange === key
                      ? 'bg-[var(--color-primary)]/40 text-white'
                      : 'text-white/55 hover:bg-white/10 hover:text-white/85'
                  }`}
                  aria-pressed={trafficRange === key}
                  onClick={() => setTrafficRange(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {trafficErr ? <p className="lw-form-error">{trafficErr}</p> : null}

          {trafficBusy && !trafficReport ? (
            <p className="text-white/55">Loading traffic sources…</p>
          ) : trafficReport ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-[rgba(48,47,47,0.76)] px-5 py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">
                    Signups w/ referrer captured
                  </p>
                  <p className="mt-2 text-3xl font-bold tabular-nums text-white">
                    {(trafficReport.signupsWithCapturedReferrer ?? 0).toLocaleString()}
                  </p>
                  <p className="mt-1 text-xs text-white/45">
                    Browser sent a non-empty HTTP referrer on the signup beacon (external or internal).
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[rgba(48,47,47,0.76)] px-5 py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">
                    Signups attributed to a code
                  </p>
                  <p className="mt-2 text-3xl font-bold tabular-nums text-white">
                    {(trafficReport.signupsWithReferralCode ?? 0).toLocaleString()}
                  </p>
                  <p className="mt-1 text-xs text-white/45">
                    Account linked to a referrer (<code className="text-white/55">referred_by_user_id</code>
                    ).
                  </p>
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-white/10 bg-black/15">
                <div className="border-b border-white/10 px-4 py-3">
                  <h3 className="text-sm font-semibold text-white">By host</h3>
                  <p className="mt-0.5 text-xs text-white/45">
                    Parsed host from signup referrer (mobile in-app referrers use the{' '}
                    <code className="text-[var(--color-primary-light)]">android-app://…</code> bucket when
                    applicable).
                  </p>
                </div>
                <div className="overflow-x-auto">
                  {(trafficReport.hosts || []).length === 0 ? (
                    <p className="px-4 py-6 text-sm text-white/45">No signups in this range.</p>
                  ) : (
                    <table className="lw-admin-table">
                      <thead>
                        <tr>
                          <th>Host</th>
                          <th>Signups</th>
                          <th>W/ code</th>
                          <th>Top referral codes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(trafficReport.hosts || []).map((h) => (
                          <tr key={h.hostKey}>
                            <td className="max-w-[240px]">
                              <div className="flex flex-col gap-1.5">
                                <TrafficHostBadge hostKey={h.hostKey} />
                                <span className="break-all text-sm text-white/90">{h.hostLabel}</span>
                              </div>
                            </td>
                            <td className="tabular-nums">{Number(h.signups || 0).toLocaleString()}</td>
                            <td className="tabular-nums">{Number(h.withCode || 0).toLocaleString()}</td>
                            <td className="max-w-[420px]">
                              {(h.topCodes || []).length === 0 ? (
                                <span className="text-white/35">—</span>
                              ) : (
                                <ul className="flex flex-col gap-1 text-xs">
                                  {(h.topCodes || []).map((c) => (
                                    <li key={`${h.hostKey}-${c.code}`}>
                                      <a
                                        href={`/?ref=${encodeURIComponent(c.code)}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="font-mono text-[var(--color-primary-light)] hover:underline"
                                      >
                                        /{c.code}
                                      </a>{' '}
                                      <span className="text-white/45">
                                        ({c.referrerUsername || '—'}) ×{c.count}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {['users', 'visits', 'events', 'referrals'].includes(tab) ? (
        <div>
          <div className="lw-admin-search-panel mb-6 space-y-3 rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-[220px] flex-[2] space-y-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">Search</span>
                <input
                  type="search"
                  className="lw-input w-full rounded-lg border border-white/15 bg-[rgba(30,29,29,0.9)] px-3 py-2 text-sm text-white placeholder:text-white/35"
                  placeholder={tableSearchPlaceholder}
                  value={tableSearchDraft}
                  onChange={(e) => setTableSearchDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') applyTableSearch();
                  }}
                  autoComplete="off"
                  aria-label="Filter table"
                />
              </label>
              {tab === 'users' ? (
                <label className="min-w-[140px] flex-1 space-y-1">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">Tier</span>
                  <select
                    className="lw-input w-full rounded-lg border border-white/15 bg-[rgba(30,29,29,0.9)] px-3 py-2 text-sm text-white"
                    value={userTierFilter}
                    onChange={(e) => {
                      setUserTierFilter(e.target.value);
                      setPage(1);
                    }}
                    aria-label="Filter by tier"
                  >
                    <option value="">All tiers</option>
                    {USER_TIER_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <button type="button" className="lw-btn primary shrink-0 px-5 py-2 text-sm" onClick={applyTableSearch}>
                Search
              </button>
              <button type="button" className="lw-btn ghost shrink-0 px-4 py-2 text-sm" onClick={clearTableFilters}>
                Clear
              </button>
            </div>
            {tab === 'users' ? (
              <>
                <div className="flex flex-wrap items-end gap-3 border-t border-white/10 pt-3">
                  <label className="min-w-[220px] flex-[2] space-y-1">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">
                      Referral lookup
                    </span>
                    <input
                      type="text"
                      className="lw-input w-full rounded-lg border border-white/15 bg-[rgba(30,29,29,0.9)] px-3 py-2 text-sm text-white placeholder:text-white/35"
                      placeholder="Full URL with ?ref=… or raw 6-character code"
                      value={referralDraft}
                      onChange={(e) => setReferralDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') runReferralLookup();
                      }}
                      autoComplete="off"
                      aria-label="Referral code lookup"
                    />
                  </label>
                  <button
                    type="button"
                    className="lw-btn shrink-0 border border-cyan-400/40 bg-cyan-500/15 px-5 py-2 text-sm text-cyan-100 hover:bg-cyan-500/25"
                    disabled={referralLookupBusy}
                    onClick={runReferralLookup}
                  >
                    {referralLookupBusy ? 'Looking up…' : 'Lookup referral'}
                  </button>
                </div>
                {referralLookupErr ? <p className="text-sm text-red-300">{referralLookupErr}</p> : null}
                {referralLookup?.ok && referralLookup.message && !referralLookup.referrer ? (
                  <p className="text-sm text-white/60">{referralLookup.message}</p>
                ) : null}
                {referralLookup?.ok && referralLookup.referrer ? (
                  <div className="rounded-lg border border-white/10 bg-[rgba(48,47,47,0.5)] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-white/45">Referrer</p>
                    <div className="mt-2 grid gap-2 text-sm text-white sm:grid-cols-2">
                      <span>
                        <span className="text-white/45">User:</span> {referralLookup.referrer.username}
                      </span>
                      <span>
                        <span className="text-white/45">Tier:</span> {referralLookup.referrer.tier}
                      </span>
                      <span>
                        <span className="text-white/45">Code:</span>{' '}
                        <code className="text-[var(--color-primary-light)]">{referralLookup.referrer.referralCode}</code>
                      </span>
                      <span>
                        <span className="text-white/45">Total signups:</span>{' '}
                        {referralLookup.referrer.referralSignups}
                      </span>
                      <span className="sm:col-span-2">
                        <span className="text-white/45">Email:</span> {referralLookup.referrer.email || '—'}
                      </span>
                    </div>
                    {(referralLookup.signups || []).length > 0 ? (
                      <div className="lw-admin-table-wrap mt-4 max-h-[220px] overflow-auto border border-white/10">
                        <table className="lw-admin-table">
                          <thead>
                            <tr>
                              <th>When</th>
                              <th>Referred user</th>
                              <th>Code used</th>
                            </tr>
                          </thead>
                          <tbody>
                            {referralLookup.signups.map((s) => (
                              <tr key={`${s.referred_user_id}-${s.created_at}`}>
                                <td className="whitespace-nowrap text-xs">{fmtTime(s.created_at)}</td>
                                <td>{s.referred_username}</td>
                                <td className="font-mono text-xs">{s.referral_code_used}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-white/45">No signups recorded for this code yet.</p>
                    )}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-white/55">
              {tableTotal.toLocaleString()} total · page {page} / {totalPages}
              {(tableSearch || (tab === 'users' && userTierFilter)) && (
                <span className="ml-2 text-white/35">· filtered</span>
              )}
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
                      <th>Actions</th>
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
                        <td className="whitespace-nowrap">
                          <button
                            type="button"
                            className="lw-btn ghost px-2 py-1 text-xs"
                            onClick={() => setModerateUser(u)}
                          >
                            Moderate
                          </button>
                        </td>
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
                        <td>{v.username || 'guest'}</td>
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

      {moderateUser ? (
        <UserModerateModal
          user={moderateUser}
          onClose={() => setModerateUser(null)}
          onSaved={() => {
            loadTable();
            loadDashboard();
          }}
        />
      ) : null}
    </div>
  );
}
