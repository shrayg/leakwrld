import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '../api';
import { CREATORS } from '../data/catalog';
import { CreatorCard } from '../components/CreatorCard';
import { GridPagination } from '../components/GridPagination';
import { recordEvent } from '../lib/analytics';
import { formatCount } from '../lib/metrics';
import { useCatalogGridPageSize } from '../hooks/useGridPageSize';

const SORT_FILTERS = [
  { id: 'default', label: 'Default' },
  { id: 'featured', label: 'Featured' },
  { id: 'trending', label: 'Trending' },
];

/** Fisher–Yates shuffle (copy). */
function shuffleCreators(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function CategoriesPage() {
  const [creators, setCreators] = useState(CREATORS);
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState('default');
  const [page, setPage] = useState(1);
  const pageSize = useCatalogGridPageSize();

  useEffect(() => {
    document.title = 'Creators - Leak World';
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (sortMode === 'trending') params.set('sort', 'trending');
    const qs = params.toString();
    apiGet(qs ? `/api/creators?${qs}` : '/api/creators', { creators: CREATORS }).then((data) => {
      setCreators(data.creators || CREATORS);
    });
  }, [query, sortMode]);

  useEffect(() => {
    const t = setTimeout(() => {
      recordEvent('creators_browse', {
        category: 'discovery',
        path: '/categories',
        payload: { q: query.trim(), sort: sortMode },
      });
    }, 650);
    return () => clearTimeout(t);
  }, [query, sortMode]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = creators.filter((creator) => !q || creator.name.toLowerCase().includes(q));
    if (sortMode === 'featured') return shuffleCreators(filtered);
    return filtered;
  }, [creators, query, sortMode]);

  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  const pageClamped = Math.min(page, totalPages);

  useEffect(() => {
    setPage(1);
  }, [query, sortMode, creators.length]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pagedCreators = useMemo(() => {
    const start = (pageClamped - 1) * pageSize;
    return visible.slice(start, start + pageSize);
  }, [visible, pageClamped, pageSize]);

  const rangeStart = visible.length === 0 ? 0 : (pageClamped - 1) * pageSize + 1;
  const rangeEnd = visible.length === 0 ? 0 : Math.min(visible.length, pageClamped * pageSize);

  return (
    <div className="space-y-6">
      <section className="lw-page-head">
        <span className="lw-eyebrow">Creator index</span>
        <h1>Creators</h1>
        <p>
          Browse every creator in the archive. Search by name or sort by what&apos;s hot — all leaks are mirrored and stay
          online forever.
        </p>
      </section>

      <section className="lw-toolbar">
        <label className="lw-search-field">
          <Search size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the top 100" />
        </label>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {SORT_FILTERS.map(({ id, label }) => (
            <button
              type="button"
              key={id}
              className={`lw-filter ${sortMode === id ? 'active' : ''}`}
              onClick={() => setSortMode(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="lw-creator-grid">
        {pagedCreators.map((creator) => (
          <CreatorCard key={creator.slug} creator={creator} />
        ))}
      </section>

      {visible.length > 0 ? (
        <GridPagination
          idPrefix="creators-index"
          page={pageClamped}
          totalPages={totalPages}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
          summary={
            <span className="text-[13px] text-white/70">
              Showing {formatCount(rangeStart)}-{formatCount(rangeEnd)} of {formatCount(visible.length)} creators
            </span>
          }
        />
      ) : null}
    </div>
  );
}
