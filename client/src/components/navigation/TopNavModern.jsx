import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { fetchRandomVideos } from '../../api/client';
import { ProfileMenu } from '../auth/ProfileMenu';

/** `folder` matches API/library folder names on `/video` and `/folder` for nav context. */
const CATEGORY_ITEMS = [
  { label: 'NSFW Straight', to: '/nsfw-straight', folder: 'NSFW Straight' },
  { label: 'Alt and Goth', to: '/alt-and-goth', folder: 'Alt and Goth' },
  { label: 'Petite', to: '/petite', folder: 'Petite' },
  { label: 'Teen (18+ only)', to: '/teen-18-plus', folder: 'Teen (18+ only)' },
  { label: 'MILF', to: '/milf', folder: 'MILF' },
  { label: 'Asian', to: '/asian', folder: 'Asian' },
  { label: 'Ebony', to: '/ebony', folder: 'Ebony' },
  { label: 'Feet', to: '/feet', folder: 'Feet' },
  { label: 'Hentai/Cosplay', to: '/hentai', folder: 'Hentai' },
  { label: 'Lesbian', to: '/yuri', folder: 'Yuri' },
  { label: 'Yaoi', to: '/yaoi', folder: 'Yaoi' },
  { label: 'Nip Slips', to: '/nip-slips', folder: 'Nip Slips' },
  { label: 'Omegle', to: '/omegle', folder: 'Omegle' },
  { label: 'OnlyFans Leaks', to: '/of-leaks', premium: true, folder: 'OF Leaks' },
];

const CATEGORY_FOLDER_SET = new Set(CATEGORY_ITEMS.map((c) => c.folder).filter(Boolean));
const CATEGORY_PATH_SET = new Set(CATEGORY_ITEMS.map((c) => c.to));

/**
 * First segment of a two-part path that is a known single-route page (not /:categorySlug/:videoSlug).
 * Anything else with two segments is treated as a clean category video URL.
 */
const SINGLE_SEGMENT_APP_ROUTES = new Set([
  'shorts',
  'search',
  'categories',
  'account',
  'custom-requests',
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
  'onlyfans',
  'recommended',
  'popular',
  'newly-added',
  'random-video',
  'new-releases',
  'checkout',
  'admin',
  'upload',
]);

const VIDEO_DROPDOWN = [
  { label: 'Recommended', to: '/recommended' },
  { label: 'Popular', to: '/popular' },
  { label: 'Newly Added', to: '/newly-added' },
  { label: 'Random Video', action: 'random-video' },
  { label: 'OnlyFans', to: '/onlyfans', premium: true },
];

const NAV_ITEMS = [
  { key: 'home', label: 'Home', to: '/' },
  { key: 'videos', label: 'Videos', dropdown: 'videos' },
  { key: 'categories', label: 'Categories', dropdown: 'categories' },
  { key: 'shorts', label: 'Shorts', to: '/shorts' },
  { key: 'custom', label: 'Custom Requests', to: '/custom-requests' },
  { key: 'premium', label: 'Premium', to: '/checkout', premium: true },
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

  if (p === '/checkout') return 'premium';
  if (p === '/shorts') return 'shorts';
  if (p === '/custom-requests') return 'custom';
  if (p === '/') return 'home';

  const segments = p.split('/').filter(Boolean);

  // /:categorySlug/:videoSlug — watching a video from category SEO URLs
  if (segments.length === 2 && !SINGLE_SEGMENT_APP_ROUTES.has(segments[0])) {
    return 'categories';
  }

  if (p === '/categories' || CATEGORY_PATH_SET.has(p)) return 'categories';

  if (p === '/folder') {
    const folder = params.get('folder') || '';
    if (folder && CATEGORY_FOLDER_SET.has(folder)) return 'categories';
    return 'videos';
  }

  if (p === '/video') {
    const folder = params.get('folder') || '';
    if (folder && CATEGORY_FOLDER_SET.has(folder)) return 'categories';
    return 'videos';
  }

  if (
    p === '/recommended' ||
    p === '/popular' ||
    p === '/newly-added' ||
    p === '/new-releases' ||
    p === '/random-video' ||
    p === '/onlyfans'
  ) {
    return 'videos';
  }

  return null;
}

