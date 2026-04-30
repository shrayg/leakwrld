import { useState, useEffect, useCallback } from 'react';
import { fetchMe } from '../api/client';

let cache = { user: null, loading: true, error: null };

export function useAuth() {
  const [state, setState] = useState(cache);

  const refresh = useCallback(async () => {
    cache = { ...cache, loading: true, error: null };
    setState({ ...cache });
    try {
      const { ok, data } = await fetchMe();
      if (!ok || !data) {
        cache = { user: null, loading: false, error: data?.error || 'unauthorized' };
        setState({ ...cache });
        return null;
      }
      const user = data.authed
        ? {
            authed: true,
            tier: data.tier,
            username: data.username,
            tierLabel: data.tierLabel,
            avatarUrl: String(data.avatarUrl ?? '').trim(),
          }
        : { authed: false };
      cache = { user, loading: false, error: null };
      setState({ ...cache });
      return user;
    } catch (e) {
      cache = { user: null, loading: false, error: String(e) };
      setState({ ...cache });
      return null;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    user: state.user,
    loading: state.loading,
    error: state.error,
    refresh,
    isAuthed: !!(state.user && state.user.authed),
    tier: state.user?.tier ?? 0,
  };
}
