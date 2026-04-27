import { useEffect, useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchFolderCounts } from '../api/client';
import { PageHero } from '../components/layout/PageHero';
import { displayFolderCountLabel } from '../lib/folderCountsDisplay';

/** Same folder keys / thumbs as `HomeFolderGrid`, plus Shorts (no folder count API). */
const ROWS = [
  { kind: 'folder', countKey: 'NSFW Straight', to: '/nsfw-straight', thumb: '/thumbnails/omegle.jpg', title: 'NSFW Straight' },
  { kind: 'folder', countKey: 'Alt and Goth', to: '/alt-and-goth', thumb: '/thumbnails/tiktok.jpg', title: 'Alt and Goth' },
  { kind: 'folder', countKey: 'Petitie', to: '/petitie', thumb: '/thumbnails/snapchat.jpg', title: 'Petitie' },
  { kind: 'folder', countKey: 'Teen (18+ only)', to: '/teen-18-plus', thumb: '/thumbnails/liveslips.png', title: 'Teen (18+ only)' },
  { kind: 'folder', countKey: 'MILF', to: '/milf', thumb: '/thumbnails/feet.jpg', title: 'MILF' },
  { kind: 'folder', countKey: 'Asian', to: '/asian', thumb: '/thumbnails/omegle.jpg', title: 'Asian' },
  { kind: 'folder', countKey: 'Ebony', to: '/ebony', thumb: '/thumbnails/tiktok.jpg', title: 'Ebony' },
  { kind: 'folder', countKey: 'Hentai', to: '/hentai', thumb: '/thumbnails/snapchat.jpg', title: 'Hentai' },
  { kind: 'folder', countKey: 'Yuri', to: '/yuri', thumb: '/thumbnails/liveslips.png', title: 'Yuri' },
  { kind: 'folder', countKey: 'Yaoi', to: '/yaoi', thumb: '/thumbnails/feet.jpg', title: 'Yaoi' },
  { kind: 'folder', countKey: 'Nip Slips', to: '/nip-slips', thumb: '/thumbnails/liveslips.png', title: 'Nip Slips' },
  { kind: 'folder', countKey: 'Omegle', to: '/omegle', thumb: '/thumbnails/omegle.jpg', title: 'Omegle' },
  { kind: 'folder', countKey: 'OF Leaks', to: '/of-leaks', thumb: '/thumbnails/onlyfans.jpg', title: 'OF Leaks' },
  { kind: 'folder', countKey: 'Premium Leaks', to: '/premium-leaks', thumb: '/thumbnails/onlyfans.jpg', title: 'Premium Leaks' },
  { kind: 'onlyfans', to: '/onlyfans', thumb: '/thumbnails/onlyfans.jpg', title: 'OnlyFans Leaks', chip: 'By creator' },
  { kind: 'shorts', to: '/shorts', thumb: '/thumbnails/shorts.png', title: 'Shorts', chip: 'Vertical clips' },
];

export function CategoriesPage() {
  const navigate = useNavigate();
  const [counts, setCounts] = useState(null);
  const teaserThumb = useMemo(() => {
    const thumbs = ROWS.map((r) => r.thumb).filter(Boolean);
    if (!thumbs.length) return '/images/face.png';
    return thumbs[Math.floor(Math.random() * thumbs.length)];
  }, []);

  useEffect(() => {
    document.title = 'Categories — Pornwrld';
    document.body.classList.add('is-categories-page');
    let cancelled = false;
    fetchFolderCounts().then((cRes) => {
      if (cancelled || !cRes.ok || !cRes.data?.counts) return;
      setCounts(cRes.data.counts);
    });
    return () => {
      cancelled = true;
      document.body.classList.remove('is-categories-page');
      document.title = 'Pornwrld';
    };
  }, []);

  return (
    <main className="page-content categories-page">
      <div className="categories-page-back-wrap">
        <button
          type="button"
          className="categories-page-back-btn"
          onClick={() => {
            if (window.history.length > 1) navigate(-1);
            else navigate('/');
          }}
        >
          Back
        </button>
      </div>
      <PageHero title="Categories" subtitle="Every library on the site — tap a tile to open the full collection." />

      <section className="categories-page-section" aria-labelledby="categories-grid-heading">
        <h2 id="categories-grid-heading" className="categories-page-visually-hidden">
          Browse libraries
        </h2>
        <div className="media-grid folder-media-grid categories-page-grid">
          {ROWS.map((row) => {
            if (row.kind === 'onlyfans') {
              return (
                <Link key={row.to} to={row.to} className="media-item video-item categories-page-tile folder-card--locked">
                  <div className="media-thumb-wrapper">
                    <img
                      className="media-thumb"
                      src={row.thumb}
                      alt=""
                      width={320}
                      height={180}
                      loading="lazy"
                      onError={(e) => {
                        e.target.style.display = 'none';
                      }}
                    />
                    <div className="play-icon" />
                    <div className="folder-card-lock-overlay" aria-hidden="true">
                      <Lock className="folder-card-lock-icon-svg" size={32} strokeWidth={2.4} />
                      <span className="folder-card-lock-text">Premium only</span>
                    </div>
                  </div>
                  <div className="media-info">
                    <h3 className="media-title">{row.title}</h3>
                    <div className="media-stats-row">
                      <span className="media-stat-tag media-stat-category">{row.chip}</span>
                    </div>
                  </div>
                </Link>
              );
            }
            if (row.kind === 'shorts') {
              return (
                <Link key={row.to} to={row.to} className="media-item video-item categories-page-tile">
                  <div className="media-thumb-wrapper">
                    <img
                      className="media-thumb"
                      src={row.thumb}
                      alt=""
                      width={320}
                      height={180}
                      loading="lazy"
                      onError={(e) => {
                        e.target.style.display = 'none';
                      }}
                    />
                    <div className="play-icon" />
                  </div>
                  <div className="media-info">
                    <h3 className="media-title">{row.title}</h3>
                    <div className="media-stats-row">
                      <span className="media-stat-tag media-stat-category">{row.chip}</span>
                    </div>
                  </div>
                </Link>
              );
            }
            const raw = counts && typeof counts === 'object' ? counts[row.countKey] : undefined;
            const label = displayFolderCountLabel(row.countKey, raw) || 'Browse collection';
            return (
              <Link
                key={row.countKey}
                to={row.to}
                className="media-item video-item categories-page-tile"
                data-folder={row.countKey}
              >
                <div className="media-thumb-wrapper">
                  <img
                    className="media-thumb"
                    src={row.thumb}
                    alt=""
                    width={320}
                    height={180}
                    loading="lazy"
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                  <div className="play-icon" />
                </div>
                <div className="media-info">
                  <h3 className="media-title">{row.title}</h3>
                  <div className="media-stats-row">
                    <span className="media-stat-tag media-stat-category">{label}</span>
                  </div>
                </div>
              </Link>
            );
          })}
          <div className="media-item video-item categories-page-tile categories-page-coming-soon" aria-label="More categories coming soon">
            <div className="media-thumb-wrapper categories-page-coming-soon__thumb-wrap">
              <img className="media-thumb categories-page-coming-soon__thumb" src={teaserThumb} alt="" width={320} height={180} loading="lazy" />
              <div className="categories-page-coming-soon__veil" />
              <div className="categories-page-coming-soon__question" aria-hidden="true">
                ?
              </div>
            </div>
            <div className="media-info">
              <h3 className="media-title">More categories coming soon</h3>
              <div className="media-stats-row">
                <span className="media-stat-tag media-stat-category">Stay tuned</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
