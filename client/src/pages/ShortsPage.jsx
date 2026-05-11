import {
  ChevronDown,
  ChevronUp,
  Filter,
  Heart,
  Menu,
  Play,
  Share2,
  ThumbsDown,
  User,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { apiGet } from '../api';
import { useAuth } from '../components/AuthContext';
import { UserAccountMenu } from '../components/UserAccountMenu';
import { recordEvent } from '../lib/analytics';
import { mediaUrl, TIER_LABELS } from '../lib/media';
import {
  manifestMediaLike,
  manifestMediaProgress,
  manifestMediaSessionStart,
  mediaPlaybackSessionId,
} from '../lib/mediaAnalytics';
import { displayCount, formatCount } from '../lib/metrics';

const NAV_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/shorts', label: 'Shorts' },
  { to: '/categories', label: 'Creators' },
  { to: '/checkout', label: 'Premium', premium: true },
];

const EMPTY_FILTERS = { creators: [], categories: [] };
const REACTION_PREFIX = 'lw_short_reaction_';
const FEED_PAGE_SIZE = 240;

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function reactionKey(item) {
  return `${REACTION_PREFIX}${item?.id || item?.key || ''}`;
}

function navClass(link) {
  return ({ isActive }) => `lw-shorts-drawer-link ${link.premium ? 'lw-premium-nav' : ''} ${isActive ? 'active' : ''}`.trim();
}

function clampIndex(value, length) {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, value));
}

