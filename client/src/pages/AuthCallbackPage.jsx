import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSupabaseAuth } from '../context/SupabaseAuthProvider';

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { supabase, configured } = useSupabaseAuth();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!configured || !supabase) {
        navigate('/', { replace: true });
        return;
      }
      const { data } = await supabase.auth.getSession();
      const tok = data.session?.access_token;
      if (!tok || cancelled) {
        navigate('/?auth_error=1', { replace: true });
        return;
      }
      await fetch('/api/auth/sync-profile', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tok}`,
        },
        body: '{}',
      });
      if (!cancelled) navigate('/?welcome=1', { replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [configured, supabase, navigate]);

  return (
    <div className="page-content page-shell" style={{ padding: 48, textAlign: 'center' }}>
      <p style={{ color: 'var(--pornwrld-muted, #999)' }}>Completing sign-in…</p>
    </div>
  );
}
