import { NavLink } from 'react-router-dom';
import { X } from 'lucide-react';
import { GoldPremiumFx } from '../home/GoldPremiumFx';

const LINKS = [
  { to: '/upload', label: 'Upload' },
  { to: '/custom-requests', label: 'Custom Requests' },
  { to: '/checkout', label: 'Get Premium' },
  { to: '/search', label: 'Search' },
];

export function MobileSidebar({ open, onClose }) {
  if (!open) return null;

  return (
    <>
      <div className="nav-sidebar-overlay" onClick={onClose} role="presentation" />
      <div className="nav-sidebar open">
        <div className="nav-sidebar-header">
          <button
            type="button"
            className="nav-sidebar-close"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X size={16} strokeWidth={2.4} aria-hidden="true" />
          </button>
          <span className="nav-sidebar-title">Menu</span>
        </div>
        <nav className="nav-sidebar-links">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} onClick={onClose} className={({ isActive }) => 'nav-sidebar-item' + (isActive ? ' active' : '')} end={l.to === '/'}>
              {l.to === '/checkout' ? <GoldPremiumFx className="nav-sidebar-premium-fx">{l.label}</GoldPremiumFx> : l.label}
            </NavLink>
          ))}
          <a href="https://t.me/pornyardxyz" target="_blank" rel="noopener noreferrer" onClick={onClose} className="nav-sidebar-item">
            Contact Us
          </a>
        </nav>
      </div>
    </>
  );
}
