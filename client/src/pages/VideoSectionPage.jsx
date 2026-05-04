import { useEffect, useMemo, useState } from 'react';
import { fetchNewest, fetchRandomVideos } from '../api/client';
import { HomepageMediaTile } from '../components/home/HomepageMediaTile';
import { videoCardStableKey } from '../components/media/VideoCard';
import { sortFiles } from '../lib/folderMedia';

const PAGE_SIZE = 24;

const CONFIG = {
  recommended: {
    title: 'Recommended',
    seo: 'Browse recommended videos on Pornwrld — curated picks updated regularly.',
    load: async () => fetchRandomVideos({ limit: '120', page: '0', sort: 'top_random', topPercent: '20' }),
  },
  popular: {
    title: 'Popular',
    seo: 'Browse popular videos on Pornwrld — top-performing content refreshed frequently.',
    load: async () => fetchRandomVideos({ limit: '120', page: '0', sort: 'top_random', topPercent: '5' }),
  },
  newlyAdded: {
    title: 'Newly Added',
    seo: 'Browse newly added videos on Pornwrld — latest uploads in one place.',
    load: async () => fetchNewest(120),
  },
  random: {
    title: 'Random Video',
    seo: 'Discover random videos on Pornwrld — load a fresh random pick anytime.',
    load: async () => fetchRandomVideos({ limit: '120', page: '0', sort: 'random' }),
  },
};

export function VideoSectionPage({ variant = 'recommended' }) {
  const cfg = CONFIG[variant] || CONFIG.recommended;
  const [allFiles, setAllFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState('recent');
  const [videoSearch, setVideoSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    document.title = `${cfg.title} — Pornwrld`;
  }, [cfg.title]);

  async function load() {
    setLoading(true);
    setError('');
    const res = await cfg.load();
    setLoading(false);
    if (!res.ok) {
      setAllFiles([]);
      setError(`Could not load ${cfg.title.toLowerCase()} videos.`);
      return;
    }
    const list = Array.isArray(res.data?.files) ? res.data.files : [];
    setAllFiles(list);
    setPage(1);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);

  const filteredFiles = useMemo(() => {
    const q = videoSearch.trim().toLowerCase();
    const list = q
      ? allFiles.filter((f) => String(f.title || f.name || '').toLowerCase().includes(q))
      : allFiles;
    return sortFiles(list, sortKey);
  }, [allFiles, sortKey, videoSearch]);

  const totalPages = Math.max(1, Math.ceil(filteredFiles.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const items = filteredFiles.slice(start, start + PAGE_SIZE);

  return (
    <div className="page-content folder-page">
      <div className="folder-header pornwrld-folder-head">
        <h1 className="pornwrld-page-title">{cfg.title}</h1>
      </div>

      <div className="folder-toolbar">
        <div className="folder-sort-bar">
          <label>Sort by:</label>
          {['recent', 'likes', 'longest'].map((k) => (
            <button
              key={k}
              type="button"
              className={'sort-btn' + (sortKey === k ? ' active' : '')}
              onClick={() => {
                setSortKey(k);
                setPage(1);
              }}
            >
              {k === 'recent' ? 'Recent' : k === 'likes' ? 'Most Liked' : 'Longest'}
            </button>
          ))}
        </div>
        <div className="folder-video-search">
          <label htmlFor={`video-section-search-${variant}`}>Search videos:</label>
          <input
            id={`video-section-search-${variant}`}
            type="text"
            className="folder-video-search-input"
            placeholder="Search by video name..."
            value={videoSearch}
            onChange={(e) => {
              setVideoSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      {variant === 'random' ? (
        <div className="folder-toolbar" style={{ justifyContent: 'flex-end', marginTop: -6 }}>
          <button type="button" className="sort-btn active" onClick={load}>
            Load another random set
          </button>
        </div>
      ) : null}

      {loading && (
        <div className="media-grid folder-media-grid">
          <p style={{ gridColumn: '1/-1', textAlign: 'center', padding: 40 }}>Loading…</p>
        </div>
      )}

      {!loading && error ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <p>{error}</p>
        </div>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <h3>No videos found</h3>
        </div>
      ) : null}

      {!loading && !error && items.length > 0 ? (
        <div className="media-grid folder-media-grid">
          {items.map((item, idx) => (
            <HomepageMediaTile key={videoCardStableKey(item, idx)} file={item} badgeType={variant === 'newlyAdded' ? 'new' : ''} />
          ))}
        </div>
      ) : null}

      {!loading && !error && totalPages > 1 ? (
        <div className="pagination-controls">
          <button type="button" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Back
          </button>
          <span className="folder-page-count">
            Page {safePage} / {totalPages}
          </span>
          <button type="button" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            Next
          </button>
        </div>
      ) : null}

      <section className="folder-seo" aria-label={`${cfg.title} description`}>
        <p className="seo-intro" style={{ color: '#999', lineHeight: 1.7 }}>
          {cfg.seo}
        </p>
      </section>
    </div>
  );
}

