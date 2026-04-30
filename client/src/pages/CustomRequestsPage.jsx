import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchMe } from '../api/client';
import { PageHero } from '../components/layout/PageHero';
import { OFFICIAL_DISCORD_INVITE_URL, OFFICIAL_TELEGRAM_URL } from '../constants/officialContact';

export function CustomRequestsPage() {
  const [tierOk, setTierOk] = useState(null);

  useEffect(() => {
    document.body.classList.add('is-custom-requests-page');
    return () => document.body.classList.remove('is-custom-requests-page');
  }, []);

  useEffect(() => {
    document.title = 'Pornwrld — Custom Requests';
    let cancelled = false;
    (async () => {
      const r = await fetchMe();
      if (cancelled) return;
      if (r.ok && r.data?.authed && r.data.tier >= 1) setTierOk(true);
      else setTierOk(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="page-content custom-requests-page">
      <PageHero title="Custom requests" subtitle="Premium members can request specific content tailored to their preferences." />

      <div className="cr-card pornwrld-cr-card">
        <div className="cr-card-icon" aria-hidden="true">
          🎬
        </div>
        <h2 className="cr-card-heading">How it works</h2>

        <div className="cr-steps">
          <div className="cr-step">
            <div className="cr-step-number">1</div>
            <div className="cr-step-content">
              <h3>Get Premium</h3>
              <p>Custom requests are available to Tier 1 and Tier 2 members.</p>
            </div>
          </div>

          <div className="cr-step">
            <div className="cr-step-number">2</div>
            <div className="cr-step-content">
              <h3>Submit your request</h3>
              <p>Fill out the form, choose Standard (free) or Priority ($20), and we&apos;ll get back to you.</p>
            </div>
          </div>

          <div className="cr-step">
            <div className="cr-step-number">3</div>
            <div className="cr-step-content">
              <h3>Get your content</h3>
              <p>Standard: up to 5 hours. Priority: up to 1 hour.</p>
            </div>
          </div>
        </div>

        {tierOk === null && (
          <p className="page-loading" style={{ textAlign: 'center' }}>
            Checking access…
          </p>
        )}

        {tierOk === true && (
          <a href={OFFICIAL_TELEGRAM_URL} target="_blank" rel="noopener noreferrer" className="cr-upgrade-btn pornwrld-cr-btn" id="cr-upgrade-btn">
            Submit your request
          </a>
        )}

        {tierOk === false && (
          <Link to="/checkout" className="cr-upgrade-btn pornwrld-cr-btn" id="cr-upgrade-btn">
            Upgrade to unlock requests
          </Link>
        )}
      </div>

      <p className="pornwrld-cr-footnote">
        Or reach us on{' '}
        <a href={OFFICIAL_DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">
          Discord
        </a>{' '}
        or{' '}
        <a href={OFFICIAL_TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
          Telegram
        </a>
        — our only official contact channels.
      </p>
    </main>
  );
}
