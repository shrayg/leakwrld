import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { fetchRandomVideos } from '../../api/client';
import { ProfileMenu } from '../auth/ProfileMenu';

const CATEGORY_ITEMS = [
  { label: 'NSFW Straight', to: '/nsfw-straight' },
  { label: 'Alt and Goth', to: '/alt-and-goth' },
  { label: 'Petitie', to: '/petitie' },
  { label: 'Teen (18+ only)', to: '/teen-18-plus' },
  { label: 'MILF', to: '/milf' },
  { label: 'Asian', to: '/asian' },
  { label: 'Ebony', to: '/ebony' },
  { label: 'Hentai', to: '/hentai' },
  { label: 'Yuri', to: '/yuri' },
  { label: 'Yaoi', to: '/yaoi' },
  { label: 'Nip Slips', to: '/nip-slips' },
  { label: 'Omegle', to: '/omegle' },
  { label: 'OF Leaks', to: '/of-leaks' },
  { label: 'Premium Leaks', to: '/premium-leaks' },
];

const VIDEO_DROPDOWN = [
  { label: 'Recommended', to: '/' },
  { label: 'Popular', to: '/search' },
  { label: 'Newly Added', to: '/new-releases' },
  { label: 'Random Video', action: 'random-video' },
  { label: 'Live Cams', to: '/live-cams' },
  { label: 'OnlyFans', to: '/onlyfans' },
];

const NAV_ITEMS = [
  { key: 'home', label: 'Home', to: '/' },
  { key: 'videos', label: 'Videos', dropdown: 'videos' },
  { key: 'categories', label: 'Categories', dropdown: 'categories' },
  { key: 'shorts', label: 'Shorts', to: '/shorts' },
  { key: 'custom', label: 'Custom Requests', to: '/custom-requests' },
  { key: 'premium', label: 'Premium', to: '/checkout', premium: true },
  { key: 'support', label: 'Contact Us', href: 'https://t.me/pornwrldxyz' },
];

function isItemActive(pathname, item) {
  if (item.to === '/') return pathname === '/' || pathname === '/index.html';
  if (item.to) return pathname === item.to || pathname.startsWith(item.to + '/');
  if (item.dropdown === 'videos') return pathname === '/new-releases' || pathname === '/onlyfans' || pathname === '/live-cams';
  if (item.dropdown === 'categories') return pathname === '/categories' || CATEGORY_ITEMS.some((c) => pathname === c.to);
  return false;
}

export function TopNavModern({ menuOpen = false, onToggleMenu }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [openDropdown, setOpenDropdown] = useState(null);
  const [busyRandom, setBusyRandom] = useState(false);
  const navRef = useRef(null);
  const itemRefs = useRef({});
  const [glide, setGlide] = useState({ opacity: 0, x: 0, y: 0, w: 0, h: 0 });

  const activeKey = useMemo(() => {
    const active = NAV_ITEMS.find((it) => isItemActive(pathname, it));
    return active?.key ?? null;
  }, [pathname]);

  const visualActiveKey = useMemo(() => {
    if (openDropdown === 'videos') return 'videos';
    if (openDropdown === 'categories') return 'categories';
    return 'home';
  }, [openDropdown]);

  useLayoutEffect(() => {
    const navNode = navRef.current;
    if (!navNode || !visualActiveKey) {
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
      const item = res?.data?.videos?.[0];
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
        <Link to="/" className="pw-nav-brand">Pornwrld</Link>
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
                                  className="pw-nav-dd-item"
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
                            className="pw-nav-dd-item"
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

