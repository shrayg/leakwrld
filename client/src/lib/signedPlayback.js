import { getSiteConfig } from './siteConfig';

/**
 * @param {string} storageKey R2 object key
 * @param {{ format?: 'mp4' | 'hls' }} opts
 * @returns {Promise<string|null>}
 */
export async function fetchSignedMediaUrl(storageKey, opts = {}) {
  const cfg = await getSiteConfig();
  if (!cfg.mediaSigningEnabled || !storageKey) return null;
  const q = new URLSearchParams({ key: encodeURIComponent(storageKey) });
  if (opts.format === 'hls') q.set('format', 'hls');
  const r = await fetch(`/api/media/sign?${q}`, { credentials: 'include' });
  if (!r.ok) return null;
  const j = await r.json().catch(() => ({}));
  return typeof j.url === 'string' ? j.url : null;
}

/**
 * @param {HTMLVideoElement} videoEl
 * @param {string} src Signed absolute URL (HLS master or MP4)
 * @returns {Promise<() => void>} cleanup
 */
export async function attachAdaptiveVideo(videoEl, src) {
  if (!videoEl || !src) return () => {};

  if (src.includes('.m3u8')) {
    if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      videoEl.src = src;
      return () => {
        videoEl.removeAttribute('src');
        videoEl.load();
      };
    }
    const { default: Hls } = await import('hls.js');
    if (Hls.isSupported()) {
      const hls = new Hls({
        maxBufferLength: 45,
        maxMaxBufferLength: 120,
      });
      hls.loadSource(src);
      hls.attachMedia(videoEl);
      return () => {
        hls.destroy();
        videoEl.removeAttribute('src');
        videoEl.load();
      };
    }
  }

  videoEl.src = src;
  return () => {
    videoEl.removeAttribute('src');
    videoEl.load();
  };
}
