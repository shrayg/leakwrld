/** Deterministic “Google-style” circle + initial from username (HSL from string hash). */
export function UserAvatar({ username, size = 28, className = '' }) {
  const seed = String(username || '').trim() || '?';
  const letter = seed.charAt(0).toUpperCase();

  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  const h = Math.abs(hash) % 360;
  const bg = `hsl(${h} 58% 46%)`;

  const px = Number(size) || 28;
  const fs = Math.max(11, Math.round(px * 0.42));

  return (
    <span
      className={`lw-user-avatar ${className}`.trim()}
      style={{
        width: px,
        height: px,
        fontSize: fs,
        backgroundColor: bg,
      }}
      aria-hidden
    >
      {letter}
    </span>
  );
}
