import { Check, Crown, Gift, Lock, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiGet, money } from '../api';
import { recordEvent } from '../lib/analytics';
import {
  displayBytes,
  displayCount,
  displayVideoAccessCount,
  formatBytes,
  formatCount,
} from '../lib/metrics';

/** Shown first; not returned by `/api/checkout/plans` (paid tiers only). */
const FREE_PLAN = {
  key: 'free',
  name: 'Free',
  tier: 0,
  priceCents: 0,
  mediaAccess:
    'Browse free previews across creators with SD-quality playback. Upgrade anytime for full vaults and HD streams.',
};

const fallbackPlans = [
  {
    key: 'basic',
    name: 'Basic',
    tier: 1,
    priceCents: 999,
    mediaAccess:
      'Full basic vault with SD-quality streaming. Free previews everywhere — upgrade when you want deeper archives.',
  },
  {
    key: 'premium',
    name: 'Premium',
    tier: 2,
    priceCents: 2499,
    mediaAccess:
      'HD content across premium videos and photo sets, full archive access, plus priority on creator requests.',
  },
  {
    key: 'ultimate',
    name: 'Ultimate',
    tier: 3,
    priceCents: 3999,
    mediaAccess:
      'Everything in Premium in HD, plus skip-the-queue priority during peak hours — maximum access and polish.',
  },
];

const planIcons = {
  free: Gift,
  basic: Zap,
  premium: Crown,
  ultimate: Lock,
};

/** @type {Record<string, string>} */
const planThemeClass = {
  free: 'lw-plan--free',
  basic: 'lw-plan--basic',
  premium: 'lw-plan--premium',
  ultimate: 'lw-plan--ultimate',
};

const CHECKOUT_LIBRARY_KEYS = ['free', 'basic', 'premium', 'ultimate'];

/** External checkout (xyzpurchase plugin) per paid plan key. */
const TIER_PURCHASE_URLS = {
  basic: 'https://xyzpurchase.xyz/checkout?slug=xyzpurchase-plugin-basic-tier&auto=1&qty=1',
  premium: 'https://xyzpurchase.xyz/checkout?slug=xyzpurchase-plugin-premium-tier&auto=1&qty=1',
  ultimate: 'https://xyzpurchase.xyz/checkout?slug=xyzpurchase-plugin-ultimate-tier&auto=1&qty=1',
};

/** Vault tier → which subscription columns include that vault (matches manifest tiers). */
const CHECKOUT_VIDEO_ACCESS_ROWS = [
  { vault: 'free', label: 'Access to free-tier videos', columns: ['free', 'basic', 'premium', 'ultimate'] },
  { vault: 'tier1', label: 'Access to Basic-tier videos', columns: ['basic', 'premium', 'ultimate'] },
  { vault: 'tier2', label: 'Access to Premium-tier videos', columns: ['premium', 'ultimate'] },
  { vault: 'tier3', label: 'Access to Ultimate-tier videos', columns: ['ultimate'] },
];

const MATRIX_ROWS = [
  { label: 'Free previews', free: true, basic: true, premium: true, ultimate: true },
  { label: 'SD content', free: true, basic: true, premium: false, ultimate: false },
  { label: 'HD content', free: false, basic: false, premium: true, ultimate: true },
  { label: 'Full premium archive', free: false, basic: false, premium: true, ultimate: true },
  { label: 'Skip the peak-hour queue', free: false, basic: false, premium: false, ultimate: true },
  { label: 'Priority on creator requests', free: false, basic: false, premium: true, ultimate: true },
  { label: 'Re-uploaded the moment files drop', free: true, basic: true, premium: true, ultimate: true },
];

