import { useMemo, useState } from 'react';
import { PwNavTabRow } from '../ui/PwNavTabRow';

function toUsd(cents) {
  return `$${(Math.max(0, Number(cents) || 0) / 100).toFixed(2)}`;
}

function toNum(v) {
  return Number(v || 0).toLocaleString();
}

function buildShareUrls(linkUrl) {
  if (!linkUrl) {
    return { xPost: '#', xComment: '#', redditPost: '#', redditComment: '#' };
  }
  const postX = `Join me on Pornwrld — ${linkUrl}`;
  const commentX = `Check out Pornwrld — my referral: ${linkUrl}`;
  return {
    xPost: `https://twitter.com/intent/tweet?text=${encodeURIComponent(postX)}`,
    xComment: `https://twitter.com/intent/tweet?text=${encodeURIComponent(commentX)}`,
    redditPost: `https://www.reddit.com/submit?url=${encodeURIComponent(linkUrl)}&title=${encodeURIComponent('Pornwrld — fast discovery & previews')}`,
    redditComment: `https://www.reddit.com/submit?selftext=true&title=${encodeURIComponent('Referral')}&text=${encodeURIComponent(`When a thread fits the rules, you can reply with:\n${linkUrl}`)}`,
  };
}

const STATS_TABS = [
  { key: 'overview', label: 'Earnings overview' },
  { key: 'claimed', label: 'Claimed payouts' },
];

