import { GoldPremiumFx } from '../home/GoldPremiumFx';

function toNum(v) {
  return Number(v || 0).toLocaleString();
}

function pct(current, goal) {
  if (!goal || goal <= 0) return 0;
  return Math.min(100, Math.round((Math.max(0, Number(current) || 0) / goal) * 1000) / 10);
}

function GoalBar({ label, current, goal, suffix = '', detail, formatCount }) {
  const p = pct(current, goal);
  const countStr = formatCount ? formatCount(current, goal) : `${toNum(Math.min(current, goal))} / ${toNum(goal)}${suffix}`;
  return (
    <div className="account-affiliate-goal">
      <div className="account-affiliate-goal__top">
        <span className="account-affiliate-goal__label">{label}</span>
        <span className="account-affiliate-goal__count">{countStr}</span>
      </div>
      <div className="referral-bar account-affiliate-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)} aria-label={label}>
        <div className="referral-bar-fill account-affiliate-bar__fill" style={{ width: `${p}%` }} />
      </div>
      {detail ? <p className="account-affiliate-goal__detail">{detail}</p> : null}
    </div>
  );
}

export function AccountAffiliateProgram({ affiliate }) {
  const a = affiliate || {};
  const tg = String(a.telegramPayoutUrl || '').trim();

  const refGoal = Math.max(1, Number(a.referralGoal) || 100);
  const paidGoal = Math.max(1, Number(a.paidReferralsGoal) || 10);
  const hoursGoal = Math.max(1, Number(a.creatorWatchHoursGoal) || 500);
  const mediaGoal = Math.max(1, Number(a.creatorMediaGoal) || 100);

  const refCount = Math.max(0, Number(a.referralCount) || 0);
  const paidCount = Math.max(0, Number(a.paidReferralsCount) || 0);
  const watchHours = Math.max(0, Number(a.creatorWatchHours) || 0);
  const mediaCount = Math.max(0, Number(a.creatorMediaCount) || 0);

  const refReady = refCount >= refGoal && paidCount >= paidGoal;
  const creatorReady = watchHours >= hoursGoal && mediaCount >= mediaGoal;

  const refCombinedPct = (pct(refCount, refGoal) + pct(paidCount, paidGoal)) / 2;

  return (
    <section className="account-affiliate" aria-labelledby="account-affiliate-heading">
      <div className="account-affiliate__hero">
        <h3 id="account-affiliate-heading">Affiliate program</h3>
        <p className="account-affiliate__lede">
          <strong>Yes, you can make real money here.</strong> Two partnership paths unlock higher payouts as you grow traffic, drive upgrades, and build watch time.
          Hit milestones, then message us to activate your rates.
        </p>
        <div className="account-affiliate__money-points">
          <p>
            <GoldPremiumFx>High payout potential:</GoldPremiumFx> serious partners can stack recurring commissions and creator payouts every month.
          </p>
          <p>
            <GoldPremiumFx>Performance based:</GoldPremiumFx> the more buying traffic and watch time you generate, the more you can earn.
          </p>
          <p>
            <GoldPremiumFx>Monetize your audience:</GoldPremiumFx> earn on video monetization, a percentage of total platform earnings, and paid-only content drops.
          </p>
        </div>
      </div>

      <div className="account-affiliate__grid">
        <article className="account-affiliate-card account-affiliate-card--refer">
          <header className="account-affiliate-card__head">
            <span className="account-affiliate-card__badge">Path 1</span>
            <h4>Referral partnership</h4>
            <p className="account-affiliate-card__sub">
              Scale your audience and convert clicks into paid members. Hit both targets, then DM us with your <strong>Pornwrld username</strong> to unlock partner payouts.
            </p>
          </header>
          <div className="account-affiliate-card__body">
            <GoalBar
              label="Total referrals"
              current={refCount}
              goal={refGoal}
              detail="Everyone who signed up with your referral link counts toward this goal."
            />
            <GoalBar
              label="Paying referred members"
              current={paidCount}
              goal={paidGoal}
              detail="Users you referred who upgraded (Basic/Premium) or show paid activity on their account."
            />
            <div className="account-affiliate-card__reward">
              <strong>Unlock:</strong> Partner status + referral payouts up to <GoldPremiumFx className="account-affiliate__money-fx">25%+</GoldPremiumFx> per paid member.
            </div>
            {refReady ? (
              <p className="account-affiliate-card__ready">
                You&apos;ve cleared both referral milestones — message us now to activate your payout rate.
              </p>
            ) : (
              <p className="account-affiliate-card__nudge">
                {refCombinedPct.toFixed(0)}% combined progress — keep sharing your link; every paid conversion moves you closer to payout unlock.
              </p>
            )}
            <section className="account-affiliate-card__info" aria-label="Referral monetization details">
              <h5>How you earn with referral partnership</h5>
              <ul>
                <li><strong>Referral earnings:</strong> you earn money only from paid users you refer and the qualified paid activity they generate.</li>
              </ul>
            </section>
          </div>
        </article>

        <article className="account-affiliate-card account-affiliate-card--creator">
          <header className="account-affiliate-card__head">
            <span className="account-affiliate-card__badge account-affiliate-card__badge--creator">Path 2</span>
            <h4>Creator partnership</h4>
            <p className="account-affiliate-card__sub">
              Publish consistently and build watch time across linked uploads. Meet both bars, then message us to activate stronger creator payouts.
            </p>
          </header>
          <div className="account-affiliate-card__body">
            <GoalBar
              label="Watch hours on your uploads"
              current={watchHours}
              goal={hoursGoal}
              formatCount={(c, g) => `${Math.min(c, g).toFixed(1)} / ${toNum(g)} hrs`}
              detail="Totals combine watch time stored on each linked video/photo/GIF (watchSeconds/watchMs) plus verified hours we attach to your profile."
            />
            <GoalBar
              label="Pieces of media on profile"
              current={mediaCount}
              goal={mediaGoal}
              detail="Count of linked items across Videos, Photos, and GIFs on your profile tab."
            />
            <div className="account-affiliate-card__reward">
              <strong>Unlock:</strong> Creator partner status with <GoldPremiumFx className="account-affiliate__money-fx">earn monetization on videos</GoldPremiumFx> plus a percentage of total platform earnings.
            </div>
            {creatorReady ? (
              <p className="account-affiliate-card__ready">
                You&apos;ve cleared creator milestones — send your username + profile link so we can turn on creator payouts.
              </p>
            ) : (
              <p className="account-affiliate-card__nudge">
                Keep uploading and promoting — watch hours compound over time and push you toward payout activation.
              </p>
            )}
            <section className="account-affiliate-card__info" aria-label="Creator monetization details">
              <h5>How you earn with creator partnership</h5>
              <ul>
                <li><strong>Video monetization:</strong> earn money when paid users watch your uploaded content.</li>
                <li><strong>Platform percentage:</strong> receive a percentage of total platform earnings tied to your creator performance tier.</li>
                <li><strong>Paid-only content payouts:</strong> earn directly from posting exclusive paid-only videos, photos, and GIF packs.</li>
              </ul>
            </section>
          </div>
        </article>
      </div>

      <footer className="account-affiliate__footer">
        {tg ? (
          <>
            <p>
              <strong>Ready when you are:</strong> open Telegram and message us from the account we can verify. Include your Pornwrld username and which path you&apos;re
              pursuing (or both).
            </p>
            <a className="account-affiliate__telegram" href={tg} target="_blank" rel="noopener noreferrer">
              Message us on Telegram
            </a>
          </>
        ) : (
          <p className="account-affiliate__telegram-pending">
            <strong>Official channels:</strong> Our payout deep-link may appear here soon. Until then, use the site&apos;s Discord and Telegram links — same official channels as support and reports — and include proof screenshots when you message us.
          </p>
        )}
      </footer>
    </section>
  );
}
