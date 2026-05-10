import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Lock, Play, Sparkles, Unlock } from 'lucide-react';
import { useCatalogShortTelemetry } from '../hooks/useCatalogShortTelemetry';
import { displayCount, formatCount } from '../lib/metrics';
import { catalogMediaLike } from '../lib/mediaAnalytics';

export function CreatorCard({ creator, compact = false }) {
  const [thumbBroken, setThumbBroken] = useState(false);
  const showImage = Boolean(creator.thumbnail) && !thumbBroken;
  return (
    <Link to={`/creators/${creator.slug}`} className="lw-card-link" aria-label={`Open ${creator.name}`}>
      <article className={`lw-card group ${compact ? 'p-3' : 'p-3.5'}`}>
        <div className={`lw-thumb accent-${creator.accent || 'pink'}`}>
          {showImage ? (
            <img
              src={creator.thumbnail}
              alt={`${creator.name} thumbnail`}
              loading="lazy"
              decoding="async"
              onError={() => setThumbBroken(true)}
              className="lw-thumb-img"
            />
          ) : null}
          <span className="lw-rank">#{creator.rank}</span>
          {!showImage ? (
            <div className="lw-thumb-mark">
              <Sparkles size={compact ? 18 : 22} />
            </div>
          ) : null}
          <div className="lw-tier-chips">
            <span className="lw-tier-chip unlocked" aria-label={`${creator.freeCount} free files`}>
              <Unlock size={12} />
              {formatCount(displayCount(creator.freeCount))}
            </span>
            <span className="lw-tier-chip locked" aria-label={`${creator.mediaCount} total files`}>
              <Lock size={12} />
              {formatCount(displayCount(creator.mediaCount))}
            </span>
          </div>
        </div>
        <div className="mt-3 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-[15px] font-semibold text-white">{creator.name}</h3>
              <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-[var(--color-text-muted)]">{creator.tagline}</p>
            </div>
            <span className="rounded-[6px] border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-white/70">
              {creator.heat}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
            <span className="lw-mini-stat">
              <b>{formatCount(displayCount(creator.mediaCount))}</b>
              Media
            </span>
            <span className="lw-mini-stat">
              <b>{formatCount(displayCount(creator.freeCount))}</b>
              Free
            </span>
            <span className="lw-mini-stat">
              <b>{creator.category}</b>
              Type
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}

export function ShortCard({ item, index }) {
  const premium = item.tier !== 'free';
  const accent = index % 4 === 0 ? 'gold' : index % 3 === 0 ? 'cyan' : 'pink';
  const telemetry = useCatalogShortTelemetry(item);

  const [views, setViews] = useState(Number(item.views) || 0);
  const [likes, setLikes] = useState(Number(item.likes) || 0);

  useEffect(() => {
    setViews(Number(item.views) || 0);
    setLikes(Number(item.likes) || 0);
  }, [item.views, item.likes, item.id]);

  const likeKey = `lw_sl_${item.id}`;
  const [liked, setLiked] = useState(() => {
    try {
      return localStorage.getItem(likeKey) === '1';
    } catch {
      return false;
    }
  });

  function onLike(e) {
    e.preventDefault();
    e.stopPropagation();
    if (liked) return;
    try {
      localStorage.setItem(likeKey, '1');
    } catch {
      /* ignore */
    }
    setLiked(true);
    catalogMediaLike(item.id);
    setLikes((x) => x + 1);
  }

  function onOpenShort() {
    telemetry.onNavigateIntent();
    setViews((v) => v + 1);
  }

  return (
    <article ref={telemetry.rootRef} className="relative lw-card overflow-hidden p-0">
      <Link
        to={`/creators/${item.creatorSlug}`}
        className="block"
        onClick={onOpenShort}
        aria-label={`Open ${item.creatorName} from ${item.title}`}
      >
        <div className={`lw-short-preview accent-${accent}`}>
          <span className="lw-rank">{item.duration}</span>
          <span className="lw-play pointer-events-none" aria-hidden>
            <Play size={22} fill="currentColor" />
          </span>
          {premium ? (
            <span className="lw-tier-chip">
              <Lock size={12} />
              Premium
            </span>
          ) : (
            <span className="lw-tier-chip free">Free</span>
          )}
        </div>
        <div className="p-3">
          <h3 className="truncate text-[14px] font-semibold text-white">{item.title}</h3>
          <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">{item.creatorName}</p>
          <div className="mt-3 flex items-center justify-between text-[11px] text-white/60">
            <span>{formatCount(displayCount(views))} views</span>
            <span>{formatCount(displayCount(likes))} likes</span>
          </div>
        </div>
      </Link>
      <button
        type="button"
        className="lw-icon-btn absolute right-3 top-3 z-10 border border-white/15 bg-black/40 text-white shadow-md backdrop-blur-sm"
        aria-label={liked ? 'Liked' : 'Like short'}
        aria-pressed={liked}
        onClick={onLike}
      >
        <Heart size={16} className={liked ? 'text-[var(--color-primary)]' : ''} fill={liked ? 'currentColor' : 'none'} />
      </button>
    </article>
  );
}
