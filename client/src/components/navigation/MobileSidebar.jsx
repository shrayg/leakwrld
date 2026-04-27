import { NavLink } from 'react-router-dom';
import { X } from 'lucide-react';
import { GoldPremiumFx } from '../home/GoldPremiumFx';
import { useAuth } from '../../hooks/useAuth';

function getLinks(isAuthed) {
  return [
    { to: '/', label: 'Home' },
    { to: '/shorts', label: 'Shorts' },
    { to: '/search', label: 'Videos' },
    { to: '/categories', label: 'Categories' },
    { to: '/custom-requests', label: 'Custom Requests' },
    { to: '/checkout', label: 'Premium' },
    ...(isAuthed ? [] : [{ to: '/login', label: 'Login / Sign Up' }]),
    ...(isAuthed
      ? []
      : []),
  ];
}

export function MobileSidebar({ open, onClose }) {
  const { isAuthed } = useAuth();
  if (!open) return null;
  const links = getLinks(isAuthed);

  return (
    <>
      <div
        className="nav-sidebar-overlay open fixed inset-0 z-[9998] block bg-[rgba(5,5,8,0.72)] [backdrop-filter:blur(4px)] animate-[nav-sidebar-overlay-in_200ms_ease-out] md:hidden"
        onClick={onClose}
        role="presentation"
      />
      <div className="nav-sidebar open fixed left-0 top-0 z-[9999] flex h-dvh w-[min(82vw,320px)] translate-x-0 flex-col border-r border-white/10 bg-[linear-gradient(180deg,rgba(7,7,14,0.98),rgba(10,10,18,0.98))] p-0 shadow-[18px_0_40px_rgba(0,0,0,0.55)] animate-[nav-sidebar-slide-in_260ms_cubic-bezier(0.22,1,0.36,1)] md:hidden">
        <div className="nav-sidebar-header flex items-center justify-between border-b border-white/10 px-3.5 pb-3 pt-4">
          <button
            type="button"
            className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-[var(--pornwrld-radius-card)] border border-white/20 bg-white/10 p-0 text-white/90 transition"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X size={16} strokeWidth={2.4} aria-hidden="true" />
          </button>
          <span className="text-sm font-bold tracking-[0.03em] text-white">Menu</span>
        </div>
        <nav className="nav-sidebar-links grid content-start gap-1.5 overflow-auto px-2.5 pb-4 pt-3">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              onClick={onClose}
              className={({ isActive }) =>
                'nav-sidebar-item flex min-h-10 w-full items-center rounded-[var(--pornwrld-radius-card)] border px-3 py-2 text-sm font-semibold leading-tight tracking-[0.01em] transition ' +
                (isActive
                  ? 'border-[rgba(243,198,105,0.36)] bg-[rgba(243,198,105,0.11)] text-white'
                  : 'border-transparent bg-transparent text-white/85')
              }
              end={l.to === '/'}
            >
              {l.to === '/checkout' ? <GoldPremiumFx className="nav-sidebar-premium-fx">{l.label}</GoldPremiumFx> : l.label}
            </NavLink>
          ))}
          <a
            href="https://t.me/pornwrldxyz"
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="nav-sidebar-item flex min-h-10 w-full items-center rounded-[var(--pornwrld-radius-card)] border border-transparent bg-transparent px-3 py-2 text-sm font-semibold leading-tight tracking-[0.01em] text-white/85 transition"
          >
            Contact Us
          </a>
        </nav>
      </div>
    </>
  );
}
