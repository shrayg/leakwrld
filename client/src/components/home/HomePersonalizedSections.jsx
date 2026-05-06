import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { fetchNewest, fetchRandomVideos, fetchRecommendations } from '../../api/client';
import { HorizontalScrollRail } from './HorizontalScrollRail';
import { HomepageMediaTile } from './HomepageMediaTile';
import { sendTelemetry } from '../../lib/telemetry';

const RAIL_LIMIT = 18;
/** Pad merged rails when the API returns fewer tiles than this (small catalog / transient partial responses). */
const RAIL_MIN_ACCEPTABLE = 8;

function stableFileKey(f) {
  if (!f) return '';
  if (f.videoKey) return String(f.videoKey);
  if (f.videoId) return String(f.videoId);
  return `${f.folder || ''}/${f.subfolder || ''}/${f.name || ''}`;
}

function mergeUniqueFiles(primary, extra, maxLen) {
  const seen = new Set();
  const out = [];
  for (const f of primary) {
    const k = stableFileKey(f);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(f);
    if (out.length >= maxLen) return out;
  }
  for (const f of extra) {
    if (out.length >= maxLen) break;
    const k = stableFileKey(f);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}

export function HomePersonalizedSections() {
  const [newest, setNewest] = useState([]);
  const [recommended, setRecommended] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let newestOut = [];
      let recommendedOut = [];

      try {
        const [nw, rec] = await Promise.all([
          fetchNewest(RAIL_LIMIT),
          fetchRecommendations(RAIL_LIMIT, { surface: 'home' }),
        ]);
        if (cancelled) return;

        if (nw.ok && Array.isArray(nw.data?.files) && nw.data.files.length) newestOut = nw.data.files;
        if (rec.ok && Array.isArray(rec.data?.files) && rec.data.files.length) recommendedOut = rec.data.files;

        if ((!nw.ok || !newestOut.length) && !cancelled) {
          const fallbackNewest = await fetchRandomVideos({
            limit: String(RAIL_LIMIT),
            page: '0',
            sort: 'top_random',
            topPercent: '15',
          });
          if (
            !cancelled &&
            fallbackNewest.ok &&
            Array.isArray(fallbackNewest.data?.files) &&
            fallbackNewest.data.files.length
          ) {
            newestOut = mergeUniqueFiles(fallbackNewest.data.files, [], RAIL_LIMIT);
          }
        }
        if ((!rec.ok || !recommendedOut.length) && !cancelled) {
          const fallbackRec = await fetchRandomVideos({
            limit: String(RAIL_LIMIT),
            page: '0',
            sort: 'top_random',
            topPercent: '15',
          });
          if (
            !cancelled &&
            fallbackRec.ok &&
            Array.isArray(fallbackRec.data?.files) &&
            fallbackRec.data.files.length
          ) {
            recommendedOut = mergeUniqueFiles(fallbackRec.data.files, [], RAIL_LIMIT);
          }
        }

        if (!cancelled && newestOut.length > 0 && newestOut.length < RAIL_MIN_ACCEPTABLE) {
          const pad = await fetchRandomVideos({
            limit: String(RAIL_LIMIT),
            page: '0',
            sort: 'random',
          });
          if (!cancelled && pad.ok && Array.isArray(pad.data?.files) && pad.data.files.length) {
            newestOut = mergeUniqueFiles(newestOut, pad.data.files, RAIL_LIMIT);
          }
        }
        if (!cancelled && recommendedOut.length > 0 && recommendedOut.length < RAIL_MIN_ACCEPTABLE) {
          const pad = await fetchRandomVideos({
            limit: String(RAIL_LIMIT),
            page: '0',
            sort: 'random',
          });
          if (!cancelled && pad.ok && Array.isArray(pad.data?.files) && pad.data.files.length) {
            recommendedOut = mergeUniqueFiles(recommendedOut, pad.data.files, RAIL_LIMIT);
          }
        }

        if (!cancelled) {
          setNewest(newestOut);
          setRecommended(recommendedOut);
        }

        if (!cancelled && recommendedOut.length) {
          recommendedOut.slice(0, 12).forEach((f, idx) => {
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
      } catch {
        if (cancelled) return;
        const fb = await fetchRandomVideos({ limit: String(RAIL_LIMIT), page: '0', sort: 'random' });
        if (
          !cancelled &&
          fb.ok &&
          Array.isArray(fb.data?.files) &&
          fb.data.files.length
        ) {
          const chunk = mergeUniqueFiles(fb.data.files, [], RAIL_LIMIT);
          setNewest((prev) => (prev.length ? prev : chunk));
          setRecommended((prev) => (prev.length ? prev : chunk));
        }
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
            scrollClassName="pornwrld-video-rail-scroll"
          >
            {newest.map((f, i) => (
              <HomepageMediaTile key={(f.videoKey || f.name) + String(i)} file={f} badgeType="new" listReturnPath={listReturnPath} />
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
            scrollClassName="pornwrld-video-rail-scroll"
          >
            {recommended.map((f, i) => (
              <HomepageMediaTile key={(f.videoKey || f.name) + String(i)} file={f} badgeType="" listReturnPath={listReturnPath} />
            ))}
          </HorizontalScrollRail>
        </section>
      )}
    </>
  );
}
