import { Gift, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { GoldPremiumFx } from './GoldPremiumFx';

const DISMISS_KEY = 'lw_ref_welcome_dismissed';

/**
 * Sticky welcome banner shown when a guest arrives via a referral link
 * (?ref= in the URL). Designed to anchor the "you were invited" framing
 * before the signup modal opens — a single contextual cue meaningfully
 * lifts referral-link conversion rates.
 *
 * Hidden for signed-in users and after explicit dismissal (sessionStorage).
 */
export function ReferralWelcomeBanner() {
  const { user, openAuthModal } = useAuth();
  const { search } = useLocation();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return !!sessionStorage.getItem(DISMISS_KEY);
    } catch {
      return false;
    }
  });

  const refParam = new URLSearchParams(search).get('ref');

  useEffect(() => {
    /** Once the user signs up, the banner is irrelevant — clear the dismissal
     *  flag so it can fire again for the next anonymous session. */
    if (user) {
      try {
        sessionStorage.removeItem(DISMISS_KEY);
      } catch {
        /* ignore */
      }
    }
  }, [user]);

  if (user || !refParam || dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  }

  return (
    <aside className="lw-ref-welcome" role="status">
      <div className="lw-ref-welcome-icon" aria-hidden>
        <Gift size={18} />
      </div>
      <div className="lw-ref-welcome-body">
        <strong>You were invited by a friend.</strong>{' '}
        Sign up to unlock previews and help them earn <GoldPremiumFx>free premium</GoldPremiumFx>.
      </div>
      <button type="button" className="lw-ref-welcome-cta" onClick={() => openAuthModal('signup')}>
        Sign up free
      </button>
      <button type="button" className="lw-ref-welcome-close" aria-label="Dismiss" onClick={dismiss}>
        <X size={14} aria-hidden />
      </button>
    </aside>
  );
}
