import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
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
  const [creatorSearch, setCreatorSearch] = useState('');

  useEffect(() => {
    document.title = 'OnlyFans Leaks — Pornwrld';
    document.body.classList.add('is-onlyfans-page');
    return () => {
      document.title = 'Pornwrld';
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
    async (creator) => {
      try {
        await fetch('/api/onlyfans-creators/view', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: creator.slug || '' }),
        });
      } catch {
        // non-critical stats endpoint
      }
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

  const filteredCreators = useMemo(() => {
    const q = creatorSearch.trim().toLowerCase();
    if (!q) return creators;
    return creators.filter((c) => String(c.name || '').toLowerCase().includes(q));
  }, [creators, creatorSearch]);

  return (
    <main className="page-content folder-page onlyfans-page px-4 pb-20 pt-6 max-[640px]:px-3">
      <div className="folder-header pornwrld-folder-head">
        <h1 className="pornwrld-page-title">OnlyFans Leaks</h1>
      </div>

      <div className="folder-toolbar">
        <div className="folder-sort-bar">
          <label>Section:</label>
          <button type="button" className="sort-btn active">
            Creators
          </button>
        </div>
        <div className="folder-video-search">
          <label htmlFor="onlyfans-creator-search">Search creators:</label>
          <input
            id="onlyfans-creator-search"
            type="text"
            className="folder-video-search-input"
            placeholder="Search by creator name..."
            value={creatorSearch}
            onChange={(e) => setCreatorSearch(e.target.value)}
          />
        </div>
      </div>

      {loadErr ? (
        <p className="onlyfans-page__err" role="alert">
          {loadErr}
        </p>
      ) : null}

      {!loading && isAuthed && (tier || 0) < 2 && (
        <div className="of-upgrade-banner">
          <span className="of-upgrade-banner-lock" aria-hidden>
            🔒
          </span>
          <div className="of-upgrade-banner-copy">
            <strong>Premium required</strong> to open Mega folders.{' '}
            <button
              type="button"
              className="of-upgrade-banner-link"
              onClick={() => navigate('/checkout?plan=premium')}
            >
              Upgrade
            </button>
            {' · '}
            <button type="button" className="of-upgrade-banner-link" onClick={() => openReferral()}>
              Referrals
            </button>
          </div>
        </div>
      )}

      <div className="of-creator-grid" aria-busy={filteredCreators.length === 0 && !loadErr}>
        {filteredCreators.length === 0 && !loadErr ? (
          <div className="of-loading">
            <div className="of-spinner" />
            <p>{creators.length ? 'No creators match that search.' : 'Loading creators…'}</p>
          </div>
        ) : null}
        {filteredCreators.map((c) => (
          <button
            key={c.slug || c.name}
            type="button"
            className="media-item video-item of-creator-card folder-card--locked"
            aria-label={c.name}
            onClick={() => onCreatorClick(c)}
          >
            <div className="media-thumb-wrapper">
              {c.thumbUrl ? (
                <img
                  className="media-thumb of-creator-thumb"
                  src={c.thumbUrl}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    const el = e.currentTarget;
                    const candidates = c.thumbUrlR2Candidates || (c.thumbUrlR2 ? [c.thumbUrlR2] : []);
                    const placeholder = '/assets/images/face.png';
                    const idx = parseInt(el.dataset.ofThumbR2Index || '0', 10);

                    if (!candidates.length) {
                      el.src = placeholder;
                      return;
                    }
                    if (Number.isNaN(idx) || idx >= candidates.length) {
                      el.src = placeholder;
                      return;
                    }
                    el.dataset.ofThumbR2Index = String(idx + 1);
                    el.src = candidates[idx];
                  }}
                />
              ) : (
                <div className="of-creator-thumb of-creator-thumb--placeholder" aria-hidden />
              )}
              <div className="play-icon" />
              <div className="folder-card-lock-overlay" aria-hidden="true">
                <Lock className="folder-card-lock-icon-svg" size={32} strokeWidth={2.4} />
                <span className="folder-card-lock-text">Premium only</span>
              </div>
            </div>
            <div className="media-info">
              <h3 className="media-title">{c.name}</h3>
              <div className="media-stats-row">
                <span className="media-stat-tag media-stat-category">Creator</span>
                <span className="media-stat-tag media-stat-views">
                  {Number(c.views || 0).toLocaleString()} views
                </span>
              </div>
            </div>
          </button>
        ))}
        {creatorsLoaded && !loadErr ? (
          <div className="of-creator-card of-creator-teaser" aria-label="More creators coming soon">
            <div className="of-teaser-thumb">
              <img
                className="of-teaser-blur"
                src="/assets/images/preview.jpg"
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
      <section className="folder-seo" aria-label="OnlyFans description">
        <p className="seo-intro" style={{ color: '#999', lineHeight: 1.7 }}>
          Browse OnlyFans leaks by creator on Pornwrld — open full archives with Premium Tier 2 access.
        </p>
      </section>
    </main>
  );
}
