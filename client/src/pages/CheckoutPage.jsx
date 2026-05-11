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

  const displayPlans = useMemo(() => {
    const paid = Array.isArray(plans) ? plans.filter((p) => p && p.key !== 'free') : [];
    return [FREE_PLAN, ...paid];
  }, [plans]);

  return (
    <div className="space-y-6">
      <section className="lw-page-head">
        <span className="lw-eyebrow">Membership</span>
        <h1>Premium access</h1>
        <p>One subscription, the entire mirrored archive. Pick a tier — billing opens shortly. Existing accounts keep all their saved creators when you upgrade.</p>
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
                <a
                  href={TIER_PURCHASE_URLS[plan.key] || TIER_PURCHASE_URLS.basic}
                  className={
                    plan.key === 'ultimate'
                      ? 'lw-btn lw-plan-cta lw-plan-cta--ultimate w-full justify-center'
                      : plan.key === 'premium'
                        ? 'lw-btn lw-plan-cta lw-plan-cta--premium w-full justify-center'
                        : plan.key === 'basic'
                          ? 'lw-btn lw-plan-cta lw-plan-cta--basic w-full justify-center'
                          : 'lw-btn ghost lw-plan-cta w-full justify-center'
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() =>
                    recordEvent('checkout_tier_cta', {
                      category: 'commerce',
                      path: '/checkout',
                      payload: { tier: plan.key },
                    })
                  }
                >
                  Continue to checkout
                </a>
              )}
            </article>
          );
        })}
      </section>

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
