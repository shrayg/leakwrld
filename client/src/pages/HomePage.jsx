import { Archive, ArrowRight, HardDrive, ShieldCheck, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet } from '../api';
import { CREATORS, SHORTS } from '../data/catalog';
import { CreatorCard, ShortCard } from '../components/CreatorCard';
import { GridPagination } from '../components/GridPagination';
import { TopCreatorsGallery } from '../components/TopCreatorsGallery';
import { useCatalogGridPageSize, useHomeShortsPageSize } from '../hooks/useGridPageSize';
import { formatBytes, formatCount } from '../lib/metrics';

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
  const [creatorPage, setCreatorPage] = useState(1);
  const creatorPageSize = useCatalogGridPageSize();
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

  const creatorTotalPages = Math.max(1, Math.ceil(creators.length / creatorPageSize));
  const creatorPageClamped = Math.min(creatorPage, creatorTotalPages);
  const pagedCreators = useMemo(() => {
    const start = (creatorPageClamped - 1) * creatorPageSize;
    return creators.slice(start, start + creatorPageSize);
  }, [creators, creatorPageClamped, creatorPageSize]);

  const rowShorts = useMemo(() => shorts.slice(0, Math.max(1, shortsRowSize)), [shorts, shortsRowSize]);

  useEffect(() => {
    if (creatorPage > creatorTotalPages) setCreatorPage(creatorTotalPages);
  }, [creatorPage, creatorTotalPages]);

  const creatorRangeStart = creators.length === 0 ? 0 : (creatorPageClamped - 1) * creatorPageSize + 1;
  const creatorRangeEnd = creators.length === 0 ? 0 : Math.min(creators.length, creatorPageClamped * creatorPageSize);

  return (
    <div className="space-y-8">
      <div className="hidden space-y-4 lg:block">
        <section className="lw-hero lw-home-hero">
          <div className="lw-hero-media">
            <div className="lw-hero-window lw-hero-window--gallery">
              <TopCreatorsGallery creators={creators} variant="hero" />
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
        <div className="lw-creator-grid">
          {pagedCreators.map((creator) => (
            <CreatorCard key={creator.slug} creator={creator} />
          ))}
        </div>
        <GridPagination
          idPrefix="home-creators"
          page={creatorPageClamped}
          totalPages={creatorTotalPages}
          onPrev={() => setCreatorPage((p) => Math.max(1, p - 1))}
          onNext={() => setCreatorPage((p) => Math.min(creatorTotalPages, p + 1))}
          summary={
            <span className="text-[13px] text-white/70">
              Showing {formatCount(creatorRangeStart)}-{formatCount(creatorRangeEnd)} of {formatCount(creators.length)}{' '}
              creators
            </span>
          }
        />
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
