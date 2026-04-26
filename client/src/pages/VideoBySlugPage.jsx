import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { resolveCleanVideo } from '../api/client';
import { PageHero } from '../components/layout/PageHero';
import { NotFoundPage } from './NotFoundPage';

/**
 * Clean URL /:categorySlug/:videoSlug — resolves to /video?folder=&name= via API (same map as server rewrite).
 */
export function VideoBySlugPage() {
  const { categorySlug, videoSlug } = useParams();
  const [target, setTarget] = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!categorySlug || !videoSlug) return;
    let cancelled = false;
    (async () => {
      const { ok, data, status } = await resolveCleanVideo(categorySlug, videoSlug);
      if (cancelled) return;
      if (!ok || status === 404 || !data?.folder || !data?.name) {
        setNotFound(true);
        return;
      }
      const q = new URLSearchParams();
      q.set('folder', data.folder);
      q.set('name', data.name);
      setTarget('/video?' + q.toString());
    })();
    return () => {
      cancelled = true;
    };
  }, [categorySlug, videoSlug]);

  if (notFound) {
    return <NotFoundPage />;
  }
  if (!target) {
    return (
      <main className="page-content video-page page-shell hanime-video-resolve">
        <PageHero title="Loading video" subtitle="Resolving link…" />
      </main>
    );
  }

  return <Navigate to={target} replace />;
}
