import { useEffect, useState } from 'react';

/** In sync with `.lw-creator-grid` / `.lw-media-grid` in app.css */
export const CATALOG_GRID_ROWS_PER_PAGE = 6;

/** Homepage "Top creators" only — fewer rows so the section stays compact. */
export const HOME_TOP_CREATORS_ROWS = 2;

export function getCatalogGridColumns(width) {
  const w = Number(width);
  if (!Number.isFinite(w) || w <= 520) return 1;
  if (w <= 640) return 2;
  if (w <= 1180) return 3;
  return 4;
}

/**
 * Homepage shorts strip: was `sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6` — match with CSS class `.lw-home-shorts-grid`.
 */
export function getHomeShortsGridColumns(width) {
  const w = Number(width);
  if (!Number.isFinite(w) || w < 640) return 1;
  if (w < 1024) return 2;
  if (w < 1280) return 3;
  return 6;
}

function defaultWidth() {
  if (typeof window === 'undefined') return 1200;
  return window.innerWidth;
}

/** Page size = 6 rows × columns (catalog / creator detail grids). */
export function useCatalogGridPageSize() {
  const [pageSize, setPageSize] = useState(
    () => getCatalogGridColumns(defaultWidth()) * CATALOG_GRID_ROWS_PER_PAGE,
  );

  useEffect(() => {
    function sync() {
      const next = getCatalogGridColumns(window.innerWidth) * CATALOG_GRID_ROWS_PER_PAGE;
      setPageSize((p) => (p === next ? p : next));
    }
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  return pageSize;
}

/** Same column breakpoints as `useCatalogGridPageSize`, but only **two** rows of cards (home featured strip). */
export function useHomeTopCreatorsPageSize() {
  const [pageSize, setPageSize] = useState(
    () => getCatalogGridColumns(defaultWidth()) * HOME_TOP_CREATORS_ROWS,
  );

  useEffect(() => {
    function sync() {
      const next = getCatalogGridColumns(window.innerWidth) * HOME_TOP_CREATORS_ROWS;
      setPageSize((p) => (p === next ? p : next));
    }
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  return pageSize;
}

export function useHomeShortsPageSize() {
  const [rowSize, setRowSize] = useState(
    () => getHomeShortsGridColumns(defaultWidth()),
  );

  useEffect(() => {
    function sync() {
      const next = getHomeShortsGridColumns(window.innerWidth);
      setRowSize((p) => (p === next ? p : next));
    }
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  return rowSize;
}
