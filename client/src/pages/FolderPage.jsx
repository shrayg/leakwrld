import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { fetchList, fetchPreviewList, fetchRecommendations } from '../api/client';
import { HomepageMediaTile } from '../components/home/HomepageMediaTile';
import { videoCardStableKey } from '../components/media/VideoCard';
import { useAuth } from '../hooks/useAuth';
import { cleanPathToFolder, folderDisplayName, folderToCleanPath, folderToCleanUrl } from '../lib/cleanUrls';
import { dedupeFiles, formatDuration, sortFiles } from '../lib/folderMedia';
import { FOLDER_DOC_META } from '../data/folderDocMeta';
import { PageHero } from '../components/layout/PageHero';
import { buildVideoId, sendTelemetry } from '../lib/telemetry';

const PAGE_SIZE = 15;
export function FolderPage({ seoFolder: propFolder }) {
  const [params] = useSearchParams();
  const location = useLocation();
  const { loading: authLoading } = useAuth();

  const folderFromQuery = params.get('folder') || '';
  const subfolderFromQuery = params.get('subfolder') || '';
  const folder = propFolder || folderFromQuery || cleanPathToFolder(location.pathname) || '';

  const displayHeading = subfolderFromQuery
    ? `${folderDisplayName(folder)} — ${subfolderFromQuery}`
    : folderDisplayName(folder);

  const [items, setItems] = useState([]);
  const [allFiles, setAllFiles] = useState([]);
  const [subfoldersFromApi, setSubfoldersFromApi] = useState(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [sortKey, setSortKey] = useState('recent');
  const [page, setPage] = useState(1);
  const [gotoPageInput, setGotoPageInput] = useState('');
  const [subfolderFilter, setSubfolderFilter] = useState('all');
  const [videoSearch, setVideoSearch] = useState('');
  const [recoRankMap, setRecoRankMap] = useState({});

  const docMeta = FOLDER_DOC_META[folder];

  useEffect(() => {
    if (!folder) return;
    const t = docMeta ? docMeta.title + ' — Pornwrld' : displayHeading + ' — Pornwrld';
    document.title = t;
    let metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc && docMeta) metaDesc.setAttribute('content', docMeta.desc);
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) {
      const path = folderToCleanPath(folder) || '/folder.html?folder=' + encodeURIComponent(folder);
      canonical.setAttribute('href', 'https://pornwrld.xyz' + path);
    }
  }, [folder, displayHeading, docMeta]);

  const load = useCallback(async () => {
    if (!folder) return;
    setLoading(true);
    setErr(null);
    try {
      const { ok, data, status } = await fetchList(folder, subfolderFromQuery || undefined);
      if (!ok) {
        if (status === 403 || status === 401) {
          const prev = await fetchPreviewList(folder);
          if (prev.ok && prev.data?.files?.length) {
            let pfiles = dedupeFiles(prev.data.files);
            pfiles = sortFiles(pfiles, 'recent');
            setAllFiles(pfiles);
            setItems(pfiles);
            setPreviewMode(true);
            setSubfoldersFromApi(null);
          } else {
            setErr('empty');
          }
          setLoading(false);
          return;
        }
        throw new Error('list failed');
      }
      const raw = Array.isArray(data.files) ? data.files : [];
      const deduped = dedupeFiles(raw);
      setAllFiles(deduped);
      setSubfoldersFromApi(data.subfolders && Array.isArray(data.subfolders) ? data.subfolders : null);
      setPreviewMode(false);
      setPage(1);
      setSubfolderFilter('all');
      setErr(null);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, [folder, subfolderFromQuery]);

  useEffect(() => {
    if (authLoading) return;
    if (folder === 'Omegle') {
      setLoading(false);
      setErr(null);
      setAllFiles([]);
      setItems([]);
      setSubfoldersFromApi(null);
      setPreviewMode(false);
      setRecoRankMap({});
      return;
    }
    load();
  }, [load, authLoading, folder]);

  useEffect(() => {
    if (!folder || !allFiles.length) return;
    let cancelled = false;
    fetchRecommendations(Math.min(120, allFiles.length), { surface: 'category', contextFolder: folder }).then((res) => {
      if (cancelled || !res.ok || !Array.isArray(res.data?.files)) return;
      const rankMap = {};
      res.data.files.forEach((f, idx) => {
        rankMap[buildVideoId(f.folder, f.subfolder || '', f.name, f.vault)] = idx + 1;
      });
      setRecoRankMap(rankMap);
      res.data.files.slice(0, 20).forEach((f, idx) => {
        sendTelemetry('impression', {
          surface: 'category',
          slot: idx,
          rank: idx + 1,
          videoId: f.videoId || buildVideoId(f.folder, f.subfolder || '', f.name, f.vault),
          folder: f.folder,
          subfolder: f.subfolder || '',
          name: f.name,
        });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [folder, allFiles]);

  const filteredFiles = useMemo(() => {
    let list = allFiles;
    if (subfolderFilter !== 'all') {
      list = list.filter((f) => f.subfolder === subfolderFilter);
    }
    const query = videoSearch.trim().toLowerCase();
    if (query) {
      list = list.filter((f) => {
        const title = String(f.title || f.name || '').toLowerCase();
        return title.includes(query);
      });
    }
    const sorted = sortFiles(list, sortKey);
    if (sortKey !== 'recent') return sorted;
    return sorted.slice().sort((a, b) => {
      const ra =
        recoRankMap[
          buildVideoId(a.folder || folder, a.subfolder || '', a.name, a.vault)
        ] || Number.MAX_SAFE_INTEGER;
      const rb =
        recoRankMap[
          buildVideoId(b.folder || folder, b.subfolder || '', b.name, b.vault)
        ] || Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });
  }, [allFiles, sortKey, subfolderFilter, videoSearch, recoRankMap, folder]);

  useEffect(() => {
    if (previewMode) {
      setItems(filteredFiles);
      return;
    }
    const totalPages = Math.max(1, Math.ceil(filteredFiles.length / PAGE_SIZE));
    const p = Math.min(page, totalPages);
    const start = (p - 1) * PAGE_SIZE;
    setItems(filteredFiles.slice(start, start + PAGE_SIZE));
  }, [filteredFiles, page, previewMode]);

  const totalPages = previewMode
    ? 1
    : Math.max(1, Math.ceil(filteredFiles.length / PAGE_SIZE));

  const pageButtons = useMemo(() => {
    if (previewMode || totalPages <= 1) return [];
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
  }, [page, totalPages, previewMode]);

  function goToPage() {
    const n = parseInt(gotoPageInput, 10);
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(1, Math.min(totalPages, n));
    setPage(clamped);
    setGotoPageInput('');
  }

  const folderHrefBase = folderToCleanUrl(folder);

  if (!folder) {
    return (
      <div className="page-content folder-page page-shell pornwrld-folder-empty">
        <PageHero title="Pick a category" subtitle="Choose a category from the home page or browse /categories." align="start" />
        <Link to="/" className="pornwrld-inline-link-btn">
          Home
        </Link>
      </div>
    );
  }

  if (folder === 'Omegle') {
    return (
      <div className="page-content folder-page folder-page--partner">
        <div className="folder-header pornwrld-folder-head">
          <h1 className="pornwrld-page-title">{displayHeading}</h1>
        </div>
        <div className="folder-partner-panel" role="region" aria-label="Partner site">
          <p className="folder-partner-text">Omegle leaks are on our partner site.</p>
          <a
            href="https://pornyard.xyz"
            target="_blank"
            rel="noopener noreferrer"
            className="pornwrld-inline-link-btn folder-partner-cta"
          >
            Visit Pornyard
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content folder-page">
      <div className="folder-header pornwrld-folder-head">
        <h1 className="pornwrld-page-title">{displayHeading}</h1>
        {previewMode && (
          <div className="cta-banner cta-banner-inline">
            <Link to="/">CLICK HERE TO UNLOCK MORE</Link>
          </div>
        )}
      </div>

      <div className="folder-toolbar">
        <div className="folder-sort-bar" id="folder-sort-bar">
          <label>Sort by:</label>
          {['recent', 'likes', 'longest'].map((k) => (
            <button
              key={k}
              type="button"
              className={'sort-btn' + (sortKey === k ? ' active' : '')}
              data-sort={k}
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
          <label htmlFor="folder-video-search-input">Search videos:</label>
          <input
            id="folder-video-search-input"
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

      {subfoldersFromApi && subfoldersFromApi.length > 0 && !subfolderFromQuery && (
        <div className="folder-category-filter">
          <label>Category:</label>
          <select
            className="category-filter-select"
            value={subfolderFilter}
            onChange={(e) => {
              setSubfolderFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">All</option>
            {subfoldersFromApi.map((sf) => (
              <option key={sf} value={sf}>
                {sf}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading && (
        <div className="media-grid folder-media-grid">
          <p style={{ gridColumn: '1/-1', textAlign: 'center', padding: 40 }}>Loading…</p>
        </div>
      )}

      {!loading && err === 'preview' && (
        <div style={{ textAlign: 'center', padding: 60, color: '#666' }}>
          <h3 style={{ color: '#bbb' }}>Preview unavailable</h3>
          <p>This collection doesn&apos;t have a free preview right now.</p>
        </div>
      )}

      {!loading && err && err !== 'preview' && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <p>Could not load folder.</p>
        </div>
      )}

      {!loading && !err && items.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <h3>No files found</h3>
        </div>
      )}

      {!loading && items.length > 0 && (
        <>
          <div className="media-grid folder-media-grid">
            {items.map((item, idx) => (
              <HomepageMediaTile key={videoCardStableKey(item, idx)} file={item} badgeType="" />
            ))}
          </div>

          {!previewMode && totalPages > 1 && (
            <div className="pagination-controls" id="folder-pagination">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Back
              </button>
              {pageButtons.map((pg) => (
                <button
                  key={pg}
                  type="button"
                  className={pg === page ? 'active' : ''}
                  onClick={() => setPage(pg)}
                >
                  {pg}
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
        </>
      )}

      <section className="folder-seo" id="folder-seo" aria-label="Category description">
        <p className="seo-intro" style={{ color: '#999', lineHeight: 1.7 }}>
          Browse <strong>{folder}</strong> videos on Pornwrld — HD streaming, updated regularly.
        </p>
      </section>

    </div>
  );
}
