import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useShell } from '../../context/ShellContext';
import { fetchReferralStatus } from '../../api/client';
import { GoldPremiumFx } from './GoldPremiumFx';

const REFERRAL_PROGRAM_TO = '/account?tab=referrals';

function ChevronDown({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
            Referrals do two things at once: they move you toward <strong className="hero-referral-goal__gold">premium access</strong>{' '}
            (tier perks &amp; bonus previews) and let you <strong className="hero-referral-goal__gold">earn money</strong> through your
            personal referral code.
          </p>
          <p className="hero-referral-goal__earn-hint">
            After you create an account, use <strong className="hero-referral-goal__gold">Get your referral link</strong> on this card — that’s
            where your code lives. Earnings and payout rules are on your{' '}
            <Link className="referral-inline-link" to={REFERRAL_PROGRAM_TO}>
              Referral Program
            </Link>{' '}
            page.
          </p>
          <p className="hero-referral-goal__midline">Referral progress and payout tracking unlock after signup.</p>
          <div className="hero-referral-goal__actions">
            <button type="button" className="referral-cta-primary" onClick={() => openAuth('signup')}>
              Create free account
            </button>
            <button
              type="button"
              className="referral-more-btn"
              aria-expanded={moreOpen}
              aria-controls="referral-more-panel-guest"
              id="referral-more-toggle-guest"
              aria-label="Expand a short explanation of premium tiers and referrals"
              onClick={() => setMoreOpen((o) => !o)}
            >
              <span className="referral-more-btn__label">How it works</span>
              <ChevronDown className="referral-more-btn__arrow" />
            </button>
            <Link
              className="referral-more-btn referral-more-btn--program-link"
              to={REFERRAL_PROGRAM_TO}
              aria-label="Open Referral Program on your account"
              id="referral-program-more-guest"
            >
              <span className="referral-more-btn__label">Referral program</span>
              <ChevronDown className="referral-more-btn__arrow referral-more-btn__arrow--forward" />
            </Link>
          </div>
          <div
            className={'referral-more-panel' + (moreOpen ? ' is-open' : '')}
            id="referral-more-panel-guest"
            role="region"
            aria-labelledby="referral-more-toggle-guest"
            aria-hidden={!moreOpen}
          >
            <p>
              After you join, share your link: friends browse free while your signups count toward premium tiers. Leaderboards and paid
              referral perks are spelled out on your Referral Program tab.
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
          Share your referral code for two wins: faster <strong className="hero-referral-goal__gold">premium access</strong> (tiers &amp;
          bonus previews) and <strong className="hero-referral-goal__gold">earning money</strong> when your referrals qualify for program
          payouts.
        </p>
        <p className="hero-referral-goal__earn-hint">
          Use <strong className="hero-referral-goal__gold">Get your referral link</strong> above for your code. Payouts, tiers, and earning
          rules live on your{' '}
          <Link className="referral-inline-link" to={REFERRAL_PROGRAM_TO}>
            Referral Program
          </Link>{' '}
          page.
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
            aria-controls="referral-more-panel-auth"
            id="referral-more-toggle-auth"
            aria-label="Expand a short explanation of premium tiers and referrals"
            onClick={() => setMoreOpen((o) => !o)}
          >
            <span className="referral-more-btn__label">How it works</span>
            <ChevronDown className="referral-more-btn__arrow" />
          </button>
          <Link
            className="referral-more-btn referral-more-btn--program-link"
            to={REFERRAL_PROGRAM_TO}
            aria-label="Open Referral Program on your account"
            id="referral-program-more-auth"
          >
            <span className="referral-more-btn__label">Referral program</span>
            <ChevronDown className="referral-more-btn__arrow referral-more-btn__arrow--forward" />
          </Link>
        </div>
        <div
          className={'referral-more-panel' + (moreOpen ? ' is-open' : '')}
          id="referral-more-panel-auth"
          role="region"
          aria-labelledby="referral-more-toggle-auth"
          aria-hidden={!moreOpen}
        >
          <p>
            Premium tiers unlock as verified signups land. Paid referral earnings, leaderboard prizes, and eligibility are documented on
            your Account → Referral Program page — use the <strong>Referral program</strong> button to open it anytime.
          </p>
        </div>
      </div>
    </section>
  );
}
