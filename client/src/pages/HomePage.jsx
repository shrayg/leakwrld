import { Archive, ArrowRight, HardDrive, ShieldCheck, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet } from '../api';
import { CREATORS, SHORTS } from '../data/catalog';
import { ShortCard } from '../components/CreatorCard';
import { TopCreatorsGallery } from '../components/TopCreatorsGallery';
import { useHomeShortsPageSize } from '../hooks/useGridPageSize';
import { formatBytes, formatCount } from '../lib/metrics';

function HeroTile({ creator, delay }) {
  const [broken, setBroken] = useState(false);
  const showImage = Boolean(creator.thumbnail) && !broken;
  return (
    <Link
      to={`/creators/${creator.slug}`}
      className={`lw-hero-tile accent-${creator.accent || 'pink'}`}
      style={{ animationDelay: `${delay}ms` }}
      aria-label={`Open ${creator.name}`}
    >
      {showImage ? (
        <img
          src={creator.thumbnail}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          className="lw-hero-tile-img"
        />
      ) : null}
      <div className="lw-hero-tile-meta">
        <span>#{creator.rank}</span>
        <b>{creator.name}</b>
      </div>
    </Link>
  );
}

export function HomePage() {
  const [creators, setCreators] = useState(CREATORS);
  const [shorts, setShorts] = useState(SHORTS);
  const [shortsSeed, setShortsSeed] = useState('');
  const shortsSeedRef = useRef(
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  const fallbackStats = useMemo(() => {
    /** Conservative SSR fallback until /api/stats loads. */
    const seededFiles = CREATORS.reduce((sum, c) => sum + (c.mediaCount || 0), 0);
    return {
      creators: CREATORS.length,
      rawObjectCount: seededFiles,
      rawBytes: seededFiles * 63 * 1024 * 1024,
      categories: 8,
      backups: { cadence: 'daily', mirrored: true, reuploaded: true },
    };
  }, []);
  const [stats, setStats] = useState(fallbackStats);
  const shortsRowSize = useHomeShortsPageSize();

  useEffect(() => {
    document.title = 'Leak World';
    apiGet('/api/creators?sort=top_views', { creators: CREATORS }).then((data) => {
      const rows = Array.isArray(data?.creators) && data.creators.length ? data.creators : CREATORS;
      setCreators(rows.map((creator, index) => ({ ...creator, rank: index + 1 })));
    });
    const seed = shortsSeedRef.current;
    apiGet(
      `/api/shorts/feed?limit=240&offset=0&seed=${encodeURIComponent(seed)}`,
      { shorts: SHORTS, page: { seed } },
    ).then((data) => {
      const feedShorts = Array.isArray(data?.shorts) ? data.shorts : [];
      if (feedShorts.length) setShorts(feedShorts);
      else setShorts(SHORTS);
      setShortsSeed(String(data?.page?.seed || seed));
    });
    apiGet('/api/stats', fallbackStats).then((data) => setStats({ ...fallbackStats, ...data }));
  }, [fallbackStats]);

  const rowShorts = useMemo(() => shorts.slice(0, Math.max(1, shortsRowSize)), [shorts, shortsRowSize]);

  /** Hero feature row: prefer the highest-ranked creators that have a real thumbnail
   *  so the marquee never shows a placeholder gradient next to a real photo. Falls
   *  back to top-ranked if fewer than 6 have thumbnails. */
  const heroCreators = useMemo(() => {
    const withThumb = creators.filter((c) => c.thumbnail).slice(0, 6);
    if (withThumb.length >= 6) return withThumb;
    const remaining = creators.filter((c) => !c.thumbnail).slice(0, 6 - withThumb.length);
    return [...withThumb, ...remaining];
  }, [creators]);

  return (
    <div className="space-y-8">
      <div className="hidden space-y-4 lg:block">
        <section className="lw-hero lw-home-hero">
          <div className="lw-hero-media">
            <div className="lw-hero-window">
              {heroCreators.map((creator, index) => (
                <HeroTile key={creator.slug} creator={creator} delay={index * 80} />
              ))}
            </div>
          </div>

          <div className="lw-hero-copy">
            <h1>The most trusted source for leaks.</h1>
            <p>
              Every file is mirrored, backed up, and re-uploaded to our archive the moment it drops. Nothing
              disappears, nothing gets taken down — the most complete leaks library on the internet, with free previews
              and full premium access.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link to="/categories" className="lw-btn primary">
                Browse creators
                <ArrowRight size={16} />
              </Link>
              <Link to="/shorts" className="lw-btn ghost">
                Watch shorts
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lw-stat lw-stat--row">
            <div className="lw-stat-top">
              <Archive size={18} aria-hidden />
              <b>{formatCount(stats.rawObjectCount)}</b>
            </div>
            <span>Files in the archive</span>
          </div>
          <div className="lw-stat lw-stat--row">
            <div className="lw-stat-top">
              <HardDrive size={18} aria-hidden />
              <b>{formatBytes(stats.rawBytes)}</b>
            </div>
            <span>Total content backed up</span>
          </div>
          <div className="lw-stat lw-stat--row">
            <div className="lw-stat-top">
              <Users size={18} aria-hidden />
              <b>{formatCount(stats.creators)}</b>
            </div>
            <span>Creators tracked</span>
          </div>
          <div className="lw-stat lw-stat--row">
            <div className="lw-stat-top">
              <ShieldCheck size={18} aria-hidden />
              <b>Daily</b>
            </div>
            <span>Mirrored and re-uploaded</span>
          </div>
        </section>
      </div>

      <section className="lw-section">
        <div className="lw-section-head">
          <div>
            <span className="lw-eyebrow">Featured</span>
            <h2>Top creators</h2>
          </div>
          <Link to="/categories" className="lw-link">
            View all
            <ArrowRight size={15} />
          </Link>
        </div>
        <TopCreatorsGallery creators={creators} />
      </section>

      <section className="lw-section">
        <div className="lw-section-head">
          <div>
            <span className="lw-eyebrow">Shorts</span>
            <h2>Short previews</h2>
          </div>
          <Link to="/shorts" className="lw-link">
            Open shorts
            <ArrowRight size={15} />
          </Link>
        </div>
        <div className="lw-home-shorts-grid">
          {rowShorts.map((item, index) => (
            <ShortCard
              key={item.id}
              item={item}
              index={index}
              className="lw-home-short-card"
              to={`/shorts?v=${encodeURIComponent(item.id)}${
                shortsSeed ? `&s=${encodeURIComponent(shortsSeed)}` : ''
              }`}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
