import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Lock, Play, Sparkles, Unlock, X } from 'lucide-react';
import { apiGet } from '../api';
import { CREATORS } from '../data/catalog';
import { displayCount, formatCount } from '../lib/metrics';
import { classifyMedia, isLockedTier, mediaUrl, TIER_LABELS } from '../lib/media';

const TIER_ORDER = ['free', 'tier1', 'tier2', 'tier3'];
const PAGE_SIZE = 60;

function PaywallOverlay({ tier }) {
  return (
    <div className="lw-paywall">
      <div className="lw-paywall-icon">
        <Lock size={22} />
      </div>
      <span>{TIER_LABELS[tier]}</span>
      <Link to="/checkout" className="lw-btn primary lw-paywall-cta">
        Unlock
      </Link>
    </div>
  );
}

function MediaTile({ item, onOpen, accent }) {
  const locked = isLockedTier(item.tier);
  const kind = item.kind || classifyMedia(item.name);
  const src = mediaUrl(item.key);

  /** Locked items show only a blurred placeholder + paywall; we never
   *  emit an <img> with the locked URL so the browser never even fetches it. */
  if (locked) {
    return (
      <button type="button" className={`lw-media-tile locked accent-${accent}`} aria-label={`${TIER_LABELS[item.tier]} content (locked)`}>
        <PaywallOverlay tier={item.tier} />
      </button>
    );
  }

  if (kind === 'image') {
    return (
      <button type="button" className="lw-media-tile" onClick={() => onOpen(item)} aria-label="View image">
        <img src={src} alt="" loading="lazy" decoding="async" />
        <span className="lw-media-tile-tier free">
          <Unlock size={11} /> Free
        </span>
      </button>
    );
  }

  if (kind === 'video') {
    /** Grid used to show only a gradient — looked “broken” on prod. A muted
     *  `preload="metadata"` fetch shows the first frame like a poster (same URL as lightbox).
     *  `crossOrigin="anonymous"` matches Worker CORS when `VITE_R2_PUBLIC_BASE` is cross-origin. */
    return (
      <button type="button" className="lw-media-tile" onClick={() => onOpen(item)} aria-label="Play video">
        <video
          className="lw-media-tile-video-el"
          src={src}
          muted
          playsInline
          preload="metadata"
          crossOrigin="anonymous"
        />
        <div className="lw-media-tile-video-overlay" aria-hidden>
          <span className="lw-play big">
            <Play size={28} fill="currentColor" />
          </span>
        </div>
        <span className="lw-media-tile-tier free">
          <Unlock size={11} /> Free
        </span>
      </button>
    );
  }

  return (
    <div className={`lw-media-tile other accent-${accent}`} aria-label={`File: ${item.name}`}>
      <span className="text-xs text-white/60">{item.ext || 'file'}</span>
    </div>
  );
}

function Lightbox({ items, index, onClose, onNavigate }) {
  const item = items[index];
  const handleKey = useCallback(
    (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onNavigate(-1);
      else if (e.key === 'ArrowRight') onNavigate(1);
    },
    [onClose, onNavigate],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [handleKey]);

  if (!item) return null;
  const kind = item.kind || classifyMedia(item.name);
  const src = mediaUrl(item.key);

  return (
    <div className="lw-lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <button type="button" className="lw-lightbox-close" onClick={onClose} aria-label="Close">
        <X size={20} />
      </button>
      <button
        type="button"
        className="lw-lightbox-nav left"
        onClick={(e) => {
          e.stopPropagation();
          onNavigate(-1);
        }}
        aria-label="Previous"
      >
        <ChevronLeft size={28} />
      </button>
      <button
        type="button"
        className="lw-lightbox-nav right"
        onClick={(e) => {
          e.stopPropagation();
          onNavigate(1);
        }}
        aria-label="Next"
      >
        <ChevronRight size={28} />
      </button>
      <div className="lw-lightbox-stage" onClick={(e) => e.stopPropagation()}>
        {kind === 'video' ? (
          <video
            src={src}
            controls
            autoPlay
            playsInline
            crossOrigin="anonymous"
            preload="metadata"
            className="lw-lightbox-video"
          />
        ) : (
          <img src={src} alt="" className="lw-lightbox-image" />
        )}
        <div className="lw-lightbox-meta">
          <span>
            {index + 1} / {items.length}
          </span>
        </div>
      </div>
    </div>
  );
}

