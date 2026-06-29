/**
 * Renders a confirmation prompt for an AI-proposed mutation action.
 * Shown below the assistant's text when message.pending_action is non-null.
 * The user must confirm or cancel before the AI proceeds with the write tool.
 * (MINCRM-425, MINCRM-426)
 */

import { useTranslation } from 'react-i18next';
import type { AiPendingAction, AiMutationOperation } from '@shared/schemas/aiSessionSchema.js';

export interface MutationConfirmationBlockProps {
  pendingAction: AiPendingAction;
  onConfirm: () => void;
  onCancel: () => void;
  isDisabled?: boolean;
}

// ── Style maps keyed by operation ────────────────────────────────────────────

const CONTAINER_CLASSES: Record<AiMutationOperation, string> = {
  create:
    'border border-green-200 bg-green-50 border-s-4 border-s-green-500 rounded-lg ps-4 pe-4 py-3',
  update:
    'border border-blue-200 bg-blue-50 border-s-4 border-s-blue-500 rounded-lg ps-4 pe-4 py-3',
  delete: 'border border-red-200 bg-red-50 border-s-4 border-s-red-500 rounded-lg ps-4 pe-4 py-3',
};

const BADGE_CLASSES: Record<AiMutationOperation, string> = {
  create: 'bg-green-100 text-green-800',
  update: 'bg-blue-100 text-blue-800',
  delete: 'bg-red-100 text-red-800',
};

const CONFIRM_BUTTON_CLASSES: Record<AiMutationOperation, string> = {
  create:
    'px-3 py-1.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors',
  update:
    'px-3 py-1.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors',
  delete:
    'px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors',
};

const CONFIRM_KEY: Record<AiMutationOperation, string> = {
  create: 'ai.confirmation.confirmCreate',
  update: 'ai.confirmation.confirmUpdate',
  delete: 'ai.confirmation.confirmDelete',
};

const OP_LABEL_KEY: Record<AiMutationOperation, string> = {
  create: 'ai.confirmation.operationCreate',
  update: 'ai.confirmation.operationUpdate',
  delete: 'ai.confirmation.operationDelete',
};

// ── Field table ───────────────────────────────────────────────────────────────

interface FieldTableProps {
  fields: Record<string, unknown>;
  /** Column label for the value column */
  valueLabel: string;
}

function FieldTable({ fields, valueLabel }: FieldTableProps) {
  const { t } = useTranslation();
  const entries = Object.entries(fields);
  if (entries.length === 0) return null;

  return (
    <table className="w-full text-xs mt-2 border-collapse" data-testid="nli-confirmation-fields">
      <thead>
        <tr className="text-start text-gray-500">
          <th className="pb-1 pe-3 font-medium text-start">{t('ai.confirmation.fieldLabel')}</th>
          <th className="pb-1 font-medium text-start">{valueLabel}</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([key, value]) => (
          <tr key={key} className="border-t border-gray-200">
            <td className="py-1 pe-3 font-mono text-gray-600 align-top whitespace-nowrap">{key}</td>
            <td className="py-1 text-gray-800 break-words">
              {value === null || value === undefined ? (
                <span className="text-gray-400 italic">—</span>
              ) : typeof value === 'object' ? (
                JSON.stringify(value)
              ) : (
                String(value)
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Bulk sample chips ─────────────────────────────────────────────────────────

interface BulkSampleProps {
  sample: string[];
  totalCount: number;
}

function BulkSample({ sample, totalCount }: BulkSampleProps) {
  const { t } = useTranslation();
  const remaining = totalCount - sample.length;

  return (
    <div className="flex flex-wrap gap-1.5 mt-2" data-testid="nli-bulk-sample">
      {sample.map((name) => (
        <span
          key={name}
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-white border border-gray-300 text-gray-700"
        >
          {name}
        </span>
      ))}
      {remaining > 0 && (
        <span className="inline-flex items-center px-2 py-0.5 text-xs text-gray-500">
          {t('ai.confirmation.andMore', { count: remaining })}
        </span>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MutationConfirmationBlock({
  pendingAction,
  onConfirm,
  onCancel,
  isDisabled = false,
}: MutationConfirmationBlockProps) {
  const { t } = useTranslation();
  const {
    operation,
    entityType,
    entityName,
    entityId,
    fields,
    isBulk,
    bulkCount,
    bulkSample,
    summary,
  } = pendingAction;

  const capitalizedEntityType =
    entityType.charAt(0).toUpperCase() + entityType.slice(1).toLowerCase();

  return (
    <div className={`mt-3 ${CONTAINER_CLASSES[operation]}`} data-testid="nli-confirmation-block">
      {/* Header row: operation badge + entity type */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${BADGE_CLASSES[operation]}`}
          data-testid="nli-operation-badge"
        >
          {t(OP_LABEL_KEY[operation])}
        </span>
        <span className="text-sm font-medium text-gray-700">{capitalizedEntityType}</span>
      </div>

      {/* Summary */}
      <p className="text-sm text-gray-800 mb-2">{summary}</p>

      {/* Single-record delete: show entity name/id prominently */}
      {operation === 'delete' && !isBulk && (entityName ?? entityId) && (
        <div className="mb-2 p-2 bg-red-100 rounded-md text-xs text-red-800 break-words">
          <span className="font-semibold">{entityName ?? entityId}</span>
        </div>
      )}

      {/* Fields preview — create shows all fields, update shows changed fields */}
      {operation !== 'delete' && Object.keys(fields).length > 0 && (
        <FieldTable
          fields={fields}
          valueLabel={
            operation === 'update'
              ? t('ai.confirmation.newValueLabel')
              : t('ai.confirmation.valueLabel')
          }
        />
      )}

      {/* Bulk info */}
      {isBulk && bulkCount !== undefined && (
        <div className="mt-2">
          <p className="text-xs font-medium text-gray-700">
            {t('ai.confirmation.affectedCount', { count: bulkCount })}
          </p>
          {bulkSample && bulkSample.length > 0 && (
            <BulkSample sample={bulkSample} totalCount={bulkCount} />
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 mt-3 flex-wrap">
        <button
          type="button"
          onClick={onConfirm}
          disabled={isDisabled}
          data-testid="nli-confirm-button"
          aria-label={t(CONFIRM_KEY[operation])}
          className={CONFIRM_BUTTON_CLASSES[operation]}
        >
          {t(CONFIRM_KEY[operation])}
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
            {/* Muted "Request sent…" indicator while follow-up processes */}
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
