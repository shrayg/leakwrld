import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useShell } from '../../context/ShellContext';
import { logout } from '../../api/client';

function initialsFor(name) {
  const s = String(name || '').trim();
  if (!s) return 'U';
  const parts = s.split(/\s+/).filter(Boolean);
  const first = parts[0] ? parts[0][0] : s[0];
  const second = parts.length > 1 ? parts[1][0] : s.length > 1 ? s[1] : '';
  return (first + second).toUpperCase();
}

export function ProfileMenu() {
  const { user, loading, isAuthed, tier } = useAuth();
  const { openAuth } = useShell();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    function onDoc(e) {
      if (!rootRef.current?.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  async function onLogout() {
    try {
      await logout();
    } finally {
      sessionStorage.removeItem('age_verified');
      setMenuOpen(false);
      window.location.href = '/';
    }
  }

  if (loading) {
    return <span className="top-nav-auth-placeholder">…</span>;
  }

  if (!isAuthed) {
    return (
      <button type="button" className="home-login-btn" id="home-login" onClick={() => openAuth('login')}>
        Login / Sign Up
      </button>
    );
  }

  const name = (user.username || 'Account').replace(/^discord:/, '');
  const tierLabel = String(user.tierLabel || 'NO TIER');

  return (
    <div className="profile" id="profile" ref={rootRef}>
      <a className="profile-telegram-external" href="https://t.me/pornyardxyz" target="_blank" rel="noopener noreferrer" aria-label="Telegram" id="profile-telegram-ext">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="20" height="20">
          <path d="M9.993 15.53 9.84 19.2c.314 0 .451-.135.616-.297l1.478-1.419 3.065 2.242.562.31.962.148 1.11-.52l2.01-9.43v-.001c.205-.957-.346-1.332-.893-1.13L4.41 11.41c-.93.36-.915.875-.17 1.105l3.856 1.203 8.96-5.655c.422-.256.806-.114.49.142l-7.553 7.123z" />
        </svg>
      </a>
      <button type="button" className="profile-btn" id="profile-btn" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
        <span className="profile-avatar" id="profile-avatar">
          {initialsFor(name)}
        </span>
        <span className="profile-username-trigger" id="profile-username-trigger">
          {name}
        </span>
        {tier > 0 && tierLabel !== 'NO TIER' ? (
          <span className="profile-tier-badge" id="profile-tier-badge">
            {tierLabel}
          </span>
        ) : (
          <span className="profile-tier-badge" id="profile-tier-badge" hidden />
        )}
        <span className="profile-caret">▾</span>
      </button>
      <div className={'profile-dropdown' + (menuOpen ? ' active' : '')} id="profile-dropdown" role="menu" aria-label="Profile menu">
        <div className="profile-username" id="profile-username">
          {name}
        </div>
        <div className="profile-tier" id="profile-tier">
          {tierLabel}
        </div>
        <Link to="/help" className="profile-settings" id="profile-settings" role="menuitem" onClick={() => setMenuOpen(false)}>
          Settings
        </Link>
        {tier < 1 && (
          <button
            type="button"
            className="profile-upgrade"
            id="profile-upgrade"
            onClick={() => {
              setMenuOpen(false);
              navigate('/?welcome=1');
            }}
          >
            Upgrade
          </button>
        )}
        <a
          href="https://t.me/pornyardxyz"
          className="profile-contact"
          role="menuitem"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setMenuOpen(false)}
        >
          Contact Us
        </a>
        <button className="profile-logout" id="profile-logout" type="button" onClick={onLogout}>
          Sign out
        </button>
      </div>
    </div>
  );
}
