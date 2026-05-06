import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { displayFolderCountLabel } from '../../lib/folderCountsDisplay';
import { HorizontalScrollRail } from './HorizontalScrollRail';

export { displayFolderCountLabel };

/** Same rail tile structure as Trending / New releases — matches width, 16:9 thumb, typography. */
const railTileClass = 'media-item video-item media-item--rail';

/** OnlyFans first (pornwrld-style primary tile), then the rest. Shorts lives in the hero CTA. */
const GRID_ROWS = [
  {
    kind: 'onlyfans',
    thumb: '/assets/thumbnails/onlyfans.png',
    title: 'OnlyFans Leaks',
    subtitle: 'Premium only · daily drops',
  },
  { kind: 'folder', countKey: 'NSFW Straight', to: '/nsfw-straight', thumb: '/assets/thumbnails/nsfw-straight.png', title: 'NSFW Straight' },
  { kind: 'folder', countKey: 'Alt and Goth', to: '/alt-and-goth', thumb: '/assets/thumbnails/alt-and-goth.png', title: 'Alt and Goth' },
  { kind: 'folder', countKey: 'Petite', to: '/petite', thumb: '/assets/thumbnails/petite.png', title: 'Petite' },
  { kind: 'folder', countKey: 'Teen (18+ only)', to: '/teen-18-plus', thumb: '/assets/thumbnails/teen-18-plus.png', title: 'Teen (18+ only)' },
  { kind: 'folder', countKey: 'MILF', to: '/milf', thumb: '/assets/thumbnails/milf.png', title: 'MILF' },
  { kind: 'folder', countKey: 'Asian', to: '/asian', thumb: '/assets/thumbnails/asian.png', title: 'Asian' },
  { kind: 'folder', countKey: 'Ebony', to: '/ebony', thumb: '/assets/thumbnails/ebony.png', title: 'Ebony' },
  { kind: 'folder', countKey: 'Feet', to: '/feet', thumb: '/assets/thumbnails/feet.png', title: 'Feet' },
  { kind: 'folder', countKey: 'Hentai', to: '/hentai', thumb: '/assets/thumbnails/hentai.png', title: 'Hentai/Cosplay' },
  { kind: 'folder', countKey: 'Yuri', to: '/yuri', thumb: '/assets/thumbnails/yuri.png', title: 'Lesbian' },
  { kind: 'folder', countKey: 'Yaoi', to: '/yaoi', thumb: '/assets/thumbnails/yaoi.png', title: 'Yaoi' },
  { kind: 'folder', countKey: 'Nip Slips', to: '/nip-slips', thumb: '/assets/thumbnails/nip-slips.png', title: 'Nip Slips' },
  { kind: 'folder', countKey: 'Omegle', to: '/omegle', thumb: '/assets/thumbnails/omegle.png', title: 'Omegle' },
];

export function HomeFolderGrid({ counts }) {
  return (
    <section className="homepage-categories-section" aria-labelledby="browse-categories-heading">
      <HorizontalScrollRail
        className="pornwrld-rail-block--categories"
        title="Browse categories"
        titleId="browse-categories-heading"
        allHref="/categories"
        allLabel="ALL"
        navLabel="Content categories"
        scrollClassName="pornwrld-video-rail-scroll"
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
