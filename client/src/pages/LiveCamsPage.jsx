import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCams } from '../api/client';
import { PageHero } from '../components/layout/PageHero';

const FALLBACK_MODELS = ['alice_dusk_', 'kiradivine', 'vesia', 'polynessia', 'kii_wii', 'itssheababy', 'melon_mussy'];
const CB_BASE = 'https://chaturbate.com/in/?tour=LQps&campaign=PAhNg&track=default';

export function LiveCamsPage() {
  const [imgRoom, setImgRoom] = useState('alice_dusk_');
  const [href, setHref] = useState(CB_BASE + '&room=alice_dusk_');
  const [viewers, setViewers] = useState(2800);

  useEffect(() => {
    document.body.classList.add('is-live-cams-page');
    return () => document.body.classList.remove('is-live-cams-page');
  }, []);

  useEffect(() => {
    document.title = 'Pornwrld — Live Cams';
    let cancelled = false;
    (async () => {
      const r = await fetchCams(5);
      if (cancelled || !r.ok || !r.data?.results?.length) {
        const pick = FALLBACK_MODELS[Math.floor(Math.random() * FALLBACK_MODELS.length)];
        setImgRoom(pick);
        setHref(`${CB_BASE}&room=${pick}`);
        return;
      }
      const results = r.data.results || r.data.rooms || [];
      const pick = results[Math.floor(Math.random() * results.length)];
      setImgRoom(pick.username);
      setHref(`${CB_BASE}&room=${pick.username}`);
      if (pick.num_users) setViewers(Number(pick.num_users));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setViewers((v) => {
        let n = v + Math.floor(Math.random() * 40) - 18;
        if (n < 1200) n = 1200;
        return n;
      });
    }, 4000);
    return () => clearInterval(id);
  }, []);

  return (
    <main className="page-content live-cams-route">
      <PageHero title="Live cams" subtitle="External partner stream — opens in a new tab." />
      <div className="lc-wrapper pornwrld-lc-wrap">
        <div className="lc-live-badge">
          <span className="lc-live-dot" />
          Live Now
        </div>

        <a href={href} target="_blank" rel="noopener noreferrer" className="lc-hero-link">
          <img
            className="lc-hero-img"
            src={'/api/cam-img?room=' + encodeURIComponent(imgRoom)}
            alt=""
            onError={(e) => {
              e.target.onerror = null;
              e.target.src = '/api/cam-img?room=kiradivine';
            }}
          />
          <span className="lc-hero-live">LIVE</span>
          <span className="lc-hero-viewers">{viewers.toLocaleString()} watching</span>
          <div className="lc-hero-overlay">
          <div className="rounded-[var(--pornwrld-radius-card)] bg-[linear-gradient(180deg,#f6d486_0%,#f3c669_100%)] px-12 py-4 text-lg font-extrabold uppercase tracking-[0.06em] text-[#17181a]">
            Click Here to Watch Live
          </div>
          </div>
        </a>

        <p className="lc-sub">Free live cams • No signup required • 4,200+ models online</p>
      </div>

      <div className="lc-upsell">
        <div className="lc-upsell-inner">
          <h3>Want Exclusive Videos?</h3>
          <p>Unlock Premium Tier 2 (5,000+ videos, including OnlyFans leaks) or Basic Tier 1 (1,000+ videos).</p>
          <Link to="/checkout" className="lc-upsell-btn">
            Get Premium Now
          </Link>
        </div>
      </div>
    </main>
  );
}
