import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * On SPA navigations (footer, nav, etc.), restore scroll to the top smoothly
 * instead of inheriting the previous page’s scroll position.
 */
export function ScrollToTop() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
  }, [pathname, search]);

  return null;
}
