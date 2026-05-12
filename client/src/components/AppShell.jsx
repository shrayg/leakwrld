import { Menu, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { recordEvent, recordPageView } from '../lib/analytics';
import { AuthModal } from './AuthModal';
import { useAuth } from './AuthContext';
import { ReferralModals } from './referral/ReferralModals';
import { ReferralWelcomeBanner } from './referral/ReferralWelcomeBanner';
import { SiteFooter } from './SiteFooter';
import { UserAccountMenu } from './UserAccountMenu';

const links = [
  { to: '/', label: 'Home' },
  { to: '/shorts', label: 'Shorts' },
  { to: '/categories', label: 'Creators' },
  { to: '/checkout', label: 'Premium', premium: true },
];

function navClass(link) {
  return ({ isActive }) => `lw-nav-tab ${link.premium ? 'lw-premium-nav' : ''} ${isActive ? 'active' : ''}`.trim();
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { user, loading, logout, openAuthModal } = useAuth();
  const isShorts = pathname === '/shorts';

  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo(0, 0);
  }, [pathname]);

  useEffect(() => {
    const path = `${pathname}${search}`;
    recordPageView(path);
    recordEvent('spa_route', {
      category: 'navigation',
      path,
      payload: { pathname, search: search || '' },
    });
  }, [pathname, search]);

  useEffect(() => {
    if (loading) return;
    const params = new URLSearchParams(search);
    const a = params.get('auth');
    const refParam = params.get('ref');
    /** If a guest lands here via a referral link (?ref= in the URL), pop the
     *  signup modal automatically — these are high-intent visits we don't
     *  want to lose to passive browsing. We deliberately leave `?ref=` in
     *  the URL so it survives a hard refresh and downstream `captureReferralCookie`
     *  on the server keeps refreshing the cookie / IP visit row. */
    const wantAuth = a === 'login' || a === 'signup';
    const wantReferralSignup = !!refParam && !user;
    if (!wantAuth && !wantReferralSignup) return;
    if (!user) openAuthModal(wantAuth ? a : 'signup');
    if (wantAuth) {
      /** `?auth=` is a one-shot trigger — strip it after opening the modal
       *  so a back/forward navigation doesn't re-pop the dialog. */
      params.delete('auth');
      const qs = params.toString();
      navigate(`${pathname}${qs ? `?${qs}` : ''}`, { replace: true });
    }
  }, [search, pathname, navigate, openAuthModal, loading, user]);

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="lw-bg-grid" />
        <div className="lw-bg-wash" />
      </div>

      <header className={`lw-nav ${isShorts ? 'lw-nav--shorts' : ''}`}>
        <div className="lw-nav-top">
          <button
            type="button"
            className="lw-icon-btn lw-menu-toggle"
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
              <UserAccountMenu user={user} logout={logout} variant="desktop" />
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

        <nav className="lw-nav-tabs-outer" aria-label="Main navigation">
          <div className="lw-nav-tabs-scroll">
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.to === '/'} className={navClass(link)}>
                {link.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </header>

      {mobileOpen ? (
        <>
          <button type="button" className="lw-mobile-scrim" aria-label="Close menu" onClick={() => setMobileOpen(false)} />
          <div className="lw-mobile-panel" role="navigation" aria-label="Mobile menu">
            <div className="lw-mobile-panel-head">
              <Link to="/" className="lw-brand" aria-label="Leak World home" onClick={() => setMobileOpen(false)}>
                <span>Leak World</span>
              </Link>
              <button type="button" className="lw-icon-btn" aria-label="Close menu" onClick={() => setMobileOpen(false)}>
                <X size={18} />
              </button>
            </div>
            {links.map((link, index) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/'}
                className={navClass(link)}
                style={{ '--i': index }}
              >
                {link.label}
              </NavLink>
            ))}
            <div className="grid grid-cols-2 gap-2 pt-2" style={{ '--i': links.length }}>
              {user ? (
                <div className="col-span-2">
                  <UserAccountMenu
                    user={user}
                    logout={logout}
                    variant="mobile"
                    onAfterNavigate={() => setMobileOpen(false)}
                  />
                </div>
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
        </>
      ) : null}

      <main className={`lw-main mx-auto w-full max-w-[1440px] px-3 pb-20 pt-[148px] sm:px-4 lg:px-6 ${isShorts ? 'lw-main--shorts' : ''}`}>
        <ReferralWelcomeBanner />
        <Outlet />
      </main>

      <SiteFooter />

      <AuthModal />
      <ReferralModals />
    </div>
  );
}