export function TopNavModern({ menuOpen = false, onToggleMenu }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [openDropdown, setOpenDropdown] = useState(null);
  const [busyRandom, setBusyRandom] = useState(false);
  const navRef = useRef(null);
  const itemRefs = useRef({});
  const [glide, setGlide] = useState({ opacity: 0, x: 0, y: 0, w: 0, h: 0 });

  const routeActiveKey = useMemo(() => resolveNavActiveKey(pathname, search), [pathname, search]);

  const visualActiveKey = useMemo(() => {
    if (openDropdown === 'videos') return 'videos';
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

  async function openRandomVideo() {
    if (busyRandom) return;
    setBusyRandom(true);
    try {
      const res = await fetchRandomVideos({ limit: '1', page: '0', sort: 'random' });
      const pool = Array.isArray(res?.data?.files)
        ? res.data.files
        : Array.isArray(res?.data?.videos)
          ? res.data.videos
          : [];
      const item = pool[0];
      if (item?.folder && item?.name) {
        const q = new URLSearchParams({ folder: item.folder, name: item.name });
        if (item.subfolder) q.set('subfolder', item.subfolder);
        navigate('/video?' + q.toString());
      } else {
        navigate('/search');
      }
    } finally {
      setBusyRandom(false);
      setOpenDropdown(null);
    }
  }

  function openRandomCategory() {
    const idx = Math.floor(Math.random() * CATEGORY_ITEMS.length);
    navigate(CATEGORY_ITEMS[idx].to);
    setOpenDropdown(null);
  }

  function splitCategoriesForTwoColumns(items) {
    const midpoint = Math.ceil(items.length / 2);
    return [items.slice(0, midpoint), items.slice(midpoint)];
  }

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
        <Link to="/" className="pw-nav-brand" aria-label="Pornwrld Home">
          <img src="/assets/branding/pornwrld-logo.png" alt="Pornwrld" className="pw-nav-brand-logo" />
        </Link>
        <button type="button" className="pw-nav-search" onClick={() => navigate('/search')}>
          Search videos and categories
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
            const menuItems = item.dropdown === 'videos' ? VIDEO_DROPDOWN : CATEGORY_ITEMS;
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
                    {item.dropdown === 'categories' ? (
                      <>
                        <div className="pw-nav-dd-cols">
                          {splitCategoriesForTwoColumns(CATEGORY_ITEMS).map((col, colIdx) => (
                            <div key={`cat-col-${colIdx}`} className="pw-nav-dd-col">
                              {col.map((entry) => (
                                <button
                                  key={entry.label}
                                  type="button"
                                  className={`pw-nav-dd-item${entry.premium ? ' premium' : ''}`}
                                  onClick={() => {
                                    navigate(entry.to);
                                    setOpenDropdown(null);
                                  }}
                                >
                                  {entry.label}
                                </button>
                              ))}
                            </div>
                          ))}
                        </div>
                        <button type="button" className="pw-nav-dd-item pw-nav-dd-item-random" onClick={openRandomCategory}>
                          Random Category
                        </button>
                      </>
                    ) : (
                      menuItems.map((entry) => {
                        if (entry.action === 'random-video') {
                          return (
                            <button key={entry.label} type="button" className="pw-nav-dd-item" onClick={openRandomVideo} disabled={busyRandom}>
                              {busyRandom ? 'Loading random...' : entry.label}
                            </button>
                          );
                        }
                        return (
                          <button
                            key={entry.label}
                            type="button"
                            className={`pw-nav-dd-item${entry.premium ? ' premium' : ''}`}
                            onClick={() => {
                              navigate(entry.to);
                              setOpenDropdown(null);
                            }}
                          >
                            {entry.label}
                          </button>
                        );
                      })
                    )}
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

