import { createClient } from '@supabase/supabase-js';

let singleton = null;

export function isSupabaseBrowserConfigured() {
  return !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

/** Browser Supabase client (anon key). Returns null if env not set. */
export function getSupabase() {
  if (singleton) return singleton;
  const url = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
  const anon = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!url || !anon) return null;
  singleton = createClient(url, anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });
  return singleton;
}
