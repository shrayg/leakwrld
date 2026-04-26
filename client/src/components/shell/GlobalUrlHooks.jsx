import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useShell } from '../../context/ShellContext';
import { useAuth } from '../../hooks/useAuth';

/** Handles legacy query params: ?login=1, ?welcome=1, ?ref= */
export function GlobalUrlHooks() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { openAuth, openReferral } = useShell();
  const { isAuthed, loading } = useAuth();

  useEffect(() => {
    const ref = searchParams.get('ref');
    if (ref) sessionStorage.setItem('tbw_has_ref', '1');

    const login = searchParams.get('login');
    if (login === '1') {
      openAuth('login');
      const next = new URLSearchParams(searchParams);
      next.delete('login');
      setSearchParams(next, { replace: true });
    }

    const welcome = searchParams.get('welcome');
    if (welcome === '1') {
      sessionStorage.setItem('tbw_show_ref_tutorial', '1');
      const next = new URLSearchParams(searchParams);
      next.delete('welcome');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, openAuth]);

  useEffect(() => {
    if (loading) return;
    if (!isAuthed) return;
    if (sessionStorage.getItem('tbw_show_ref_tutorial') === '1') {
      sessionStorage.removeItem('tbw_show_ref_tutorial');
      openReferral();
    }
  }, [loading, isAuthed, openReferral]);

  return null;
}
