import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { seoCleanTitle } from '../../lib/seoTitle';
import { formatDuration } from '../../lib/folderMedia';
import { buildVideoId, sendTelemetry } from '../../lib/telemetry';

/** Inline SVG poster when thumb fails or is missing (matches VideoCard fallback) */
const DEFAULT_PREVIEW_THUMB =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">' +
      '<rect fill="#17181a" width="640" height="360"/>' +
      '<rect fill="rgba(255,255,255,0.06)" x="24" y="24" width="592" height="312" rx="4"/>' +
      '<path fill="rgba(243,198,105,0.35)" d="M268 118l184 62-184 62z"/>' +
      '</svg>',
  );

export function resolveThumbUrlForFile(file) {
  if (file.thumb) return file.thumb;
  if (file.thumbnailUrl) return file.thumbnailUrl;
  if (file.folder && file.name) {
    let u =
      '/thumbnail?folder=' +
      encodeURIComponent(file.folder) +
      '&name=' +
      encodeURIComponent(file.name) +
      (file.subfolder ? '&subfolder=' + encodeURIComponent(file.subfolder) : '');
    if (file.vault) u += '&vault=' + encodeURIComponent(file.vault);
    return u;
  }
  return DEFAULT_PREVIEW_THUMB;
}

export function videoHrefFromFile(f) {
  const q = new URLSearchParams();
  q.set('folder', f.folder || '');
  q.set('name', f.name || '');
  if (f.subfolder) q.set('subfolder', f.subfolder);
  if (f.vault) q.set('vault', f.vault);
  return '/video?' + q.toString();
}

export function HomepageMediaTile({ file, badgeType }) {
  const isVideo = String(file?.type || 'video') !== 'image';
  const isGif = /\.gif$/i.test(String(file?.name || ''));
  const mediaKind = isVideo ? 'VID' : isGif ? 'GIF' : 'IMG';
  const title = seoCleanTitle(file.name || '', file.folder || '');
  const primary = resolveThumbUrlForFile(file);
  const [thumbSrc, setThumbSrc] = useState(primary);

  useEffect(() => {
    setThumbSrc(primary);
  }, [primary]);

  const hasDirectVideoIdentity = Boolean(file?.folder && file?.name);
  const rawHref = typeof file?.href === 'string' ? file.href.trim() : '';
  const looksLikeSearchFallback = rawHref === '/search' || rawHref.startsWith('/search?');
  // Prefer stable video routes whenever the file carries enough identity.
  const href = hasDirectVideoIdentity ? videoHrefFromFile(file) : !looksLikeSearchFallback && rawHref ? rawHref : '/search';
  let badgeHtml = null;
  if (badgeType === 'trending') badgeHtml = <span className="badge-trending">Trending</span>;
  else if (badgeType === 'new') badgeHtml = <span className="badge-new">New</span>;

  const showStatsRow =
    !!file.folder ||
    typeof file.views === 'number' ||
    typeof file.likes === 'number' ||
    !!file.duration;

  return (
    <Link
      to={href}
      className="media-item video-item media-item--rail"
      onClick={() => {
        sendTelemetry('click', {
          surface: 'rail_tile',
          videoId:
            file.videoId ||
            buildVideoId(file.folder, file.subfolder || '', file.name, file.vault),
          folder: file.folder,
          subfolder: file.subfolder || '',
          name: file.name,
        });
      }}
    >
      <div className="media-thumb-wrapper">
        {badgeHtml}
        {isVideo && file.duration ? <span className="video-duration">{formatDuration(file.duration)}</span> : null}
        <img
          className="media-thumb"
          width={320}
          height={180}
          src={thumbSrc}
          alt={title}
          loading="lazy"
          decoding="async"
          onError={() => {
            setThumbSrc((s) => (s === DEFAULT_PREVIEW_THUMB ? s : DEFAULT_PREVIEW_THUMB));
          }}
        />
        {isVideo ? <div className="play-icon" /> : null}
      </div>
      <div className="media-info">
        <h3 className="media-title">{title}</h3>
        {showStatsRow ? (
          <div className="media-stats-row">
            {file.folder ? <span className="media-stat-tag media-stat-category">{file.folder}</span> : null}
            <span className="media-stat-tag media-stat-kind">{mediaKind}</span>
            {typeof file.views === 'number' ? (
              <span className="media-stat-tag media-stat-views">{file.views.toLocaleString()} views</span>
            ) : null}
            {typeof file.likes === 'number' ? (
              <span className="media-stat-tag media-stat-like">{file.likes.toLocaleString()} likes</span>
            ) : null}
            {file.duration ? (
              <span className="media-stat-tag media-stat-date">{formatDuration(file.duration)}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </Link>
  );
}
