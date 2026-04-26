import { useEffect, useState } from 'react';
import { fetchRandomVideos, fetchFolderCounts } from '../api/client';
import { HanimeHero } from '../components/home/HanimeHero';
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
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title =
      'Pornyard — Free Omegle Wins, OmeTV, MiniChat, TikTok Leaks & IRL Dick Flashing Videos';
    return () => {
      document.title = 'Pornyard';
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
          topPercent: '5',
        });
        if (cancelled) return;
        if (vRes.ok && vRes.data?.files) {
          const files = Array.isArray(vRes.data.files) ? vRes.data.files : [];
          setItems(files);
          files.slice(0, 20).forEach((f, idx) => {
            sendTelemetry('impression', {
              surface: 'home_popular',
              slot: idx,
              rank: idx + 1,
              videoId: f.videoId || buildVideoId(f.folder, f.subfolder || '', f.name),
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
    <div className="page-content homepage hanime-home">
      <div className="home-hero-fade-stack">
        <HanimeHero />
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
              scrollClassName="hanime-video-rail-scroll"
            >
              {items.map((item, i) => (
                <HomepageMediaTile key={(item.videoKey || item.name) + String(i)} file={item} badgeType="" />
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

      <section className="seo-about" aria-label="About">
        <h2>Pornyard — Amateur Cam &amp; Reaction Archive</h2>
        <p>
          Pornyard is a curated archive of <strong>Omegle reactions</strong>, <strong>public flashing</strong>,{' '}
          <strong>TikTok</strong>, <strong>Snapchat</strong>, and <strong>foot</strong> content. Free previews on every
          category. Refer one friend for <strong>Basic (Tier&nbsp;1)</strong>, or unlock full{' '}
          <strong>Premium (Tier&nbsp;2)</strong> access for $24.99.
        </p>
      </section>
    </div>
  );
}
