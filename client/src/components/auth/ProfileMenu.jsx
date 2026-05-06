import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useShell } from '../../context/ShellContext';
import { logout } from '../../api/client';
import { useSupabaseAuth } from '../../context/SupabaseAuthProvider';
import { UserAvatar } from '../ui/UserAvatar';
import { OFFICIAL_DISCORD_INVITE_URL, OFFICIAL_TELEGRAM_URL } from '../../constants/officialContact';

export function ProfileMenu() {
  const { user, loading, isAuthed, tier } = useAuth();
  const { openAuth } = useShell();
  const sb = useSupabaseAuth();
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
      await sb?.signOutSupabase?.();
      await logout();
    } finally {
      setMenuOpen(false);
      window.location.href = '/';
    }
  }

  if (loading) {
    return <span className="top-nav-auth-placeholder">…</span>;
  }

  if (!isAuthed) {
    return (
      <div className="profile-auth-links">
        <a
          className="profile-social-external profile-discord-external"
          href={OFFICIAL_DISCORD_INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Discord"
          id="profile-discord-ext"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="18" height="18">
            <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.0777.0777 0 01-.0076-.1278c.1258-.0943.2517-.1913.3718-.2894a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.097.246.1951.3728.2895a.0777.0777 0 01-.0066.1278 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.0777.0777 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419-.019 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1568 2.4189Z" />
          </svg>
        </a>
        <a
          className="profile-social-external profile-telegram-external"
          href={OFFICIAL_TELEGRAM_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Telegram"
          id="profile-telegram-ext"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="18" height="18">
            <path d="M9.993 15.53 9.84 19.2c.314 0 .451-.135.616-.297l1.478-1.419 3.065 2.242.562.31.962.148 1.11-.52 2.01-9.43v-.001c.205-.957-.346-1.332-.893-1.13L4.41 11.41c-.93.36-.915.875-.17 1.105l3.856 1.203 8.96-5.655c.422-.256.806-.114.49.142l-7.553 7.123z" />
          </svg>
        </a>
        <button type="button" className="home-login-btn" id="home-login" onClick={() => openAuth('login')}>
          Login / Sign Up
        </button>
      </div>
    );
  }

  const name = (user.username || 'Account').replace(/^discord:/, '');
  const tierLabel = String(user.tierLabel || 'NO TIER');

  return (
    <div className="profile" id="profile" ref={rootRef}>
      <a className="profile-telegram-external" href={OFFICIAL_TELEGRAM_URL} target="_blank" rel="noopener noreferrer" aria-label="Telegram" id="profile-telegram-ext">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="20" height="20">
          <path d="M9.993 15.53 9.84 19.2c.314 0 .451-.135.616-.297l1.478-1.419 3.065 2.242.562.31.962.148 1.11-.52l2.01-9.43v-.001c.205-.957-.346-1.332-.893-1.13L4.41 11.41c-.93.36-.915.875-.17 1.105l3.856 1.203 8.96-5.655c.422-.256.806-.114.49.142l-7.553 7.123z" />
        </svg>
      </a>
      <a className="profile-discord-external" href={OFFICIAL_DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer" aria-label="Discord" id="profile-discord-ext">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="20" height="20">
          <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.0777.0777 0 01-.0076-.1278c.1258-.0943.2517-.1913.3718-.2894a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.097.246.1951.3728.2895a.0777.0777 0 01-.0066.1278 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.0777.0777 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419-.019 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1568 2.4189Z" />
        </svg>
      </a>
      <button type="button" className="profile-btn" id="profile-btn" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
        <UserAvatar username={name} src={user.avatarUrl} size={28} className="profile-avatar" id="profile-avatar" alt="" />
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
        <Link to="/account" className="profile-settings" id="profile-settings" role="menuitem" onClick={() => setMenuOpen(false)}>
          Account
        </Link>
        {tier < 1 && (
          <button
            type="button"
            className="profile-upgrade"
            id="profile-upgrade"
            onClick={() => {
              setMenuOpen(false);
              navigate('/checkout');
            }}
          >
            Upgrade
          </button>
        )}
        <Link to="/help" className="profile-contact" role="menuitem" onClick={() => setMenuOpen(false)}>
          Contact Us
        </Link>
        <button className="profile-logout" id="profile-logout" type="button" onClick={onLogout}>
          Sign out
        </button>
      </div>
    </div>
  );
}
