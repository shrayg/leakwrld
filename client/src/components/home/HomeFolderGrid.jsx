import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { displayFolderCountLabel } from '../../lib/folderCountsDisplay';
import { HorizontalScrollRail } from './HorizontalScrollRail';

export { displayFolderCountLabel };

/** Same rail tile structure as Trending / New releases — matches width, 16:9 thumb, typography. */
const railTileClass = 'media-item video-item media-item--rail';

/** OnlyFans first (hanime-style primary tile), then the rest. Shorts lives in the hero CTA. */
const GRID_ROWS = [
  {
    kind: 'onlyfans',
    thumb: '/thumbnails/onlyfans.jpg',
    title: 'OnlyFans Leaks',
    subtitle: 'Premium only · daily drops',
  },
  { kind: 'folder', countKey: 'NSFW Straight', to: '/nsfw-straight', thumb: '/thumbnails/omegle.jpg', title: 'NSFW Straight' },
  { kind: 'folder', countKey: 'Alt and Goth', to: '/alt-and-goth', thumb: '/thumbnails/tiktok.jpg', title: 'Alt and Goth' },
  { kind: 'folder', countKey: 'MILF', to: '/milf', thumb: '/thumbnails/feet.jpg', title: 'MILF' },
  { kind: 'folder', countKey: 'Asian', to: '/asian', thumb: '/thumbnails/snapchat.jpg', title: 'Asian' },
  { kind: 'folder', countKey: 'Hentai', to: '/hentai', thumb: '/thumbnails/liveslips.png', title: 'Hentai' },
  { kind: 'folder', countKey: 'OF Leaks', to: '/of-leaks', thumb: '/thumbnails/onlyfans.jpg', title: 'OF Leaks' },
];

export function HomeFolderGrid({ counts }) {
  return (
    <section className="homepage-categories-section" aria-labelledby="browse-categories-heading">
      <HorizontalScrollRail
        className="hanime-rail-block--categories"
        title="Browse categories"
        titleId="browse-categories-heading"
        allHref="/categories"
        allLabel="ALL"
        navLabel="Content categories"
        scrollClassName="hanime-video-rail-scroll"
      >
        {GRID_ROWS.map((row) => {
          if (row.kind === 'onlyfans') {
            return (
              <Link key="onlyfans" to="/onlyfans" className={railTileClass + ' folder-card--locked'}>
                <div className="media-thumb-wrapper">
                  <img
                    className="media-thumb"
                    src={row.thumb}
                    alt={row.title}
                    width={320}
                    height={180}
                    loading="lazy"
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                  <div className="play-icon" />
                  <div className="folder-card-lock-overlay folder-card-lock-overlay--rail-thumb" aria-hidden="true">
                    <Lock className="folder-card-lock-icon-svg" size={32} strokeWidth={2.4} />
                    <span className="folder-card-lock-text">Premium only</span>
                  </div>
                </div>
                <div className="media-info">
                  <h3 className="media-title">{row.title}</h3>
                  <div className="media-stats-row">
                    <span className="media-stat-tag media-stat-category">{row.subtitle}</span>
                  </div>
                </div>
              </Link>
            );
          }
          const raw = counts && typeof counts === 'object' ? counts[row.countKey] : undefined;
          const label = displayFolderCountLabel(row.countKey, raw) || 'Browse Collection';
          return (
            <Link key={row.countKey} to={row.to} className={railTileClass} data-folder={row.countKey}>
              <div className="media-thumb-wrapper">
                <img
                  className="media-thumb"
                  src={row.thumb}
                  alt={row.title}
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
      </HorizontalScrollRail>
    </section>
  );
}
