import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Eye, Heart, Lock, Play, Sparkles, ThumbsDown, Unlock, X } from 'lucide-react';
import { apiGet } from '../api';
import { useAuth } from '../components/AuthContext';
import { CREATORS } from '../data/catalog';
import { displayCount, formatCount } from '../lib/metrics';
import { accountTierLabel, classifyMedia, isLockedTier, mediaUrl, TIER_LABELS } from '../lib/media';
import { recordEvent } from '../lib/analytics';
import {
  manifestMediaLike,
  manifestMediaProgress,
  manifestMediaSessionStart,
  mediaPlaybackSessionId,
} from '../lib/mediaAnalytics';

const TIER_ORDER = ['free', 'tier1', 'tier2', 'tier3'];
const PAGE_SIZE = 60;

function TrackedVideo({ src, item, creatorSlug, playbackId, className }) {
  const ref = useRef(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let lastCheckpoint = 0;
    let metaSent = false;

    const sendDur = () => {
      const dur = Math.floor(v.duration || 0);
      if (dur <= 0 || metaSent) return;
      metaSent = true;
      manifestMediaProgress({
        storageKey: item.key,
        creatorSlug,
        playbackSessionId: playbackId,
        secondsDelta: 0,
        durationSeconds: dur,
      });
    };

    const flush = (force = false) => {
      const cur = Math.floor(v.currentTime || 0);
      let d = cur - lastCheckpoint;
      if (force && d < 1 && cur > lastCheckpoint) d = 1;
      if (d >= 1) {
        manifestMediaProgress({
          storageKey: item.key,
          creatorSlug,
          playbackSessionId: playbackId,
          secondsDelta: Math.min(120, d),
        });
        lastCheckpoint = cur;
      }
    };

    const onTime = () => flush(false);
    const onPause = () => flush(true);
    const onEnded = () => flush(true);

    v.addEventListener('loadedmetadata', sendDur);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEnded);

    return () => {
      flush(true);
      v.removeEventListener('loadedmetadata', sendDur);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEnded);
    };
  }, [src, item.key, creatorSlug, playbackId]);

  return (
    <video
      ref={ref}
      src={src}
      controls
      autoPlay
      playsInline
      crossOrigin="anonymous"
      preload="metadata"
      className={className}
    />
  );
}

function LightboxFooter({ item, creatorSlug, index, total }) {
  const likeKey = `lw_mlk_${item.key}`;
  const dislikeKey = `lw_mdk_${item.key}`;
  const [liked, setLiked] = useState(() => {
    try {
      return localStorage.getItem(likeKey) === '1';
    } catch {
      return false;
    }
  });
  const [disliked, setDisliked] = useState(() => {
    try {
      return localStorage.getItem(dislikeKey) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      setLiked(localStorage.getItem(likeKey) === '1');
      setDisliked(localStorage.getItem(dislikeKey) === '1');
    } catch {
      setLiked(false);
      setDisliked(false);
    }
  }, [likeKey, dislikeKey]);

  function onLike(e) {
    e.stopPropagation();
    if (liked) return;
    try {
      localStorage.setItem(likeKey, '1');
    } catch {
      /* ignore */
    }
    setLiked(true);
    manifestMediaLike({ storageKey: item.key, creatorSlug });
  }

  function onDislike(e) {
    e.stopPropagation();
    if (disliked) return;
    try {
      localStorage.setItem(dislikeKey, '1');
    } catch {
      /* ignore */
    }
    setDisliked(true);
    recordEvent('media_dislike', {
      path: item.key,
      category: 'media',
      payload: {
        key: item.key,
        creatorSlug,
        tier: item.tier,
        kind: item.kind || classifyMedia(item.name),
      },
    });
  }

  return (
    <div className="lw-lightbox-meta flex flex-wrap items-center justify-between gap-3">
      <span>
        {index + 1} / {total}
      </span>
      <div className="lw-lightbox-actions">
        <button
          type="button"
          className={`lw-lightbox-like-btn ${liked ? 'is-liked' : ''}`}
          onClick={onLike}
          aria-pressed={liked}
          aria-label={liked ? 'Liked' : 'Like'}
        >
          <Heart size={16} className="lw-lightbox-like-icon" fill={liked ? 'currentColor' : 'none'} />
          {liked ? 'Liked' : 'Like'}
        </button>
        <button
          type="button"
          className={`lw-lightbox-like-btn ${disliked ? 'is-disliked' : ''}`}
          onClick={onDislike}
          aria-pressed={disliked}
          aria-label={disliked ? 'Disliked' : 'Dislike'}
        >
          <ThumbsDown size={16} className="lw-lightbox-like-icon" fill={disliked ? 'currentColor' : 'none'} />
          {disliked ? 'Disliked' : 'Dislike'}
        </button>
      </div>
    </div>
  );
}

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

