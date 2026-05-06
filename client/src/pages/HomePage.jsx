import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { fetchRandomVideos, fetchFolderCounts } from '../api/client';
import { PornwrldHero } from '../components/home/PornwrldHero';
import { HeroReferralGoal } from '../components/home/HeroReferralGoal';
import { HomeFolderGrid } from '../components/home/HomeFolderGrid';
import { HorizontalScrollRail } from '../components/home/HorizontalScrollRail';
import { HomepageMediaTile } from '../components/home/HomepageMediaTile';
import { HomePersonalizedSections } from '../components/home/HomePersonalizedSections';
import { HomeReferralTeaser, HOME_TOP_REFERRERS_ID } from '../components/home/HomeReferralTeaser';
import { HomeTrendingSection } from '../components/home/HomeTrendingSection';
import { LeaderboardDock } from '../components/shell/LeaderboardDock';
import { useAuth } from '../hooks/useAuth';
import { buildVideoId, sendTelemetry } from '../lib/telemetry';

const PAGE_SIZE = 24;

function HomeReferralLeaderRow() {
  const { isAuthed, loading } = useAuth();
  if (loading) {
    return <div id={HOME_TOP_REFERRERS_ID} className="home-referral-lb-row home-referral-lb-row--loading" aria-hidden="true" />;
  }
  return (
    <div id={HOME_TOP_REFERRERS_ID} className="home-referral-lb-row">
      <div className="home-referral-lb-col home-referral-lb-col--leaderboard">
        <LeaderboardDock inline />
      </div>
      <div className="home-referral-lb-col home-referral-lb-col--referral">
        <HeroReferralGoal />
      </div>
    </div>
  );
}

export function HomePage() {
  const location = useLocation();
  const listReturnPath = `${location.pathname}${location.search}`;
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Pornwrld';
    return () => {
      document.title = 'Pornwrld';
    };
  }, []);

  useEffect(() => {
    const startedAt = Date.now();
    return () => {
      sendTelemetry('page_session', {
        page: '/',
        surface: 'home',
        duration: Date.now() - startedAt,
      });
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchFolderCounts().then((cRes) => {
      if (cancelled || !cRes.ok || !cRes.data?.counts) return;
      setCounts(cRes.data.counts);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const vRes = await fetchRandomVideos({
          limit: String(PAGE_SIZE),
          page: '0',
          sort: 'top_random',
          topPercent: '15',
        });
        if (cancelled) return;
        if (vRes.ok && vRes.data?.files) {
          let files = Array.isArray(vRes.data.files) ? vRes.data.files : [];
          if (files.length > 0 && files.length < 12 && !cancelled) {
            const pad = await fetchRandomVideos({
              limit: String(PAGE_SIZE),
              page: '0',
              sort: 'random',
            });
            if (!cancelled && pad.ok && Array.isArray(pad.data?.files)) {
              const seen = new Set(
                files.map((f) => f.videoKey || f.videoId || `${f.folder || ''}/${f.subfolder || ''}/${f.name || ''}`),
              );
              for (const f of pad.data.files) {
                if (files.length >= PAGE_SIZE) break;
                const k = f.videoKey || f.videoId || `${f.folder || ''}/${f.subfolder || ''}/${f.name || ''}`;
                if (!k || seen.has(k)) continue;
                seen.add(k);
                files.push(f);
              }
            }
          }
          setItems(files);
          files.slice(0, 20).forEach((f, idx) => {
            sendTelemetry('impression', {
              surface: 'home_popular',
              slot: idx,
              rank: idx + 1,
              videoId: f.videoId || buildVideoId(f.folder, f.subfolder || '', f.name, f.vault),
              folder: f.folder,
              subfolder: f.subfolder || '',
              name: f.name,
            });
          });
        } else if (vRes.ok && Array.isArray(vRes.data)) {
          setItems(vRes.data);
        } else {
          setErr('Could not load videos');
          setItems([]);
        }
      } catch (e) {
        if (!cancelled) {
          setErr(String(e));
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page-content homepage pornwrld-home">
      <div className="home-hero-fade-stack">
        <PornwrldHero />
        <HomeReferralTeaser />
      </div>
      <HomeFolderGrid counts={counts} />
      <HomeTrendingSection />
      <HomeReferralLeaderRow />

      <HomePersonalizedSections />

      <section className="homepage-videos-section" aria-labelledby="discover-videos-heading">
        {loading && <p className="page-loading">Loading…</p>}
        {err && <p className="page-error">{err}</p>}

        {!loading && !err && (
          <>
            <HorizontalScrollRail
              title="Popular videos"
              titleId="discover-videos-heading"
              allHref="/search?mode=popular"
              allLabel="ALL"
              scrollClassName="pornwrld-video-rail-scroll"
            >
              {items.map((item, i) => (
                <HomepageMediaTile key={(item.videoKey || item.name) + String(i)} file={item} badgeType="" listReturnPath={listReturnPath} />
              ))}
            </HorizontalScrollRail>
            {items.length === 0 ? (
              <p className="homepage-empty-state">
                No preview videos loaded yet. If you run the site locally, ensure storage (R2) is enabled and the library
                is indexed — otherwise the popular list stays empty.
              </p>
            ) : null}
          </>
        )}
      </section>

    </div>
  );
}
