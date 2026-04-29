import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useShell } from '../../context/ShellContext';
import { fetchReferralStatus } from '../../api/client';
import { GoldPremiumFx } from './GoldPremiumFx';

/** Referral progress + CTAs — paired with leaderboard on the home row. */
export function HeroReferralGoal() {
  const { isAuthed } = useAuth();
  const { openReferral, openAuth } = useShell();
  const [moreOpen, setMoreOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [goal, setGoal] = useState(1);
  const [statusLoading, setStatusLoading] = useState(true);

  useEffect(() => {
    if (!isAuthed) {
      setStatusLoading(false);
      return;
    }
    let cancelled = false;
    setStatusLoading(true);
    (async () => {
      const r = await fetchReferralStatus();
      if (cancelled) return;
      setStatusLoading(false);
      if (!r.ok || !r.data) {
        setCount(0);
        setGoal(1);
        return;
      }
      setCount(Number(r.data.count || 0));
      setGoal(Math.max(1, Number(r.data.goal || 1)));
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthed]);

  if (!isAuthed) {
    return (
      <section className="hero-referral-goal" id="hero-referral-goal" aria-label="Referral info">
        <div className="hero-referral-goal__inner">
          <h3 className="hero-referral-goal__kicker">
            Want <GoldPremiumFx>free premium</GoldPremiumFx> access?
          </h3>
          <p className="hero-referral-goal__lede">
            Create an account to unlock your personal referral link. Each friend signup moves you toward Tier 1 perks and premium access.
          </p>
          <p className="hero-referral-goal__midline">
            Referral progress and payout tracking unlock after signup.
          </p>
          <div className="hero-referral-goal__actions">
            <button type="button" className="referral-cta-primary" onClick={() => openAuth('signup')}>
              Create free account
            </button>
            <button
              type="button"
              className="referral-more-btn"
              aria-expanded={moreOpen}
              aria-controls="referral-more-panel"
              id="referral-more-toggle"
              onClick={() => setMoreOpen((o) => !o)}
            >
              <span className="referral-more-btn__label">More info</span>
              <svg className="referral-more-btn__arrow" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path
                  d="M6 9l6 6 6-6"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          <div
            className={'referral-more-panel' + (moreOpen ? ' is-open' : '')}
            id="referral-more-panel"
            role="region"
            aria-labelledby="referral-more-toggle"
            aria-hidden={!moreOpen}
          >
            <p>
              Sign up, share your link, and each verified referral helps unlock premium tiers faster.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const pct = !statusLoading && goal > 0 ? Math.min(100, Math.round((count / goal) * 100)) : 0;

  return (
    <section className="hero-referral-goal" id="hero-referral-goal" aria-busy={statusLoading}>
      <div className="hero-referral-goal__inner">
        <h3 className="hero-referral-goal__kicker">
          Want <GoldPremiumFx>free premium</GoldPremiumFx> access?
        </h3>
        <p className="hero-referral-goal__lede">
          Share referral codes — friends get free browsing; each signup moves you toward premium perks and bonus previews.
        </p>

        <div className="referral-goal referral-goal--hero">
          <div className="referral-goal-top">
            <div className="referral-goal-title">Referral signup goal</div>
            <div className="referral-goal-count" id="hero-referral-goal-count" aria-live="polite">
              {statusLoading ? '…' : `${count}/${goal}`}
            </div>
          </div>
          <div
            className={'referral-bar' + (statusLoading ? ' referral-bar--loading' : '')}
            role="progressbar"
            aria-valuenow={statusLoading ? undefined : pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={statusLoading ? 'Loading referral status' : `${pct} percent`}
          >
            <div className="referral-bar-fill" id="hero-referral-bar-fill" style={{ width: statusLoading ? '0%' : `${pct}%` }} />
          </div>
        </div>

        <p className="hero-referral-goal__midline">
          Hit your goal for <span className="hero-referral-goal__gold">Tier 1</span> perks; top referrers each week can earn leaderboard payouts.
        </p>

        <p className="hero-referral-goal__free-hint">Core browsing stays free; referrals speed up tier unlocks.</p>

        <div className="hero-referral-goal__actions">
          <button type="button" className="referral-cta-primary" id="referral-tutorial-hero" data-ref-open onClick={() => openReferral()}>
            Get your referral link
          </button>
          <button
            type="button"
            className="referral-more-btn"
            aria-expanded={moreOpen}
            aria-controls="referral-more-panel"
            id="referral-more-toggle"
            onClick={() => setMoreOpen((o) => !o)}
          >
            <span className="referral-more-btn__label">More info</span>
            <svg className="referral-more-btn__arrow" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path
                d="M6 9l6 6 6-6"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <div
          className={'referral-more-panel' + (moreOpen ? ' is-open' : '')}
          id="referral-more-panel"
          role="region"
          aria-labelledby="referral-more-toggle"
          aria-hidden={!moreOpen}
        >
          <p>
            Your personal link tracks signups. Hit the goal for tier rewards; top referrers each week may qualify for payouts — see the leaderboard.
          </p>
        </div>
      </div>
    </section>
  );
}
