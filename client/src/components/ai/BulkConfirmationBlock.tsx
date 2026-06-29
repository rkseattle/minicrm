/**
 * Extends MutationConfirmationBlock with a double-confirm gate for bulk deletes.
 * Rendered instead of MutationConfirmationBlock when pendingAction.isBulkDelete is true.
 * The confirm button stays disabled until the user types the record count or "DELETE".
 * (MINCRM-425, MINCRM-426)
 */

import { useTranslation } from 'react-i18next';
import type { AiPendingAction } from '@shared/schemas/aiSessionSchema.js';

export interface BulkConfirmationBlockProps {
  pendingAction: AiPendingAction;
  onConfirm: () => void;
  onCancel: () => void;
  isDisabled?: boolean;
  confirmText: string;
  onConfirmTextChange: (value: string) => void;
}

export default function BulkConfirmationBlock({
  pendingAction,
  onConfirm,
  onCancel,
  isDisabled = false,
  confirmText,
  onConfirmTextChange,
}: BulkConfirmationBlockProps) {
  const { t } = useTranslation();
  const bulkCount = pendingAction.bulkCount ?? 0;

  // Require "DELETE" if bulk_count was not provided (bulkCount===0 means unknown scope).
  // When bulk_count is known and > 0, also accept the exact count string.
  const isConfirmAllowed =
    (bulkCount > 0 && confirmText === String(bulkCount)) || confirmText.toUpperCase() === 'DELETE';

  return (
    <div
      className="mt-3 border border-red-200 bg-red-50 border-s-4 border-s-red-500 rounded-lg ps-4 pe-4 py-3"
      data-testid="nli-bulk-confirmation-block"
    >
      {/* Reuse the base block but intercept the confirm button via isDisabled.
          We gate the confirm button ourselves via the text-input check below,
          so we always pass isDisabled=true to the base block to disable its buttons,
          and render our own confirm button after the warning callout. */}

      {/* Operation badge + entity type header (mirrors MutationConfirmationBlock header) */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800"
          data-testid="nli-operation-badge"
        >
          {t('ai.confirmation.operationDelete')}
        </span>
        <span className="text-sm font-medium text-gray-700">
          {pendingAction.entityType.charAt(0).toUpperCase() +
            pendingAction.entityType.slice(1).toLowerCase()}
        </span>
      </div>

      {/* Summary */}
      <p className="text-sm text-gray-800 mb-3">{pendingAction.summary}</p>

      {/* Bulk affected count + sample */}
      {bulkCount > 0 && (
        <div className="mb-3">
          <p className="text-xs font-medium text-gray-700">
            {t('ai.confirmation.affectedCount', { count: bulkCount })}
          </p>
          {pendingAction.bulkSample && pendingAction.bulkSample.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2" data-testid="nli-bulk-sample">
              {pendingAction.bulkSample.map((name: string, idx: number) => (
                <span
                  key={`${name}-${idx}`}
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-white border border-gray-300 text-gray-700"
                >
                  {name}
                </span>
              ))}
              {bulkCount - pendingAction.bulkSample.length > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 text-xs text-gray-500">
                  {t('ai.confirmation.andMore', {
                    count: bulkCount - pendingAction.bulkSample.length,
                  })}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Permanent deletion warning */}
      <div
        className="mb-3 p-2 bg-red-100 rounded-md text-xs text-red-800"
        role="alert"
        data-testid="nli-bulk-delete-warning"
      >
        {t('ai.confirmation.bulkDeleteWarning', { count: bulkCount })}
      </div>

      {/* Confirmation text input */}
      <div className="mb-3">
        <input
          type="text"
          value={confirmText}
          onChange={(e) => onConfirmTextChange(e.target.value)}
          disabled={isDisabled}
          placeholder={t('ai.confirmation.bulkDeleteConfirmPlaceholder', { count: bulkCount })}
          data-testid="nli-bulk-delete-confirm-input"
          aria-label={t('ai.confirmation.bulkDeleteConfirmPlaceholder', { count: bulkCount })}
          className="w-full rounded-lg border border-red-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent disabled:opacity-50"
        />
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={onConfirm}
          disabled={isDisabled || !isConfirmAllowed}
          data-testid="nli-confirm-button"
          aria-label={t('ai.confirmation.confirmDelete')}
          className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {t('ai.confirmation.confirmDelete')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isDisabled}
          data-testid="nli-cancel-button"
          className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {t('ai.confirmation.cancel')}
        </button>
        {isDisabled && (
          <span
            className="flex items-center text-xs text-gray-400 ms-1"
            aria-live="polite"
            role="status"
          >
            <svg
              className="animate-spin h-3 w-3 me-1 text-gray-400"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
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
                d="M4 12a8 8 0 018-8V0C5.373 0 22 6.477 22 12h-4z"
              />
            </svg>
            {t('ai.sending')}
          </span>
        )}
      </div>
    </div>
  );
}
