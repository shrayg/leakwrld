import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Crown,
  Eye,
  Heart,
  Lock,
  Play,
  Sparkles,
  ThumbsDown,
  Unlock,
  X,
} from 'lucide-react';
import { apiGet } from '../api';
import { useAuth } from '../components/AuthContext';
import { CREATORS } from '../data/catalog';
import { formatCount } from '../lib/metrics';
import {
  accountTierLabel,
  canAccessManifestTier,
  classifyMedia,
  isLockedTier,
  mediaUrl,
  normalizeAccountTier,
  TIER_LABELS,
} from '../lib/media';
import { recordEvent } from '../lib/analytics';
import {
  manifestMediaLike,
  manifestMediaProgress,
  manifestMediaSessionStart,
  mediaPlaybackSessionId,
} from '../lib/mediaAnalytics';
import { AdminCopyStorageKeyButton } from '../components/AdminCopyStorageKeyButton';
import { GridPagination } from '../components/GridPagination';
import { useCatalogGridPageSize } from '../hooks/useGridPageSize';

const TIER_ORDER = ['free', 'tier1', 'tier2', 'tier3'];

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
      <span title={`${formatCount(views)} views`} aria-label={`${formatCount(views)} views`}>
        <Eye size={13} aria-hidden />
        {formatCount(views)}
      </span>
      <div className="lw-media-tile-reactions" aria-label={`${formatCount(likes)} likes, ${formatCount(dislikes)} dislikes`}>
        <span className="lw-media-tile-react" title={`${formatCount(likes)} likes`}>
          <Heart size={12} aria-hidden />
          {formatCount(likes)}
        </span>
        <span className="lw-media-tile-react" title={`${formatCount(dislikes)} dislikes`}>
          <ThumbsDown size={12} aria-hidden />
          {formatCount(dislikes)}
        </span>
      </div>
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
      <div className="lw-media-tile-outer">
        <button type="button" className="lw-media-tile" onClick={() => onOpen(item)} aria-label="View image">
          <img src={src} alt="" loading="lazy" decoding="async" />
          <span className="lw-media-tile-tier free">
            <Unlock size={11} /> Free
          </span>
          <MediaTileStats item={item} />
        </button>
        <AdminCopyStorageKeyButton storageKey={item.key} variant="tile" />
      </div>
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

/** Free-only upsell: ~1/5 of video opens on creator media grid (see `openLightbox`). */
const MISSING_OUT_PROMO_CHANCE = 0.2;

function MissingOutUpgradeModal({ onUpgrade, onContinueWatching }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onContinueWatching();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onContinueWatching]);

  return (
    <div
      className="lw-upgrade-modal-root lw-missing-out-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lw-missing-out-title"
    >
      <button type="button" className="lw-upgrade-modal-backdrop" aria-label="Close" onClick={onContinueWatching} />
      <div className="lw-upgrade-modal-panel" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="lw-upgrade-modal-close" onClick={onContinueWatching} aria-label="Close">
          <X size={18} />
        </button>
        <div className="lw-upgrade-modal-icon" aria-hidden>
          <Sparkles size={22} />
        </div>
        <h2 id="lw-missing-out-title" className="lw-upgrade-modal-title">
          You are missing out
        </h2>
        <p className="lw-upgrade-modal-lede">
          Upgrade to unlock more videos, full tiers for every creator, and the complete mirrored archive — free previews
          only scratch the surface.
        </p>
        <ul className="lw-upgrade-modal-bullets">
          <li>Premium unlocks tiered vaults and thousands more clips.</li>
          <li>New leaks mirror in daily — stay ahead with full access.</li>
          <li>Instant access after checkout.</li>
        </ul>
        <div className="lw-upgrade-modal-actions">
          <Link to="/checkout" className="lw-btn primary justify-center" onClick={onUpgrade}>
            Upgrade to unlock more content
          </Link>
          <button type="button" className="lw-btn ghost w-full justify-center" onClick={onContinueWatching}>
            Continue watching
          </button>
        </div>
      </div>
    </div>
  );
}

