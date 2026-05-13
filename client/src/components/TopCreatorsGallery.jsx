import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../api';
import { AdminCopyStorageKeyButton } from './AdminCopyStorageKeyButton';
import { classifyMedia, mediaUrl } from '../lib/media';

/** Time each slide stays fully visible before advancing (even pace, independent of fetch latency). */
const DWELL_MS = 3000;

/** @param {{ creators: unknown[], variant?: 'default' | 'hero' }} props */
export function TopCreatorsGallery({ creators, variant = 'default' }) {
  const [index, setIndex] = useState(0);
  const [preview, setPreview] = useState({ key: null, kind: null, name: null, fallbackThumbnail: null });
  const [overlayBroken, setOverlayBroken] = useState(false);
  const [overlayLoaded, setOverlayLoaded] = useState(false);
  const fetchGen = useRef(0);
  /** One dwell timer per slide; do not reset when `url` upgrades from thumb → random-preview. */
  const dwellRef = useRef({ index: null, timerId: null });
  const dwellArmUrlRef = useRef('');

  const n = creators?.length || 0;

  useEffect(() => {
    if (n && index >= n) setIndex(0);
  }, [n, index]);

  const safeIndex = n ? index % n : 0;
  const creator = n ? creators[safeIndex] : null;

  useEffect(() => {
    if (!creator) return undefined;
    if (dwellRef.current.timerId) {
      clearTimeout(dwellRef.current.timerId);
      dwellRef.current = { index: null, timerId: null };
    }
    const ac = new AbortController();
    const gen = (fetchGen.current += 1);
    setOverlayBroken(false);
    setOverlayLoaded(false);
    /** Keep the grid thumbnail visible immediately — no empty-tile flash while `/random-preview` returns. */
    setPreview({
      key: null,
      kind: null,
      name: null,
      fallbackThumbnail: creator.thumbnail || null,
    });
    const seed =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    apiGet(`/api/creators/${creator.slug}/random-preview?seed=${encodeURIComponent(seed)}`, {}, { signal: ac.signal }).then(
      (data) => {
        if (ac.signal.aborted || gen !== fetchGen.current) return;
        if (data && typeof data === 'object') {
          setPreview({
            key: data.key || null,
            kind: data.kind || null,
            name: data.name || null,
            fallbackThumbnail: data.fallbackThumbnail || creator.thumbnail || null,
          });
        }
      },
    );
    return () => ac.abort();
  }, [creator?.slug, creator?.thumbnail, safeIndex]);

  useEffect(() => {
    setOverlayBroken(false);
    setOverlayLoaded(false);
  }, [preview?.key]);

  const baseSrc = preview?.fallbackThumbnail || creator?.thumbnail || '';
  const rawKind = preview?.key ? preview.kind || classifyMedia(preview.name || '') : 'image';
  /** API is image-only for this endpoint; never treat as video in the hero. */
  const overlayIsImage = Boolean(preview?.key) && rawKind !== 'video';
  const overlaySrc = overlayIsImage && preview?.key ? mediaUrl(preview.key) : '';
  const showOverlay = Boolean(overlaySrc) && !overlayBroken;

  const mediaFetchPriority =
    (variant === 'hero' && safeIndex === 0) || (typeof baseSrc === 'string' && baseSrc.includes('/thumbnails/'))
      ? 'high'
      : 'low';

  dwellArmUrlRef.current = baseSrc || overlaySrc || '';

  useEffect(() => {
    if (n <= 1 || !creator) return undefined;

    let cancelled = false;
    let rafId = 0;
    let framesWaited = 0;

    const clearDwell = () => {
      if (dwellRef.current.timerId) {
        clearTimeout(dwellRef.current.timerId);
        dwellRef.current = { index: null, timerId: null };
      }
    };

    clearDwell();

    const armDwell = () => {
      if (cancelled) return;
      if (!dwellArmUrlRef.current) {
        framesWaited += 1;
        if (framesWaited > 120) {
          return;
        }
        rafId = requestAnimationFrame(armDwell);
        return;
      }
      const timerId = window.setTimeout(() => {
        dwellRef.current = { index: null, timerId: null };
        setIndex((i) => (i + 1) % n);
      }, DWELL_MS);
      dwellRef.current = { index: safeIndex, timerId };
    };

    armDwell();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      clearDwell();
    };
  }, [safeIndex, n, creator?.slug]);

  if (!creator) return null;

  const rootClass = variant === 'hero' ? 'lw-top-gallery lw-top-gallery--hero' : 'lw-top-gallery';

  return (
    <div className={rootClass}>
      <div className={`lw-top-gallery-viewport accent-${creator.accent || 'pink'}`}>
        <div key={creator.slug} className="lw-top-gallery-slide-layer">
          <Link
            to={`/creators/${creator.slug}`}
            className="lw-hero-tile lw-top-gallery-tile"
            aria-label={`Open ${creator.name}`}
          >
            <div className="lw-hero-tile-media-stack">
              {baseSrc ? (
                <img
                  className="lw-hero-tile-img lw-hero-tile-img--base"
                  src={baseSrc}
                  alt=""
                  loading={variant === 'hero' && safeIndex === 0 ? 'eager' : 'lazy'}
                  decoding="async"
                  fetchPriority={mediaFetchPriority}
                />
              ) : null}
              {showOverlay ? (
                <img
                  className={`lw-hero-tile-img lw-hero-tile-img--overlay ${overlayLoaded ? 'is-loaded' : ''}`}
                  src={overlaySrc}
                  alt=""
                  loading="eager"
                  decoding="async"
                  fetchPriority={overlaySrc && baseSrc ? 'high' : mediaFetchPriority}
                  onLoad={() => setOverlayLoaded(true)}
                  onError={() => setOverlayBroken(true)}
                />
              ) : null}
            </div>
            {showOverlay && preview?.key ? (
              <AdminCopyStorageKeyButton storageKey={preview.key} variant="hero" />
            ) : null}
            <div className="lw-hero-tile-meta">
              <span>#{creator.rank}</span>
              <b>{creator.name}</b>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