export function CreatorDetailPage() {
  const { slug } = useParams();
  const seedCreator = useMemo(() => CREATORS.find((c) => c.slug === slug), [slug]);

  const [creator, setCreator] = useState(seedCreator || null);
  const [totals, setTotals] = useState(null);
  const [items, setItems] = useState([]);
  const [tier, setTier] = useState('free');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const requestId = useRef(0);

  useEffect(() => {
    document.title = seedCreator ? `${seedCreator.name} - Leak World` : 'Creator - Leak World';
  }, [seedCreator]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    apiGet(`/api/creators/${slug}`, null).then((data) => {
      if (cancelled) return;
      if (!data || !data.creator) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setCreator(data.creator);
      setTotals(data.mediaSummary || null);
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    const params = new URLSearchParams({ tier, limit: String(PAGE_SIZE), offset: '0' });
    apiGet(`/api/creators/${slug}/media?${params}`, { items: [] }).then((data) => {
      if (id !== requestId.current) return;
      setItems(data.items || []);
      if (data.totals) setTotals(data.totals);
      setLoading(false);
    });
  }, [slug, tier]);

  const openLightbox = useCallback(
    (item) => {
      const idx = items.findIndex((it) => it.key === item.key);
      if (idx >= 0) setLightboxIndex(idx);
    },
    [items],
  );

  const navigateLightbox = useCallback(
    (delta) => {
      setLightboxIndex((prev) => {
        if (prev < 0) return prev;
        const next = prev + delta;
        if (next < 0 || next >= items.length) return prev;
        return next;
      });
    },
    [items.length],
  );

  if (notFound) {
    return (
      <div className="space-y-6">
        <Link to="/categories" className="lw-link">
          <ArrowLeft size={15} /> Back to creators
        </Link>
        <section className="lw-page-head">
          <h1>Creator not found</h1>
          <p>This creator isn&apos;t in the archive yet. Browse the full index to find someone else.</p>
          <Link to="/categories" className="lw-btn primary mt-3">
            Browse all creators
          </Link>
        </section>
      </div>
    );
  }

  const tierCounts = totals?.byTier || { free: { count: 0 }, tier1: { count: 0 }, tier2: { count: 0 }, tier3: { count: 0 } };
  const accent = creator?.accent || 'pink';

  return (
    <div className="space-y-6">
      <Link to="/categories" className="lw-link">
        <ArrowLeft size={15} /> Back to creators
      </Link>

      <section className="lw-creator-hero">
        <div className={`lw-creator-hero-thumb accent-${accent}`}>
          {creator?.thumbnail ? (
            <img src={creator.thumbnail} alt={`${creator.name} thumbnail`} loading="eager" />
          ) : (
            <Sparkles size={32} />
          )}
        </div>
        <div className="lw-creator-hero-meta">
          <span className="lw-eyebrow">#{creator?.rank} - {creator?.category}</span>
          <h1>{creator?.name || 'Loading...'}</h1>
          <p>{creator?.tagline}</p>
          <div className="lw-creator-hero-stats">
            <span className="lw-tier-chip unlocked">
              <Unlock size={12} /> {formatCount(displayCount(tierCounts.free.count))} free
            </span>
            <span className="lw-tier-chip locked">
              <Lock size={12} /> {formatCount(displayCount(totals?.count || 0))} total
            </span>
          </div>
        </div>
      </section>

      <section className="lw-toolbar">
        <div className="flex items-center gap-2 text-[13px] text-white/70">
          Browsing <b className="text-white">{TIER_LABELS[tier]}</b>
        </div>
        <div className="flex flex-wrap gap-2">
          {TIER_ORDER.map((t) => {
            const count = tierCounts[t]?.count || 0;
            const active = tier === t;
            return (
              <button
                key={t}
                type="button"
                className={`lw-filter ${active ? 'active' : ''}`}
                onClick={() => setTier(t)}
              >
                {t === 'free' ? <Unlock size={12} /> : <Lock size={12} />}
                {TIER_LABELS[t]}
                <span className="text-white/60">{formatCount(displayCount(count))}</span>
              </button>
            );
          })}
        </div>
      </section>

      {loading ? (
        <div className="lw-grid-loading">Loading {TIER_LABELS[tier]} content...</div>
      ) : items.length === 0 ? (
        <div className="lw-grid-empty">No {TIER_LABELS[tier]} files for this creator yet.</div>
      ) : (
        <section className="lw-media-grid">
          {items.map((item) => (
            <MediaTile key={item.key} item={item} onOpen={openLightbox} accent={accent} />
          ))}
        </section>
      )}

      {(totals?.byTier?.[tier]?.count || 0) > items.length ? (
        <div className="lw-grid-empty">
          Showing {items.length} of {formatCount(displayCount(totals.byTier[tier].count))} {TIER_LABELS[tier]} files.
          Pagination is coming soon.
        </div>
      ) : null}

      {lightboxIndex >= 0 ? (
        <Lightbox
          items={items.filter((it) => !isLockedTier(it.tier))}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(-1)}
          onNavigate={navigateLightbox}
        />
      ) : null}
    </div>
  );
}