function statCount(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function MediaTileStats({ item }) {
  const views = statCount(item.views);
  const likes = statCount(item.likes);
  const dislikes = statCount(item.dislikes);
  return (
    <div className="lw-media-tile-stats">
      <span>
        <Eye size={13} />
        {formatCount(views)}
      </span>
      <span title="Likes to dislikes">
        <Heart size={12} />
        {formatCount(likes)}:{formatCount(dislikes)}
        <ThumbsDown size={12} />
      </span>
    </div>
  );
}

function MediaTile({ item, onOpen, accent, accountTier }) {
  const locked = item.locked || isLockedTier(item.tier, accountTier);
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
        <MediaTileStats item={item} />
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
        <MediaTileStats item={item} />
      </button>
    );
  }

  return (
    <div className={`lw-media-tile other accent-${accent}`} aria-label={`File: ${item.name}`}>
      <span className="text-xs text-white/60">{item.ext || 'file'}</span>
      <MediaTileStats item={item} />
    </div>
  );
}

function Lightbox({ items, index, creatorSlug, onClose, onNavigate }) {
  const item = items[index];
  const playbackId = useMemo(() => mediaPlaybackSessionId(), [item?.key, index]);

  useEffect(() => {
    if (!item || !creatorSlug) return;
    const kind = item.kind || classifyMedia(item.name);
    manifestMediaSessionStart({
      storageKey: item.key,
      creatorSlug,
      kind,
      playbackSessionId: playbackId,
    });
  }, [item, creatorSlug, playbackId]);

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

  if (!item || !creatorSlug) return null;
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
          <TrackedVideo
            src={src}
            item={item}
            creatorSlug={creatorSlug}
            playbackId={playbackId}
            className="lw-lightbox-video"
          />
        ) : (
          <img src={src} alt="" className="lw-lightbox-image" />
        )}
        <LightboxFooter item={item} creatorSlug={creatorSlug} index={index} total={items.length} />
      </div>
    </div>
  );
}

