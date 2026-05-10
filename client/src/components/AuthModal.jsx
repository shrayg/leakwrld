import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { apiPost } from '../api';
import { getVisitorKey, recordEvent } from '../lib/analytics';
import { useAuth } from './AuthContext';

export function AuthModal() {
  const location = useLocation();
  const {
    authModalOpen,
    authModalMode,
    setAuthModalMode,
    closeAuthModal,
    refresh,
    user,
  } = useAuth();

  const isSignup = authModalMode === 'signup';
  const [form, setForm] = useState({
    email: '',
    username: '',
    identifier: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldownSec, setCooldownSec] = useState(0);

  useEffect(() => {
    if (cooldownSec <= 0) return;
    const t = setInterval(() => {
      setCooldownSec((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [cooldownSec]);

  useEffect(() => {
    if (!authModalOpen || user) return;
    recordEvent('auth_modal', {
      category: 'auth',
      payload: { mode: authModalMode },
    });
  }, [authModalOpen, authModalMode, user]);

  useEffect(() => {
    if (!authModalOpen || user) return;
    function onKey(e) {
      if (e.key === 'Escape') closeAuthModal();
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [authModalOpen, user, closeAuthModal]);

  if (!authModalOpen || user) return null;

  async function submit(e) {
    e.preventDefault();
    if (cooldownSec > 0) return;
    setBusy(true);
    setError('');
    try {
      const refTrim = new URLSearchParams(location.search).get('ref')?.trim();
      if (isSignup) {
        await apiPost('/api/auth/signup', {
          email: form.email.trim() || undefined,
          username: form.username,
          password: form.password,
          confirmPassword: form.confirmPassword,
          ...(refTrim ? { referralCode: refTrim } : {}),
          visitorKey: getVisitorKey(),
          referrer: typeof document !== 'undefined' ? document.referrer || undefined : undefined,
        });
      } else {
        await apiPost('/api/auth/login', {
          identifier: form.identifier,
          password: form.password,
          visitorKey: getVisitorKey(),
          referrer: typeof document !== 'undefined' ? document.referrer || undefined : undefined,
        });
      }
      await refresh();
      closeAuthModal();
    } catch (err) {
      setError(err.message || 'Authentication failed');
      const retry = Number(err.retryAfterSeconds);
      if (retry > 0) {
        setCooldownSec(Math.ceil(retry));
      }
    } finally {
      setBusy(false);
    }
  }

  const blocked = cooldownSec > 0;

  return (
    <div className="lw-auth-modal-root" role="presentation">
      <div className="lw-auth-modal-backdrop" aria-hidden />
      <div
        className="lw-auth-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="lw-auth-modal-close"
          onClick={closeAuthModal}
          aria-label="Close"
        >
          <X size={18} strokeWidth={2} />
        </button>

        <h2 id="auth-modal-title" className="lw-auth-modal-title">
          Login or sign up to view all content
        </h2>
        <p className="lw-auth-modal-lede">
          {isSignup
            ? 'Create a free account for previews across the archive. Your personal referral code is created automatically after you sign up.'
            : 'Welcome back — sign in with your email or username.'}
        </p>

        <div className="lw-auth-modal-tabs" role="tablist" aria-label="Account">
          <button
            type="button"
            role="tab"
            aria-selected={!isSignup}
            className={`lw-auth-modal-tab ${!isSignup ? 'active' : ''}`}
            onClick={() => {
              setAuthModalMode('login');
              setError('');
            }}
          >
            Login
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isSignup}
            className={`lw-auth-modal-tab ${isSignup ? 'active' : ''}`}
            onClick={() => {
              setAuthModalMode('signup');
              setError('');
            }}
          >
            Sign up
          </button>
        </div>

        <form className="lw-form lw-auth-modal-form" onSubmit={submit}>
          {isSignup ? (
            <>
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
                <span className="lw-form-label-title">
                  Email{' '}
                  <span className="text-white/45">(optional)</span>
                </span>
                <input
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="you@example.com"
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
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              minLength={8}
              required
            />
          </label>
          {isSignup ? (
            <label>
              Confirm password
              <input
                type="password"
                autoComplete="new-password"
                value={form.confirmPassword}
                onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                minLength={8}
                required
              />
            </label>
          ) : null}
          {error ? <p className="lw-form-error">{error}</p> : null}
          <button
            type="submit"
            className="lw-btn primary w-full justify-center"
            disabled={busy || blocked}
          >
            {busy
              ? 'Working...'
              : blocked
                ? `Wait ${cooldownSec}s and try again`
                : isSignup
                  ? 'Create account'
                  : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}