export function CheckoutPage() {
  const [plans, setPlans] = useState(fallbackPlans);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [pendingCheckoutTier, setPendingCheckoutTier] = useState(/** @type {null | string} */ (null));
  const [libraryMatrix, setLibraryMatrix] = useState(
    /** @type {Record<string, { fileCount: number; bytes: number }> | null} */ (null),
  );

  useEffect(() => {
    document.title = 'Premium - Leak World';
    recordEvent('checkout_view', { category: 'commerce', path: '/checkout', payload: {} });
    apiGet('/api/checkout/plans', { plans: fallbackPlans }).then((data) => {
      setPlans(data.plans || fallbackPlans);
      setLibraryMatrix(data.libraryMatrix && typeof data.libraryMatrix === 'object' ? data.libraryMatrix : null);
    });
  }, []);

  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const v = String(p.get('redeem') || '').trim().toLowerCase();
      if (v === '1' || v === 'true' || v === 'yes') setRedeemOpen(true);
    } catch {
      /* ignore */
    }
  }, []);

  const displayPlans = useMemo(() => {
    const paid = Array.isArray(plans) ? plans.filter((p) => p && p.key !== 'free') : [];
    return [FREE_PLAN, ...paid];
  }, [plans]);

  function openCheckoutPrompt(tierKey) {
    setPendingCheckoutTier(String(tierKey || 'basic'));
    recordEvent('checkout_pre_redirect_open', { category: 'commerce', path: '/checkout', payload: { tier: tierKey } });
  }

  function closeCheckoutPrompt() {
    setPendingCheckoutTier(null);
  }

  return (
    <div className="space-y-6">
      <section className="lw-page-head">
        <span className="lw-eyebrow">Membership</span>
        <h1>Premium access</h1>
        <p>
          One subscription, the entire mirrored archive. Pick a tier to continue to secure checkout — existing accounts keep all
          their saved creators when you upgrade.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="lw-filter lw-filter--upgrade-cta" onClick={() => setRedeemOpen(true)}>
            Redeem your purchase tier
          </button>
          <a className="lw-filter" href="https://t.me/leakwrldcom" target="_blank" rel="noopener noreferrer">
            Reach out to support
          </a>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {displayPlans.map((plan) => {
          const Icon = planIcons[plan.key] || Crown;
          const theme = planThemeClass[plan.key] || '';
          const isFree = plan.key === 'free';
          const isUltimate = plan.key === 'ultimate';
          return (
            <article key={plan.key} className={`lw-plan ${theme}`.trim()}>
              {isUltimate ? <span className="lw-plan-ribbon">Best value</span> : null}
              <div className="lw-plan-head flex items-center justify-between">
                <span className="lw-plan-icon">
                  <Icon size={20} />
                </span>
                <span className="lw-plan-tier-badge">Tier {plan.tier}</span>
              </div>
              <h2>{plan.name}</h2>
              <div className="lw-plan-price-row flex items-end gap-1">
                <b>{money(plan.priceCents)}</b>
                <span>/mo</span>
              </div>
              <p>{plan.mediaAccess}</p>
              {isFree ? (
                <button
                  type="button"
                  className="lw-btn ghost lw-plan-cta lw-plan-cta--free w-full justify-center"
                  disabled
                >
                  Included with your account
                </button>
              ) : (
                <button
                  type="button"
                  className={
                    plan.key === 'ultimate'
                      ? 'lw-btn lw-plan-cta lw-plan-cta--ultimate w-full justify-center'
                      : plan.key === 'premium'
                        ? 'lw-btn lw-plan-cta lw-plan-cta--premium w-full justify-center'
                        : plan.key === 'basic'
                          ? 'lw-btn lw-plan-cta lw-plan-cta--basic w-full justify-center'
                          : 'lw-btn ghost lw-plan-cta w-full justify-center'
                  }
                  onClick={() =>
                    openCheckoutPrompt(plan.key)
                  }
                >
                  Continue to checkout
                </button>
              )}
            </article>
          );
        })}
      </section>

      {pendingCheckoutTier ? (
        <CheckoutRedirectModal
          tierKey={pendingCheckoutTier}
          onClose={closeCheckoutPrompt}
          onRedeem={() => {
            closeCheckoutPrompt();
            setRedeemOpen(true);
          }}
        />
      ) : null}

      {redeemOpen ? <RedeemPurchaseModal onClose={() => setRedeemOpen(false)} /> : null}

      <section className="lw-matrix lw-matrix--checkout" aria-labelledby="lw-checkout-matrix-heading">
        <h2 id="lw-checkout-matrix-heading" className="lw-checkout-matrix-title">
          What each tier includes
        </h2>
        <div className="lw-checkout-matrix-scroll">
          <table className="lw-checkout-matrix-table">
            <thead>
              <tr>
                <th scope="col" className="lw-checkout-matrix-th-feature">
                  Feature
                </th>
                <th scope="col" className="lw-matrix-head lw-matrix-head--free">
                  Free
                </th>
                <th scope="col" className="lw-matrix-head lw-matrix-head--basic">
                  Basic
                </th>
                <th scope="col" className="lw-matrix-head lw-matrix-head--premium">
                  Premium
                </th>
                <th scope="col" className="lw-matrix-head lw-matrix-head--ultimate">
                  Ultimate
                </th>
              </tr>
            </thead>
            <tbody>
              {libraryMatrix ? (
                <>
                  <tr>
                    <th scope="row" className="lw-checkout-matrix-row-label">
                      Files in library
                    </th>
                    {CHECKOUT_LIBRARY_KEYS.map((tierKey) => (
                      <td key={`files-${tierKey}`} className="lw-checkout-matrix-cell lw-checkout-matrix-metric">
                        {formatCount(displayCount(libraryMatrix[tierKey]?.fileCount))}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row" className="lw-checkout-matrix-row-label">
                      Total storage unlocked
                    </th>
                    {CHECKOUT_LIBRARY_KEYS.map((tierKey) => (
                      <td key={`bytes-${tierKey}`} className="lw-checkout-matrix-cell lw-checkout-matrix-metric">
                        {formatBytes(displayBytes(libraryMatrix[tierKey]?.bytes))}
                      </td>
                    ))}
                  </tr>
                  {libraryMatrix.videoCountsByVault &&
                  typeof libraryMatrix.videoCountsByVault === 'object' ? (
                    CHECKOUT_VIDEO_ACCESS_ROWS.map((row) => (
                      <tr key={`videos-${row.vault}`}>
                        <th scope="row" className="lw-checkout-matrix-row-label">
                          {row.label}
                        </th>
                        {CHECKOUT_LIBRARY_KEYS.map((colKey) => (
                          <td
                            key={`videos-${row.vault}-${colKey}`}
                            className="lw-checkout-matrix-cell lw-checkout-matrix-metric"
                          >
                            {row.columns.includes(colKey) ? (
                              formatCount(displayVideoAccessCount(libraryMatrix.videoCountsByVault[row.vault]))
                            ) : (
                              <span className="lw-checkout-matrix-metric-na" aria-label="Not included">
                                —
                              </span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : null}
                </>
              ) : null}
              {MATRIX_ROWS.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="lw-checkout-matrix-row-label">
                    {row.label}
                  </th>
                  {[row.free, row.basic, row.premium, row.ultimate].map((value, index) => (
                    <td key={`${row.label}-${index}`} className="lw-checkout-matrix-cell">
                      <span className={value ? 'yes' : 'no'}>
                        {value ? <Check size={15} aria-label="Included" /> : <span aria-label="Not included">-</span>}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function CheckoutRedirectModal({ tierKey, onClose, onRedeem }) {
  const [secondsLeft, setSecondsLeft] = useState(5);
  const url = TIER_PURCHASE_URLS[tierKey] || TIER_PURCHASE_URLS.basic;

  useEffect(() => {
    setSecondsLeft(5);
    const startedAt = Date.now();
    const t = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const left = Math.max(0, 5 - elapsed);
      setSecondsLeft(left);
    }, 250);
    return () => clearInterval(t);
  }, [tierKey]);

  useEffect(() => {
    if (secondsLeft > 0) return;
    window.location.assign(url);
  }, [secondsLeft, url]);

  return (
    <div className="lw-upgrade-modal-root" role="dialog" aria-modal="true" aria-label="Continue to checkout" onClick={onClose}>
      <button type="button" className="lw-upgrade-modal-backdrop" aria-label="Close" onClick={onClose} />
      <div className="lw-upgrade-modal-panel" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="lw-upgrade-modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="lw-upgrade-modal-icon" aria-hidden>
          <Crown size={22} />
        </div>
        <h2 className="lw-upgrade-modal-title">Remember your email</h2>
        <p className="lw-upgrade-modal-lede">
          Use the same email at checkout so you can redeem your tier instantly after purchase.
        </p>
        <div className="lw-upgrade-modal-actions">
          <button
            type="button"
            className="lw-btn primary w-full justify-center"
            onClick={() => window.location.assign(url)}
            disabled={secondsLeft > 0}
          >
            {secondsLeft > 0 ? `Continue in ${secondsLeft}s` : 'Continue to checkout'}
          </button>
          <button type="button" className="lw-btn ghost w-full justify-center" onClick={onRedeem}>
            Redeem your access
          </button>
        </div>
      </div>
    </div>
  );
}

function RedeemPurchaseModal({ onClose }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState({ loading: false, error: '', ok: false });

  async function onSubmit(e) {
    e.preventDefault();
    if (status.loading) return;
    setStatus({ loading: true, error: '', ok: false });
    try {
      const res = await fetch('/api/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Redeem failed.');
      setStatus({ loading: false, error: '', ok: true });
      window.setTimeout(onClose, 900);
    } catch (err) {
      setStatus({ loading: false, error: String(err?.message || 'Redeem failed.'), ok: false });
    }
  }

  return (
    <div className="lw-upgrade-modal-root" role="dialog" aria-modal="true" aria-label="Redeem your purchase" onClick={onClose}>
      <button type="button" className="lw-upgrade-modal-backdrop" aria-label="Close" onClick={onClose} />
      <div className="lw-upgrade-modal-panel" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="lw-upgrade-modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="lw-upgrade-modal-icon" aria-hidden>
          <Crown size={22} />
        </div>
        <h2 className="lw-upgrade-modal-title">Redeem your purchase tier</h2>
        <p className="lw-upgrade-modal-lede">
          Enter the email you used at checkout to activate your tier. Payments can take about a minute to show up in our system
          after checkout completes.
        </p>
        <form onSubmit={onSubmit} className="mt-3 grid gap-2">
          <input
            className="lw-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
          />
          {status.error ? <div className="text-xs text-red-300">{status.error}</div> : null}
          {status.ok ? <div className="text-xs text-green-300">Redeemed. Your tier is now active.</div> : null}
          <button type="submit" className="lw-btn primary w-full justify-center" disabled={status.loading}>
            {status.loading ? 'Checking…' : 'Redeem access'}
          </button>
          <a className="lw-btn ghost w-full justify-center" href="https://t.me/leakwrldcom" target="_blank" rel="noopener noreferrer">
            Reach out to support
          </a>
        </form>
      </div>
    </div>
  );
}
