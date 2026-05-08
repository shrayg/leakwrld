import { createContext, useContext, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    refresh();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, authed: !!user, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
