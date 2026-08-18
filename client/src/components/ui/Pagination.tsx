/**
 * Pagination controls component.
 * Renders previous/next buttons, page indicator, a record count summary, and an
 * optional page-size selector.
 * Used by all paginated list pages.
 */

import { useTranslation } from 'react-i18next';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export interface PaginationProps {
  /** Current 1-based page number */
  page: number;
  /** Records per page */
  limit: number;
  /** Total number of records matching the current filters */
  total: number;
  /** Called when the user navigates to a different page */
  onPageChange: (page: number) => void;
  /**
   * Called when the user selects a new page size.
   * The caller is responsible for resetting `page` to 1 when this fires.
   * When omitted, the page-size selector is not rendered.
   */
  onLimitChange?: (limit: number) => void;
}

/**
 * Prev/Next pagination bar with a "Page N of M" indicator, a "Showing X–Y of Z" summary,
 * and an optional page-size selector.
 */
export function Pagination({ page, limit, total, onPageChange, onLimitChange }: PaginationProps) {
  const { t } = useTranslation();

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  return (
    <div
      className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-white text-sm text-gray-600"
      data-testid="pagination"
    >
      {/* Record count summary + optional page-size selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500" data-testid="pagination-summary">
          {t('pagination.showing', { from, to, total })}
        </span>
        {onLimitChange && (
          <select
            value={limit}
            onChange={(e) => onLimitChange(Number(e.target.value))}
            data-testid="pagination-limit-select"
            className="text-xs border border-gray-300 rounded px-1 py-0.5"
            aria-label={t('pagination.rowsPerPage')}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {t('pagination.rowsPerPageOption', { n })}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Page controls */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={!hasPrev}
          data-testid="pagination-prev"
          className="inline-flex items-center px-3 py-1.5 rounded-md border border-gray-300 bg-white text-xs font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
          aria-label={t('pagination.previous')}
        >
          {t('pagination.previous')}
        </button>

        <span className="text-xs" data-testid="pagination-page-indicator">
          {t('pagination.pageOf', { page, total: totalPages })}
        </span>

        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={!hasNext}
          data-testid="pagination-next"
          className="inline-flex items-center px-3 py-1.5 rounded-md border border-gray-300 bg-white text-xs font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
          aria-label={t('pagination.next')}
        >
          {t('pagination.next')}
        </button>
      </div>
    </div>
  );
}
