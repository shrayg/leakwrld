import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { fetchNewest } from '../api/client';
import { HomepageMediaTile } from '../components/home/HomepageMediaTile';
import { PageHero } from '../components/layout/PageHero';
import { videoCardStableKey } from '../components/media/VideoCard';

const PAGE_SIZE = 32;

export function NewReleasesPage() {
  const location = useLocation();
  const listReturnPath = `${location.pathname}${location.search}`;
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'New releases — Pornwrld';
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      const res = await fetchNewest(PAGE_SIZE);
      if (cancelled) return;
      if (!res.ok) {
        setFiles([]);
        setError('Could not load new releases.');
        setLoading(false);
        return;
      }
      setFiles(Array.isArray(res.data?.files) ? res.data.files : []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="page-content search-page">
      <div className="search-page-header">
        <PageHero title="New releases" subtitle="Latest videos added to the site." />
        {!loading && files.length > 0 && (
          <div className="search-page-info">{files.length} videos found</div>
        )}
      </div>

      {loading && <div className="videos-loading-msg">Loading new releases…</div>}
      {!loading && error && (
        <div className="search-empty-state">
          <div className="search-empty-title">Could not load new releases</div>
          <div className="search-empty-sub">{error}</div>
        </div>
      )}

      {!loading && !error && files.length === 0 && (
        <div className="search-empty-state">
          <div className="search-empty-title">No new releases yet</div>
          <div className="search-empty-sub">Check back soon.</div>
        </div>
      )}

      {!loading && !error && files.length > 0 && (
        <div className="media-grid" id="new-releases-grid">
          {files.map((item, i) => (
            <HomepageMediaTile key={videoCardStableKey(item, i)} file={item} badgeType="new" listReturnPath={listReturnPath} />
          ))}
        </div>
      )}
    </main>
  );
}

