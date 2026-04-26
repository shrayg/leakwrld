import { useLayoutEffect, useRef, useState } from 'react';

const GAP_PX = 6;
/** Reserve width for “More ▾” when some links move into the overflow menu */
const MORE_BTN_RESERVE_PX = 92;

/**
 * How many nav items fit from the left before the rest go under “More” (legacy `updateNavOverflow`).
 * @param {number[]} widths — measured outer widths in tab order
 * @param {number} containerWidth — available width for the link row + optional More button
 */
export function computeNavOverflowSplit(widths, containerWidth) {
  const n = widths.length;
  if (n === 0 || containerWidth <= 0) return n;

  let sumAll = 0;
  for (let i = 0; i < n; i++) sumAll += widths[i] + (i > 0 ? GAP_PX : 0);
  if (sumAll <= containerWidth) return n;

  for (let K = n - 1; K >= 1; K--) {
    let sum = 0;
    for (let i = 0; i < K; i++) sum += widths[i] + (i > 0 ? GAP_PX : 0);
    const withMore = sum + GAP_PX + MORE_BTN_RESERVE_PX;
    if (withMore <= containerWidth) return K;
  }
  return 1;
}

/**
 * Measures all `[data-nav-measure]` nodes inside `measureRef` and updates split when `containerRef` resizes.
 */
export function useNavOverflowSplit({ pathname, itemCount }) {
  const [split, setSplit] = useState(itemCount);
  const measureRef = useRef(null);
  const containerRef = useRef(null);

  useLayoutEffect(() => {
    const measure = measureRef.current;
    const container = containerRef.current;
    if (!measure || !container) return;

    function measureWidths() {
      const nodes = measure.querySelectorAll('[data-nav-measure]');
      return Array.from(nodes).map((el) => el.getBoundingClientRect().width);
    }

    function update() {
      const cw = container.clientWidth;
      const widths = measureWidths();
      if (widths.length !== itemCount) return;
      /* Container not laid out yet or absurdly narrow: show Home + More only.
         Using full itemCount here squeezed every link into the bar and caused overlap (Home/Search etc.). */
      if (cw < 72) {
        setSplit(1);
        return;
      }
      setSplit(computeNavOverflowSplit(widths, cw));
    }

    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(container);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [pathname, itemCount]);

  return { split, measureRef, containerRef };
}
