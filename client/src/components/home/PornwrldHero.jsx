import { Link } from 'react-router-dom';
import { LiveActivityStrip } from './LiveActivityStrip';

export function PornwrldHero() {
  return (
    <section className="pornwrld-hero" aria-labelledby="pornwrld-hero-heading">
      <div className="pornwrld-hero__inner">
        <h1 id="pornwrld-hero-heading" className="pornwrld-hero__title">
          Watch Free HD Amateur &amp; Reaction Videos
        </h1>
        <p className="pornwrld-hero__subtitle">
          Omegle, OmeTV, TikTok, Snapchat, IRL &amp; more — curated, searchable, updated regularly on Pornwrld.
        </p>
        <div className="pornwrld-hero__shorts-row">
          <Link to="/shorts" className="pornwrld-shorts-cta">
            <span className="pornwrld-shorts-cta__label">Shorts</span>
            <svg
              className="pornwrld-shorts-cta__arrow"
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
        <div className="pornwrld-hero__live-row">
          <LiveActivityStrip />
        </div>
      </div>
    </section>
  );
}
