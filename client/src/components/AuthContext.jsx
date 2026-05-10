import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api';

const AuthContext = createContext(null);

const GATE_DISMISS_KEY = 'lw_auth_gate_dismissed';
const AUTO_GATE_SUPPRESSED_PATHS = new Set(['/shorts']);

function suppressAutoGateForCurrentPath() {
  if (typeof window === 'undefined') return false;
  return AUTO_GATE_SUPPRESSED_PATHS.has(window.location.pathname);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState('signup');

  async function refresh() {
    setLoading(true);
    const data = await apiGet('/api/session', { authed: false, user: null });
    setUser(data?.user || null);
    setLoading(false);
  }

  async function logout() {
    await apiPost('/api/auth/logout');
    setUser(null);
  }

  const openAuthModal = useCallback((mode = 'signup') => {
    setAuthModalMode(mode === 'login' ? 'login' : 'signup');
    setAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setAuthModalOpen(false);
    try {
      sessionStorage.setItem(GATE_DISMISS_KEY, '1');
    } catch (_) {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (user) {
      setAuthModalOpen(false);
      return;
    }
    if (loading) return;
    try {
      if (sessionStorage.getItem(GATE_DISMISS_KEY)) return;
    } catch (_) {
      /* ignore */
    }
    if (suppressAutoGateForCurrentPath()) {
      setAuthModalOpen(false);
      return;
    }
    setAuthModalMode('signup');
    setAuthModalOpen(true);
  }, [loading, user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        authed: !!user,
        refresh,
        logout,
        authModalOpen,
        authModalMode,
        setAuthModalMode,
        openAuthModal,
        closeAuthModal,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
