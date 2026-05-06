import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { fetchNewest, fetchRandomVideos, fetchAllViewsRankedVideos, RANDOM_VIDEOS_PAGE_LIMIT } from '../api/client';
import { HomepageMediaTile } from '../components/home/HomepageMediaTile';
import { videoCardStableKey } from '../components/media/VideoCard';
import { folderDisplayName } from '../lib/cleanUrls';
import { sortFiles } from '../lib/folderMedia';
import { useResponsiveGridPageSize } from '../hooks/useResponsiveGridPageSize';

function readVideoSectionPage(sp) {
  const n = parseInt(String(sp.get('page') || '1'), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

const SECTION_SORT_OPTIONS = [
  { key: 'recent', label: 'Recent' },
  { key: 'views', label: 'Most viewed' },
  { key: 'likes', label: 'Most liked' },
  { key: 'longest', label: 'Longest' },
  { key: 'shortest', label: 'Shortest' },
];

const CONFIG = {
  recommended: {
    title: 'Recommended',
    seo: 'Browse recommended videos on Pornwrld — curated picks updated regularly.',
    load: async () =>
      fetchRandomVideos({
        limit: String(RANDOM_VIDEOS_PAGE_LIMIT),
        page: '0',
        sort: 'top_random',
        topPercent: '35',
      }),
  },
  popular: {
    title: 'Popular',
    seo: 'Browse popular videos on Pornwrld — top-performing content by views.',
    load: fetchAllViewsRankedVideos,
  },
  newlyAdded: {
    title: 'Newly Added',
    seo: 'Browse newly added videos on Pornwrld — latest uploads in one place.',
    load: async () => fetchNewest(RANDOM_VIDEOS_PAGE_LIMIT),
  },
  random: {
    title: 'Random Video',
    seo: 'Discover random videos on Pornwrld — load a fresh random pick anytime.',
    load: async () =>
      fetchRandomVideos({
        limit: String(RANDOM_VIDEOS_PAGE_LIMIT),
        page: '0',
        sort: 'random',
      }),
  },
};

export function VideoSectionPage({ variant = 'recommended' }) {
  const cfg = CONFIG[variant] || CONFIG.recommended;
  const pageSize = useResponsiveGridPageSize(6);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const listReturnPath = `${location.pathname}${location.search}`;
  const prevVariantRef = useRef(null);
  const [allFiles, setAllFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState('recent');
  const [videoSearch, setVideoSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [page, setPageState] = useState(() => readVideoSectionPage(searchParams));

  useEffect(() => {
    setPageState(readVideoSectionPage(searchParams));
  }, [searchParams]);

  useEffect(() => {
    if (prevVariantRef.current != null && prevVariantRef.current !== variant) {
      setSearchParams((prev) => {
        const out = new URLSearchParams(prev);
        out.delete('page');
        return out;
      }, { replace: true });
      setPageState(1);
    }
    prevVariantRef.current = variant;
  }, [variant, setSearchParams]);

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
    setSearchParams((prev) => {
      const out = new URLSearchParams(prev);
      out.delete('page');
      return out;
    }, { replace: true });
    setPageState(1);
    setCategoryFilter('all');
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);

  const categoryOptions = useMemo(() => {
    const set = new Set();
    for (const f of allFiles) {
      const folder = String(f.folder || '').trim();
      if (folder) set.add(folder);
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [allFiles]);

  const filteredFiles = useMemo(() => {
    let list = allFiles;
    if (categoryFilter !== 'all') {
      list = list.filter((f) => String(f.folder || '') === categoryFilter);
    }
    const q = videoSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((f) => String(f.title || f.name || '').toLowerCase().includes(q));
    }
    return sortFiles(list, sortKey);
  }, [allFiles, sortKey, videoSearch, categoryFilter]);

  const commitSectionPage = useCallback(
    (nextPage) => {
      const tp = Math.max(1, Math.ceil(filteredFiles.length / pageSize));
      const clamped = Math.max(1, Math.min(tp, nextPage));
      setPageState(clamped);
      setSearchParams((prev) => {
        const out = new URLSearchParams(prev);
        if (clamped <= 1) out.delete('page');
        else out.set('page', String(clamped));
        return out;
      }, { replace: true });
    },
    [filteredFiles.length, pageSize, setSearchParams],
  );

  const totalPages = Math.max(1, Math.ceil(filteredFiles.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const items = filteredFiles.slice(start, start + pageSize);

  return (
    <div className="page-content folder-page">
      <div className="folder-header pornwrld-folder-head">
        <h1 className="pornwrld-page-title">{cfg.title}</h1>
      </div>

      <div className="folder-toolbar">
        <div className="folder-sort-bar">
          <label>Sort by:</label>
          {SECTION_SORT_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={'sort-btn' + (sortKey === key ? ' active' : '')}
              onClick={() => {
                setSortKey(key);
                commitSectionPage(1);
              }}
            >
              {label}
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
              commitSectionPage(1);
            }}
          />
        </div>
      </div>

      {categoryOptions.length > 1 ? (
        <div className="folder-category-filter video-section-category-filter">
          <label htmlFor={`video-section-category-${variant}`}>Category:</label>
          <select
            id={`video-section-category-${variant}`}
            className="category-filter-select"
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              commitSectionPage(1);
            }}
          >
            <option value="all">All categories</option>
            {categoryOptions.map((f) => (
              <option key={f} value={f}>
                {folderDisplayName(f)}
              </option>
            ))}
          </select>
        </div>
      ) : null}

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
            <HomepageMediaTile
              key={videoCardStableKey(item, idx)}
              file={item}
              badgeType={variant === 'newlyAdded' ? 'new' : ''}
              listReturnPath={listReturnPath}
            />
          ))}
        </div>
      ) : null}

      {!loading && !error && filteredFiles.length > 0 ? (
        <p className="video-section-count" style={{ color: '#999', fontSize: '13px', marginTop: 12 }}>
          {totalPages <= 1
            ? `Showing ${filteredFiles.length} video${filteredFiles.length === 1 ? '' : 's'}`
            : `Showing ${start + 1}–${start + items.length} of ${filteredFiles.length}`}
        </p>
      ) : null}

      {!loading && !error && totalPages > 1 ? (
        <div className="pagination-controls">
          <button type="button" disabled={safePage <= 1} onClick={() => commitSectionPage(safePage - 1)}>
            Back
          </button>
          <span className="folder-page-count">
            Page {safePage} / {totalPages}
          </span>
          <button type="button" disabled={safePage >= totalPages} onClick={() => commitSectionPage(safePage + 1)}>
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
