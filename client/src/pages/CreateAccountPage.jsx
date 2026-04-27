import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHero } from '../components/layout/PageHero';

export function CreateAccountPage() {
  const [searchParams] = useSearchParams();
  const tier = searchParams.get('tier');
  const [line, setLine] = useState('Choose a method to continue');

  useEffect(() => {
    document.title = 'Create Account — Pornwrld';
    if (tier === '1' || tier === '2') {
      setLine(`Selected: Tier ${tier} — choose a method to continue`);
    }
  }, [tier]);

  return (
    <div className="mx-auto w-full max-w-[960px] px-4 py-6 pb-20">
      <Link to="/" className="pw-btn pw-btn--compact pw-btn--inline">
        ← Back
      </Link>

      <PageHero title="Create account" subtitle={line} />

      <div className="mx-auto mb-[30px] grid max-w-[860px] gap-4 sm:grid-cols-2">
        <a className="group block no-underline" href="/auth/discord" aria-label="Create with Discord">
          <div
            className="h-full rounded-[12px] border border-white/10 border-t-4 border-t-premium bg-bg-card p-5 transition group-hover:border-premium/45"
            role="button"
            tabIndex={0}
          >
            <h2 className="mb-2 text-xl font-bold text-premium">Discord</h2>
            <ul className="space-y-1.5 text-sm text-text-muted">
              <li>Fast verification</li>
              <li>Instant access</li>
              <li>Recommended</li>
            </ul>
          </div>
        </a>

        <a className="group block no-underline" href="/auth/google" aria-label="Create with Google">
          <div
            className="h-full rounded-[12px] border border-white/10 border-t-4 border-t-premium bg-bg-card p-5 transition group-hover:border-premium/45"
            role="button"
            tabIndex={0}
          >
            <h2 className="mb-2 text-xl font-bold text-premium">Google</h2>
            <ul className="space-y-1.5 text-sm text-text-muted">
              <li>One click sign in</li>
              <li>Instant access</li>
              <li>Use your Gmail</li>
            </ul>
          </div>
        </a>
      </div>
    </div>
  );
}
