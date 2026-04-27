import { useEffect, useState } from 'react';
import { fetchTrending } from '../../api/client';
import { HorizontalScrollRail } from './HorizontalScrollRail';
import { HomepageMediaTile } from './HomepageMediaTile';

const RAIL_LIMIT = 18;

/** Trending rail — below Browse categories on the home page. */
export function HomeTrendingSection() {
  const [trending, setTrending] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tr = await fetchTrending(RAIL_LIMIT);
      if (cancelled) return;
      if (tr.ok && Array.isArray(tr.data?.files) && tr.data.files.length) setTrending(tr.data.files);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (trending.length === 0) return null;

  return (
    <section className="homepage-section homepage-section--rail" id="trending-section" aria-labelledby="trending-heading">
      <HorizontalScrollRail
        title="Trending now"
        titleId="trending-heading"
        allHref="/search"
        allLabel="ALL"
        scrollClassName="pornwrld-video-rail-scroll"
      >
        {trending.map((f, i) => (
          <HomepageMediaTile key={(f.videoKey || f.name) + String(i)} file={f} badgeType="trending" />
        ))}
      </HorizontalScrollRail>
    </section>
  );
}
