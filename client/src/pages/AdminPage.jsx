import { useCallback, useEffect, useState } from 'react';

export function AdminPage() {
  const [session, setSession] = useState(undefined);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);

  const loadSession = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/session', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({ ok: false }));
      setSession(data);
    } catch {
      setSession({ ok: false });
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/stats', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        setStats(null);
        return;
      }
      setStats(await res.json());
    } catch {
      setStats(null);
    }
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (session?.ok) loadStats();
    else setStats(null);
  }, [session?.ok, loadStats]);

  async function login(e) {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Login failed');
        return;
      }
      setPassword('');
      await loadSession();
    } catch {
      setError('Network error');
    }
  }

  async function logout() {
    await fetch('/api/admin/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    setStats(null);
    await loadSession();
  }

  if (session === undefined) {
    return (
      <div className="lw-admin-page flex min-h-screen items-center justify-center bg-[var(--color-bg)] text-[var(--color-text)]">
        <p className="text-white/55">Loading…</p>
      </div>
    );
  }

  return (
    <div className="lw-admin-page min-h-screen bg-[var(--color-bg)] px-4 py-16 text-[var(--color-text)]">
      <div className="lw-admin-inner mx-auto max-w-lg">
        <h1 className="mb-1 text-2xl font-semibold text-white">Admin</h1>
        <p className="mb-8 text-sm text-white/55">
          Sign in with the password from your channel (when{' '}
          <code className="text-[var(--color-primary-light)]">ADMIN_DISCORD_WEBHOOK_URL</code> is set in{' '}
          <code className="text-[var(--color-primary-light)]">.env</code>).
        </p>

        {!session.ok ? (
          <form className="lw-form lw-admin-form" onSubmit={login}>
            <label>
              Password
              <input
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {error ? <p className="lw-form-error">{error}</p> : null}
            <button type="submit" className="lw-btn primary w-full justify-center">
              Sign in
            </button>
          </form>
        ) : (
          <div className="lw-form lw-admin-panel border border-[var(--color-border)] bg-[rgba(48,47,47,0.76)]">
            <p className="mb-2 text-sm text-white/55">
              Signed in ·{' '}
              <span className="text-white/75">{session.siteLabel || stats?.siteLabel || 'this origin'}</span>
            </p>
            {stats ? (
              <ul className="mb-6 grid gap-2 text-sm text-white/85">
                <li>
                  Users (registered): <strong className="text-white">{stats.userCount ?? '—'}</strong>
                </li>
                <li>
                  Database:{' '}
                  <strong className="text-white">{stats.database ? 'connected' : 'off / unavailable'}</strong>
                </li>
              </ul>
            ) : (
              <p className="mb-6 text-sm text-white/45">Loading stats…</p>
            )}
            <button type="button" className="lw-btn ghost w-full justify-center" onClick={logout}>
              Admin logout
            </button>
          </div>
        )}

        <p className="mt-10 text-center text-sm text-white/40">
          <a href="/" className="text-[var(--color-primary-light)] hover:underline">
            ← Back to site
          </a>
        </p>
      </div>
    </div>
  );
}
