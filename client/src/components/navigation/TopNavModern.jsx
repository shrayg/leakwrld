import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ProfileMenu } from '../auth/ProfileMenu';

/**
 * First segment of a two-part path that is a known single-route page (not /:categorySlug/:videoSlug).
 * Anything else with two segments is treated as a clean category video URL.
 */
const SINGLE_SEGMENT_APP_ROUTES = new Set([
  'categories',
  'account',
  'blog',
  'about',
  'faqs',
  'privacy',
  'terms',
  'help',
  'changelog',
  'brand',
  'folder',
  'video',
  'checkout',
  'admin',
  'upload',
]);

const NAV_ITEMS = [
  { key: 'home', label: 'Creators', to: '/categories' },
  { key: 'categories', label: 'Categories', dropdown: 'categories' },
];

function normalizeNavPath(pathname) {
  if (!pathname) return '/';
  let p = pathname.replace(/\/+/g, '/');
  if (p !== '/' && p.endsWith('/')) p = p.slice(0, -1);
  if (p.endsWith('.html')) {
    const base = p.slice(0, -5);
    if (base === '' || base === '/index') return '/';
    p = base || '/';
  }
  return p || '/';
}

/** Which primary nav tab should show active + glide for this URL. */
function resolveNavActiveKey(pathname, search) {
  const p = normalizeNavPath(pathname);
  const rawQs = typeof search === 'string' ? search : '';
  const qs = rawQs.startsWith('?') ? rawQs.slice(1) : rawQs;
  const params = new URLSearchParams(qs);

  if (p === '/categories' || p === '/') return 'home';

  const segments = p.split('/').filter(Boolean);

  // /:categorySlug/:videoSlug — watching a video from category SEO URLs
  if (segments.length === 2 && !SINGLE_SEGMENT_APP_ROUTES.has(segments[0])) {
    return 'categories';
  }

  if (p === '/categories') return 'categories';

  return null;
}

export function TopNavModern({ menuOpen = false, onToggleMenu }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [openDropdown, setOpenDropdown] = useState(null);
  const navRef = useRef(null);
  const itemRefs = useRef({});
  const [glide, setGlide] = useState({ opacity: 0, x: 0, y: 0, w: 0, h: 0 });

  const routeActiveKey = useMemo(() => resolveNavActiveKey(pathname, search), [pathname, search]);

  const visualActiveKey = useMemo(() => {
    if (openDropdown === 'categories') return 'categories';
    return routeActiveKey;
  }, [openDropdown, routeActiveKey]);

  useLayoutEffect(() => {
    const navNode = navRef.current;
    if (!navNode || visualActiveKey == null || visualActiveKey === '') {
      setGlide((prev) => ({ ...prev, opacity: 0 }));
      return;
    }
    const activeNode = itemRefs.current[visualActiveKey];
    if (!activeNode) {
      setGlide((prev) => ({ ...prev, opacity: 0 }));
      return;
    }
    const nr = navNode.getBoundingClientRect();
    const ar = activeNode.getBoundingClientRect();
    setGlide({
      opacity: 1,
      x: ar.left - nr.left + navNode.scrollLeft,
      y: ar.top - nr.top + navNode.scrollTop,
      w: ar.width,
      h: ar.height,
    });
  }, [visualActiveKey, pathname, openDropdown]);

  useEffect(() => {
    function onDocClick(e) {
      if (!e.target.closest('.pw-nav-tabs')) {
        setOpenDropdown(null);
      }
    }
    function onEsc(e) {
      if (e.key === 'Escape') setOpenDropdown(null);
    }
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  return (
    <header className="top-nav pw-nav">
      <div className="pw-nav-top">
        <button
          type="button"
          className="pw-nav-burger"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          onClick={onToggleMenu}
        >
          <span />
          <span />
          <span />
        </button>
        <Link to="/categories" className="pw-nav-brand" aria-label="Leak World Home">
          <span className="pw-nav-brand-logo">Leak World</span>
        </Link>
        <button type="button" className="pw-nav-search" onClick={() => navigate('/categories')}>
          Search creators
        </button>
        <div className="pw-nav-profile">
          <ProfileMenu />
        </div>
      </div>

      <nav className="pw-nav-tabs" ref={navRef} aria-label="Main navigation tabs">
        <span
          className="pw-nav-glide"
          style={{
            opacity: glide.opacity,
            transform: `translate(${glide.x}px, ${glide.y}px)`,
            width: glide.w,
            height: glide.h,
          }}
          aria-hidden="true"
        />
        {NAV_ITEMS.map((item) => {
          const isActive = visualActiveKey === item.key;
          const commonProps = {
            className: `pw-nav-tab${isActive ? ' active' : ''}${item.premium ? ' premium' : ''}`,
            ref: (node) => {
              if (node) itemRefs.current[item.key] = node;
              else delete itemRefs.current[item.key];
            },
          };

          if (item.href) {
            return (
              <a key={item.key} href={item.href} target="_blank" rel="noopener noreferrer" {...commonProps}>
                <span>{item.label}</span>
              </a>
            );
          }

          if (item.dropdown) {
            const isOpen = openDropdown === item.dropdown;
            return (
              <div key={item.key} className="pw-nav-dd-wrap">
                <button
                  type="button"
                  {...commonProps}
                  aria-expanded={isOpen}
                  aria-haspopup="menu"
                  onClick={() => setOpenDropdown((prev) => (prev === item.dropdown ? null : item.dropdown))}
                >
                  <span>{item.label}</span>
                  <span className="pw-nav-caret">▾</span>
                </button>
                {isOpen && (
                  <div className="pw-nav-dd" role="menu">
                    <button
                      type="button"
                      className="pw-nav-dd-item"
                      onClick={() => {
                        navigate('/categories');
                        setOpenDropdown(null);
                      }}
                    >
                      Top 100 creators
                    </button>
                  </div>
                )}
              </div>
            );
          }

          return (
            <Link key={item.key} to={item.to} {...commonProps}>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

