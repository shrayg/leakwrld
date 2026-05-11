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
  const [preview, setPreview] = useState({ key: null, kind: null, fallbackThumbnail: null });
  const [mediaBroken, setMediaBroken] = useState(false);
  const fetchGen = useRef(0);
  /** One dwell timer per slide; do not reset when `url` upgrades from thumb → random-preview. */
  const dwellRef = useRef({ index: null, timerId: null });

  const n = creators?.length || 0;

  useEffect(() => {
    if (n && index >= n) setIndex(0);
  }, [n, index]);

  const safeIndex = n ? index % n : 0;
  const creator = n ? creators[safeIndex] : null;

  useEffect(() => {
    if (!creator) return;
    if (dwellRef.current.timerId) {
      clearTimeout(dwellRef.current.timerId);
      dwellRef.current = { index: null, timerId: null };
    }
    const gen = (fetchGen.current += 1);
    setMediaBroken(false);
    setPreview({ key: null, kind: null, fallbackThumbnail: null });
    const seed =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    apiGet(`/api/creators/${creator.slug}/random-preview?seed=${encodeURIComponent(seed)}`, {}).then(
      (data) => {
        if (gen !== fetchGen.current) return;
        if (data && typeof data === 'object') setPreview(data);
      },
    );
  }, [creator?.slug, safeIndex]);

  useEffect(() => {
    setMediaBroken(false);
  }, [preview?.key]);

  const kind = preview?.key
    ? preview.kind || classifyMedia(preview.name || '')
    : 'image';
  const primarySrc = preview?.key ? mediaUrl(preview.key) : '';
  const fallbackSrc = preview?.fallbackThumbnail || creator?.thumbnail || '';

  const usePrimary = Boolean(primarySrc) && !mediaBroken;
  const url = usePrimary ? primarySrc : fallbackSrc;
  const isVideo = usePrimary && kind === 'video';

  const urlRef = useRef(url);
  urlRef.current = url;

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
      if (!urlRef.current) {
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
        <div key={safeIndex} className="lw-top-gallery-slide-layer">
          <Link
            to={`/creators/${creator.slug}`}
            className="lw-hero-tile lw-top-gallery-tile"
            aria-label={`Open ${creator.name}`}
          >
            {url ? (
              isVideo ? (
                <video
                  className="lw-hero-tile-img"
                  src={url}
                  muted
                  playsInline
                  autoPlay
                  loop
                  preload="metadata"
                  onError={() => setMediaBroken(true)}
                />
              ) : (
                <img
                  className="lw-hero-tile-img"
                  src={url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onError={() => setMediaBroken(true)}
                />
              )
            ) : null}
            {!isVideo && preview?.key ? (
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
