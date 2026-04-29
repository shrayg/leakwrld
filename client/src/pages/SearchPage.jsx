import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { fetchRandomVideos, fetchVideoLibrary } from '../api/client';
import { useShell } from '../context/ShellContext';
import { HomepageMediaTile } from '../components/home/HomepageMediaTile';
import { videoCardStableKey } from '../components/media/VideoCard';
import { PageHero } from '../components/layout/PageHero';

const PAGE_SIZE = 50;

/** Maps UI sort buttons to /api/videos sort + order (matches script.js search page). */
function sortParams(uiSort) {
  if (uiSort === 'recent') return { sort: 'date', order: 'desc' };
  if (uiSort === 'rating') return { sort: 'rating', order: 'desc' };
  if (uiSort === 'longest') return { sort: 'size', order: 'desc' };
  return { sort: 'views', order: 'desc' };
}

export function SearchPage() {
  const { openReferral, openAuth } = useShell();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const qParam = searchParams.get('q') || '';
  const mode = (searchParams.get('mode') || '').toLowerCase();
  const isPopularMode = mode === 'popular';

  const [query, setQuery] = useState(qParam);
  const [sortUi, setSortUi] = useState('recent');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [files, setFiles] = useState([]);
  const [gotoPageInput, setGotoPageInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorKind, setErrorKind] = useState(null);

  useEffect(() => {
    document.body.classList.add('is-search-page');
    return () => document.body.classList.remove('is-search-page');
  }, []);

  useEffect(() => {
    setQuery(qParam);
  }, [qParam]);

  const runSearch = useCallback(async () => {
    if (isPopularMode) {
      setLoading(true);
      setErrorKind(null);
      const res = await fetchRandomVideos({ limit: '32', page: '0', sort: 'top_random', topPercent: '5' });
      setLoading(false);
      if (!res.ok) {
        setErrorKind('other');
        setFiles([]);
        setTotal(0);
        return;
      }
      const list = Array.isArray(res.data?.files) ? res.data.files : [];
      setFiles(list);
      setTotal(list.length);
      return;
    }
    const q = query.trim();
    if (q.length < 2) {
      setFiles([]);
      setTotal(0);
      setErrorKind(null);
      return;
    }
    setLoading(true);
    setErrorKind(null);
    const { sort, order } = sortParams(sortUi);
    const offset = (page - 1) * PAGE_SIZE;
    const qs = new URLSearchParams({
      search: q,
      limit: String(PAGE_SIZE),
      offset: String(offset),
      sort,
      order,
    });
    const res = await fetchVideoLibrary(qs.toString());
    setLoading(false);
    if (res.status === 401) {
      setErrorKind('auth');
      setFiles([]);
      setTotal(0);
      return;
    }
    if (res.status === 403) {
      setErrorKind('tier');
      setFiles([]);
      setTotal(0);
      return;
    }
    if (!res.ok) {
      setErrorKind('other');
      setFiles([]);
      setTotal(0);
      return;
    }
    const data = res.data || {};
    const list = Array.isArray(data.files) ? data.files : [];
    setFiles(list);
    setTotal(data.total != null ? data.total : list.length);
  }, [query, sortUi, page, isPopularMode]);

  useEffect(() => {
    runSearch();
  }, [runSearch]);

  useEffect(() => {
    if (isPopularMode) {
      document.title = 'Popular videos — Pornwrld';
      return;
    }
    const q = query.trim();
    if (q.length >= 2) {
      document.title = `${q} — Search — Pornwrld`;
    } else {
      document.title = 'Search — Pornwrld';
    }
  }, [query, isPopularMode]);

  function submitSearch() {
    if (isPopularMode) return;
    const q = query.trim();
    if (q.length < 2) return;
    setSearchParams({ q });
    setPage(1);
  }

  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

  const pageButtons = useMemo(() => {
    if (totalPages <= 1) return [];
    const windowSize = 10;
    let start = Math.max(1, page - Math.floor(windowSize / 2));
    let end = start + windowSize - 1;
    if (end > totalPages) {
      end = totalPages;
      start = Math.max(1, end - windowSize + 1);
    }
    const arr = [];
    for (let p = start; p <= end; p++) arr.push(p);
    return arr;
  }, [page, totalPages]);

  function goToPage() {
    const n = parseInt(gotoPageInput, 10);
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(1, Math.min(totalPages, n));
    setPage(clamped);
    setGotoPageInput('');
  }

  return (
    <div className="page-content search-page">
      {isPopularMode && (
        <div className="search-page-back-wrap">
          <button
            type="button"
            className="search-page-back-btn"
            onClick={() => {
              if (window.history.length > 1) navigate(-1);
              else navigate('/');
            }}
          >
            Back
          </button>
        </div>
      )}
      <div className="search-page-header">
        <PageHero
          titleId="search-page-title"
          title={
            isPopularMode
              ? 'Most popular videos'
              : query.trim().length >= 2
                ? `Results for "${query.trim()}"`
                : 'Search'
          }
          subtitle={
            isPopularMode
              ? 'Top-performing videos (top 5%) shuffled each load.'
              : query.trim().length >= 2
                ? undefined
                : 'Search titles across every category'
          }
        />
        {!isPopularMode && <div className="search-page-bar">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" className="search-page-bar-icon">
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
          </svg>
          <input
            type="text"
            className="search-page-input"
            placeholder="Search videos..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitSearch();
            }}
          />
          <button className="search-page-btn" type="button" onClick={submitSearch}>
            Search
          </button>
        </div>}
        <div className="search-page-info" id="search-page-info">
          {!loading && files.length > 0 && `${total} video${total !== 1 ? 's' : ''} found`}
        </div>
      </div>

      {!isPopularMode && query.trim().length >= 2 && !errorKind && files.length > 0 && (
        <div className="folder-sort-bar" id="search-sort-bar">
          <label>Sort by:</label>
          <button
            type="button"
            className={'sort-btn' + (sortUi === 'recent' ? ' active' : '')}
            onClick={() => {
              setSortUi('recent');
              setPage(1);
            }}
          >
            Recent
          </button>
          <button
            type="button"
            className={'sort-btn' + (sortUi === 'rating' ? ' active' : '')}
            onClick={() => {
              setSortUi('rating');
              setPage(1);
            }}
          >
            Top Rated
          </button>
          <button
            type="button"
            className={'sort-btn' + (sortUi === 'longest' ? ' active' : '')}
            onClick={() => {
              setSortUi('longest');
              setPage(1);
            }}
          >
            Longest
          </button>
        </div>
      )}

      {loading && <div className="videos-loading-msg">Searching…</div>}

      {!loading && errorKind === 'auth' && (
        <div className="search-empty-state">
          <div className="search-empty-title">Sign in to search</div>
          <div className="search-empty-sub">Create an account or log in to search videos</div>
          <button type="button" className="search-unlock-btn" onClick={() => openAuth('login')}>
            Sign In
          </button>
        </div>
      )}

      {!loading && errorKind === 'tier' && (
        <div className="search-empty-state">
          <div className="search-empty-title">Unlock search</div>
          <div className="search-empty-sub">Refer 1 friend to get access</div>
          <button type="button" className="search-unlock-btn" onClick={() => openReferral()}>
            Unlock Access
          </button>
        </div>
      )}

      {!loading && errorKind === 'other' && (
        <div className="search-empty-state">
          <div className="search-empty-title">Search failed</div>
          <div className="search-empty-sub">Something went wrong — try again</div>
        </div>
      )}

      {!loading && !errorKind && ((isPopularMode && files.length === 0) || (!isPopularMode && query.trim().length >= 2 && files.length === 0)) && (
        <div className="search-empty-state">
          <div className="search-empty-title">No results found</div>
          <div className="search-empty-sub">Try a different search term</div>
        </div>
      )}

      {!errorKind && (
        <div className="media-grid" id="search-results-grid">
          {files.map((item, i) => (
            <HomepageMediaTile key={videoCardStableKey(item, i)} file={item} badgeType="" />
          ))}
        </div>
      )}

      {!loading && !errorKind && files.length > 0 && totalPages > 1 && (
        <div className="pagination" id="search-pagination">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Back
          </button>
          {pageButtons.map((p) => (
            <button
              key={p}
              type="button"
              className={p === page ? 'active' : ''}
              onClick={() => setPage(p)}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
          <div className="pagination-go" aria-label="Go to page">
            <input
              type="number"
              min={1}
              max={totalPages}
              inputMode="numeric"
              value={gotoPageInput}
              onChange={(e) => setGotoPageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') goToPage();
              }}
              placeholder="Page"
            />
            <button type="button" onClick={goToPage}>
              Go
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
