import { Menu, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AuthModal } from './AuthModal';
import { useAuth } from './AuthContext';
import { UserAvatar } from './UserAvatar';

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
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { user, loading, logout, openAuthModal } = useAuth();

  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo(0, 0);
  }, [pathname]);

  useEffect(() => {
    if (loading) return;
    const params = new URLSearchParams(search);
    const a = params.get('auth');
    if (a !== 'login' && a !== 'signup') return;
    if (!user) openAuthModal(a);
    params.delete('auth');
    const qs = params.toString();
    navigate(`${pathname}${qs ? `?${qs}` : ''}`, { replace: true });
  }, [search, pathname, navigate, openAuthModal, loading, user]);

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
                  <UserAvatar username={user.username} size={28} />
                  {user.username}
                </span>
                <button type="button" className="lw-btn ghost" onClick={logout}>
                  Logout
                </button>
              </>
            ) : (
              <>
                <button type="button" className="lw-btn ghost" onClick={() => openAuthModal('login')}>
                  Login
                </button>
                <button type="button" className="lw-btn primary" onClick={() => openAuthModal('signup')}>
                  Sign up
                </button>
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
                <>
                  <div className="lw-user-chip col-span-2 flex min-h-0 items-center gap-2">
                    <UserAvatar username={user.username} size={28} />
                    <span className="min-w-0 truncate font-medium">{user.username}</span>
                  </div>
                  <button type="button" className="lw-btn ghost col-span-2" onClick={logout}>
                    Logout
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="lw-btn ghost"
                    onClick={() => {
                      setMobileOpen(false);
                      openAuthModal('login');
                    }}
                  >
                    Login
                  </button>
                  <button
                    type="button"
                    className="lw-btn primary"
                    onClick={() => {
                      setMobileOpen(false);
                      openAuthModal('signup');
                    }}
                  >
                    Sign up
                  </button>
                </>
              )}
            </div>
          </div>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-[1440px] px-3 pb-20 pt-[136px] sm:px-4 lg:px-6">
        <Outlet />
      </main>

      <AuthModal />
    </div>
  );
}
