import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { apiGet } from '../api';
import { classifyMedia, mediaUrl } from '../lib/media';

const CYCLE_MS = 6500;

export function TopCreatorsGallery({ creators }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [preview, setPreview] = useState({ key: null, kind: null, fallbackThumbnail: null });
  const [mediaBroken, setMediaBroken] = useState(false);
  const fetchGen = useRef(0);

  const n = creators?.length || 0;

  useEffect(() => {
    if (n && index >= n) setIndex(0);
  }, [n, index]);

  const safeIndex = n ? index % n : 0;
  const creator = n ? creators[safeIndex] : null;

  useEffect(() => {
    if (!creator) return;
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

  useEffect(() => {
    if (n <= 1 || paused) return undefined;
    const t = setInterval(() => {
      setIndex((i) => (i + 1) % n);
    }, CYCLE_MS);
    return () => clearInterval(t);
  }, [n, paused]);

  function go(delta) {
    if (!n) return;
    setIndex((i) => (i + delta + n) % n);
  }

  if (!creator) return null;

  const kind = preview?.key
    ? preview.kind || classifyMedia(preview.name || '')
    : 'image';
  const primarySrc = preview?.key ? mediaUrl(preview.key) : '';
  const fallbackSrc = preview?.fallbackThumbnail || creator.thumbnail || '';

  const usePrimary = Boolean(primarySrc) && !mediaBroken;
  const url = usePrimary ? primarySrc : fallbackSrc;
  const isVideo = usePrimary && kind === 'video';

  return (
    <div
      className="lw-top-gallery"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <Link
        to={`/creators/${creator.slug}`}
        className={`lw-hero-tile lw-top-gallery-tile accent-${creator.accent || 'pink'}`}
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
        <div className="lw-hero-tile-meta">
          <span>#{creator.rank}</span>
          <b>{creator.name}</b>
        </div>
      </Link>

      {n > 1 ? (
        <div className="lw-top-gallery-controls">
          <button
            type="button"
            className="lw-top-gallery-nav"
            aria-label="Previous creator"
            onClick={(e) => {
              e.preventDefault();
              go(-1);
            }}
          >
            <ChevronLeft size={20} />
          </button>
          <div className="lw-top-gallery-dots" aria-label="Top creators">
            {creators.map((c, i) => (
              <button
                key={c.slug}
                type="button"
                aria-current={i === safeIndex ? 'true' : undefined}
                className={`lw-top-gallery-dot${i === safeIndex ? ' lw-top-gallery-dot--active' : ''}`}
                aria-label={`Show ${c.name}`}
                onClick={(e) => {
                  e.preventDefault();
                  setIndex(i);
                }}
              />
            ))}
          </div>
          <button
            type="button"
            className="lw-top-gallery-nav"
            aria-label="Next creator"
            onClick={(e) => {
              e.preventDefault();
              go(1);
            }}
          >
            <ChevronRight size={20} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
