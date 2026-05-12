import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { accountTierLabel } from '../lib/media';
import { TELEGRAM_URL } from '../lib/referral';
import { UserAvatar } from './UserAvatar';

export function UserAccountMenu({ user, logout, variant = 'desktop', onAfterNavigate }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const menuId = useId();
  const triggerId = useId();

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function closeAnd(cb) {
    setOpen(false);
    cb?.();
  }

  const wrapNavigate = (fn) => () => {
    closeAnd(() => {
      onAfterNavigate?.();
      fn?.();
    });
  };
  const tierLabel = user.tierLabel || accountTierLabel(user.tier);

  return (
    <div
      ref={rootRef}
      className={`lw-user-menu ${variant === 'mobile' ? 'lw-user-menu--mobile' : ''} ${variant === 'shorts' ? 'lw-user-menu--shorts' : ''}`}
    >
      <button
        type="button"
        className="lw-user-chip lw-user-menu-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        id={triggerId}
        onClick={() => setOpen((v) => !v)}
      >
        <UserAvatar username={user.username} size={28} />
        <span className="min-w-0 flex-1 truncate text-left font-medium">{user.username}</span>
        <ChevronDown
          size={16}
          className={`lw-user-menu-chevron shrink-0 opacity-65 ${open ? 'lw-user-menu-chevron--open' : ''}`}
          aria-hidden
        />
      </button>
      {open ? (
        <div
          className="lw-user-menu-dropdown"
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
        >
          <div className="lw-user-menu-tier" role="none">
            <span>Tier</span>
            <b>{tierLabel}</b>
          </div>
          <Link
            className="lw-user-menu-item"
            role="menuitem"
            to="/refer"
            onClick={wrapNavigate()}
          >
            Referrals &amp; earnings
          </Link>
          <Link
            className="lw-user-menu-item"
            role="menuitem"
            to="/checkout"
            onClick={wrapNavigate()}
          >
            Upgrade
          </Link>
          <a
            className="lw-user-menu-item"
            role="menuitem"
            href={TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={wrapNavigate()}
          >
            Contact support
          </a>
          <button
            type="button"
            className="lw-user-menu-item lw-user-menu-item--logout"
            role="menuitem"
            onClick={wrapNavigate(() => logout())}
          >
            Logout
          </button>
        </div>
      ) : null}
    </div>
  );
}
