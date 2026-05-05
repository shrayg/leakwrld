import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  fetchComments,
  fetchMe,
  fetchPreviewList,
  fetchRandomVideos,
  fetchRecommendations,
  fetchShortsStats,
  fetchList,
  postComment,
  postShortsLike,
  postShortsView,
} from '../api/client';
import { FOLDER_TO_CLEAN, folderDisplayName } from '../lib/cleanUrls';
import { seoCleanTitle } from '../lib/seoTitle';
import { buildVideoId, sendTelemetry } from '../lib/telemetry';

const SHORTS_CATEGORIES = Object.keys(FOLDER_TO_CLEAN);
const SHORTS_TAB_THUMBS = {
  'NSFW Straight': '/assets/thumbnails/omegle.jpg',
  'Alt and Goth': '/assets/thumbnails/tiktok.png',
  Petitie: '/assets/thumbnails/snapchat.jpg',
  'Teen (18+ only)': '/assets/thumbnails/liveslips.png',
  MILF: '/assets/thumbnails/feet.png',
  Asian: '/assets/thumbnails/snapchat.jpg',
  Ebony: '/assets/thumbnails/tiktok.png',
  Feet: '/assets/thumbnails/feet.png',
  Hentai: '/assets/thumbnails/liveslips.png',
  Yuri: '/assets/thumbnails/liveslips.png',
  Yaoi: '/assets/thumbnails/feet.png',
  'Nip Slips': '/assets/thumbnails/liveslips.png',
  Omegle: '/assets/thumbnails/omegle.jpg',
  'OF Leaks': '/assets/thumbnails/onlyfans.png',
};

/** Thumbnails match homepage / categories cards (same “folder” icons as before) */
const TABS = [
  { label: 'Everything', cats: 'ALL', thumb: '/assets/thumbnails/shorts.png' },
  ...SHORTS_CATEGORIES.map((folder) => ({
    label: folderDisplayName(folder),
    cats: folder,
    thumb: SHORTS_TAB_THUMBS[folder] || '/assets/thumbnails/shorts.png',
  })),
];

const MOBILE_PRELOAD_OFFSETS = [-2, -1, 1, 2];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function videoKey(video) {
  return video.name || '';
}

function formatCount(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n || 0);
}

function filterByTab(master, tab) {
  if (!master.length) return [];
  const subset = tab === 'ALL' ? master : master.filter((v) => v.category === tab);
  return shuffle(subset);
}

function filterByControls(master, tab, rawQuery) {
  if (!master.length) return [];
  const q = String(rawQuery || '').trim().toLowerCase();
  const byTab = filterByTab(master, tab);
  if (!q) return byTab;
  return byTab.filter((v) => {
    const title = seoCleanTitle(v.name || '', v.folder || v.category || '').toLowerCase();
    const name = String(v.name || '').toLowerCase();
    const category = String(v.category || '').toLowerCase();
    return title.includes(q) || name.includes(q) || category.includes(q);
  });
}

async function loadFolderVideos(folder, useAuthList) {
  const res = await (useAuthList ? fetchList(folder) : fetchPreviewList(folder));
  if (!res.ok) return [];
  const d = res.data || {};
  if (d.type === 'subfolders' && Array.isArray(d.subfolders) && d.subfolders.length) {
    const subs = await Promise.all(
      d.subfolders.map(async (sub) => {
        const r2 = await fetchList(folder, sub);
        if (!r2.ok) return [];
        const files = Array.isArray(r2.data?.files) ? r2.data.files : [];
        return files.filter((v) => v.type === 'video').map((v) => ({ ...v, category: folder }));
      }),
    );
    return subs.flat();
  }
  const files = Array.isArray(d.files) ? d.files : [];
  return files.filter((v) => v.type === 'video').map((v) => ({ ...v, category: folder }));
}

async function loadVideosInner(me) {
  try {
    const rec = await fetchRecommendations(120, { surface: 'shorts' });
    if (rec.ok && Array.isArray(rec.data?.files) && rec.data.files.length > 0) {
      return rec.data.files.map((v) => ({ ...v, category: v.folder || v.category || 'Mixed' }));
    }
  } catch {}
  const hasTier = me?.authed && me.tier >= 1;
  const folders = SHORTS_CATEGORIES;
  let videos = [];

  if (hasTier) {
    const parts = await Promise.all(folders.map((f) => loadFolderVideos(f, true)));
    videos = parts.flat();
  }

  if (videos.length === 0) {
    const parts = await Promise.all(folders.map((f) => loadFolderVideos(f, false)));
    videos = parts.flat();
  }

  if (videos.length === 0) {
    const rv = await fetchRandomVideos({ limit: '50', sort: 'random' });
    if (rv.ok && rv.data?.files) {
      videos = rv.data.files
        .filter((f) => f.type === 'video' || (f.name && /\.(mp4|webm|mov)$/i.test(f.name)))
        .map((v) => ({ ...v, category: v.folder || 'Mixed' }));
    }
  }

  return shuffle(videos);
}

