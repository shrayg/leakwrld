import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * Hanime-style section: title + optional subtitle, gold "ALL" link, prev/next scroll, horizontal strip.
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
      <Link className="hanime-all-btn" to={allHref}>
        {allLabel}
      </Link>
    ) : (
      <span className="hanime-all-btn hanime-all-btn--muted">{allLabel}</span>
    );

  return (
    <div className={'hanime-rail-block ' + className}>
      <div className="hanime-rail-head">
        <div className="hanime-rail-head-text">
          <h2 id={titleId} className="hanime-rail-title">
            {title}
          </h2>
          {subtitle ? <p className="hanime-rail-subtitle">{subtitle}</p> : null}
        </div>
        <div className="hanime-rail-controls" role="group" aria-label="Section actions">
          {allEl}
          <button
            type="button"
            className="hanime-rail-arrow"
            aria-label="Scroll left"
            disabled={!canLeft}
            onClick={() => scrollByDir(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="hanime-rail-arrow"
            aria-label="Scroll right"
            disabled={!canRight}
            onClick={() => scrollByDir(1)}
          >
            ›
          </button>
        </div>
      </div>
      {extraBelowHead}
      <div className="hanime-rail-scroll-outer">
        <div
          ref={scrollRef}
          className={'hanime-rail-scroll ' + scrollClassName}
          onScroll={updateArrows}
        >
          <div
            className="hanime-rail-scroll-track"
            {...(navLabel ? { role: 'navigation', 'aria-label': navLabel } : {})}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
