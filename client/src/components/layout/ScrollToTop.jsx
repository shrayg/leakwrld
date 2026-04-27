import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * On SPA navigations (footer, nav, etc.), restore scroll to the top smoothly
 * instead of inheriting the previous page’s scroll position.
 */
export function ScrollToTop() {
  const { pathname, search, hash } = useLocation();

  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname, search, hash]);

  return null;
}
