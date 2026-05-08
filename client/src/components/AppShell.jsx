import { Menu, Search, User, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

const links = [
  { to: '/', label: 'Home' },
  { to: '/shorts', label: 'Shorts' },
  { to: '/categories', label: 'Categories' },
  { to: '/checkout', label: 'Premium' },
];

function navClass({ isActive }) {
  return `lw-nav-tab ${isActive ? 'active' : ''}`;
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();
  const { user, loading, logout } = useAuth();

  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="lw-bg-grid" />
        <div className="lw-bg-wash" />
      </div>

      <header className="lw-nav">
        <div className="lw-nav-top">
          <button
            type="button"
            className="lw-icon-btn md:hidden"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>

          <Link to="/" className="lw-brand" aria-label="Leak World home">
            <img src="/assets/branding/pornwrld-logo.png" alt="" className="h-8 w-8 rounded-[6px]" />
            <span>Leak World</span>
          </Link>

          <div className="lw-search-pill">
            <Search size={16} />
            <span>Search creators</span>
          </div>

          <div className="ml-auto hidden items-center gap-2 md:flex">
            {loading ? (
              <span className="lw-user-chip">Checking</span>
            ) : user ? (
              <>
                <span className="lw-user-chip">
                  <User size={15} />
                  {user.username}
                </span>
                <button type="button" className="lw-btn ghost" onClick={logout}>
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="lw-btn ghost">
                  Login
                </Link>
                <Link to="/signup" className="lw-btn primary">
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>

        <nav className="lw-nav-tabs" aria-label="Main navigation">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.to === '/'} className={navClass}>
              {link.label}
            </NavLink>
          ))}
        </nav>

        {mobileOpen ? (
          <div className="lw-mobile-panel md:hidden">
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.to === '/'} className={navClass}>
                {link.label}
              </NavLink>
            ))}
            <div className="grid grid-cols-2 gap-2 pt-2">
              {user ? (
                <button type="button" className="lw-btn ghost col-span-2" onClick={logout}>
                  Logout
                </button>
              ) : (
                <>
                  <Link to="/login" className="lw-btn ghost">
                    Login
                  </Link>
                  <Link to="/signup" className="lw-btn primary">
                    Sign up
                  </Link>
                </>
              )}
            </div>
          </div>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-[1440px] px-3 pb-20 pt-[136px] sm:px-4 lg:px-6">
        <Outlet />
      </main>
    </div>
  );
}
