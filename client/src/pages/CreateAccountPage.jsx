import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHero } from '../components/layout/PageHero';

export function CreateAccountPage() {
  const [searchParams] = useSearchParams();
  const tier = searchParams.get('tier');
  const [line, setLine] = useState('Choose a method to continue');

  useEffect(() => {
    document.title = 'Create Account — Pornyard';
    if (tier === '1' || tier === '2') {
      setLine(`Selected: Tier ${tier} — choose a method to continue`);
    }
  }, [tier]);

  return (
    <div className="page-content access-page">
      <Link to="/" className="back-btn">
        ← Back
      </Link>

      <PageHero title="Create account" subtitle={line} />

      <div className="tier-chart hanime-tier-pick" style={{ marginBottom: 30 }}>
        <a className="tier-link" href="/auth/discord" aria-label="Create with Discord">
          <div className="tier-card tier-1" role="button" tabIndex={0}>
            <h2>Discord</h2>
            <ul>
              <li>Fast verification</li>
              <li>Instant access</li>
              <li>Recommended</li>
            </ul>
          </div>
        </a>

        <a className="tier-link" href="/auth/google" aria-label="Create with Google">
          <div className="tier-card tier-2" role="button" tabIndex={0}>
            <h2>Google</h2>
            <ul>
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
