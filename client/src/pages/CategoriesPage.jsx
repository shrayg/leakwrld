import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHero } from '../components/layout/PageHero';
import { LEAK_WORLD_CREATORS } from '../lib/leakWorldCreators';

export function CategoriesPage() {
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'Creators — Leak World';
    document.body.classList.add('is-categories-page');
    return () => {
      document.body.classList.remove('is-categories-page');
      document.title = 'Leak World';
    };
  }, []);

  return (
    <main className="page-content categories-page">
      <div className="categories-page-back-wrap">
        <button
          type="button"
          className="categories-page-back-btn"
          onClick={() => {
            if (window.history.length > 1) navigate(-1);
            else navigate('/');
          }}
        >
          Back
        </button>
      </div>
      <PageHero
        title="Leak World Creators"
        subtitle="Top 100 creator categories. Video browsing has been removed from this experience."
      />

      <section className="categories-page-section" aria-labelledby="categories-grid-heading">
        <h2 id="categories-grid-heading" className="categories-page-visually-hidden">
          Browse libraries
        </h2>
        <div className="media-grid folder-media-grid categories-page-grid">
          {LEAK_WORLD_CREATORS.map((creator) => (
            <article key={creator.rank} className="media-item video-item categories-page-tile">
              <div className="media-info">
                <h3 className="media-title">
                  {creator.rank}. {creator.name}
                </h3>
                <div className="media-stats-row">
                  <span className="media-stat-tag media-stat-category">{creator.marketRead}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
