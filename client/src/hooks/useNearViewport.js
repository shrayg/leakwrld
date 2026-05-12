import { useEffect, useRef, useState } from 'react';

/**
 * Fires once when the element intersects the viewport (plus rootMargin).
 * When `disabled` is true, returns visible=true immediately (no observer).
 */
export function useNearViewport(options = {}) {
  const { disabled = false, rootMargin = '180px', threshold = 0.01 } = options;
  const ref = useRef(null);
  const [visible, setVisible] = useState(disabled);

  useEffect(() => {
    if (disabled) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin, threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [disabled, rootMargin, threshold]);

  return [ref, visible];
}
