/**
 * BulkChangeStageModal component.
 * Stage picker for bulk change-stage operations on deals.
 * Accessible dialog with focus trap and Escape dismissal. (MINCRM-188)
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button.js';
import { getStageDisplayName } from '@/utils/pipelineStageI18nKey.js';
import type { PipelineStageResponse } from '@shared/schemas/pipelineStageSchema.js';

interface BulkChangeStageModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Number of deals being changed */
  selectedCount: number;
  /** Live list of pipeline stages */
  stages: PipelineStageResponse[];
  /** Disables buttons while the mutation is in flight */
  isPending: boolean;
  /** Called with the chosen stage name when user confirms */
  onConfirm: (stage: string) => void;
  /** Called when user cancels or dismisses */
  onCancel: () => void;
}

/**
 * Modal for picking a new stage during a bulk change-stage operation.
 * Focus moves to the stage select on open; returns to trigger on close.
 */
export default function BulkChangeStageModal({
  isOpen,
  selectedCount,
  stages,
  isPending,
  onConfirm,
  onCancel,
}: BulkChangeStageModalProps) {
  const { t } = useTranslation();
  const selectRef = useRef<HTMLSelectElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [selectedStage, setSelectedStage] = useState('');

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      requestAnimationFrame(() => {
        selectRef.current?.focus();
      });
    } else {
      previousFocusRef.current?.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape' && !isPending) {
      onCancel();
    }
  }

  function handleConfirm(): void {
    if (selectedStage) {
      onConfirm(selectedStage);
    }
  }

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="bulk-change-stage-modal"
      onClick={isPending ? undefined : onCancel}
      onKeyDown={handleKeyDown}
    >
      <dialog
        open
        aria-modal="true"
        aria-labelledby="bulk-change-stage-title"
        className="relative w-full max-w-sm mx-4 p-0"
      >
        <div
          role="presentation"
          className="rounded-lg bg-white p-6 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="bulk-change-stage-title" className="text-base font-semibold text-gray-900 mb-2">
            {t('bulk.changeStageTitle')}
          </h2>

          <p className="text-sm text-gray-600 mb-4">
            {t('bulk.changeStageMessage', { count: selectedCount })}
          </p>

          <label
            htmlFor="bulk-change-stage-select"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            {t('bulk.newStageLabel')}
          </label>
          <select
            id="bulk-change-stage-select"
            ref={selectRef}
            value={selectedStage}
            onChange={(e) => setSelectedStage(e.target.value)}
            disabled={isPending}
            data-testid="bulk-change-stage-select"
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 mb-6"
          >
            <option value="">{t('bulk.selectStage')}</option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.name}>
                {getStageDisplayName(stage.name, t)}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="primary"
              data-testid="bulk-change-stage-confirm"
              onClick={handleConfirm}
              disabled={isPending || !selectedStage}
            >
              {isPending ? t('bulk.changingStagePending') : t('bulk.changeStageConfirm')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              data-testid="bulk-change-stage-cancel"
              onClick={onCancel}
              disabled={isPending}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
