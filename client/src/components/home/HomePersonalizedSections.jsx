import { useEffect, useState } from 'react';
import { fetchNewest, fetchRandomVideos, fetchRecommendations } from '../../api/client';
import { HorizontalScrollRail } from './HorizontalScrollRail';
import { HomepageMediaTile } from './HomepageMediaTile';
import { sendTelemetry } from '../../lib/telemetry';

const RAIL_LIMIT = 18;

export function HomePersonalizedSections() {
  const [newest, setNewest] = useState([]);
  const [recommended, setRecommended] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [nw, rec] = await Promise.all([
        fetchNewest(RAIL_LIMIT),
        fetchRecommendations(RAIL_LIMIT, { surface: 'home' }),
      ]);
      if (cancelled) return;
      if (nw.ok && Array.isArray(nw.data?.files) && nw.data.files.length) setNewest(nw.data.files);
      if (rec.ok && Array.isArray(rec.data?.files) && rec.data.files.length) setRecommended(rec.data.files);

      // Keep home rails populated even if recommendations/newest endpoint briefly fails.
      if ((!nw.ok || !Array.isArray(nw.data?.files) || nw.data.files.length === 0) && !cancelled) {
        const fallbackNewest = await fetchRandomVideos({
          limit: String(RAIL_LIMIT),
          page: '0',
          sort: 'top_random',
          topPercent: '12',
        });
        if (
          !cancelled &&
          fallbackNewest.ok &&
          Array.isArray(fallbackNewest.data?.files) &&
          fallbackNewest.data.files.length
        ) {
          setNewest(fallbackNewest.data.files);
        }
      }
      if ((!rec.ok || !Array.isArray(rec.data?.files) || rec.data.files.length === 0) && !cancelled) {
        const fallbackRec = await fetchRandomVideos({
          limit: String(RAIL_LIMIT),
          page: '0',
          sort: 'top_random',
          topPercent: '10',
        });
        if (
          !cancelled &&
          fallbackRec.ok &&
          Array.isArray(fallbackRec.data?.files) &&
          fallbackRec.data.files.length
        ) {
          setRecommended(fallbackRec.data.files);
        }
      }
      if (rec.ok && Array.isArray(rec.data?.files)) {
        rec.data.files.slice(0, 12).forEach((f, idx) => {
          sendTelemetry('impression', {
            surface: 'home_recommended',
            slot: idx,
            rank: idx + 1,
            videoId: f.videoId,
            folder: f.folder,
            subfolder: f.subfolder || '',
            name: f.name,
          });
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {newest.length > 0 && (
        <section className="homepage-section homepage-section--rail" id="newest-section" aria-labelledby="newest-heading">
          <HorizontalScrollRail
            title="New releases"
            titleId="newest-heading"
            allHref="/new-releases"
            allLabel="ALL"
            scrollClassName="hanime-video-rail-scroll"
          >
            {newest.map((f, i) => (
              <HomepageMediaTile key={(f.videoKey || f.name) + String(i)} file={f} badgeType="new" />
            ))}
          </HorizontalScrollRail>
        </section>
      )}
      {recommended.length > 0 && (
        <section className="homepage-section homepage-section--rail" id="recommended-section" aria-labelledby="recommended-heading">
          <HorizontalScrollRail
            title="Recommended for you"
            titleId="recommended-heading"
            allHref="/search"
            allLabel="ALL"
            scrollClassName="hanime-video-rail-scroll"
          >
            {recommended.map((f, i) => (
              <HomepageMediaTile key={(f.videoKey || f.name) + String(i)} file={f} badgeType="" />
            ))}
          </HorizontalScrollRail>
        </section>
      )}
    </>
  );
}
