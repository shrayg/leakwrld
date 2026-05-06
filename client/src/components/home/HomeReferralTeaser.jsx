import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { fetchReferralStatus } from '../../api/client';
import { GoldPremiumFx } from './GoldPremiumFx';

export const HOME_TOP_REFERRERS_ID = 'home-top-referrers';

const REFERRAL_PROGRAM_TO = '/account?tab=referrals';

function ChevronDown({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Slim strip above Trending: referral goal + CTA that scrolls to the hero referral card. */
export function HomeReferralTeaser() {
  const { isAuthed, tier, loading } = useAuth();
  const [count, setCount] = useState(0);
  const [goal, setGoal] = useState(1);

  useEffect(() => {
    if (!isAuthed) {
      setCount(0);
      setGoal(1);
      return;
    }
    let cancelled = false;
    (async () => {
      const r = await fetchReferralStatus();
      if (cancelled || !r.ok || !r.data) return;
      setCount(Number(r.data.count ?? 0));
      setGoal(Math.max(1, Number(r.data.goal ?? 1)));
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthed]);

  const pct = goal > 0 ? Math.min(100, Math.round((count / goal) * 100)) : 0;

  function scrollToReferralSection() {
    const target = document.getElementById('hero-referral-goal') || document.getElementById(HOME_TOP_REFERRERS_ID);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* Guests + Tier 0 only — Basic/Premium users still see the leaderboard + "Want free premium" card below */
  if (!loading && isAuthed && (tier || 0) >= 1) return null;

  return (
    <section className="home-referral-teaser" aria-labelledby="home-referral-teaser-heading">
      <div className="home-referral-teaser__inner">
        <div className="home-referral-teaser__main">
          <h2 id="home-referral-teaser-heading" className="home-referral-teaser__heading">
            <GoldPremiumFx>Free premium</GoldPremiumFx> is one referral away
          </h2>
          <p className="home-referral-teaser__sub">
            Two perks: <strong className="hero-referral-goal__gold">premium access</strong> as signups roll in, and{' '}
            <strong className="hero-referral-goal__gold">earning money</strong> through your code. Your actual referral link lives on the
            card below (after you&apos;re signed in). Earnings, payouts, and rules are on your{' '}
            <Link className="referral-inline-link" to={REFERRAL_PROGRAM_TO}>
              Referral Program
            </Link>{' '}
            page.
          </p>
          <div className="home-referral-teaser__goal">
            <div className="home-referral-teaser__goal-top">
              <span className="home-referral-teaser__goal-label">Referral signup goal</span>
              <span className="referral-goal-count" id="home-referral-teaser-count">
                {count}/{goal}
              </span>
            </div>
            <div
              className="referral-bar home-referral-teaser__bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-label={`Referral goal progress: ${pct} percent`}
            >
              <div className="referral-bar-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
        <div className="home-referral-teaser__actions">
          <button
            type="button"
            className="referral-more-btn"
            id="home-referral-teaser-more-premium"
            aria-label="Scroll to the referral card with your link and tier progress"
            onClick={scrollToReferralSection}
          >
            <span className="referral-more-btn__label">How it works</span>
            <ChevronDown className="referral-more-btn__arrow" />
          </button>
          <Link
            className="referral-more-btn referral-more-btn--program-link"
            to={REFERRAL_PROGRAM_TO}
            id="home-referral-teaser-more-program"
            aria-label="Open Referral Program on your account (payouts and earning money)"
          >
            <span className="referral-more-btn__label">Referral program</span>
            <ChevronDown className="referral-more-btn__arrow referral-more-btn__arrow--forward" />
          </Link>
        </div>
      </div>
    </section>
  );
}