export function AccountReferralPanel({ referral, onToast }) {
  const [statsTab, setStatsTab] = useState('overview');
  const r = referral || {};
  const code = String(r.code || '');
  const url = String(r.url || '');
  const share = useMemo(() => buildShareUrls(url), [url]);

  async function copyText(label, text) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      onToast(`${label} copied.`);
    } catch {
      onToast(`Could not copy ${label.toLowerCase()}.`);
    }
  }

  return (
    <section className="account-ref-program" aria-labelledby="account-ref-heading">
      <h3 id="account-ref-heading" className="account-ref-program__page-title">
        Referral tools &amp; earnings
      </h3>

      <div className="account-ref-program__grid">
        <div className="account-ref-program__explain">
          <h4 className="account-ref-program__card-title">How it works</h4>
          <ol className="account-ref-program__steps">
            <li>Copy your referral code or full link.</li>
            <li>Use the buttons below to open X or Reddit in a new tab and create posts — or paste your link into comments where it fits the rules.</li>
            <li>Every signup that joins through your link counts toward your goal and tier unlocks.</li>
            <li>
              You earn <strong>{toNum(r.commissionPercent ?? 10)}%</strong> of eligible spend from referrals you brought in. Estimated earnings update as your
              referred members purchase.
            </li>
            <li>When payouts are enabled, DM us on Telegram or Discord with your username to request a verified payout.</li>
          </ol>
        </div>

        <div className="account-ref-program__tools">
          <h4 className="account-ref-program__card-title">Your link &amp; code</h4>
          <div className="account-ref-program__code-row">
            <code className="account-ref-program__code" title="Your referral code">
              {code || '—'}
            </code>
            <button type="button" className="account-ref-program__btn account-ref-program__btn--primary" onClick={() => copyText('Referral code', code)} disabled={!code}>
              Copy code
            </button>
          </div>
          <div className="account-ref-program__link-row">
            <span className="account-ref-program__link-preview" title={url}>
              {url || '—'}
            </span>
            <button type="button" className="account-ref-program__btn" onClick={() => copyText('Referral link', url)} disabled={!url}>
              Copy link
            </button>
            {url ? (
              <a className="account-ref-program__btn account-ref-program__btn--ghost" href={url} target="_blank" rel="noopener noreferrer">
                Open link
              </a>
            ) : null}
          </div>

          <p className="account-ref-program__kicker">Comment / create posts</p>
          <p className="account-ref-program__sub">
            Opens a new tab with a draft post; you can edit before sending. Respects each platform&apos;s rules — don&apos;t spam.
          </p>
          <div className="account-ref-program__share-grid">
            <a className="account-ref-program__share-btn" href={share.xPost} target="_blank" rel="noopener noreferrer">
              <span className="account-ref-program__share-label">X</span>
              <span className="account-ref-program__share-action">New post</span>
            </a>
            <a className="account-ref-program__share-btn" href={share.xComment} target="_blank" rel="noopener noreferrer">
              <span className="account-ref-program__share-label">X</span>
              <span className="account-ref-program__share-action">Post (reply-style)</span>
            </a>
            <a className="account-ref-program__share-btn" href={share.redditPost} target="_blank" rel="noopener noreferrer">
              <span className="account-ref-program__share-label">Reddit</span>
              <span className="account-ref-program__share-action">Submit link</span>
            </a>
            <a className="account-ref-program__share-btn" href={share.redditComment} target="_blank" rel="noopener noreferrer">
              <span className="account-ref-program__share-label">Reddit</span>
              <span className="account-ref-program__share-action">Text for comments</span>
            </a>
          </div>
        </div>
      </div>

      <div className="account-ref-program__stats-wrap">
        <PwNavTabRow
          activeKey={statsTab}
          tabs={STATS_TABS}
          onChange={setStatsTab}
          className="account-pw-tabs account-ref-program__pw-tabs"
          glideClassName="account-pw-glide"
          ariaLabel="Referral earnings"
          sentenceCase
        />

        {statsTab === 'overview' ? (
          <div className="account-ref-program__stats account-ref-program__stats--overview" role="tabpanel">
            <div className="account-ref-program__stat-cards">
              <div className="account-ref-stat-card">
                <span className="account-ref-stat-card__label">Referrals</span>
                <strong className="account-ref-stat-card__value">{toNum(r.count)}</strong>
                <span className="account-ref-stat-card__hint">signups via your link</span>
              </div>
              <div className="account-ref-stat-card">
                <span className="account-ref-stat-card__label">Referred spend</span>
                <strong className="account-ref-stat-card__value">{toUsd(r.referredSpendCents)}</strong>
                <span className="account-ref-stat-card__hint">total from your referred members</span>
              </div>
              <div className="account-ref-stat-card account-ref-stat-card--accent">
                <span className="account-ref-stat-card__label">Est. {toNum(r.commissionPercent ?? 10)}% share</span>
                <strong className="account-ref-stat-card__value">{toUsd(r.estimatedCommissionCents)}</strong>
                <span className="account-ref-stat-card__hint">before verification &amp; payout</span>
              </div>
              <div className="account-ref-stat-card">
                <span className="account-ref-stat-card__label">Goal progress</span>
                <strong className="account-ref-stat-card__value">
                  {toNum(r.count)} / {toNum(r.goal || 1)}
                </strong>
                <span className="account-ref-stat-card__hint">tier unlock path</span>
              </div>
            </div>
            <div className="account-ref-program__rewards">
              <h5>Rewards</h5>
              <ul>
                <li>Tier unlocks and premium perks as you hit referral goals.</li>
                <li>Leaderboard visibility for top referrers (weekly).</li>
                <li>{toNum(r.commissionPercent ?? 10)}% of eligible referred spend — paid out after manual verification.</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="account-ref-program__stats account-ref-program__stats--claimed" role="tabpanel">
            <div className="account-ref-claimed">
              <p className="account-ref-claimed__amount">
                <span className="account-ref-claimed__label">Total claimed (verified)</span>
                <strong>{toUsd(r.claimedPayoutCents)}</strong>
              </p>
              <p className="account-ref-claimed__note">
                Claimed totals are updated when payouts are processed. If you’re owed a balance, reach us on Telegram or Discord (below / nav icons) and DM from an account we can verify with your Pornwrld username.
              </p>
            </div>
          </div>
        )}

        <div className="account-ref-program__telegram">
          {r.telegramPayoutUrl ? (
            <>
              <p className="account-ref-program__telegram-lede">
                <strong>Payouts via Telegram</strong> — DM us on our official channel to confirm your balance and receive payment details.
              </p>
              <a className="account-ref-program__btn account-ref-program__btn--telegram" href={r.telegramPayoutUrl} target="_blank" rel="noopener noreferrer">
                Open Telegram
              </a>
            </>
          ) : (
            <p className="account-ref-program__telegram-pending">
              <strong>Payouts:</strong> We&apos;re finalizing payout links here. Until then, use the official{' '}
              <strong>Discord</strong> or <strong>Telegram</strong> buttons in the header (same channels as support and reports) to DM us about balances.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
