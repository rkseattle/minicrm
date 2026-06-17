/**
 * BulkActionBar component.
 * Shown when one or more rows are selected in a list view.
 * Displays selected count and available bulk action buttons.
 * On mobile it renders as a fixed bottom sheet; on desktop it renders inline.
 * (MINCRM-188)
 */

import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button.js';

export interface BulkAction {
  /** Action identifier */
  key: string;
  /** i18n key for the button label */
  labelKey: string;
  /** data-testid value */
  testId: string;
  /** Button variant */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}

interface BulkActionBarProps {
  /** Number of currently-selected records */
  selectedCount: number;
  /** Available bulk actions to display */
  actions: BulkAction[];
  /** Called when an action button is clicked, with the action key */
  onAction: (key: string) => void;
  /** Called when the user clears the selection */
  onClearSelection: () => void;
  /** When true, replaces action buttons with a spinner and disables clear */
  isPending?: boolean;
  /** If provided, shows a "See details" link after the count (e.g. to view partial failures) */
  onSeeDetails?: () => void;
}

/**
 * Action bar shown while rows are selected.
 * Desktop: inline bar above the list.
 * Mobile: fixed bottom sheet (z-[60], safe-area-aware).
 *
 * Uses clamp() on the count label to stay legible at narrow widths (MINCRM-208).
 */
export default function BulkActionBar({
  selectedCount,
  actions,
  onAction,
  onClearSelection,
  isPending = false,
  onSeeDetails,
}: BulkActionBarProps) {
  const { t } = useTranslation();

  if (selectedCount === 0) return null;

  const content = (
    <div className="flex flex-wrap items-center gap-3 min-w-0">
      {/* Selected count */}
      <span
        data-testid="bulk-action-count"
        className="text-sm font-medium text-gray-700 shrink-0"
        style={{ fontSize: 'clamp(0.75rem, 2vw, 0.875rem)' }}
      >
        {t('bulk.selectedCount', { count: selectedCount })}
      </span>

      {/* See details link — shown when partial failures are available */}
      {onSeeDetails && (
        <button
          type="button"
          onClick={onSeeDetails}
          className="text-xs text-primary-600 hover:underline"
          data-testid="bulk-see-details"
        >
          {t('bulk.seeDetails')}
        </button>
      )}

      {/* Action buttons or spinner when pending */}
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        {isPending ? (
          <svg
            className="animate-spin h-5 w-5 text-primary-600"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-label={t('bulk.pendingSpinner')}
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        ) : (
          actions.map((action) => (
            <Button
              key={action.key}
              type="button"
              variant={action.variant ?? 'secondary'}
              data-testid={action.testId}
              onClick={() => onAction(action.key)}
              className="shrink-0"
            >
              {t(action.labelKey)}
            </Button>
          ))
        )}
      </div>

      {/* Clear selection — disabled while an operation is in flight */}
      <button
        type="button"
        onClick={onClearSelection}
        disabled={isPending}
        data-testid="bulk-clear-selection"
        className="ms-auto text-xs text-gray-600 hover:text-gray-700 underline shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label={t('bulk.clearSelection')}
      >
        {t('bulk.clearSelection')}
      </button>
    </div>
  );

  return (
    /**
     * Responsive container: inline bar on md+, fixed bottom sheet on mobile.
     * Single element so data-testid queries are unambiguous.
     */
    <div
      data-testid="bulk-action-bar"
      className={[
        'min-w-0',
        // Mobile: fixed bottom sheet — z-[60] beats SetupChecklistWidget's z-50 so
        // bulk action buttons remain clickable when the widget is open. (MINCRM-391)
        'fixed bottom-0 start-0 end-0 z-[60]',
        'bg-white border-t border-gray-200 shadow-lg px-4 py-3',
        // Desktop: inline bar
        'md:static md:flex md:items-center',
        'md:bg-primary-50 md:border md:border-primary-200 md:rounded-lg md:px-4 md:py-2 md:mb-3',
        'md:shadow-none',
      ].join(' ')}
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      {content}
    </div>
  );
}
