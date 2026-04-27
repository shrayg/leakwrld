import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';

/**
 * Pornwrld-style section: title + optional subtitle, gold "ALL" link, prev/next scroll, horizontal strip.
 */
export function HorizontalScrollRail({
  title,
  titleId,
  subtitle,
  children,
  allHref,
  allLabel = 'ALL',
  extraBelowHead = null,
  className = '',
  scrollClassName = '',
  navLabel,
}) {
  const scrollRef = useRef(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(true);

  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const max = scrollWidth - clientWidth;
    setCanLeft(scrollLeft > 2);
    setCanRight(max > 2 && scrollLeft < max - 2);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => updateArrows());
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateArrows]);

  useLayoutEffect(() => {
    updateArrows();
  }, [updateArrows, children]);

  function scrollByDir(dir) {
    const el = scrollRef.current;
    if (!el) return;
    const delta = Math.max(200, Math.floor(el.clientWidth * 0.85)) * dir;
    el.scrollBy({ left: delta, behavior: 'smooth' });
    window.requestAnimationFrame(() => {
      window.setTimeout(updateArrows, 350);
    });
  }

  const allEl =
    allHref != null ? (
      <Link
        className="pornwrld-all-btn inline-flex min-h-[38px] items-center justify-center rounded-[var(--pornwrld-radius-card)] border border-[color:color-mix(in_srgb,var(--color-primary)_52%,transparent)] bg-[linear-gradient(180deg,var(--color-pink-soft)_0%,var(--color-primary)_100%)] px-5 py-2.5 text-[13px] font-bold uppercase tracking-[0.08em] text-[#1a1a1a] no-underline shadow-[rgba(0,0,0,0.2)_0px_2px_4px_-1px] transition duration-150 hover:brightness-105 hover:shadow-[0_8px_22px_color-mix(in_srgb,var(--color-primary)_24%,transparent)] max-[560px]:min-h-[34px] max-[560px]:px-3.5 max-[560px]:py-2 max-[560px]:text-[11px] max-[560px]:tracking-[0.07em]"
        to={allHref}
      >
        {allLabel}
      </Link>
    ) : (
      <span className="pornwrld-all-btn inline-flex min-h-[38px] pointer-events-none items-center justify-center rounded-[var(--pornwrld-radius-card)] border border-[color:color-mix(in_srgb,var(--color-primary)_52%,transparent)] bg-[linear-gradient(180deg,var(--color-pink-soft)_0%,var(--color-primary)_100%)] px-5 py-2.5 text-[13px] font-bold uppercase tracking-[0.08em] text-[#1a1a1a] opacity-40 shadow-none max-[560px]:min-h-[34px] max-[560px]:px-3.5 max-[560px]:py-2 max-[560px]:text-[11px] max-[560px]:tracking-[0.07em]">
        {allLabel}
      </span>
    );

  return (
    <div className={cn('pornwrld-rail-block mb-[clamp(18px,3vw,32px)]', className)}>
      <div className="pornwrld-rail-head mb-3 flex flex-wrap items-center justify-between gap-3 px-0.5 max-[560px]:mb-2.5 max-[560px]:gap-2.5 max-[560px]:max-w-full">
        <div className="pornwrld-rail-heading min-w-0 flex-1 max-[560px]:basis-full">
          <h2 id={titleId} className="pornwrld-rail-title m-0 text-[clamp(1.5rem,2.6vw,2.15rem)] font-light tracking-[0.02em] text-white max-[560px]:text-[clamp(1.7rem,6.2vw,2.05rem)] max-[560px]:leading-[1.15] max-[560px]:tracking-[0.015em]">
            {title}
          </h2>
          {subtitle ? <p className="pornwrld-rail-subtitle mt-1 text-[13px] font-normal text-[var(--pornwrld-muted)] max-[560px]:mt-1.5 max-[560px]:text-xs max-[560px]:leading-[1.35]">{subtitle}</p> : null}
        </div>
        <div className="pornwrld-rail-actions ml-auto flex shrink items-center gap-2 max-[560px]:gap-[7px]" role="group" aria-label="Section actions">
          {allEl}
          <button
            type="button"
            className={cn(
              'pornwrld-rail-arrow inline-flex h-9 w-9 items-center justify-center rounded-[var(--pornwrld-radius-card)] border border-white/15 bg-[var(--pornwrld-surface-3)] p-0 text-[22px] leading-none text-white transition-colors duration-150 max-[560px]:h-[34px] max-[560px]:w-[34px] max-[560px]:text-xl',
              canLeft ? 'is-enabled hover:border-[rgba(242,104,184,0.55)] hover:text-[var(--color-primary)]' : 'cursor-default opacity-30',
            )}
            aria-label="Scroll left"
            disabled={!canLeft}
            onClick={() => scrollByDir(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            className={cn(
              'pornwrld-rail-arrow inline-flex h-9 w-9 items-center justify-center rounded-[var(--pornwrld-radius-card)] border border-white/15 bg-[var(--pornwrld-surface-3)] p-0 text-[22px] leading-none text-white transition-colors duration-150 max-[560px]:h-[34px] max-[560px]:w-[34px] max-[560px]:text-xl',
              canRight ? 'is-enabled hover:border-[rgba(242,104,184,0.55)] hover:text-[var(--color-primary)]' : 'cursor-default opacity-30',
            )}
            aria-label="Scroll right"
            disabled={!canRight}
            onClick={() => scrollByDir(1)}
          >
            ›
          </button>
        </div>
      </div>
      {extraBelowHead}
      <div className="pornwrld-rail-scroll-wrap mx-[-2px]">
        <div
          ref={scrollRef}
          className={cn(
            'pornwrld-video-rail-scroll overflow-x-auto overflow-y-hidden pb-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:thin] [scroll-snap-type:x_mandatory] [&::-webkit-scrollbar]:h-1.5',
            scrollClassName,
          )}
          onScroll={updateArrows}
        >
          <div
            className="pornwrld-video-rail-track flex min-h-full w-max flex-row items-stretch gap-3.5 px-0 py-0.5 pb-2.5 max-[560px]:gap-2.5 max-[560px]:pb-2"
            {...(navLabel ? { role: 'navigation', 'aria-label': navLabel } : {})}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
