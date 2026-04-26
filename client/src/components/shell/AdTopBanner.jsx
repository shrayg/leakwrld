import { useEffect, useRef } from 'react';

/** Top ad slot — loads magsrv provider once (same as legacy index.html). */
export function AdTopBanner() {
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const s = document.createElement('script');
    s.async = true;
    s.type = 'application/javascript';
    s.src = 'https://a.magsrv.com/ad-provider.js';
    s.onload = () => {
      try {
        window.AdProvider = window.AdProvider || [];
        window.AdProvider.push({ serve: {} });
      } catch {
        /* ignore */
      }
    };
    document.body.appendChild(s);
  }, []);

  return (
    <div className="ad-top-banner" id="ad-top-banner">
      <div className="ad-top-inner">
        <ins className="eas6a97888e2" data-zoneid="5852668" />
      </div>
    </div>
  );
}