function buildShareUrl(key) {
  if (typeof window === 'undefined') return '';
  const u = new URL('/shorts', window.location.origin);
  u.searchParams.set('v', key);
  return u.toString();
}

export function ShortsPage() {
  const videoRef = useRef(null);
  const stageRef = useRef(null);
  const phoneRef = useRef(null);
  const trackRef = useRef(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const [me, setMe] = useState(null);
  const [masterVideos, setMasterVideos] = useState([]);
  const [allVideos, setAllVideos] = useState([]);
  const [tab, setTab] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentIndexRef = useRef(0);
  currentIndexRef.current = currentIndex;
  const [allStats, setAllStats] = useState({});
  const [likedSet, setLikedSet] = useState(() => new Set());
  const viewedSet = useRef(new Set());
  const goPrevRef = useRef(() => {});
  const goNextRef = useRef(() => {});
  const [loading, setLoading] = useState(true);
  const [userWantsSound, setUserWantsSound] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [seek, setSeek] = useState(0);
  const [commentCount, setCommentCount] = useState(0);
  const [shareToast, setShareToast] = useState(false);
  const [shortsMenuOpen, setShortsMenuOpen] = useState(false);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [videoFitMode, setVideoFitMode] = useState('cover');
  const urlSyncReady = useRef(false);
  const wheelStateRef = useRef({ lockUntil: 0, deltaY: 0 });
  const touchStateRef = useRef({
    active: false,
    startY: 0,
    startTs: 0,
    lastY: 0,
    lastDragY: 0,
    peekStarted: false,
  });
  const neighborPreloadRef = useRef(new Map());
  const prevPeekVideoRef = useRef(null);
  const nextPeekVideoRef = useRef(null);

  useEffect(() => {
    document.title = 'Shorts — Pornwrld';
    document.body.classList.add('is-shorts-page');
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.title = 'Pornwrld';
      document.body.classList.remove('is-shorts-page');
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return;
      // Shorts filters: only the menu button opens/closes — Escape does not dismiss the panel.
      if (commentsOpen) {
        setCommentsOpen(false);
        e.preventDefault();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commentsOpen]);

  useEffect(() => {
    const cat = searchParams.get('cat');
    if (cat && TABS.some((t) => t.cats === cat)) {
      setTab(cat);
    }
    const q = searchParams.get('q') || '';
    setSearchQuery(q);
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const meRes = await fetchMe();
      const u = meRes.ok ? meRes.data : { authed: false, tier: 0 };
      if (cancelled) return;
      setMe(u);

      const statsRes = await fetchShortsStats();
      if (statsRes.ok && statsRes.data && typeof statsRes.data === 'object') {
        setAllStats(statsRes.data);
      }

      const list = await loadVideosInner(u);
      if (cancelled) return;
      setMasterVideos(list);
      list.slice(0, 20).forEach((v, idx) => {
        sendTelemetry('impression', {
          surface: 'shorts',
          slot: idx,
          rank: idx + 1,
          videoId: v.videoId || buildVideoId(v.folder, v.subfolder || '', v.name, v.vault),
          folder: v.folder,
          subfolder: v.subfolder || '',
          name: v.name,
        });
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!masterVideos.length) {
      setAllVideos([]);
      return;
    }
    setAllVideos(filterByControls(masterVideos, tab, searchQuery));
    setCurrentIndex(0);
  }, [tab, masterVideos, searchQuery]);

  useEffect(() => {
    if (!allVideos.length) {
      urlSyncReady.current = true;
      return;
    }
    const v = searchParams.get('v');
    if (v) {
      const decoded = decodeURIComponent(v);
      const idx = allVideos.findIndex((x) => videoKey(x) === decoded);
      if (idx >= 0) setCurrentIndex(idx);
    }
    urlSyncReady.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-apply ?v= when the filtered list changes, not when syncUrl updates the URL
  }, [allVideos]);

  const video = allVideos[currentIndex];
  const prevVideo = currentIndex > 0 ? allVideos[currentIndex - 1] : null;
  const nextVideo = currentIndex < allVideos.length - 1 ? allVideos[currentIndex + 1] : null;

  const displayTitle = useMemo(() => {
    if (!video) return '';
    return seoCleanTitle(video.name || '', video.folder || video.category || '');
  }, [video]);

  const statsForCurrent = useMemo(() => {
    if (!video) return { views: 0, likes: 0 };
    const k = videoKey(video);
    return allStats[k] || { views: 0, likes: 0 };
  }, [video, allStats]);

  const shareUrl = useMemo(() => {
    if (!video) return '';
    return buildShareUrl(videoKey(video));
  }, [video]);

  const syncUrl = useCallback(() => {
    if (!video) return;
    const k = videoKey(video);
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set('v', k);
        if (tab !== 'ALL') p.set('cat', tab);
        else p.delete('cat');
        if (searchQuery.trim()) p.set('q', searchQuery.trim());
        else p.delete('q');
        return p;
      },
      { replace: true },
    );
  }, [video, tab, searchQuery, setSearchParams]);

  useEffect(() => {
    if (!video || !urlSyncReady.current) return;
    syncUrl();
  }, [currentIndex, video, syncUrl]);

  useEffect(() => {
    if (!video) return;
    const k = videoKey(video);
    if (viewedSet.current.has(k)) return;
    viewedSet.current.add(k);
    postShortsView(k).then((r) => {
      if (r.ok && r.data) {
        setAllStats((prev) => ({
          ...prev,
          [k]: {
            views: r.data.views ?? prev[k]?.views ?? 0,
            likes: r.data.likes ?? prev[k]?.likes ?? 0,
          },
        }));
      }
    });
    sendTelemetry('shorts_progress', {
      surface: 'shorts',
      videoId: video.videoId || buildVideoId(video.folder, video.subfolder || '', video.name, video.vault),
      folder: video.folder,
      subfolder: video.subfolder || '',
      name: k,
      watchMs: 1000,
      percentWatched: 1,
    });
  }, [video]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !video) return;
    el.play().catch(() => {});
  }, [video]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !userWantsSound;
    if (!el.paused) return;
    el.play().catch(() => {});
  }, [userWantsSound]);

  useEffect(() => {
    const supportsDom = typeof document !== 'undefined';
    if (!supportsDom) return undefined;
    const isMobileViewport = typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches;
    if (!isMobileViewport || !allVideos.length) return undefined;

    function ensurePreloader(slot) {
      if (neighborPreloadRef.current.has(slot)) return neighborPreloadRef.current.get(slot);
      const el = document.createElement('video');
      el.preload = 'auto';
      el.muted = true;
      el.playsInline = true;
      el.setAttribute('webkit-playsinline', 'true');
      neighborPreloadRef.current.set(slot, el);
      return el;
    }

    function warmDecode(el) {
      if (!el) return;
      const onCanPlay = () => {
        const p = el.play();
        if (p && typeof p.then === 'function') {
          p.then(() => el.pause()).catch(() => {});
        }
      };
      el.addEventListener('canplay', onCanPlay, { once: true });
    }

    const activeSlots = new Set();
    for (const offset of MOBILE_PRELOAD_OFFSETS) {
      const idx = currentIndex + offset;
      const item = idx >= 0 && idx < allVideos.length ? allVideos[idx] : null;
      const slot = String(offset);
      const el = ensurePreloader(slot);
      activeSlots.add(slot);
      if (item?.src) {
        if (el.src !== item.src) {
          el.src = item.src;
          el.load();
          warmDecode(el);
        }
      } else {
        el.removeAttribute('src');
        el.load();
      }
    }

    for (const [slot, el] of neighborPreloadRef.current.entries()) {
      if (activeSlots.has(slot)) continue;
      el.removeAttribute('src');
      el.load();
    }

    return undefined;
  }, [allVideos, currentIndex]);

  useEffect(
    () => () => {
      for (const el of neighborPreloadRef.current.values()) {
        if (!el) continue;
        el.removeAttribute('src');
        el.load();
      }
      neighborPreloadRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    function onLoadedMetadata() {
      if (!el.videoWidth || !el.videoHeight) return;
      setVideoFitMode(el.videoWidth > el.videoHeight ? 'contain' : 'cover');
    }
    el.addEventListener('loadedmetadata', onLoadedMetadata);
    return () => el.removeEventListener('loadedmetadata', onLoadedMetadata);
  }, [video]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onTime = () => {
      if (!el.duration) return;
      const pct = (el.currentTime / el.duration) * 1000;
      setSeek(pct);
      const now = Date.now();
      if (video && !el.paused && (!el._lastTelemetryTs || now - el._lastTelemetryTs > 5000)) {
        el._lastTelemetryTs = now;
        sendTelemetry('shorts_progress', {
          surface: 'shorts',
          videoId: video.videoId || buildVideoId(video.folder, video.subfolder || '', video.name, video.vault),
          folder: video.folder,
          subfolder: video.subfolder || '',
          name: videoKey(video),
          positionSec: el.currentTime,
          durationSec: el.duration,
          percentWatched: (el.currentTime / el.duration) * 100,
          completed: (el.currentTime / el.duration) >= 0.95,
          watchMs: 5000,
        });
      }
    };
    el.addEventListener('timeupdate', onTime);
    return () => el.removeEventListener('timeupdate', onTime);
  }, [video]);

  useEffect(() => {
    if (!video) {
      setCommentCount(0);
      return;
    }
    const k = videoKey(video);
    fetchComments(k).then((r) => {
      if (r.ok && Array.isArray(r.data?.comments)) setCommentCount(r.data.comments.length);
    });
  }, [video]);

  useEffect(() => {
    if (!video || !commentsOpen) return;
    const k = videoKey(video);
    fetchComments(k).then((r) => {
      if (r.ok && r.data?.comments) {
        setComments(r.data.comments);
        setCommentCount(r.data.comments.length);
      }
    });
  }, [video, commentsOpen]);

  function goPrev() {
    if (currentIndex > 0) setCurrentIndex((i) => i - 1);
  }

  function goNext() {
    if (currentIndex < allVideos.length - 1) {
      setCurrentIndex((i) => i + 1);
      return;
    }
    if (masterVideos.length > 1) {
      const more = shuffle(masterVideos.slice());
      setAllVideos((prev) => [...prev, ...more]);
      setCurrentIndex((i) => i + 1);
    }
  }

  goPrevRef.current = goPrev;
  goNextRef.current = goNext;

  useEffect(() => {
    function onKeyDown(e) {
      if (commentsOpen) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'J') {
        goNextRef.current();
        e.preventDefault();
      } else if (e.key === 'ArrowUp' || e.key === 'k' || e.key === 'K') {
        goPrevRef.current();
        e.preventDefault();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commentsOpen]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const isBlockedTarget = (target) => {
      if (!target || !target.closest) return false;
      return Boolean(
        target.closest('#shorts-tabs-wrap') ||
          target.closest('.shorts-menu-backdrop') ||
          target.closest('.shorts-comment-panel') ||
          target.closest('.shorts-seekbar-wrap') ||
          target.closest('button, a, input, textarea'),
      );
    };

    function snapBack() {
      setIsDragging(false);
      setDragOffsetY(0);
    }

    function handleWheel(e) {
      if (commentsOpen || shortsMenuOpen || !video) return;
      if (isBlockedTarget(e.target)) return;
      e.preventDefault();
      const now = Date.now();
      const wheelState = wheelStateRef.current;
      if (now < wheelState.lockUntil) return;
      wheelState.deltaY += e.deltaY;
      if (Math.abs(wheelState.deltaY) < 34) return;
      if (wheelState.deltaY > 0) goNextRef.current();
      else goPrevRef.current();
      wheelState.deltaY = 0;
      wheelState.lockUntil = now + 380;
    }

    function handleTouchStart(e) {
      if (commentsOpen || shortsMenuOpen || !video) return;
      if (!e.touches || e.touches.length !== 1) return;
      if (isBlockedTarget(e.target)) return;
      const t = e.touches[0];
      touchStateRef.current = {
        active: true,
        startY: t.clientY,
        lastY: t.clientY,
        startTs: performance.now(),
        lastDragY: 0,
        peekStarted: false,
      };
      setIsDragging(true);
      setDragOffsetY(0);
    }

    function slideHeightPx() {
      const phone = phoneRef.current;
      const h = phone?.clientHeight || stage.clientHeight || window.innerHeight || 520;
      return Math.max(1, Math.round(h));
    }

    function playPeek(dir) {
      const el = dir === 1 ? nextPeekVideoRef.current : prevPeekVideoRef.current;
      if (!el) return;
      el.muted = true;
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }

    function pausePeeks() {
      [prevPeekVideoRef.current, nextPeekVideoRef.current].forEach((el) => {
        if (!el) return;
        try { el.pause(); } catch (err) { /* noop */ }
      });
    }

    function handleTouchMove(e) {
      const state = touchStateRef.current;
      if (!state.active) return;
      if (!e.touches || e.touches.length !== 1) return;
      const y = e.touches[0].clientY;
      const dy = y - state.startY;
      state.lastY = y;
      e.preventDefault();
      const slideH = slideHeightPx();
      let visual = dy;
      if (dy > slideH) visual = slideH + (dy - slideH) * 0.25;
      else if (dy < -slideH) visual = -slideH + (dy + slideH) * 0.25;
      state.lastDragY = visual;
      setDragOffsetY(visual);

      // Start peek playback symmetrically as soon as direction is clear
      if (!state.peekStarted && Math.abs(dy) > 24) {
        state.peekStarted = true;
        playPeek(dy < 0 ? 1 : -1);
      }
    }

    function commitSlide(direction) {
      // direction: 1 = next (swipe up), -1 = prev (swipe down)
      const h = slideHeightPx();
      const target = direction === 1 ? -h : h;
      const cur = touchStateRef.current.lastDragY ?? 0;
      // Near ±h, React may not run a transform transition to the same value — looks like a hang while
      // the new clip decodes. Use a short two-leg animation (kick away, then settle on target).
      const near = Math.abs(cur - target) <= 18;
      const kick = Math.min(28, Math.max(14, Math.floor(h * 0.035)));
      const mid = near ? target - direction * kick : target;
      const legsLeftStart = near ? 2 : 1;

      playPeek(direction);
      setIsDragging(false);

      function doSwap() {
        setIsSwapping(true);
        if (direction === 1) goNextRef.current();
        else goPrevRef.current();
        setDragOffsetY(0);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setIsSwapping(false);
            pausePeeks();
          });
        });
      }

      requestAnimationFrame(() => {
        setDragOffsetY(mid);
        window.setTimeout(() => {
          const t = trackRef.current;
          if (!t) {
            doSwap();
            return;
          }
          let legsLeft = legsLeftStart;
          let finished = false;
          const onEnd = (e) => {
            if (e.target !== t || e.propertyName !== 'transform') return;
            if (finished) return;
            if (legsLeft > 1) {
              legsLeft -= 1;
              setDragOffsetY(target);
              return;
            }
            finished = true;
            t.removeEventListener('transitionend', onEnd);
            window.clearTimeout(fallbackId);
            doSwap();
          };
          const fallbackId = window.setTimeout(() => {
            if (finished) return;
            finished = true;
            t.removeEventListener('transitionend', onEnd);
            doSwap();
          }, 700);
          t.addEventListener('transitionend', onEnd, { passive: true });
        }, 0);
      });
    }

    function handleTouchEnd() {
      const state = touchStateRef.current;
      if (!state.active) return;
      state.active = false;
      const dy = state.lastY - state.startY;
      const dt = Math.max(1, performance.now() - state.startTs);
      const velocity = dy / dt;
      const threshold = 72;
      const fastFlick = Math.abs(velocity) > 0.42 && Math.abs(dy) > 30;
      if (dy <= -threshold || (fastFlick && dy < 0)) {
        commitSlide(1);
        return;
      }
      if (dy >= threshold || (fastFlick && dy > 0)) {
        if (currentIndexRef.current <= 0) {
          snapBack();
          return;
        }
        commitSlide(-1);
        return;
      }
      snapBack();
    }

    function handleTouchCancel() {
      touchStateRef.current.active = false;
      snapBack();
    }

    stage.addEventListener('wheel', handleWheel, { passive: false });
    stage.addEventListener('touchstart', handleTouchStart, { passive: true });
    stage.addEventListener('touchmove', handleTouchMove, { passive: false });
    stage.addEventListener('touchend', handleTouchEnd, { passive: true });
    stage.addEventListener('touchcancel', handleTouchCancel, { passive: true });
    return () => {
      stage.removeEventListener('wheel', handleWheel);
      stage.removeEventListener('touchstart', handleTouchStart);
      stage.removeEventListener('touchmove', handleTouchMove);
      stage.removeEventListener('touchend', handleTouchEnd);
      stage.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [commentsOpen, shortsMenuOpen, video]);

  async function onToggleLike() {
    if (!video) return;
    const k = videoKey(video);
    const was = likedSet.has(k);
    const next = new Set(likedSet);
    if (was) next.delete(k);
    else next.add(k);
    setLikedSet(next);
    const r = await postShortsLike(k, !was);
    if (r.ok && r.data) {
      setAllStats((prev) => ({
        ...prev,
        [k]: {
          ...(prev[k] || {}),
          views: r.data.views ?? prev[k]?.views ?? 0,
          likes: r.data.likes ?? 0,
        },
      }));
    }
  }

  async function sendComment() {
    if (!video || !commentText.trim()) return;
    const k = videoKey(video);
    const r = await postComment(k, commentText.trim());
    if (r.ok) {
      setCommentText('');
      const c = await fetchComments(k);
      if (c.ok && c.data?.comments) {
        setComments(c.data.comments);
        setCommentCount(c.data.comments.length);
      }
    }
  }

  async function onShare() {
    const url = shareUrl;
    if (!url) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Pornwrld Short', url });
      } else {
        await navigator.clipboard.writeText(url);
        setShareToast(true);
        window.setTimeout(() => setShareToast(false), 2000);
      }
    } catch {
      try {
        await navigator.clipboard.writeText(url);
        setShareToast(true);
        window.setTimeout(() => setShareToast(false), 2000);
      } catch {
        /* ignore */
      }
    }
  }

  const k = video ? videoKey(video) : '';
  const liked = video && likedSet.has(k);

  function onTabSelect(cats) {
    setTab(cats);
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete('v');
        if (cats === 'ALL') p.delete('cat');
        else p.set('cat', cats);
        return p;
      },
      { replace: true },
    );
    urlSyncReady.current = false;
  }

  function onSearchInput(nextValue) {
    setSearchQuery(nextValue);
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete('v');
        if (nextValue.trim()) p.set('q', nextValue.trim());
        else p.delete('q');
        return p;
      },
      { replace: true },
    );
    urlSyncReady.current = false;
  }

  function clearFilters() {
    setTab('ALL');
    setSearchQuery('');
    setCurrentIndex(0);
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete('v');
        p.delete('cat');
        p.delete('q');
        return p;
      },
      { replace: true },
    );
    urlSyncReady.current = false;
  }

  return (
    <>
      {shareToast && (
        <div className="shorts-share-toast" role="status">
          Link copied
        </div>
      )}

      <div
        className={'shorts-container' + (loading ? ' shorts-container--loading' : '')}
        id="shorts-container"
      >
        {loading && (
          <div className="shorts-loading" id="shorts-loading">
            <div className="shorts-loading-emoji" aria-hidden>
              ⏳
            </div>
            <h3>Loading Shorts…</h3>
          </div>
        )}

        {!loading && (
          <div className="shorts-feed-stage" ref={stageRef}>
            <div className="shorts-feed-phone" ref={phoneRef}>
              {video ? (
                <>
                  <div
                    ref={trackRef}
                    className={
                      'shorts-slide-track' +
                      ((isDragging || isSwapping) ? ' shorts-slide-track--dragging' : '') +
                      (isDragging && dragOffsetY > 4 ? ' shorts-slide-track--pull-prev' : '') +
                      (isDragging && dragOffsetY < -4 ? ' shorts-slide-track--pull-next' : '')
                    }
                    style={{ transform: dragOffsetY ? `translate3d(0, ${dragOffsetY}px, 0)` : undefined }}
                  >
                    {prevVideo ? (
                      <div className="shorts-slide shorts-slide--peek shorts-slide--prev">
                        <video
                          ref={prevPeekVideoRef}
                          className="shorts-video shorts-video--cover"
                          playsInline
                          muted
                          loop
                          preload="auto"
                          poster={prevVideo.thumb}
                          src={prevVideo.src}
                        />
                      </div>
                    ) : null}

                    <div className={'shorts-slide shorts-slide-active' + (isDragging ? ' shorts-slide--dragging' : '')}>
                      <video
                        ref={videoRef}
                        className={'shorts-video ' + (videoFitMode === 'contain' ? 'shorts-video--contain' : 'shorts-video--cover')}
                        src={video.src}
                        playsInline
                        loop
                        preload="auto"
                        muted={!userWantsSound}
                        poster={video.thumb}
                        onClick={() => {
                          setUserWantsSound(true);
                          const el = videoRef.current;
                          if (!el) return;
                          if (el.paused) el.play().catch(() => {});
                          else el.pause();
                        }}
                      />
                      <div className="shorts-feed-gradient" aria-hidden />
                      <div className="shorts-feed-meta">
                        <p className="shorts-feed-title">{displayTitle}</p>
                        {video.category ? <p className="shorts-feed-tag">{folderDisplayName(video.category)}</p> : null}
                      </div>

                      <div className="shorts-feed-rail" aria-label="Video actions">
                      <div className="shorts-feed-rail__desktop-nav hidden flex-col items-center gap-2.5 md:flex" aria-hidden={false}>
                        <button
                          className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-[rgba(8,8,12,0.55)] text-white transition duration-150 hover:scale-105 hover:bg-white/15"
                          type="button"
                          aria-label="Previous video"
                          onClick={goPrev}
                        >
                          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden>
                            <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" />
                          </svg>
                        </button>
                        <button
                          className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-[rgba(8,8,12,0.55)] text-white transition duration-150 hover:scale-105 hover:bg-white/15"
                          type="button"
                          aria-label="Next video"
                          onClick={goNext}
                        >
                          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden>
                            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
                          </svg>
                        </button>
                      </div>

                      <button
                        type="button"
                        className="shorts-feed-action"
                        aria-label={liked ? 'Unlike' : 'Like'}
                        aria-pressed={liked}
                        onClick={onToggleLike}
                      >
                        <span className={'shorts-feed-action__icon' + (liked ? ' text-[#ff4d6d]' : '')}>
                          <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden>
                            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                          </svg>
                        </span>
                        <span className="shorts-feed-action__label">{formatCount(statsForCurrent.likes)}</span>
                      </button>

                      <button
                        type="button"
                        className="shorts-feed-action"
                        aria-label="Comments"
                        onClick={() => {
                          setCommentsOpen((o) => !o);
                        }}
                      >
                        <span className="shorts-feed-action__icon">
                          <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden>
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                          </svg>
                        </span>
                        <span className="shorts-feed-action__label">{formatCount(commentCount)}</span>
                      </button>

                      <div className="shorts-feed-action shorts-feed-action--static" aria-label="Views">
                        <span className="shorts-feed-action__icon">
                          <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden>
                            <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
                          </svg>
                        </span>
                        <span className="shorts-feed-action__label">{formatCount(statsForCurrent.views)}</span>
                      </div>

                      <button type="button" className="shorts-feed-action" aria-label="Share link" onClick={onShare}>
                        <span className="shorts-feed-action__icon shorts-feed-action__icon--share">
                          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" aria-hidden>
                            <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13" />
                          </svg>
                        </span>
                        <span className="shorts-feed-action__share-text">Share</span>
                      </button>
                      </div>

                      <div
                        className={'shorts-seekbar-wrap' + (isDragging || isSwapping ? ' shorts-seekbar-wrap--inactive' : '')}
                      >
                        <input
                          type="range"
                          className="shorts-seekbar"
                          min={0}
                          max={1000}
                          step={1}
                          value={seek}
                          onChange={(e) => {
                            const el = videoRef.current;
                            if (!el?.duration) return;
                            const v = Number(e.target.value);
                            el.currentTime = (v / 1000) * el.duration;
                            setSeek(v);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    </div>

                    {nextVideo ? (
                      <div className="shorts-slide shorts-slide--peek shorts-slide--next">
                        <video
                          ref={nextPeekVideoRef}
                          className="shorts-video shorts-video--cover"
                          playsInline
                          muted
                          loop
                          preload="auto"
                          poster={nextVideo.thumb}
                          src={nextVideo.src}
                        />
                      </div>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="shorts-phone-empty">
                  <div className="shorts-loading">
                    <div className="shorts-loading-emoji" aria-hidden>
                      📱
                    </div>
                    <h3>No videos available right now</h3>
                    <p className="shorts-loading-sub">Check back soon — new content is added daily.</p>
                  </div>
                </div>
              )}

              {shortsMenuOpen && (
                <div
                  className="shorts-menu-backdrop"
                  aria-hidden
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                />
              )}

              <div
                className={'shorts-controls-wrap' + (shortsMenuOpen ? ' shorts-controls-wrap--open' : '')}
                id="shorts-tabs-wrap"
              >
                <div className="shorts-controls-head">
                  <div className="shorts-controls-title-group">
                    <p className="shorts-controls-title">Shorts</p>
                    <p className="shorts-controls-subtitle">
                      {tab === 'ALL' ? 'All categories' : folderDisplayName(tab)} {searchQuery.trim() ? '· Search on' : ''} ·{' '}
                      {allVideos.length} result{allVideos.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="shorts-controls-actions">
                    {me && me.tier < 2 && (
                      <Link to="/checkout" className="inline-flex min-h-[30px] w-max max-w-full items-center justify-center rounded-lg border border-[rgba(243,198,105,0.4)] bg-[linear-gradient(180deg,#f6d486_0%,#f3c669_100%)] px-2.5 text-[9px] font-extrabold uppercase tracking-[0.07em] text-[#17181a] no-underline shadow-[0_2px_12px_rgba(243,198,105,0.22)] transition hover:brightness-105">
                        Get Full Access
                      </Link>
                    )}
                  </div>
                  <div className="shorts-top-right-controls">
                    <button
                      type="button"
                      className="inline-flex h-9 min-h-9 min-w-[62px] items-center justify-center rounded-[10px] border border-[rgba(243,198,105,0.55)] bg-[linear-gradient(180deg,#1a1a1f_0%,#0c0c10_55%,#08080b_100%)] px-3 text-[10px] font-extrabold uppercase tracking-[0.08em] text-[#f3c669] shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_0_0_1px_rgba(243,198,105,0.12),0_8px_22px_rgba(0,0,0,0.55)] transition hover:border-[rgba(243,198,105,0.75)] hover:bg-[linear-gradient(180deg,#222228_0%,#12121a_55%,#0c0c12_100%)] hover:text-white active:scale-95"
                      onClick={clearFilters}
                      aria-label="Reset filters"
                      title="Reset"
                    >
                      Reset
                    </button>
                  </div>
                </div>
                <div className="shorts-controls-search">
                  <input
                    type="search"
                    className="shorts-controls-search-input"
                    placeholder="Search title or category"
                    value={searchQuery}
                    onChange={(e) => onSearchInput(e.target.value)}
                    aria-label="Search shorts"
                  />
                </div>
                <div className="shorts-tabs" id="shorts-tabs" role="tablist" aria-label="Category">
                  {TABS.map((t) => (
                    <button
                      key={t.cats}
                      type="button"
                      className={'shorts-tab' + (tab === t.cats ? ' shorts-tab--active' : '')}
                      role="tab"
                      aria-selected={tab === t.cats}
                      onClick={() => onTabSelect(t.cats)}
                    >
                      {t.thumb ? (
                        <img
                          className="shorts-tab__thumb"
                          src={t.thumb}
                          alt=""
                          width={14}
                          height={14}
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : null}
                      <span className="shorts-tab__label">{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                className={
                  'shorts-mobile-menu-btn' + (shortsMenuOpen ? ' shorts-mobile-menu-btn--open' : '')
                }
                id="shorts-mobile-menu-btn"
                aria-label={shortsMenuOpen ? 'Close shorts menu' : 'Open shorts menu'}
                aria-expanded={shortsMenuOpen}
                onClick={() => {
                  setCommentsOpen(false);
                  setShortsMenuOpen((o) => !o);
                }}
              >
                {shortsMenuOpen ? (
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" aria-hidden>
                    <path strokeWidth="2.4" strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" aria-hidden>
                    <path strokeWidth="2.4" strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {commentsOpen && (
        <button
          type="button"
          className="shorts-comment-backdrop"
          aria-label="Close comments"
          onClick={() => setCommentsOpen(false)}
        />
      )}

      <div
        className={'shorts-comment-panel shorts-comment-panel--tt' + (commentsOpen ? ' open' : '')}
        id="shorts-comment-panel"
      >
        <div className="comment-panel-header">
          <h4>Comments</h4>
          <button
            type="button"
            className="comment-panel-close"
            id="shorts-comment-close"
            onClick={() => setCommentsOpen(false)}
          >
            <X size={18} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>
        <div className="comment-panel-list" id="shorts-comment-list">
          {comments.map((c) => (
            <div key={c.id} className="comment-item">
              <span className="comment-user">{c.user}</span>
              <div className="comment-text">{c.text}</div>
            </div>
          ))}
        </div>
        <div className="comment-panel-input">
          <input
            type="text"
            className="comment-input"
            id="shorts-comment-input"
            placeholder="Add comment..."
            maxLength={500}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') sendComment();
            }}
          />
          <button type="button" className="comment-send-btn" id="shorts-comment-send" onClick={sendComment}>
            Post
          </button>
        </div>
      </div>
    </>
  );
}
