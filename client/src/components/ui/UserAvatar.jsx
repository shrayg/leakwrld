import { useState } from 'react';

/** Deterministic hue from username (Google-style stable “random” color per user). */
export function avatarHueFromUsername(seed) {
  let hash = 0;
  const s = String(seed || 'user');
  for (let i = 0; i < s.length; i += 1) {
    hash = s.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

/** First letter of username (ignores discord: prefix), like default Google avatars. */
export function avatarLetter(username) {
  const cleaned = String(username || 'User').replace(/^discord:/i, '').trim();
  const m = cleaned.match(/[a-zA-Z0-9]/u);
  return m ? m[0].toUpperCase() : 'U';
}

/**
 * @param {object} props
 * @param {string} props.username - Used for color + letter when no photo.
 * @param {string} [props.src] - Optional image URL.
 * @param {number} [props.size] - Pixel width/height (default 40).
 * @param {string} [props.className]
 * @param {string} [props.alt]
 * @param {string} [props.id]
 */
export function UserAvatar({ username, src, size = 40, className = '', alt, id }) {
  const [imgFailed, setImgFailed] = useState(false);
  const url = String(src || '').trim();
  const showImg = Boolean(url) && !imgFailed;
  const hue = avatarHueFromUsername(username);
  const letter = avatarLetter(username);
  const baseClass = [className, 'user-avatar', showImg ? 'user-avatar--image' : 'user-avatar--letter'].filter(Boolean).join(' ');

  if (showImg) {
    return (
      <img
        id={id}
        src={url}
        alt={alt || ''}
        width={size}
        height={size}
        className={baseClass}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          boxSizing: 'border-box',
        }}
        onError={() => setImgFailed(true)}
        loading="lazy"
        decoding="async"
      />
    );
  }

  const bg = `hsl(${hue}, 56%, 48%)`;
  return (
    <span
      id={id}
      role="img"
      aria-label={alt || `Avatar ${letter}`}
      className={baseClass}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: bg,
        color: '#fff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 600,
        fontSize: Math.max(12, Math.round(size * 0.38)),
        lineHeight: 1,
        flexShrink: 0,
        userSelect: 'none',
        boxSizing: 'border-box',
      }}
    >
      {letter}
    </span>
  );
}
