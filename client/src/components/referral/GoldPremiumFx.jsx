import { useCallback, useRef, useState } from 'react';

/**
 * Gold-shimmer inline text — used to highlight "free premium", "real cash",
 * and other money-coded phrases.
 *
 * Visual layers:
 *   1. Animated gold gradient on the text itself (continuous shimmer).
 *   2. Sparkle burst on hover / focus / touch: ~10 particles emit radially
 *      from the phrase's center and fade out. JS only fires when the user
 *      actually interacts — the CSS does all of the motion work via custom
 *      properties (--dx / --dy / --size / --delay / --duration).
 *   3. Soft drop-shadow glow during the burst so the text itself feels
 *      "charged up" rather than just shedding particles.
 *
 * Honours `prefers-reduced-motion`: the burst layer never mounts when the
 * user has motion reduced (gated in CSS via `display: none`).
 */

const SPARKLE_COUNT = 10;
/** ms — must be ≥ the longest possible spark duration + delay. Keeps a
 *  rapid hover-in/hover-out from queueing multiple overlapping bursts that
 *  would look chaotic and waste paints. */
const BURST_COOLDOWN_MS = 760;

/** Generate a fresh set of sparkle vectors for one burst. Distributed
 *  roughly evenly around the circle (i / N step) with a small jitter so
 *  bursts never look like a perfect compass rose. */
function makeSparkles() {
  return Array.from({ length: SPARKLE_COUNT }, (_, i) => {
    const baseAngle = (Math.PI * 2 * i) / SPARKLE_COUNT;
    const jitter = (Math.random() - 0.5) * 0.5;
    const angle = baseAngle + jitter;
    const distance = 28 + Math.random() * 26; // px
    return {
      id: i,
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance,
      size: 4 + Math.random() * 4,
      delay: Math.random() * 80,
      duration: 520 + Math.random() * 240,
    };
  });
}

export function GoldPremiumFx({ children, className = '' }) {
  /** burstKey is bumped on every fire so React remounts the burst layer —
   *  which is how we restart the CSS animation cleanly without writing any
   *  imperative animation code. */
  const [burstKey, setBurstKey] = useState(0);
  const [sparkles, setSparkles] = useState(() => makeSparkles());
  const armedRef = useRef(true);

  const fire = useCallback(() => {
    if (!armedRef.current) return;
    armedRef.current = false;
    setSparkles(makeSparkles());
    setBurstKey((k) => k + 1);
    setTimeout(() => {
      armedRef.current = true;
    }, BURST_COOLDOWN_MS);
  }, []);

  return (
    <span
      className={`lw-ref-gold ${className}`.trim()}
      onMouseEnter={fire}
      onTouchStart={fire}
    >
      {children}
      <span className="lw-ref-gold-burst" key={burstKey} aria-hidden="true">
        {sparkles.map((s) => (
          <span
            key={s.id}
            className="lw-ref-gold-spark"
            style={{
              '--dx': `${s.dx.toFixed(2)}px`,
              '--dy': `${s.dy.toFixed(2)}px`,
              '--size': `${s.size.toFixed(2)}px`,
              '--delay': `${s.delay.toFixed(0)}ms`,
              '--duration': `${s.duration.toFixed(0)}ms`,
            }}
          />
        ))}
      </span>
    </span>
  );
}
