import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../ui/button';
import { ProfileMenu } from '../auth/ProfileMenu';
import { useNavOverflowSplit } from '../../hooks/useNavOverflowSplit';
import { useAuth } from '../../hooks/useAuth';

/** Must match `.site-theme-hanime .top-nav-links { gap }` for overflow measurement */
const NAV_LINK_GAP_PX = 6;

/** Primary nav entries (left → right). */
const NAV_ENTRIES = [
  { key: 'home', kind: 'link', to: '/', label: 'Home', end: true },
  { key: 'shorts', kind: 'link', to: '/shorts', label: 'Shorts' },
  { key: 'upload', kind: 'link', to: '/upload', label: 'Upload' },
  { key: 'custom', kind: 'custom', to: '/custom-requests', label: 'Custom Requests' },
  { key: 'support', kind: 'external', href: 'https://t.me/pornyardxyz', label: 'Contact Us' },
  { key: 'premium', kind: 'link', to: '/checkout', label: 'Premium', premium: true },
  { key: 'search', kind: 'search', label: 'Search' },
];

function NavIcon({ kind }) {
  if (kind === 'home') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 3 2.5 10.7V21h7v-6h5v6h7V10.7z" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'shorts') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M7 4h10l-2.2 3H7zM7 10h10l-2.2 3H7zM7 16h10l-2.2 4H7z" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'custom') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 2a4 4 0 0 0-4 4v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a4 4 0 0 0-4-4zm-2 6V6a2 2 0 1 1 4 0v2h-4zm2 4a2 2 0 0 1 1 3.73V18h-2v-2.27A2 2 0 0 1 12 12z" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'upload') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 3 6 9h4v7h4V9h4zM5 18h14v3H5z" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'support') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M10.8 16.5 7 12.7l1.4-1.4 2.4 2.4 5-5 1.4 1.4z" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'premium') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="m12 2 3 6 6.5.9-4.7 4.6 1.1 6.5L12 17l-5.9 3 1.1-6.5L2.5 8.9 9 8z" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'search') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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

export function TopNav({ menuOpen = false, onToggleMenu }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { isAuthed, tier } = useAuth();
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
    itemCount: NAV_ENTRIES.length,
  });

  const mainEntries = NAV_ENTRIES.slice(0, split);
  const overflowEntries = NAV_ENTRIES.slice(split);
  const showMore = overflowEntries.length > 0;
  const canAccessCustomRequests = isAuthed && Number(tier || 0) >= 1;
  const homeQuickActive = pathMatch(pathname, '/', true);
  const shortsQuickActive = pathname.startsWith('/shorts');
  const quickActiveIndex = shortsQuickActive ? 1 : homeQuickActive ? 0 : -1;

  const activeBarIndex = NAV_ENTRIES.findIndex((e) => navEntryIsActive(pathname, e));
  const activeInBar = activeBarIndex >= 0 && activeBarIndex < split;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !activeInBar) {
      setActiveGlide((g) => ({ ...g, opacity: 0 }));
      return;
    }
    const entry = NAV_ENTRIES[activeBarIndex];
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
  }, [pathname, split, activeBarIndex, activeInBar]);

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
    const cls =
      'top-nav-item' +
      active +
      (entry.premium ? ' nav-premium' : '') +
      (inBar ? ' top-nav-item--bar' : '');
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
              cls +
              ' nav-custom nav-custom--locked' +
              (customLockedAnim ? ' nav-custom--locked-anim' : '')
            }
            onClick={showCustomLockedFeedback}
            aria-label="Custom Requests locked for free users"
            {...measureProps}
            {...refProp}
          >
            <NavIcon kind={entry.key} />
            <span>{entry.label}</span>
            <span className="top-nav-lock-dot" aria-hidden="true">
              🔒
            </span>
          </button>
        );
      }
      return (
        <Link key={entry.key} to={entry.to} className={cls + ' nav-custom'} {...measureProps} {...refProp}>
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
      <div className="top-nav-inner">
        <div className="top-nav-start">
          <Button
            type="button"
            className="nav-hamburger nav-hamburger-btn group"
            variant="outline"
            size="icon"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={onToggleMenu}
            aria-expanded={menuOpen}
          >
            <svg
              className="nav-hamburger-icon"
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
              <path d="M4 7L20 7" className="nav-hamburger-path nav-hamburger-path--top" />
              <path d="M4 12H20" className="nav-hamburger-path nav-hamburger-path--mid" />
              <path d="M4 17H20" className="nav-hamburger-path nav-hamburger-path--bot" />
            </svg>
          </Button>
          <Link to="/" className="nav-brand">
            Pornyard
          </Link>
        </div>

        <div ref={containerRef} className="top-nav-links" style={{ position: 'relative', flex: 1, minWidth: 0 }}>
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
            {NAV_ENTRIES.map((e) => renderEntry(e, { measure: true }))}
          </div>

          <span
            className={'top-nav-active-glide' + (activeGlide.premium ? ' top-nav-active-glide--premium' : '')}
            aria-hidden
            style={{
              opacity: activeGlide.opacity,
              transform: `translate(${activeGlide.left}px, ${activeGlide.top}px)`,
              width: activeGlide.width,
              height: activeGlide.height,
            }}
          />

          {mainEntries.map((e) => renderEntry(e, { inBar: true }))}

          <div className={'top-nav-more' + (showMore ? ' top-nav-more--visible' : '')} id="top-nav-more">
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
              className={'top-nav-more-dropdown' + (moreOpen ? ' active' : '')}
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
                          <span className="top-nav-lock-dot" aria-hidden="true">
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

        <div className="top-nav-end">
          <div className="nav-mobile-quick">
            <span
              className={
                'nav-mobile-quick-glide' +
                (quickActiveIndex === 1 ? ' is-shorts' : '') +
                (quickActiveIndex < 0 ? ' is-hidden' : '')
              }
              aria-hidden="true"
            />
            <Link to="/" className={`nav-mobile-quick-btn${homeQuickActive ? ' active' : ''}`}>
              <NavIcon kind="home" />
              <span>Home</span>
            </Link>
            <Link to="/shorts" className={`nav-mobile-quick-btn${shortsQuickActive ? ' active' : ''}`}>
              <NavIcon kind="shorts" />
              <span>Shorts</span>
            </Link>
          </div>
          <div className="top-nav-auth">
            <ProfileMenu />
          </div>
        </div>
      </div>
      {customLockedModalOpen && (
        <div
          className="nav-locked-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="nav-locked-title"
        >
          <div className="nav-locked-modal">
            <button
              type="button"
              className="nav-locked-close"
              aria-label="Close"
              onClick={() => setCustomLockedModalOpen(false)}
            >
              <X size={16} strokeWidth={2.4} aria-hidden="true" />
            </button>
            <h3 id="nav-locked-title">Custom Requests is locked</h3>
            <p>
              This feature is only available to Basic and Premium users. Request custom content and get a faster, priority workflow.
            </p>
            <div className="nav-locked-actions">
              <button type="button" className="nav-locked-upgrade-btn" onClick={() => navigate('/checkout')}>
                Purchase Premium
              </button>
              <button type="button" className="nav-locked-cancel-btn" onClick={() => setCustomLockedModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
