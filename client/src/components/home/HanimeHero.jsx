import { Link } from 'react-router-dom';
import { LiveActivityStrip } from './LiveActivityStrip';

export function HanimeHero() {
  return (
    <section className="hanime-hero" aria-labelledby="hanime-hero-heading">
      <div className="hanime-hero__inner">
        <h1 id="hanime-hero-heading" className="hanime-hero__title">
          Watch Free HD Amateur &amp; Reaction Videos
        </h1>
        <p className="hanime-hero__subtitle">
          Omegle, OmeTV, TikTok, Snapchat, IRL &amp; more — curated, searchable, updated regularly on Pornyard.
        </p>
        <div className="hanime-hero__shorts-row">
          <Link to="/shorts" className="hanime-shorts-cta">
            <span className="hanime-shorts-cta__label">Shorts</span>
            <svg
              className="hanime-shorts-cta__arrow"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M10 7l5 5-5 5"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        </div>
        <div className="hanime-hero__live-row">
          <LiveActivityStrip />
        </div>
      </div>
    </section>
  );
}