function TierUpgradeModal({ tierKey, onClose }) {
  const label = TIER_LABELS[tierKey] || tierKey;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="lw-upgrade-modal-root" role="dialog" aria-modal="true" aria-labelledby="lw-tier-upgrade-title">
      <button type="button" className="lw-upgrade-modal-backdrop" aria-label="Close" onClick={onClose} />
      <div className="lw-upgrade-modal-panel" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="lw-upgrade-modal-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <div className="lw-upgrade-modal-icon" aria-hidden>
          <Lock size={22} />
        </div>
        <h2 id="lw-tier-upgrade-title" className="lw-upgrade-modal-title">
          Upgrade to unlock the videos
        </h2>
        <p className="lw-upgrade-modal-lede">
          <strong className="text-white">{label}</strong> isn&apos;t included on your current plan. Upgrade now to unlock
          the full vault for this creator and the rest of the archive.
        </p>
        <ul className="lw-upgrade-modal-bullets">
          <li>Upgrade now to unlock premium tiers and every drop.</li>
          <li>Don&apos;t miss out — new leaks mirror in daily.</li>
          <li>Instant access after checkout — no waiting.</li>
        </ul>
        <div className="lw-upgrade-modal-actions">
          <Link to="/checkout" className="lw-btn primary justify-center" onClick={onClose}>
            View plans & upgrade
          </Link>
          <button type="button" className="lw-btn ghost w-full justify-center" onClick={onClose}>
            Maybe later
          </button>
        </div>
      </div>
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
          <>
            <img src={src} alt="" className="lw-lightbox-image" />
            {kind === 'image' ? <AdminCopyStorageKeyButton storageKey={item.key} variant="lightbox" /> : null}
          </>
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
  const pageSize = useCatalogGridPageSize();
  const [pageOffset, setPageOffset] = useState(0);
  const [pageInfo, setPageInfo] = useState({ offset: 0, limit: pageSize, returned: 0, total: 0 });
  const lastPageSize = useRef(pageSize);

  useEffect(() => {
    if (lastPageSize.current !== pageSize) {
      lastPageSize.current = pageSize;
      setPageOffset(0);
    }
  }, [pageSize]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const [upgradeModalTier, setUpgradeModalTier] = useState(null);
  const [missingOutPromoOpen, setMissingOutPromoOpen] = useState(false);
  const pendingLightboxIndexRef = useRef(null);
  const requestId = useRef(0);
  const accountTier = user?.tier || 'free';
  const accountTierNorm = normalizeAccountTier(accountTier);
  const showCreatorUpgradeBanner = accountTierNorm !== 'ultimate' && accountTierNorm !== 'admin';

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
    const params = new URLSearchParams({ tier, limit: String(pageSize), offset: String(pageOffset) });
    apiGet(`/api/creators/${slug}/media?${params}`, {
      items: [],
      page: { offset: pageOffset, limit: pageSize, returned: 0, total: 0 },
    }).then((data) => {
      if (id !== requestId.current) return;
      setItems(data.items || []);
      setPageInfo(data.page || { offset: pageOffset, limit: pageSize, returned: 0, total: 0 });
      if (data.totals) setTotals(data.totals);
      setLoading(false);
    });
  }, [slug, tier, user?.tier, pageOffset, pageSize]);

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

  const playableItems = useMemo(() => items.filter((it) => !it.locked && !isLockedTier(it.tier, accountTier)), [items, accountTier]);

  useEffect(() => {
    if (accountTierNorm !== 'free') {
      pendingLightboxIndexRef.current = null;
      setMissingOutPromoOpen(false);
    }
  }, [accountTierNorm]);

  function selectTier(t) {
    if (canAccessManifestTier(accountTier, t)) {
      setTier(t);
      return;
    }
    setUpgradeModalTier(t);
    recordEvent('creator_tier_locked_click', {
      category: 'creator',
      payload: { slug, tier: t },
    });
  }
  const totalForTier = Number(totals?.byTier?.[tier]?.count || pageInfo.total || 0);
  const serverLimit = Number(pageInfo.limit || pageSize);
  const serverReturned = Number(pageInfo.returned || items.length || 0);
  /** Some backends can cap rows lower than requested. Use the real returned page width
   *  so page count + next offset stay correct for every tier. */
  const resolvedLimit = Math.max(1, serverReturned || serverLimit || pageSize);
  const resolvedOffset = Number(pageInfo.offset || 0);
  const rangeStart = totalForTier > 0 ? resolvedOffset + 1 : 0;
  const rangeEnd = totalForTier > 0 ? Math.min(totalForTier, resolvedOffset + items.length) : 0;
  const totalPages = Math.max(1, Math.ceil(totalForTier / resolvedLimit));
  const currentPage = Math.min(totalPages, Math.floor(resolvedOffset / resolvedLimit) + 1);

  const continueAfterMissingOutPromo = useCallback(() => {
    setMissingOutPromoOpen(false);
    const idx = pendingLightboxIndexRef.current;
    pendingLightboxIndexRef.current = null;
    if (idx == null || idx < 0) return;
    const item = playableItems[idx];
    if (!item) return;
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
  }, [playableItems, slug]);

  const dismissMissingOutForUpgrade = useCallback(() => {
    pendingLightboxIndexRef.current = null;
    setMissingOutPromoOpen(false);
    recordEvent('creator_missing_out_promo_upgrade_click', {
      category: 'creator',
      payload: { slug },
    });
  }, [slug]);

  const openLightbox = useCallback(
    (item) => {
      const idx = playableItems.findIndex((it) => it.key === item.key);
      if (idx < 0) return;

      const kind = item.kind || classifyMedia(item.name);
      const showMissingOut =
        accountTierNorm === 'free' && kind === 'video' && Math.random() < MISSING_OUT_PROMO_CHANCE;

      if (showMissingOut) {
        pendingLightboxIndexRef.current = idx;
        setMissingOutPromoOpen(true);
        recordEvent('creator_missing_out_promo', {
          category: 'creator',
          payload: {
            slug,
            key: item.key,
            tier: item.tier,
          },
        });
        return;
      }

      setLightboxIndex(idx);
      recordEvent('media_lightbox_open', {
        category: 'media',
        payload: {
          slug,
          key: item.key,
          kind,
          tier: item.tier,
        },
      });
    },
    [playableItems, slug, accountTierNorm],
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
              <Unlock size={12} /> {formatCount(tierCounts.free.count)} free
            </span>
            <span className="lw-tier-chip locked">
              <Lock size={12} /> {formatCount(totals?.count || 0)} total
            </span>
          </div>
        </div>
      </section>

      <section className="lw-toolbar lw-creator-tier-toolbar">
        <div className="lw-creator-tier-toolbar-left">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-white/70">
            Browsing <b className="text-white">{TIER_LABELS[tier]}</b>
            <span className="text-white/45">Your tier: {accountTierLabel(accountTier)}</span>
          </div>
          {showCreatorUpgradeBanner ? (
            <p className="lw-creator-upgrade-hint m-0 text-[13px] leading-snug text-white/60">
              <Link to="/checkout" className="lw-creator-upgrade-link font-semibold text-[var(--color-primary-light)] hover:underline">
                Upgrade to access more videos
              </Link>{' '}
              — unlock every tier and the full mirrored library.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {TIER_ORDER.map((t) => {
            const count = tierCounts[t]?.count || 0;
            const active = tier === t;
            const lockedTab = !canAccessManifestTier(accountTier, t);
            return (
              <button
                key={t}
                type="button"
                className={`lw-filter ${active ? 'active' : ''} ${lockedTab ? 'lw-filter--tier-locked' : ''}`}
                aria-pressed={active}
                aria-label={
                  lockedTab && !active
                    ? `${TIER_LABELS[t]} — requires upgrade (${formatCount(count)} items)`
                    : `${TIER_LABELS[t]}, ${formatCount(count)} items`
                }
                onClick={() => selectTier(t)}
              >
                {t === 'free' ? <Unlock size={12} /> : <Lock size={12} />}
                {TIER_LABELS[t]}
                <span className="text-white/60">{formatCount(count)}</span>
              </button>
            );
          })}
          {showCreatorUpgradeBanner ? (
            <Link
              to="/checkout"
              className="lw-filter lw-filter--upgrade-cta"
              onClick={() =>
                recordEvent('creator_tier_strip_upgrade', {
                  category: 'creators',
                  payload: { slug },
                })
              }
            >
              <Crown size={12} aria-hidden />
              Upgrade to unlock more content
            </Link>
          ) : null}
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
        <GridPagination
          idPrefix="creator-media"
          page={currentPage}
          totalPages={totalPages}
          disabled={loading}
          onPrev={() => setPageOffset(Math.max(0, resolvedOffset - resolvedLimit))}
          onNext={() => setPageOffset(resolvedOffset + resolvedLimit)}
          summary={
            <span className="text-[13px] text-white/70">
              Showing {formatCount(rangeStart)}-{formatCount(rangeEnd)} of {formatCount(totalForTier)}{' '}
              {TIER_LABELS[tier]} files.
            </span>
          }
        />
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

      {missingOutPromoOpen ? (
        <MissingOutUpgradeModal
          onContinueWatching={continueAfterMissingOutPromo}
          onUpgrade={dismissMissingOutForUpgrade}
        />
      ) : null}

      {upgradeModalTier ? <TierUpgradeModal tierKey={upgradeModalTier} onClose={() => setUpgradeModalTier(null)} /> : null}
    </div>
  );
}
