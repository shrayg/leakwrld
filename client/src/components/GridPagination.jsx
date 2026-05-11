import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatCount } from '../lib/metrics';

/**
 * Prev/next paging for grid sections. Hidden when a single page.
 */
export function GridPagination({
  page,
  totalPages,
  onPrev,
  onNext,
  disabled,
  summary,
  idPrefix = 'grid-pg',
}) {
  if (totalPages <= 1) return null;
  const canPrev = page > 1 && !disabled;
  const canNext = page < totalPages && !disabled;
  return (
    <section className="lw-toolbar lw-grid-pagination" aria-label="Pagination">
      {summary ? <div className="text-[13px] text-white/70">{summary}</div> : <div />}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={`lw-filter ${canPrev ? '' : 'opacity-50'}`}
          disabled={!canPrev}
          onClick={onPrev}
          id={`${idPrefix}-prev`}
        >
          <ChevronLeft size={13} />
          Prev
        </button>
        <span className="min-w-[86px] text-center text-[12px] text-white/65" aria-live="polite">
          Page {formatCount(page)} / {formatCount(totalPages)}
        </span>
        <button
          type="button"
          className={`lw-filter ${canNext ? '' : 'opacity-50'}`}
          disabled={!canNext}
          onClick={onNext}
          id={`${idPrefix}-next`}
        >
          Next
          <ChevronRight size={13} />
        </button>
      </div>
    </section>
  );
}
