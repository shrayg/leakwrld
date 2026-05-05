import { useEffect, useState } from 'react';

function columnsForViewport(width) {
  if (width <= 600) return 2;
  if (width <= 960) return 3;
  return 4;
}

/**
 * Derive page size from responsive grid columns so each page fills a target row count.
 */
export function useResponsiveGridPageSize(targetRows = 6) {
  const initialWidth =
    typeof window !== 'undefined' && Number.isFinite(window.innerWidth)
      ? window.innerWidth
      : 1280;
  const [columns, setColumns] = useState(columnsForViewport(initialWidth));

  useEffect(() => {
    function onResize() {
      setColumns(columnsForViewport(window.innerWidth || 1280));
    }
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const rows = Math.max(1, Number(targetRows) || 6);
  return Math.max(1, columns * rows);
}
