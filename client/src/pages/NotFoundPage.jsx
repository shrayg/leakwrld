import { Link } from 'react-router-dom';
import { PageHero } from '../components/layout/PageHero';

export function NotFoundPage() {
  return (
    <main className="page-content pornwrld-not-found-page">
      <PageHero title="404" subtitle="That page doesn't exist or the link may be outdated." />
      <div className="pornwrld-not-found-actions">
        <Link to="/" className="pornwrld-not-found-btn">
          Back to home
        </Link>
      </div>
    </main>
  );
}
