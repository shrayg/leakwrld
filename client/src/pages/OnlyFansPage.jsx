import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHero } from '../components/layout/PageHero';
import { useAuth } from '../hooks/useAuth';
import { useShell } from '../context/ShellContext';

/**
 * OnlyFans leaks hub — creator grid from /api/onlyfans-creators; tier 2 opens mega via /api/onlyfans-mega.
 * Ported from legacy onlyfans.html to match main branch behavior inside the Vite SPA.
 */
export function OnlyFansPage() {
  const { isAuthed, tier, loading } = useAuth();
  const { openAuth, openReferral } = useShell();
  const navigate = useNavigate();
  const [creators, setCreators] = useState([]);
  const [loadErr, setLoadErr] = useState(null);
  const [creatorsLoaded, setCreatorsLoaded] = useState(false);

  useEffect(() => {
    document.title = 'OnlyFans Leaks — Pornyard';
    document.body.classList.add('is-onlyfans-page');
    return () => {
      document.title = 'Pornyard';
      document.body.classList.remove('is-onlyfans-page');
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/onlyfans-creators', { cache: 'no-store' });
        const d = r.ok ? await r.json() : { creators: [] };
        if (!cancelled) setCreators(Array.isArray(d.creators) ? d.creators : []);
      } catch (e) {
        if (!cancelled) setLoadErr('Could not load creators.');
      } finally {
        if (!cancelled) setCreatorsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onCreatorClick = useCallback(
    async (_creator) => {
      if (!isAuthed) {
        openAuth('signup');
        return;
      }
      const t = tier || 0;
      if (t >= 2) {
        try {
          const r = await fetch('/api/onlyfans-mega', { credentials: 'include', cache: 'no-store' });
          const d = await r.json();
          if (d.url) window.open(d.url, '_blank', 'noopener,noreferrer');
          else alert('Link not available right now — check back soon.');
        } catch {
          alert('Error fetching link. Try again.');
        }
        return;
      }
      navigate('/checkout?plan=premium');
    },
    [isAuthed, tier, navigate, openAuth],
  );

  return (
    <main className="page-shell onlyfans-page">
      <PageHero
        title="OnlyFans Leaks"
        subtitle="Browse by creator — tap a name to open the full leak archive (Premium Tier 2)."
      />

      {loadErr ? (
        <p className="onlyfans-page__err" role="alert">
          {loadErr}
        </p>
      ) : null}

      {!loading && isAuthed && (tier || 0) < 2 && (
        <div className="onlyfans-page__notice">
          <span className="onlyfans-page__notice-lock" aria-hidden>
            🔒
          </span>
          <div>
            <strong>Premium required</strong> to open Mega folders.{' '}
            <button type="button" className="link-btn" onClick={() => navigate('/checkout?plan=premium')}>
              Upgrade
            </button>
            {' · '}
            <button type="button" className="link-btn" onClick={() => openReferral()}>
              Referrals
            </button>
          </div>
        </div>
      )}

      <div className="of-creator-grid" aria-busy={creators.length === 0 && !loadErr}>
        {creators.length === 0 && !loadErr ? (
          <div className="of-loading">
            <div className="of-spinner" />
            <p>Loading creators…</p>
          </div>
        ) : null}
        {creators.map((c) => (
          <button
            key={c.slug || c.name}
            type="button"
            className="of-creator-card"
            aria-label={c.name}
            onClick={() => onCreatorClick(c)}
          >
            {c.thumbUrl ? (
              <img className="of-creator-thumb" src={c.thumbUrl} alt="" loading="lazy" />
            ) : (
              <div className="of-creator-thumb of-creator-thumb--placeholder" aria-hidden />
            )}
            <div className="of-creator-name">{c.name}</div>
          </button>
        ))}
        {creatorsLoaded && !loadErr ? (
          <div className="of-creator-card of-creator-teaser" aria-label="More creators coming soon">
            <div className="of-teaser-thumb">
              <img
                className="of-teaser-blur"
                src="/images/preview.jpg"
                alt=""
                loading="lazy"
                decoding="async"
              />
              <span className="of-teaser-qmark" aria-hidden>
                ?
              </span>
            </div>
            <div className="of-creator-name of-creator-teaser-label">More coming soon</div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
