import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { fetchRandomVideos, fetchTrending } from '../../api/client';
import { HorizontalScrollRail } from './HorizontalScrollRail';
import { HomepageMediaTile } from './HomepageMediaTile';

const RAIL_LIMIT = 18;
const TRENDING_MIN_TILES = 8;

/** Trending rail — below Browse categories on the home page. */
export function HomeTrendingSection() {
  const location = useLocation();
  const listReturnPath = `${location.pathname}${location.search}`;
  const [trending, setTrending] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tr = await fetchTrending(RAIL_LIMIT);
      if (cancelled) return;
      let list = tr.ok && Array.isArray(tr.data?.files) && tr.data.files.length ? tr.data.files : [];
      if (!list.length && !cancelled) {
        const fb = await fetchRandomVideos({
          limit: String(RAIL_LIMIT),
          page: '0',
          sort: 'random',
        });
        if (!cancelled && fb.ok && Array.isArray(fb.data?.files) && fb.data.files.length) {
          list = fb.data.files;
        }
      }
      if (list.length > 0 && list.length < TRENDING_MIN_TILES && !cancelled) {
        const pad = await fetchRandomVideos({
          limit: String(RAIL_LIMIT),
          page: '0',
          sort: 'random',
        });
        if (!cancelled && pad.ok && Array.isArray(pad.data?.files)) {
          const seen = new Set(
            list.map((f) => f.videoKey || f.videoId || `${f.folder || ''}/${f.subfolder || ''}/${f.name || ''}`),
          );
          for (const f of pad.data.files) {
            if (list.length >= RAIL_LIMIT) break;
            const k = f.videoKey || f.videoId || `${f.folder || ''}/${f.subfolder || ''}/${f.name || ''}`;
            if (!k || seen.has(k)) continue;
            seen.add(k);
            list.push(f);
          }
        }
      }
      setTrending(list);
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
          <HomepageMediaTile key={(f.videoKey || f.name) + String(i)} file={f} badgeType="trending" listReturnPath={listReturnPath} />
        ))}
      </HorizontalScrollRail>
    </section>
  );
}