function ShortVideoSlide({ item, isActive, offset, dragOffset, isDragging, muted }) {
  const videoRef = useRef(null);
  const playbackId = useMemo(() => mediaPlaybackSessionId(), [item.key]);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const isImage = item.kind === 'image' || String(item.ext || '').toLowerCase() === '.gif';

  useEffect(() => {
    if (isImage) return;
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    video.defaultMuted = true;
    video.autoplay = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    if (muted) video.setAttribute('muted', '');
    if (!isActive) {
      video.pause();
      setPlaying(false);
      return;
    }
    const attemptPlay = () => {
      const play = video.play();
      if (play && typeof play.then === 'function') {
        play.then(() => setPlaying(true)).catch(() => setPlaying(false));
      } else {
        setPlaying(true);
      }
    };
    attemptPlay();
    const retry = window.setTimeout(attemptPlay, 240);
    const onCanPlay = () => attemptPlay();
    const onUserGesture = () => attemptPlay();
    video.addEventListener('canplay', onCanPlay);
    window.addEventListener('pointerup', onUserGesture, { once: true });
    window.addEventListener('touchend', onUserGesture, { once: true });
    return () => {
      window.clearTimeout(retry);
      video.removeEventListener('canplay', onCanPlay);
      window.removeEventListener('pointerup', onUserGesture);
      window.removeEventListener('touchend', onUserGesture);
    };
  }, [isActive, muted, item.key, isImage]);

  useEffect(() => {
    if (isImage) return;
    const video = videoRef.current;
    if (!video || isActive) return;
    video.load();
  }, [isActive, item.key, isImage]);

  useEffect(() => {
    if (!isImage || !isActive) return;
    manifestMediaSessionStart({
      storageKey: item.key,
      creatorSlug: item.creatorSlug,
      kind: 'short',
      playbackSessionId: playbackId,
      durationSeconds: 0,
    });
  }, [isImage, isActive, item.key, item.creatorSlug, playbackId]);

  useEffect(() => {
    if (isImage) return;
    const video = videoRef.current;
    if (!video || !isActive) return;
    let lastCheckpoint = 0;
    let metaSent = false;

    const sendDuration = () => {
      const durationSeconds = Math.floor(video.duration || 0);
      if (durationSeconds <= 0 || metaSent) return;
      metaSent = true;
      manifestMediaProgress({
        storageKey: item.key,
        creatorSlug: item.creatorSlug,
        kind: 'short',
        playbackSessionId: playbackId,
        secondsDelta: 0,
        durationSeconds,
      });
    };

    const startSession = () => {
      manifestMediaSessionStart({
        storageKey: item.key,
        creatorSlug: item.creatorSlug,
        kind: 'short',
        playbackSessionId: playbackId,
        durationSeconds: Math.floor(video.duration || item.durationSeconds || 0),
      });
    };

    const flushProgress = (force = false) => {
      const current = Math.floor(video.currentTime || 0);
      let delta = current - lastCheckpoint;
      if (force && delta < 1 && current > lastCheckpoint) delta = 1;
      if (delta >= 1) {
        manifestMediaProgress({
          storageKey: item.key,
          creatorSlug: item.creatorSlug,
          kind: 'short',
          playbackSessionId: playbackId,
          secondsDelta: Math.min(120, delta),
          durationSeconds: Math.floor(video.duration || 0),
        });
        lastCheckpoint = current;
      }
    };

    const onLoaded = () => {
      setReady(true);
      sendDuration();
      startSession();
    };
    const onTime = () => flushProgress(false);
    const onPause = () => {
      setPlaying(false);
      flushProgress(true);
    };
    const onPlay = () => {
      setPlaying(true);
      startSession();
    };
    const onEnded = () => flushProgress(true);

    if (video.readyState >= 1) onLoaded();
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('pause', onPause);
    video.addEventListener('play', onPlay);
    video.addEventListener('ended', onEnded);

    return () => {
      flushProgress(true);
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('ended', onEnded);
    };
  }, [isActive, item, playbackId, isImage]);

  const togglePlayback = useCallback(() => {
    if (!isActive || isImage) return;
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      const play = video.play();
      if (play && typeof play.then === 'function') {
        play.then(() => setPlaying(true)).catch(() => setPlaying(false));
      } else {
        setPlaying(true);
      }
    } else {
      video.pause();
      setPlaying(false);
    }
  }, [isActive, isImage]);

  return (
    <article
      className={`lw-short-slide ${isActive ? 'active' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{ transform: `translate3d(0, calc(${offset * 100}% + ${dragOffset}px), 0)` }}
      aria-hidden={!isActive}
    >
      {isImage ? (
        <img
          className="lw-short-video lw-short-image"
          src={mediaUrl(item.key)}
          alt=""
          loading={isActive ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setReady(true)}
        />
      ) : (
        <video
          ref={videoRef}
          className="lw-short-video"
          src={mediaUrl(item.key)}
          preload="auto"
          autoPlay={isActive}
          playsInline
          loop
          muted={muted}
          crossOrigin="anonymous"
        />
      )}
      <button
        type="button"
        className="lw-short-play-surface"
        aria-label={isImage ? 'View short' : playing ? 'Pause short' : 'Play short'}
        tabIndex={isActive ? 0 : -1}
        onClick={togglePlayback}
      >
        {!ready ? <span className="lw-short-loading">Loading</span> : null}
        {ready && !isImage && !playing ? (
          <span className="lw-short-play-float">
            <Play size={34} fill="currentColor" />
          </span>
        ) : null}
      </button>
      <div className="lw-short-gradient" aria-hidden />
    </article>
  );
}

function ShortsDrawer({ open, onClose, user, loading, logout, openAuthModal }) {
  if (!open) return null;
  return (
    <>
      <button type="button" className="lw-shorts-drawer-scrim" aria-label="Close menu" onClick={onClose} />
      <aside className="lw-shorts-drawer" aria-label="Navigation menu">
        <div className="lw-shorts-drawer-head">
          <Link to="/" className="lw-brand" onClick={onClose}>
            <span>Leak World</span>
          </Link>
          <button type="button" className="lw-icon-btn" aria-label="Close menu" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <nav className="lw-shorts-drawer-nav">
          {NAV_LINKS.map((link, index) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/'}
              className={navClass(link)}
              style={{ '--i': index }}
              onClick={onClose}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
        <div className="lw-shorts-drawer-auth" style={{ '--i': NAV_LINKS.length }}>
          {loading ? (
            <span className="lw-user-chip">Checking</span>
          ) : user ? (
            <UserAccountMenu user={user} logout={logout} variant="mobile" onAfterNavigate={onClose} />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="lw-btn ghost"
                onClick={() => {
                  onClose();
                  openAuthModal('login');
                }}
              >
                Login
              </button>
              <button
                type="button"
                className="lw-btn primary"
                onClick={() => {
                  onClose();
                  openAuthModal('signup');
                }}
              >
                Sign up
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function FilterPanel({
  open,
  creators,
  categories,
  selectedCreators,
  selectedCategories,
  onToggleCreator,
  onToggleCategory,
  onAllCreators,
  onNoCreators,
  onAllCategories,
  onNoCategories,
  onClose,
  access,
}) {
  if (!open) return null;
  const unlockable = displayCount(access?.unlockableRaw || 0);
  return (
    <div className="lw-shorts-filter-panel" role="dialog" aria-label="Shorts filters">
      <div className="lw-shorts-filter-head">
        <div>
          <h2>Filters</h2>
          <p>{selectedCreators.size} creators / {selectedCategories.size} categories</p>
        </div>
        <div className="lw-shorts-filter-tier">
          <span>Your tier: {access?.userTierLabel || access?.userTier || 'Free'}</span>
          <b>{unlockable > 0 ? `Upgrade to unlock ${formatCount(unlockable)} more videos` : 'All videos unlocked'}</b>
        </div>
        <button type="button" className="lw-icon-btn" aria-label="Close filters" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      <section className="lw-shorts-filter-group">
        <div className="lw-shorts-filter-row">
          <h3>Creators</h3>
          <div className="flex gap-2">
            <button type="button" onClick={onAllCreators}>All</button>
            <button type="button" onClick={onNoCreators}>None</button>
          </div>
        </div>
        <div className="lw-shorts-filter-list">
          {creators.map((creator) => (
            <label key={creator.slug} className="lw-shorts-check">
              <input
                type="checkbox"
                checked={selectedCreators.has(creator.slug)}
                onChange={() => onToggleCreator(creator.slug)}
              />
              <span>{creator.name}</span>
              <b>{formatCount(displayCount(creator.count))}</b>
            </label>
          ))}
        </div>
      </section>

      <section className="lw-shorts-filter-group">
        <div className="lw-shorts-filter-row">
          <h3>Categories</h3>
          <div className="flex gap-2">
            <button type="button" onClick={onAllCategories}>All</button>
            <button type="button" onClick={onNoCategories}>None</button>
          </div>
        </div>
        <div className="lw-shorts-filter-list compact">
          {categories.map((category) => (
            <label key={category.slug} className="lw-shorts-check">
              <input
                type="checkbox"
                checked={selectedCategories.has(category.slug)}
                onChange={() => onToggleCategory(category.slug)}
              />
              <span>{category.name}</span>
              <b>{formatCount(displayCount(category.count))}</b>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}

export function ShortsPage() {
  const { user, loading: authLoading, logout, openAuthModal } = useAuth();
  const [shorts, setShorts] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [access, setAccess] = useState({ userTier: 'free', manifestTiers: ['free'] });
  const [pageInfo, setPageInfo] = useState({ offset: 0, returned: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedCreators, setSelectedCreators] = useState(null);
  const [selectedCategories, setSelectedCategories] = useState(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [muted, setMuted] = useState(true);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [reactions, setReactions] = useState({});
  const [shared, setShared] = useState(false);
  const initialVideoId = useRef(
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('v') : null,
  );
  const initialFeedSeed = useRef(
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('s') : null,
  );
  const pointerRef = useRef(null);
  const wheelLockRef = useRef(0);
  const requestSeq = useRef(0);
  const playerShellRef = useRef(null);
  const shareToastTimerRef = useRef(null);
  const feedSeedRef = useRef(
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  useEffect(() => {
    document.title = 'Shorts - Leak World';
    document.body.classList.add('lw-shorts-active-body');
    return () => {
      document.body.classList.remove('lw-shorts-active-body');
      if (shareToastTimerRef.current) {
        window.clearTimeout(shareToastTimerRef.current);
        shareToastTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++requestSeq.current;
    setLoading(true);
    setLoadingMore(false);
    feedSeedRef.current =
      initialFeedSeed.current ||
      (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    initialFeedSeed.current = null;
    const seed = encodeURIComponent(feedSeedRef.current);
    apiGet(`/api/shorts/feed?limit=${FEED_PAGE_SIZE}&offset=0&seed=${seed}`, { shorts: [], filters: EMPTY_FILTERS, access: { userTier: 'free', manifestTiers: ['free'] }, page: { offset: 0, returned: 0, total: 0 } })
      .then((data) => {
        if (cancelled || requestId !== requestSeq.current) return;
        setShorts(data?.shorts || []);
        setFilters(data?.filters || EMPTY_FILTERS);
        setAccess(data?.access || { userTier: 'free', manifestTiers: ['free'] });
        setPageInfo(data?.page || { offset: 0, returned: 0, total: 0 });
        setActiveIndex(0);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.tier]);

  const loadMore = useCallback(() => {
    const nextOffset = Number(pageInfo.offset || 0) + Number(pageInfo.returned || 0);
    if (loading || loadingMore || nextOffset <= 0 || nextOffset >= Number(pageInfo.total || 0)) return;
    setLoadingMore(true);
    const seed = encodeURIComponent(feedSeedRef.current);
    apiGet(`/api/shorts/feed?limit=${FEED_PAGE_SIZE}&offset=${nextOffset}&seed=${seed}`, { shorts: [], page: pageInfo })
      .then((data) => {
        const nextItems = data?.shorts || [];
        setShorts((prev) => {
          const seen = new Set(prev.map((item) => item.id));
          const merged = [...prev];
          for (const item of nextItems) {
            if (!seen.has(item.id)) merged.push(item);
          }
          return merged;
        });
        if (data?.page) setPageInfo(data.page);
      })
      .finally(() => setLoadingMore(false));
  }, [loading, loadingMore, pageInfo]);

  const allCreatorSlugs = useMemo(() => filters.creators.map((creator) => creator.slug), [filters.creators]);
  const allCategorySlugs = useMemo(() => filters.categories.map((category) => category.slug), [filters.categories]);
  const activeCreatorSet = useMemo(
    () => new Set(selectedCreators || allCreatorSlugs),
    [selectedCreators, allCreatorSlugs],
  );
  const activeCategorySet = useMemo(
    () => new Set(selectedCategories || allCategorySlugs),
    [selectedCategories, allCategorySlugs],
  );

  const visibleShorts = useMemo(
    () => shorts.filter((item) => {
      const itemCategories = item.categorySlugs?.length ? item.categorySlugs : [item.categorySlug];
      return activeCreatorSet.has(item.creatorSlug) && itemCategories.some((slug) => activeCategorySet.has(slug));
    }),
    [shorts, activeCreatorSet, activeCategorySet],
  );

  const current = visibleShorts[activeIndex] || null;
  const currentReaction = current ? reactions[current.id] ?? storageGet(reactionKey(current)) : null;
  const currentLikes = current ? Math.max(0, Number(current.likes || 0)) : 0;

  const navigateShort = useCallback(
    (delta) => {
      setActiveIndex((index) => clampIndex(index + delta, visibleShorts.length));
    },
    [visibleShorts.length],
  );

  useEffect(() => {
    setActiveIndex((index) => clampIndex(index, visibleShorts.length));
  }, [visibleShorts.length]);

  useEffect(() => {
    if (!initialVideoId.current || !visibleShorts.length) return;
    const idx = visibleShorts.findIndex((item) => item.id === initialVideoId.current);
    if (idx >= 0) setActiveIndex(idx);
    initialVideoId.current = null;
  }, [visibleShorts]);

  useEffect(() => {
    if (!current || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('v', current.id);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    setShared(false);
  }, [current?.id]);

  useEffect(() => {
    if (loading || loadingMore) return;
    if (activeCreatorSet.size === 0 || activeCategorySet.size === 0) return;
    if (Number(pageInfo.offset || 0) + Number(pageInfo.returned || 0) >= Number(pageInfo.total || 0)) return;
    if (visibleShorts.length === 0 || activeIndex >= Math.max(0, visibleShorts.length - 5)) {
      loadMore();
    }
  }, [
    activeIndex,
    activeCreatorSet.size,
    activeCategorySet.size,
    loadMore,
    loading,
    loadingMore,
    pageInfo,
    visibleShorts.length,
  ]);

  useEffect(() => {
    const onKey = (e) => {
      if (filterOpen || navOpen) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigateShort(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigateShort(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filterOpen, navOpen, navigateShort]);

  useEffect(() => {
    const onWheelLock = (e) => {
      const shell = playerShellRef.current;
      if (!shell) return;
      const target = e.target instanceof Node ? e.target : null;
      if (target && shell.contains(target)) return;
      e.preventDefault();
    };

    const onKeyLock = (e) => {
      const tag = String(e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;
      if (e.key === ' ' || e.key === 'PageDown' || e.key === 'PageUp' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
      }
    };

    window.addEventListener('wheel', onWheelLock, { passive: false });
    window.addEventListener('keydown', onKeyLock);
    return () => {
      window.removeEventListener('wheel', onWheelLock);
      window.removeEventListener('keydown', onKeyLock);
    };
  }, []);

  function toggleCreator(slug) {
    setSelectedCreators((prev) => {
      const next = new Set(prev || allCreatorSlugs);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
    setActiveIndex(0);
  }

  function toggleCategory(slug) {
    setSelectedCategories((prev) => {
      const next = new Set(prev || allCategorySlugs);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
    setActiveIndex(0);
  }

  function react(kind) {
    if (!current) return;
    const key = reactionKey(current);
    const previous = currentReaction;
    if (kind === 'like' && previous === 'like') return;
    const next = kind === 'like' ? 'like' : previous === kind ? null : kind;
    storageSet(key, next);
    setReactions((state) => ({ ...state, [current.id]: next }));
    if (kind === 'like' && previous !== 'like') {
      manifestMediaLike({ storageKey: current.key, creatorSlug: current.creatorSlug, kind: 'short' });
    }
    if (kind === 'dislike' && previous !== 'dislike') {
      recordEvent('short_dislike', {
        category: 'shorts',
        payload: { id: current.id, key: current.key, creatorSlug: current.creatorSlug },
      });
    }
  }

  async function shareCurrent() {
    if (!current || typeof window === 'undefined') return;
    const url = `${window.location.origin}/shorts?v=${encodeURIComponent(current.id)}`;
    const title = `${current.creatorName} short`;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      }
      setShared(true);
      if (shareToastTimerRef.current) window.clearTimeout(shareToastTimerRef.current);
      shareToastTimerRef.current = window.setTimeout(() => {
        setShared(false);
        shareToastTimerRef.current = null;
      }, 1600);
      recordEvent('short_share', {
        category: 'shorts',
        payload: { id: current.id, key: current.key, creatorSlug: current.creatorSlug },
      });
    } catch {
      /* user cancelled or clipboard unavailable */
    }
  }

  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    pointerRef.current = { id: e.pointerId, startY: e.clientY };
    setIsDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    if (!pointerRef.current || pointerRef.current.id !== e.pointerId) return;
    setDragOffset(Math.max(-160, Math.min(160, e.clientY - pointerRef.current.startY)));
  }

  function onPointerUp(e) {
    if (!pointerRef.current || pointerRef.current.id !== e.pointerId) return;
    const delta = e.clientY - pointerRef.current.startY;
    pointerRef.current = null;
    setIsDragging(false);
    setDragOffset(0);
    if (delta < -64) navigateShort(1);
    else if (delta > 64) navigateShort(-1);
  }

  function onWheel(e) {
    if (Math.abs(e.deltaY) < 28) return;
    e.preventDefault();
    const now = Date.now();
    if (now - wheelLockRef.current < 430) return;
    wheelLockRef.current = now;
    navigateShort(e.deltaY > 0 ? 1 : -1);
  }

  const tierLabels = access.manifestTiers.map((tier) => TIER_LABELS[tier] || tier).join(', ');
  const filterLabel = `${activeCreatorSet.size}/${allCreatorSlugs.length || 0}`;

  return (
    <div className="lw-shorts-page">
      <ShortsDrawer
        open={navOpen}
        onClose={() => setNavOpen(false)}
        user={user}
        loading={authLoading}
        logout={logout}
        openAuthModal={openAuthModal}
      />

      <section ref={playerShellRef} className="lw-shorts-player-shell">
        <div className="lw-shorts-topbar">
          <button type="button" className="lw-shorts-top-btn" aria-label="Open menu" onClick={() => setNavOpen(true)}>
            <Menu size={20} />
          </button>
          <button
            type="button"
            className="lw-shorts-filter-trigger"
            aria-label="Open shorts filters"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((open) => !open)}
          >
            <Filter size={17} />
            <span>{filterLabel}</span>
          </button>
          <div className="lw-shorts-account">
            {authLoading ? (
              <span className="lw-shorts-top-btn" aria-label="Checking account">
                <User size={18} />
              </span>
            ) : user ? (
              <UserAccountMenu user={user} logout={logout} variant="shorts" />
            ) : (
              <button type="button" className="lw-shorts-top-btn" aria-label="Login" onClick={() => openAuthModal('login')}>
                <User size={18} />
              </button>
            )}
          </div>
        </div>

        <FilterPanel
          open={filterOpen}
          creators={filters.creators}
          categories={filters.categories}
          selectedCreators={activeCreatorSet}
          selectedCategories={activeCategorySet}
          onToggleCreator={toggleCreator}
          onToggleCategory={toggleCategory}
          onAllCreators={() => {
            setSelectedCreators(new Set(allCreatorSlugs));
            setActiveIndex(0);
          }}
          onNoCreators={() => {
            setSelectedCreators(new Set());
            setActiveIndex(0);
          }}
          onAllCategories={() => {
            setSelectedCategories(new Set(allCategorySlugs));
            setActiveIndex(0);
          }}
          onNoCategories={() => {
            setSelectedCategories(new Set());
            setActiveIndex(0);
          }}
          onClose={() => setFilterOpen(false)}
          access={access}
        />

        <div
          className="lw-shorts-viewport"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          {loading ? (
            <div className="lw-short-state">Loading shorts...</div>
          ) : visibleShorts.length === 0 ? (
            <div className="lw-short-state">{loadingMore ? 'Loading more shorts...' : 'No videos match these filters.'}</div>
          ) : (
            [-1, 0, 1].map((offset) => {
              const item = visibleShorts[activeIndex + offset];
              if (!item) return null;
              return (
                <ShortVideoSlide
                  key={item.id}
                  item={item}
                  isActive={offset === 0}
                  offset={offset}
                  dragOffset={dragOffset}
                  isDragging={isDragging}
                  muted={muted}
                />
              );
            })
          )}
        </div>

        {current ? (
          <>
            <div className="lw-short-meta">
              <Link to={`/creators/${current.creatorSlug}`} className="lw-short-creator">
                {current.creatorName}
              </Link>
              <p>{(current.categoryLabels?.[0] || current.category || 'Featured')} / {TIER_LABELS[current.tier] || current.tier}</p>
              <p>{formatCount(current.views || 0)} views / {formatCount(currentLikes)} likes</p>
            </div>

            <div className="lw-short-actions" aria-label="Short actions">
              <button
                type="button"
                className={`lw-short-action ${currentReaction === 'like' ? 'active' : ''}`}
                aria-label="Like"
                aria-pressed={currentReaction === 'like'}
                disabled={currentReaction === 'like'}
                onClick={() => react('like')}
              >
                <Heart size={20} fill={currentReaction === 'like' ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                className={`lw-short-action ${currentReaction === 'dislike' ? 'active' : ''}`}
                aria-label="Dislike"
                aria-pressed={currentReaction === 'dislike'}
                onClick={() => react('dislike')}
              >
                <ThumbsDown size={20} fill={currentReaction === 'dislike' ? 'currentColor' : 'none'} />
              </button>
              <button type="button" className={`lw-short-action ${shared ? 'active' : ''}`} aria-label="Share" onClick={shareCurrent}>
                <Share2 size={20} />
              </button>
              {shared ? <span className="lw-short-share-toast">Link copied</span> : null}
              <button type="button" className="lw-short-action" aria-label={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted((v) => !v)}>
                {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>
            </div>

            <div className="lw-short-pc-nav" aria-label="Short navigation">
              <button type="button" className="lw-short-action" aria-label="Previous short" disabled={activeIndex <= 0} onClick={() => navigateShort(-1)}>
                <ChevronUp size={22} />
              </button>
              <button type="button" className="lw-short-action" aria-label="Next short" disabled={activeIndex >= visibleShorts.length - 1} onClick={() => navigateShort(1)}>
                <ChevronDown size={22} />
              </button>
            </div>
          </>
        ) : null}
      </section>

      <aside className="lw-shorts-side-panel">
        <span className="lw-eyebrow">Shorts</span>
        <h1>Swipe Feed</h1>
        <p>{formatCount(displayCount(pageInfo.total || visibleShorts.length))} videos available for {access.userTierLabel || access.userTier}. Access: {tierLabels || 'Free'}.</p>
        <div className="lw-shorts-side-stats">
          <span>{activeIndex + (visibleShorts.length ? 1 : 0)} / {visibleShorts.length}</span>
          <span>{activeCreatorSet.size} creators</span>
          <span>{activeCategorySet.size} categories</span>
        </div>
      </aside>
    </div>
  );
}
