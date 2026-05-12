import { Send } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { TELEGRAM_URL } from '../lib/referral';

/**
 * Global site footer — slim, always present, anchors the canonical Telegram
 * link site-wide so users always have a way to reach support / request a
 * payout regardless of which page they're on.
 *
 * Hidden on /shorts because that page is a full-bleed media experience and a
 * footer underneath the player creates a dead zone after every scroll.
 */
export function SiteFooter() {
  const { pathname } = useLocation();
  if (pathname.startsWith('/shorts')) return null;

  const year = new Date().getFullYear();

  return (
    <footer className="lw-footer" aria-label="Site footer">
      <div className="lw-footer-inner">
        <div className="lw-footer-brand">
          <span className="lw-footer-brand-name">Leak World</span>
          <span className="lw-footer-brand-sub">The most trusted source for leaks.</span>
        </div>

        <nav className="lw-footer-nav" aria-label="Footer navigation">
          <Link to="/categories" className="lw-footer-link">
            Creators
          </Link>
          <Link to="/shorts" className="lw-footer-link">
            Shorts
          </Link>
          <Link to="/refer" className="lw-footer-link">
            Referrals &amp; earnings
          </Link>
          <Link to="/checkout" className="lw-footer-link">
            Premium
          </Link>
        </nav>

        <div className="lw-footer-contact">
          <a
            className="lw-footer-tg"
            href={TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Contact Leak World on Telegram"
          >
            <Send size={14} aria-hidden />
            <span className="lw-footer-tg-label">Telegram</span>
            <span className="lw-footer-tg-handle">@leakwrldcom</span>
          </a>
          <p className="lw-footer-contact-note">
            DM us for support, payout requests, or anything else.
          </p>
        </div>
      </div>

      <div className="lw-footer-baseline">
        <span>© {year} Leak World</span>
        <span className="lw-footer-baseline-dot" aria-hidden>
          ·
        </span>
        <span>All content mirrored daily.</span>
      </div>
    </footer>
  );
}
