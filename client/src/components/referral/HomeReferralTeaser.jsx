import { Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { fetchReferralStatus } from '../../lib/referral';
import { GoldPremiumFx } from './GoldPremiumFx';

/**
 * Slim referral strip rendered above the featured grid on the home page.
 * Always visible — even for max-tier users, who still earn 20% revshare on
 * every payment, so the share CTA stays relevant.
 *
 * Progress bar reflects the user's *next* milestone, sourced from the
 * server's `/api/referral/status` (`goal` + `goalLabel`). Once every
 * ladder threshold is cleared, the bar is replaced with a "max tier
 * unlocked" success state.
 */
export function HomeReferralTeaser() {
  const { user, openAuthModal, openReferral, openFastModal } = useAuth();
  const isAuthed = !!user;
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!isAuthed) {
      setStatus(null);
      return undefined;
    }
    let cancelled = false;
    fetchReferralStatus().then((s) => {
      if (cancelled || !s) return;
      setStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthed]);

  const count = Number(status?.count || 0);
  const goal = Math.max(1, Number(status?.goal || 3));
  const goalLabel = status?.goalLabel || 'Lifetime Tier 1';
  /** Server returns `goal === count` when every ladder has been cleared. */
  const maxedOut = isAuthed && status && count >= goal && count >= 30;
  const remaining = Math.max(0, goal - count);
  const pct = Math.min(100, Math.round((count / goal) * 100));
  const rateLabel = status?.revshareUnlocked
    ? `${((status?.revshareRateBps || 0) / 100).toFixed(0)}%`
    : '';

  return (
    <section className="lw-ref-teaser" aria-label="Referral teaser">
      <div className="lw-ref-teaser-main">
        <h2 className="lw-ref-teaser-heading">
          {!isAuthed ? (
            <>
              <GoldPremiumFx>Free premium access</GoldPremiumFx>
              {' '}and <GoldPremiumFx>earn up to $1,000+</GoldPremiumFx>
              <span className="lw-ref-teaser-heading-kicker"> — one share away.</span>
            </>
          ) : maxedOut ? (
            <>
              <GoldPremiumFx>You've maxed every tier.</GoldPremiumFx> Every signup now earns you{' '}
              <strong className="lw-ref-gold">{rateLabel || '20%'}</strong> revshare.
            </>
          ) : (
            <>
              <GoldPremiumFx>{goalLabel}</GoldPremiumFx> is{' '}
              {remaining === 0
                ? 'ready to claim'
                : `${remaining} ${remaining === 1 ? 'signup' : 'signups'} away`}
            </>
          )}
        </h2>
        <p className="lw-ref-teaser-sub">
          Share once: <strong className="lw-ref-gold">lifetime vault tiers</strong> unlock as referrals add up, then{' '}
          <strong className="lw-ref-gold">paid revshare</strong> kicks in from your 10th signup.
        </p>
        {isAuthed && !maxedOut ? (
          <div className="lw-ref-teaser-bar-wrap">
            <div
              className="lw-ref-bar"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Referral progress ${pct}%`}
            >
              <div className="lw-ref-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="lw-ref-teaser-count">
              {count}/{goal}
            </span>
          </div>
        ) : null}
      </div>
      <div className="lw-ref-teaser-actions">
        {isAuthed ? (
          <>
            {/* "Get referrals fast" is the fastest path to a real signup — surfaced
                directly here so users don't have to dig through the share modal. */}
            <button
              type="button"
              className="lw-ref-cta-primary lw-ref-cta-fast"
              onClick={openFastModal}
            >
              <Zap size={14} aria-hidden /> Get referrals fast
            </button>
            <button type="button" className="lw-ref-cta-secondary" onClick={openReferral}>
              Share my link
            </button>
          </>
        ) : (
          <button type="button" className="lw-ref-cta-primary" onClick={() => openAuthModal('signup')}>
            Sign up to earn
          </button>
        )}
        <Link className="lw-ref-more-btn" to="/refer">
          Referral program
        </Link>
      </div>
    </section>
  );
}
