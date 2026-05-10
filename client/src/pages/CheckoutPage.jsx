import { Check, Crown, Lock, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiGet, money } from '../api';

const fallbackPlans = [
  { key: 'basic', name: 'Basic', tier: 1, priceCents: 999, mediaAccess: 'Free previews plus basic vault access' },
  { key: 'premium', name: 'Premium', tier: 2, priceCents: 2499, mediaAccess: 'Premium videos, photo sets, and request priority' },
  { key: 'ultimate', name: 'Ultimate', tier: 3, priceCents: 3999, mediaAccess: 'Everything plus skip-queue priority when payments go live' },
];

const planIcons = {
  basic: Zap,
  premium: Crown,
  ultimate: Lock,
};

export function CheckoutPage() {
  const [plans, setPlans] = useState(fallbackPlans);

  useEffect(() => {
    document.title = 'Premium - Leak World';
    apiGet('/api/checkout/plans', { plans: fallbackPlans }).then((data) => setPlans(data.plans || fallbackPlans));
  }, []);

  return (
    <div className="space-y-6">
      <section className="lw-page-head">
        <span className="lw-eyebrow">Membership</span>
        <h1>Premium access</h1>
        <p>One subscription, the entire mirrored archive. Pick a tier — billing opens shortly. Existing accounts keep all their saved creators when you upgrade.</p>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        {plans.map((plan) => {
          const Icon = planIcons[plan.key] || Crown;
          const featured = plan.key === 'premium';
          return (
            <article key={plan.key} className={`lw-plan ${featured ? 'featured' : ''}`}>
              <div className="flex items-center justify-between">
                <span className="lw-plan-icon">
                  <Icon size={20} />
                </span>
                <span className="rounded-[6px] border border-white/10 px-2 py-1 text-xs text-white/60">Tier {plan.tier}</span>
              </div>
              <h2>{plan.name}</h2>
              <div className="flex items-end gap-1">
                <b>{money(plan.priceCents)}</b>
                <span>/mo</span>
              </div>
              <p>{plan.mediaAccess}</p>
              <button type="button" className={`lw-btn ${featured ? 'primary' : 'ghost'} w-full justify-center`} disabled>
                Billing opens soon
              </button>
            </article>
          );
        })}
      </section>

      <section className="lw-matrix">
        {[
          ['Free previews', true, true, true],
          ['Full premium archive', false, true, true],
          ['Skip the peak-hour queue', false, false, true],
          ['Priority on creator requests', false, true, true],
          ['Re-uploaded the moment files drop', true, true, true],
        ].map((row) => (
          <div key={row[0]} className="lw-matrix-row">
            <span>{row[0]}</span>
            {row.slice(1).map((value, index) => (
              <b key={`${row[0]}-${index}`} className={value ? 'yes' : 'no'}>
                {value ? <Check size={15} /> : '-'}
              </b>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}
