import { Lock, Play, Sparkles } from 'lucide-react';

function formatNumber(value) {
  const n = Number(value || 0);
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function CreatorCard({ creator, compact = false }) {
  return (
    <article className={`lw-card group ${compact ? 'p-3' : 'p-3.5'}`}>
      <div className={`lw-thumb accent-${creator.accent || 'pink'}`}>
        <span className="lw-rank">#{creator.rank}</span>
        <div className="lw-thumb-mark">
          <Sparkles size={compact ? 18 : 22} />
        </div>
        <span className="lw-tier-chip">
          <Lock size={12} />
          {creator.premiumCount}
        </span>
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
            <b>{formatNumber(creator.mediaCount)}</b>
            Media
          </span>
          <span className="lw-mini-stat">
            <b>{creator.freeCount}</b>
            Free
          </span>
          <span className="lw-mini-stat">
            <b>{creator.category}</b>
            Type
          </span>
        </div>
      </div>
    </article>
  );
}

export function ShortCard({ item, index }) {
  const premium = item.tier !== 'free';
  return (
    <article className="lw-card overflow-hidden p-0">
      <div className={`lw-short-preview accent-${index % 4 === 0 ? 'gold' : index % 3 === 0 ? 'cyan' : 'pink'}`}>
        <span className="lw-rank">{item.duration}</span>
        <button type="button" className="lw-play" aria-label={`Play ${item.title}`}>
          <Play size={22} fill="currentColor" />
        </button>
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
          <span>{formatNumber(item.views)} views</span>
          <span>{formatNumber(item.likes)} likes</span>
        </div>
      </div>
    </article>
  );
}