export function CreatorDetailPage() {
  const { slug } = useParams();
  const { user } = useAuth();
  const seedCreator = useMemo(() => CREATORS.find((c) => c.slug === slug), [slug]);

  const [creator, setCreator] = useState(seedCreator || null);
  const [totals, setTotals] = useState(null);
  const [items, setItems] = useState([]);
  const [tier, setTier] = useState('free');
  const [pageOffset, setPageOffset] = useState(0);
  const [pageInfo, setPageInfo] = useState({ offset: 0, limit: PAGE_SIZE, returned: 0, total: 0 });
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
    setPageOffset(0);
  }, [slug, tier, user?.tier]);

  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    const params = new URLSearchParams({ tier, limit: String(PAGE_SIZE), offset: String(pageOffset) });
    apiGet(`/api/creators/${slug}/media?${params}`, {
      items: [],
      page: { offset: pageOffset, limit: PAGE_SIZE, returned: 0, total: 0 },
    }).then((data) => {
      if (id !== requestId.current) return;
      setItems(data.items || []);
      setPageInfo(data.page || { offset: pageOffset, limit: PAGE_SIZE, returned: 0, total: 0 });
      if (data.totals) setTotals(data.totals);
      setLoading(false);
    });
  }, [slug, tier, user?.tier, pageOffset]);

  useEffect(() => {
    setLightboxIndex(-1);
  }, [slug, tier, pageOffset]);

  useEffect(() => {
    if (!creator || creator.slug !== slug) return;
    recordEvent('creator_profile_view', {
      category: 'creator',
      payload: { slug },
    });
  }, [creator, slug]);

  useEffect(() => {
    recordEvent('creator_browse_tier', {
      category: 'creator',
      payload: { slug, tier },
    });
  }, [slug, tier]);

  const accountTier = user?.tier || 'free';
  const playableItems = useMemo(() => items.filter((it) => !it.locked && !isLockedTier(it.tier, accountTier)), [items, accountTier]);
  const totalForTier = Number(totals?.byTier?.[tier]?.count || pageInfo.total || 0);
  const resolvedLimit = Number(pageInfo.limit || PAGE_SIZE);
  const resolvedOffset = Number(pageInfo.offset || 0);
  const rangeStart = totalForTier > 0 ? resolvedOffset + 1 : 0;
  const rangeEnd = totalForTier > 0 ? Math.min(totalForTier, resolvedOffset + items.length) : 0;
  const totalPages = Math.max(1, Math.ceil(totalForTier / resolvedLimit));
  const currentPage = Math.min(totalPages, Math.floor(resolvedOffset / resolvedLimit) + 1);
  const canPrevPage = resolvedOffset > 0;
  const canNextPage = resolvedOffset + Number(pageInfo.returned || items.length) < totalForTier;

  const openLightbox = useCallback(
    (item) => {
      const idx = playableItems.findIndex((it) => it.key === item.key);
      if (idx >= 0) {
        setLightboxIndex(idx);
        recordEvent('media_lightbox_open', {
          category: 'media',
          payload: {
            slug,
            key: item.key,
            kind: item.kind || classifyMedia(item.name),
            tier: item.tier,
          },
        });
      }
    },
    [playableItems, slug],
  );

  const navigateLightbox = useCallback(
    (delta) => {
      setLightboxIndex((prev) => {
        if (prev < 0) return prev;
        const next = prev + delta;
        if (next < 0 || next >= playableItems.length) return prev;
        return next;
      });
    },
    [playableItems.length],
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
          <span className="text-white/45">Your tier: {accountTierLabel(accountTier)}</span>
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
            <MediaTile key={item.key} item={item} onOpen={openLightbox} accent={accent} accountTier={accountTier} />
          ))}
        </section>
      )}

      {totalForTier > 0 ? (
        <section className="lw-toolbar">
          <div className="text-[13px] text-white/70">
            Showing {formatCount(rangeStart)}-{formatCount(rangeEnd)} of {formatCount(displayCount(totalForTier))} {TIER_LABELS[tier]} files.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`lw-filter ${canPrevPage ? '' : 'opacity-50'}`}
              disabled={!canPrevPage || loading}
              onClick={() => setPageOffset(Math.max(0, resolvedOffset - resolvedLimit))}
            >
              <ChevronLeft size={13} />
              Prev
            </button>
            <span className="min-w-[86px] text-center text-[12px] text-white/65">
              Page {formatCount(currentPage)} / {formatCount(totalPages)}
            </span>
            <button
              type="button"
              className={`lw-filter ${canNextPage ? '' : 'opacity-50'}`}
              disabled={!canNextPage || loading}
              onClick={() => setPageOffset(resolvedOffset + resolvedLimit)}
            >
              Next
              <ChevronRight size={13} />
            </button>
          </div>
        </section>
      ) : null}

      {lightboxIndex >= 0 ? (
        <Lightbox
          items={playableItems}
          index={lightboxIndex}
          creatorSlug={slug}
          onClose={() => setLightboxIndex(-1)}
          onNavigate={navigateLightbox}
        />
      ) : null}
    </div>
  );
}
