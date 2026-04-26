import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

/** Inline SVG poster — always loads (no /images 404 in dev); used when thumb URL fails */
const DEFAULT_PREVIEW_THUMB =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">' +
      '<rect fill="#17181a" width="640" height="360"/>' +
      '<rect fill="rgba(255,255,255,0.06)" x="24" y="24" width="592" height="312" rx="4"/>' +
      '<path fill="rgba(243,198,105,0.35)" d="M268 118l184 62-184 62z"/>' +
      '</svg>',
  );

function thumbUrl(item) {
  if (item.thumb) return item.thumb;
  if (item.thumbnailUrl) return item.thumbnailUrl;
  if (item.folder && item.name) {
    const q =
      '/thumbnail?folder=' +
      encodeURIComponent(item.folder) +
      '&name=' +
      encodeURIComponent(item.name) +
      (item.subfolder ? '&subfolder=' + encodeURIComponent(item.subfolder) : '');
    return q;
  }
  return DEFAULT_PREVIEW_THUMB;
}

function videoHref(item) {
  if (item.href) return item.href;
  const f = encodeURIComponent(item.folder || '');
  const n = encodeURIComponent(item.name || '');
  const s = item.subfolder ? '&subfolder=' + encodeURIComponent(item.subfolder) : '';
  return '/video?folder=' + f + '&name=' + n + s;
}

/** Stable list key for API file rows (avoids duplicate / missing `name`) */
export function videoCardStableKey(item, index) {
  if (item.videoKey) return String(item.videoKey);
  if (item.key) return String(item.key);
  const parts = [item.folder, item.subfolder, item.name].filter(Boolean);
  if (parts.length) return parts.join('/');
  return `video-${index}`;
}

export function VideoCard({ item }) {
  const title = item.title || item.name || 'Video';
  const href = videoHref(item);
  const primary = thumbUrl(item);
  const [thumbSrc, setThumbSrc] = useState(primary);

  useEffect(() => {
    setThumbSrc(primary);
  }, [primary]);

  return (
    <article className="video-card">
      <Link to={href} className="video-card-link">
        <div className="video-card-thumb-wrap">
          <img
            src={thumbSrc}
            alt=""
            className="video-card-thumb"
            loading="lazy"
            decoding="async"
            onError={() => {
              setThumbSrc((s) => (s === DEFAULT_PREVIEW_THUMB ? s : DEFAULT_PREVIEW_THUMB));
            }}
          />
        </div>
        <div className="video-card-meta">
          <span className="video-card-title">{title}</span>
          {item.folder && <span className="video-card-folder">{item.folder}</span>}
        </div>
      </Link>
    </article>
  );
}
