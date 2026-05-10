import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="lw-page-head mx-auto max-w-2xl text-center">
      <span className="lw-eyebrow">404</span>
      <h1>Page not found</h1>
      <p>That link does not exist. Head back to the archive and pick up where you left off.</p>
      <Link to="/" className="lw-btn primary mx-auto mt-4 w-fit">
        Back home
      </Link>
    </section>
  );
}
