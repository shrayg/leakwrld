import { useCallback, useEffect, useState } from 'react';
import { AdminDashboard } from './AdminDashboard';

export function AdminPage() {
  const [session, setSession] = useState(undefined);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

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

  useEffect(() => {
    loadSession();
  }, [loadSession]);

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
    await loadSession();
  }

  if (session === undefined) {
    return (
      <div className="lw-admin-page flex min-h-screen items-center justify-center bg-[var(--color-bg)] text-[var(--color-text)]">
        <p className="text-white/55">Loading…</p>
      </div>
    );
  }

  if (session.ok) {
    return <AdminDashboard siteLabel={session.siteLabel} onLogout={logout} />;
  }

  return (
    <div className="lw-admin-page min-h-screen bg-[var(--color-bg)] px-4 py-16 text-[var(--color-text)]">
      <div className="lw-admin-inner mx-auto max-w-lg">
        <h1 className="mb-1 text-2xl font-semibold text-white">Admin</h1>
        <p className="mb-8 text-sm text-white/55">Restricted area — administrator password required.</p>

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

        <p className="mt-10 text-center text-sm text-white/40">
          <a href="/" className="text-[var(--color-primary-light)] hover:underline">
            ← Back to site
          </a>
        </p>
      </div>
    </div>
  );
}
