import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiPost } from '../api';
import { useAuth } from '../components/AuthContext';

export function AuthPage({ mode }) {
  const isSignup = mode === 'signup';
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const refFromUrl = searchParams.get('ref') || '';
  const { refresh } = useAuth();
  const [form, setForm] = useState({
    email: '',
    username: '',
    identifier: '',
    password: '',
    referralCode: refFromUrl,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (isSignup) {
        await apiPost('/api/auth/signup', {
          email: form.email.trim() || undefined,
          username: form.username,
          password: form.password,
          referralCode: form.referralCode.trim() || undefined,
        });
      } else {
        await apiPost('/api/auth/login', {
          identifier: form.identifier,
          password: form.password,
        });
      }
      await refresh();
      navigate('/');
    } catch (err) {
      setError(err.message || 'Authentication failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[1fr_420px]">
      <section className="lw-auth-copy">
        <span className="lw-eyebrow">Members area</span>
        <h1>{isSignup ? 'Create your account' : 'Welcome back'}</h1>
        <p>
          {isSignup
            ? 'Free accounts unlock previews across the entire archive. Upgrade any time for full premium access to every creator.'
            : 'Sign back in to pick up where you left off — your saved creators, watch history, and premium access all stay in sync.'}
        </p>
      </section>

      <form className="lw-form" onSubmit={submit}>
        <h2>{isSignup ? 'Sign up' : 'Login'}</h2>
        {isSignup ? (
          <>
            <label>
              Email <span className="text-white/45">(optional)</span>
              <input
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="you@example.com"
              />
            </label>
            <label>
              Username
              <input
                autoComplete="username"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                minLength={3}
                maxLength={24}
                required
              />
            </label>
            <label>
              Referral code <span className="text-white/45">(optional)</span>
              <input
                value={form.referralCode}
                onChange={(e) => setForm((f) => ({ ...f, referralCode: e.target.value.toUpperCase() }))}
                maxLength={6}
                placeholder="6-character code"
                spellCheck={false}
              />
            </label>
          </>
        ) : (
          <label>
            Email or username
            <input
              value={form.identifier}
              onChange={(e) => setForm((f) => ({ ...f, identifier: e.target.value }))}
              required
            />
          </label>
        )}
        <label>
          Password
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            minLength={8}
            required
          />
        </label>
        {error ? <p className="lw-form-error">{error}</p> : null}
        <button type="submit" className="lw-btn primary w-full justify-center" disabled={busy}>
          {busy ? 'Working...' : isSignup ? 'Create account' : 'Login'}
        </button>
        <p className="text-center text-sm text-white/55">
          {isSignup ? 'Already have an account?' : 'Need an account?'}{' '}
          <Link className="text-[var(--color-primary-light)]" to={isSignup ? '/login' : '/signup'}>
            {isSignup ? 'Login' : 'Sign up'}
          </Link>
        </p>
      </form>
    </div>
  );
}
