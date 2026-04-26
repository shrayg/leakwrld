import { useCallback, useEffect, useRef, useState } from 'react';

let sparkSeq = 0;
function nextSparkId() {
  sparkSeq += 1;
  return sparkSeq;
}

const SPARK_COUNT = 14;
const HOVER_COOLDOWN_MS = 420;

/**
 * Animated gold "free premium" text: sweeping shine + glow; golden sparkle burst on hover (lightweight).
 */
export function GoldPremiumFx({ children, className = '' }) {
  const [sparks, setSparks] = useState([]);
  const lastBurst = useRef(0);
  const clearSparksT = useRef(null);

  useEffect(() => {
    return () => {
      if (clearSparksT.current) clearTimeout(clearSparksT.current);
    };
  }, []);

  const onEnter = useCallback(() => {
    const now = Date.now();
    if (now - lastBurst.current < HOVER_COOLDOWN_MS) return;
    lastBurst.current = now;
    if (clearSparksT.current) {
      clearTimeout(clearSparksT.current);
    }
    const batch = Array.from({ length: SPARK_COUNT }, () => ({
      id: nextSparkId(),
      x: 6 + Math.random() * 88,
      y: 8 + Math.random() * 84,
      dx: (Math.random() - 0.5) * 38,
      dy: (Math.random() - 0.5) * 34 - 10,
      delay: Math.random() * 0.06,
      life: 0.5 + Math.random() * 0.25,
    }));
    setSparks(batch);
    clearSparksT.current = window.setTimeout(() => {
      setSparks([]);
      clearSparksT.current = null;
    }, 850);
  }, []);

  return (
    <span className={`gold-premium-fx ${className}`.trim()} onMouseEnter={onEnter}>
      <span className="gold-premium-fx__text">{children}</span>
      {sparks.map((s) => (
        <span
          key={s.id}
          className="gold-premium-fx__spark"
          aria-hidden="true"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            '--dx': `${s.dx}px`,
            '--dy': `${s.dy}px`,
            '--spark-delay': `${s.delay}s`,
            '--spark-life': `${s.life}s`,
          }}
        />
      ))}
    </span>
  );
}
