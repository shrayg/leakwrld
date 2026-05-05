import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { getSupabase, isSupabaseBrowserConfigured } from '../lib/supabaseClient';
import { setApiAccessTokenGetter } from '../api/client';

const SupabaseAuthContext = createContext(null);

export function SupabaseAuthProvider({ children }) {
  const supabase = useMemo(() => getSupabase(), []);
  const configured = isSupabaseBrowserConfigured() && !!supabase;
  const [session, setSession] = useState(null);

  useEffect(() => {
    if (!supabase) {
      setSession(null);
      return undefined;
    }
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSession(data.session ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      setSession(sess ?? null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  useLayoutEffect(() => {
    if (!configured || !session?.access_token) {
      setApiAccessTokenGetter(() => null);
      return;
    }
    const token = session.access_token;
    setApiAccessTokenGetter(() => token);
  }, [configured, session]);

  const applySessionTokens = useCallback(
    async (tokens) => {
      if (!supabase || !tokens?.access_token || !tokens?.refresh_token) return false;
      const { error } = await supabase.auth.setSession({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      });
      return !error;
    },
    [supabase],
  );

  const signInOAuth = useCallback(
    async (provider) => {
      if (!supabase) return { error: new Error('Supabase not configured') };
      const redirectTo = `${window.location.origin}/auth/callback`;
      return supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
    },
    [supabase],
  );

  const signOutSupabase = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut().catch(() => {});
  }, [supabase]);

  const value = useMemo(
    () => ({
      supabase,
      session,
      configured,
      applySessionTokens,
      signInOAuth,
      signOutSupabase,
    }),
    [supabase, session, configured, applySessionTokens, signInOAuth, signOutSupabase],
  );

  return <SupabaseAuthContext.Provider value={value}>{children}</SupabaseAuthContext.Provider>;
}

export function useSupabaseAuth() {
  return useContext(SupabaseAuthContext);
}
