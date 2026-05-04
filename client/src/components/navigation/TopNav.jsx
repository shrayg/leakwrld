import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../ui/button';
import { ProfileMenu } from '../auth/ProfileMenu';
import { useNavOverflowSplit } from '../../hooks/useNavOverflowSplit';
import { useAuth } from '../../hooks/useAuth';
import { cn } from '../../lib/utils';

/** Must match `.site-theme-pornwrld .top-nav-links { gap }` for overflow measurement */
const NAV_LINK_GAP_PX = 6;

/** Primary nav entries (left → right). */
const NAV_ENTRIES = [
  { key: 'home', kind: 'link', to: '/', label: 'Home', end: true },
  { key: 'shorts', kind: 'link', to: '/shorts', label: 'Shorts' },
  { key: 'custom', kind: 'custom', to: '/custom-requests', label: 'Custom Requests' },
  { key: 'premium', kind: 'link', to: '/checkout', label: 'Premium', premium: true },
  { key: 'search', kind: 'search', label: 'Search' },
];

function NavIcon({ kind }) {
  if (kind === 'home') {
    return (
      <svg
        className="h-4 w-4 shrink-0"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M12 3 2.5 10.7V21h7v-6h5v6h7V10.7z" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'shorts') {
    return (
      <svg
        className="h-4 w-4 shrink-0"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M7 4h10l-2.2 3H7zM7 10h10l-2.2 3H7zM7 16h10l-2.2 4H7z" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'custom') {
    return (
      <svg
        className="h-4 w-4 shrink-0"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M12 2a4 4 0 0 0-4 4v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a4 4 0 0 0-4-4zm-2 6V6a2 2 0 1 1 4 0v2h-4zm2 4a2 2 0 0 1 1 3.73V18h-2v-2.27A2 2 0 0 1 12 12z" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'support') {
    return (
      <svg
        className="h-4 w-4 shrink-0"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M10.8 16.5 7 12.7l1.4-1.4 2.4 2.4 5-5 1.4 1.4z" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'discord') {
    return (
      <svg className="h-4 w-4 shrink-0" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037 19.59 19.59 0 0 0-.608 1.25 13.47 13.47 0 0 0-5.487 0 19.37 19.37 0 0 0-.618-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.319 13.58.1 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.077.077 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 12.6 12.6 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.29.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .079.009c.12.098.246.196.373.29a.078.078 0 0 1-.006.128 12.33 12.33 0 0 1-1.873.891.076.076 0 0 0-.04.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.078.078 0 0 0 .032-.054c.5-5.177-.838-9.674-3.548-13.66a.061.061 0 0 0-.031-.03zM8.02 15.331c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.419 0 1.333-.956 2.419-2.157 2.419zm7.975 0c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.211 0 2.176 1.095 2.157 2.419 0 1.333-.955 2.419-2.157 2.419z"
          fill="currentColor"
        />
      </svg>
    );
  }
  if (kind === 'premium') {
    return (
      <svg
        className="h-4 w-4 shrink-0"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <path d="m12 2 3 6 6.5.9-4.7 4.6 1.1 6.5L12 17l-5.9 3 1.1-6.5L2.5 8.9 9 8z" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'search') {
    return (
      <svg
        className="h-4 w-4 shrink-0"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M10.5 3a7.5 7.5 0 1 0 4.7 13.3l4.3 4.3 1.4-1.4-4.3-4.3A7.5 7.5 0 0 0 10.5 3zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z" fill="currentColor" />
      </svg>
    );
  }
  return null;
}

function pathMatch(pathname, to, end) {
  if (end) return pathname === '/' || pathname === '/index.html';
  return pathname === to || pathname === to + '.html';
}

function navEntryIsActive(pathname, entry) {
  if (entry.kind === 'link') {
    return pathMatch(pathname, entry.to, entry.end);
  }
  if (entry.kind === 'external') return false;
  if (entry.kind === 'custom') return pathname.startsWith('/custom-requests');
  if (entry.kind === 'search') return pathname.startsWith('/search');
  return false;
}

function entryActive(pathname, entry) {
  return navEntryIsActive(pathname, entry) ? ' active' : '';
}

const NAV_ITEM_BASE =
  'top-nav-item relative z-[1] inline-flex items-center gap-2 rounded-[var(--pornwrld-radius-card)] border border-transparent bg-transparent px-2.5 py-2 text-sm font-normal tracking-[0.02em] text-white/90 transition duration-150 hover:bg-white/10 hover:text-white';

export function TopNav({ menuOpen = false, onToggleMenu }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { tier, isAuthed } = useAuth();
  const navEntries = NAV_ENTRIES;
  const [moreOpen, setMoreOpen] = useState(false);
  const [customLockedModalOpen, setCustomLockedModalOpen] = useState(false);
  const [customLockedAnim, setCustomLockedAnim] = useState(false);
  const moreBtnRef = useRef(null);
  const barItemRefs = useRef({});
  const [activeGlide, setActiveGlide] = useState({
    opacity: 0,
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    premium: false,
  });

  const { split, measureRef, containerRef } = useNavOverflowSplit({
    pathname,
    itemCount: navEntries.length,
  });

  const mainEntries = navEntries.slice(0, split);
  const overflowEntries = navEntries.slice(split);
  const showMore = overflowEntries.length > 0;
  const canAccessCustomRequests = isAuthed && Number(tier || 0) >= 1;
  const homeQuickActive = pathMatch(pathname, '/', true);
  const shortsQuickActive = pathname.startsWith('/shorts');
  const quickActiveIndex = shortsQuickActive ? 1 : homeQuickActive ? 0 : -1;

  const activeBarIndex = navEntries.findIndex((e) => navEntryIsActive(pathname, e));
  const activeInBar = activeBarIndex >= 0 && activeBarIndex < split;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !activeInBar) {
      setActiveGlide((g) => ({ ...g, opacity: 0 }));
      return;
    }
    const entry = navEntries[activeBarIndex];
    const el = barItemRefs.current[entry.key];
    if (!el) {
      setActiveGlide((g) => ({ ...g, opacity: 0 }));
      return;
    }
    function measure() {
      const c = containerRef.current;
      const node = barItemRefs.current[entry.key];
      if (!c || !node) return;
      const cr = c.getBoundingClientRect();
      const er = node.getBoundingClientRect();
      setActiveGlide({
        opacity: 1,
        left: er.left - cr.left + c.scrollLeft,
        top: er.top - cr.top + c.scrollTop,
        width: er.width,
        height: er.height,
        premium: !!entry.premium,
      });
    }
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(container);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [pathname, split, activeBarIndex, activeInBar, navEntries]);

  useEffect(() => {
    function onDoc(e) {
      if (moreBtnRef.current?.contains(e.target)) return;
      const drop = document.getElementById('top-nav-more-dropdown');
      if (drop?.contains(e.target)) return;
      setMoreOpen(false);
    }
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  function showCustomLockedFeedback() {
    setCustomLockedAnim(false);
    window.setTimeout(() => setCustomLockedAnim(true), 0);
    window.setTimeout(() => setCustomLockedAnim(false), 460);
    setCustomLockedModalOpen(true);
    setMoreOpen(false);
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') setMoreOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function renderEntry(entry, opts) {
    const active = entryActive(pathname, entry);
    const inBar = !!opts?.inBar;
    const cls = cn(
      NAV_ITEM_BASE,
      inBar && 'top-nav-item--bar',
      active && 'text-[var(--pornwrld-gold)]',
      entry.premium && 'nav-premium',
      entry.premium &&
        'border border-[color:color-mix(in_srgb,var(--color-premium-border)_52%,transparent)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-premium-border)_18%,transparent)_0%,color-mix(in_srgb,var(--color-premium-border)_8%,transparent)_100%),rgba(24,24,24,0.92)] font-semibold tracking-[0.015em] text-[var(--color-premium-text)] shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-premium-text)_18%,transparent),0_0_0_1px_color-mix(in_srgb,var(--color-premium-border)_8%,transparent)] animate-[pornwrld-nav-premium-glow_3.2s_ease-in-out_infinite] hover:border-[color:color-mix(in_srgb,var(--color-premium-border)_70%,transparent)] hover:bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-premium-border)_24%,transparent)_0%,color-mix(in_srgb,var(--color-premium-border)_12%,transparent)_100%),rgba(24,24,24,0.96)] hover:text-white hover:shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-premium-text)_24%,transparent),0_0_18px_color-mix(in_srgb,var(--color-premium-border)_20%,transparent)] hover:animate-none',
    );
    const measureProps = opts?.measure ? { 'data-nav-measure': true } : {};
    const refProp =
      inBar && !opts?.measure
        ? {
            ref: (node) => {
              if (node) barItemRefs.current[entry.key] = node;
              else delete barItemRefs.current[entry.key];
            },
          }
        : {};

    if (entry.kind === 'external') {
      return (
        <a
          key={entry.key}
          href={entry.href}
          className={cls}
          target="_blank"
          rel="noopener noreferrer"
          {...measureProps}
          {...refProp}
        >
          <NavIcon kind={entry.key} />
          <span>{entry.label}</span>
        </a>
      );
    }
    if (entry.kind === 'custom') {
      if (!canAccessCustomRequests) {
        return (
          <button
            key={entry.key}
            type="button"
            className={
              cn(
                cls,
                'cursor-not-allowed border border-[rgba(255,90,108,0.34)] bg-[linear-gradient(180deg,rgba(255,90,108,0.16)_0%,rgba(255,90,108,0.08)_100%),rgba(24,24,24,0.92)] text-[#ff9ea9] hover:border-[rgba(255,90,108,0.58)] hover:text-white hover:shadow-[0_0_16px_rgba(255,90,108,0.22)]',
                customLockedAnim && 'animate-[nav-custom-lock-bump_0.42s_cubic-bezier(0.34,1.56,0.64,1)]',
              )
            }
            onClick={showCustomLockedFeedback}
            aria-label="Custom Requests locked for free users"
            {...measureProps}
            {...refProp}
          >
            <NavIcon kind={entry.key} />
            <span>{entry.label}</span>
            <span className="ml-1 text-xs leading-none" aria-hidden="true">
              🔒
            </span>
          </button>
        );
      }
      return (
        <Link
          key={entry.key}
          to={entry.to}
          className={cn(
            cls,
            'border border-[rgba(255,90,108,0.34)] bg-[linear-gradient(180deg,rgba(255,90,108,0.16)_0%,rgba(255,90,108,0.08)_100%),rgba(24,24,24,0.92)] text-[#ff9ea9] hover:border-[rgba(255,90,108,0.58)] hover:text-white hover:shadow-[0_0_16px_rgba(255,90,108,0.22)]',
          )}
          {...measureProps}
          {...refProp}
        >
          <NavIcon kind={entry.key} />
          <span>{entry.label}</span>
        </Link>
      );
    }
    if (entry.kind === 'search') {
      return (
        <button
          key={entry.key}
          type="button"
          className={cls + ' nav-search-btn'}
          aria-label="Search"
          onClick={() => navigate('/search')}
          {...measureProps}
          {...refProp}
        >
          <NavIcon kind={entry.key} />
          <span>{entry.label}</span>
        </button>
      );
    }
    return (
      <Link key={entry.key} to={entry.to} className={cls} {...measureProps} {...refProp}>
        <NavIcon kind={entry.key} />
        <span>{entry.label}</span>
      </Link>
    );
  }

  return (
    <header className="top-nav">
      <div
        className="top-nav-shell"
        style={{
          display: 'flex',
          minHeight: '56px',
          width: '100%',
          maxWidth: '1680px',
          alignItems: 'center',
          gap: '8px',
          padding: '0 clamp(12px,2.8vw,32px)',
          boxSizing: 'border-box',
        }}
      >
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            className="group nav-hamburger nav-hamburger-btn h-[34px] w-[34px] rounded-lg p-0"
            variant="outline"
            size="icon"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={onToggleMenu}
            aria-expanded={menuOpen}
          >
            <svg
              className="h-4 w-4"
              width={16}
              height={16}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path d="M4 7L20 7" className={cn('origin-center transition-all duration-300', menuOpen && 'translate-y-[5px] rotate-45')} />
              <path d="M4 12H20" className={cn('origin-center transition-all duration-200', menuOpen && 'opacity-0')} />
              <path d="M4 17H20" className={cn('origin-center transition-all duration-300', menuOpen && '-translate-y-[5px] -rotate-45')} />
            </svg>
          </Button>
          <Link to="/" className="nav-brand items-center whitespace-nowrap rounded-[var(--pornwrld-radius-card)] px-1.5 py-1.5 text-white no-underline transition hover:bg-white/10 hover:text-[var(--pornwrld-gold)]" aria-label="Pornwrld Home">
            <img src="/assets/branding/pornwrld-logo.png" alt="Pornwrld" className="h-[34px] w-auto max-w-[170px] object-contain" />
          </Link>
        </div>

        <div ref={containerRef} className="top-nav-links relative ml-1 min-w-0 flex-1 items-center gap-1.5 overflow-visible">
          <div
            ref={measureRef}
            aria-hidden
            style={{
              position: 'absolute',
              left: '-10000px',
              top: 0,
              display: 'flex',
              alignItems: 'center',
              gap: NAV_LINK_GAP_PX,
              visibility: 'hidden',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {navEntries.map((e) => renderEntry(e, { measure: true }))}
          </div>

          <span
            className={cn(
              'pointer-events-none absolute left-0 top-0 z-0 block box-border rounded-[var(--pornwrld-radius-card)] border border-[color:color-mix(in_srgb,var(--color-primary)_48%,transparent)] bg-[color:color-mix(in_srgb,var(--color-primary)_14%,transparent)] transition-[transform,width,height,opacity] duration-[380ms,380ms,380ms,200ms] ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform',
              activeGlide.premium &&
                'border-[rgba(243,198,105,0.55)] bg-[linear-gradient(180deg,rgba(243,198,105,0.2)_0%,rgba(243,198,105,0.09)_100%),rgba(24,24,24,0.55)] shadow-[inset_0_1px_0_rgba(255,238,184,0.14),0_0_0_1px_rgba(243,198,105,0.06)]',
            )}
            aria-hidden
            style={{
              opacity: activeGlide.opacity,
              transform: `translate(${activeGlide.left}px, ${activeGlide.top}px)`,
              width: activeGlide.width,
              height: activeGlide.height,
            }}
          />

          {mainEntries.map((e) => renderEntry(e, { inBar: true }))}

          <div className={cn('top-nav-more', showMore && 'top-nav-more--visible')} id="top-nav-more">
            <button
              ref={moreBtnRef}
              type="button"
              className="top-nav-more-btn"
              id="top-nav-more-btn"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              aria-label="More menu"
              onClick={(e) => {
                e.stopPropagation();
                setMoreOpen((o) => !o);
              }}
            >
              More ▾
            </button>
            <div
              className={cn(
                'top-nav-more-dropdown',
                moreOpen && 'active',
              )}
              id="top-nav-more-dropdown"
              role="menu"
            >
              <div className="top-nav-more-overflow" id="top-nav-overflow">
                {overflowEntries.map((e) => {
                  const active = entryActive(pathname, e);
                  const cls = 'top-nav-item' + active + (e.premium ? ' nav-premium' : '');
                  if (e.kind === 'external') {
                    return (
                      <a key={e.key} href={e.href} className={cls} target="_blank" rel="noopener noreferrer" role="menuitem">
                        <NavIcon kind={e.key} />
                        <span>{e.label}</span>
                      </a>
                    );
                  }
                  if (e.kind === 'custom') {
                    if (!canAccessCustomRequests) {
                      return (
                        <button
                          key={e.key}
                          type="button"
                          className={
                            cls +
                            ' nav-custom nav-custom--locked' +
                            (customLockedAnim ? ' nav-custom--locked-anim' : '')
                          }
                          role="menuitem"
                          onClick={showCustomLockedFeedback}
                        >
                          <NavIcon kind={e.key} />
                          <span>{e.label}</span>
                          <span className="ml-1 text-xs leading-none" aria-hidden="true">
                            🔒
                          </span>
                        </button>
                      );
                    }
                    return (
                      <Link key={e.key} to={e.to} className={cls + ' nav-custom'} role="menuitem" onClick={() => setMoreOpen(false)}>
                        <NavIcon kind={e.key} />
                        <span>{e.label}</span>
                      </Link>
                    );
                  }
                  if (e.kind === 'search') {
                    return (
                      <button
                        key={e.key}
                        type="button"
                        className={cls + ' nav-search-btn'}
                        role="menuitem"
                        onClick={() => {
                          navigate('/search');
                          setMoreOpen(false);
                        }}
                      >
                        <NavIcon kind={e.key} />
                        <span>{e.label}</span>
                      </button>
                    );
                  }
                  return (
                    <Link key={e.key} to={e.to} className={cls} role="menuitem" onClick={() => setMoreOpen(false)}>
                      <NavIcon kind={e.key} />
                      <span>{e.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="top-nav-auth ml-auto flex shrink-0 items-center gap-2.5">
          <div className="nav-mobile-quick relative ml-0.5 min-w-0 grid-cols-2 items-center gap-1 rounded-[10px] border border-white/10 bg-white/[0.03] p-0.5">
            <span
              className={cn(
                'pointer-events-none absolute bottom-0.5 left-0.5 top-0.5 z-0 w-[calc((100%-8px)/2)] rounded-lg border border-[rgba(243,198,105,0.42)] bg-[rgba(243,198,105,0.18)] shadow-[0_8px_16px_rgba(0,0,0,0.25)] transition',
                quickActiveIndex === 1 && 'translate-x-[calc(100%+4px)]',
                quickActiveIndex < 0 && 'opacity-0',
              )}
              aria-hidden="true"
            />
            <Link
              to="/"
              className={cn(
                'nav-mobile-quick-btn relative z-[1] inline-flex items-center justify-center gap-1.5 rounded-[var(--pornwrld-radius-card)] px-2.5 py-2 text-xs font-semibold text-white/80 no-underline transition hover:text-white',
                homeQuickActive && 'active text-[var(--pornwrld-gold)]',
              )}
            >
              <NavIcon kind="home" />
              <span>Home</span>
            </Link>
            <Link
              to="/shorts"
              className={cn(
                'nav-mobile-quick-btn relative z-[1] inline-flex items-center justify-center gap-1.5 rounded-[var(--pornwrld-radius-card)] px-2.5 py-2 text-xs font-semibold text-white/80 no-underline transition hover:text-white',
                shortsQuickActive && 'active text-[var(--pornwrld-gold)]',
              )}
            >
              <NavIcon kind="shorts" />
              <span>Shorts</span>
            </Link>
          </div>
          <div>
            <ProfileMenu />
          </div>
        </div>
      </div>
      {customLockedModalOpen && (
        <div
          className="fixed inset-0 z-[12000] flex items-center justify-center bg-[rgba(6,6,10,0.78)] p-4 [backdrop-filter:blur(12px)_saturate(90%)] animate-[nav-locked-overlay-in_180ms_ease-out]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="nav-locked-title"
        >
          <div className="relative w-full max-w-[460px] rounded-xl border border-white/15 bg-[linear-gradient(170deg,rgba(28,28,34,0.98)_0%,rgba(17,17,22,0.98)_100%)] px-[18px] pb-4 pt-5 text-center shadow-[0_20px_56px_rgba(0,0,0,0.55)] animate-[nav-locked-modal-in_240ms_cubic-bezier(0.22,1,0.36,1)]">
            <button
              type="button"
              className="absolute right-2.5 top-2.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/20 bg-white/5 p-0 text-white/85 transition hover:border-white/30 hover:bg-white/10 hover:text-white"
              aria-label="Close"
              onClick={() => setCustomLockedModalOpen(false)}
            >
              <X size={16} strokeWidth={2.4} aria-hidden="true" />
            </button>
            <h3 id="nav-locked-title" className="mx-7 mb-2 mt-0 text-[clamp(1.05rem,2.6vw,1.2rem)] font-bold text-white">Custom Requests is locked</h3>
            <p className="mx-auto mb-3.5 mt-0 max-w-[38ch] text-[13px] leading-6 text-white/70">
              This feature is only available to Basic and Premium users. Request custom content and get a faster, priority workflow.
            </p>
            <div className="flex flex-wrap justify-center gap-2.5">
              <button type="button" className="min-h-9 rounded-[10px] border border-[rgba(243,198,105,0.5)] bg-[linear-gradient(180deg,#f6d486_0%,#f3c669_100%)] px-3.5 text-xs font-extrabold tracking-[0.04em] text-[#17181a]" onClick={() => navigate('/checkout')}>
                Purchase Premium
              </button>
              <button type="button" className="min-h-9 rounded-[10px] border border-white/20 bg-white/5 px-3.5 text-xs font-bold text-[#e7e7ea]" onClick={() => setCustomLockedModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
