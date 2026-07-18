/**
 * CloseDealModal component.
 * Shown when a user selects "Closed Won" or "Closed Lost" from a stage selector.
 * Captures an optional close date (pre-filled with today) and, for Closed Lost,
 * an optional loss reason before the deal update is submitted.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input.js';
import { Button } from '@/components/ui/Button.js';
import type { PipelineStage } from '@shared/schemas/dealSchema.js';

/** The two terminal stages that trigger this modal */
export const CLOSED_STAGES: PipelineStage[] = ['Closed Won', 'Closed Lost'];

interface CloseDealModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** The terminal stage the user selected */
  targetStage: string;
  /** Initial value for the close date field (YYYY-MM-DD, typically today) */
  initialCloseDate: string;
  /** Disables all inputs and buttons while the API call is in flight */
  isSubmitting: boolean;
  /** Error message from a failed close attempt */
  error?: string;
  /**
   * Called when the user confirms the close.
   *
   * @param closeDate - YYYY-MM-DD close date
   * @param lossReason - Free-text loss reason (empty string when not applicable)
   */
  onConfirm: (closeDate: string, lossReason: string) => void;
  /** Called when the user dismisses the modal without confirming */
  onCancel: () => void;
}

/**
 * Modal dialog for closing a deal as Won or Lost.
 * Renders a close date input and, for Closed Lost, a loss reason textarea.
 *
 * @param isOpen - Whether the modal is visible
 * @param targetStage - The terminal stage the user selected
 * @param initialCloseDate - Today's date in YYYY-MM-DD format
 * @param isSubmitting - Disable controls while request is in flight
 * @param error - Error message from a failed attempt
 * @param onConfirm - Callback with closeDate and lossReason
 * @param onCancel - Callback when the modal is dismissed
 */
export default function CloseDealModal({
  isOpen,
  targetStage,
  initialCloseDate,
  isSubmitting,
  error,
  onConfirm,
  onCancel,
}: CloseDealModalProps) {
  const { t } = useTranslation();
  const [closeDate, setCloseDate] = useState(initialCloseDate);
  const [lossReason, setLossReason] = useState('');

  /**
   * Keeps closeDate in sync if initialCloseDate changes (e.g. day rolls over
   * between opens). Adjusted during render rather than via an effect — avoids
   * the extra render an effect-based sync would cause. See:
   * https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
   */
  const [prevInitialCloseDate, setPrevInitialCloseDate] = useState(initialCloseDate);
  if (initialCloseDate !== prevInitialCloseDate) {
    setPrevInitialCloseDate(initialCloseDate);
    setCloseDate(initialCloseDate);
  }

  const isClosedLost = targetStage === 'Closed Lost';

  if (!isOpen) return null;

  /**
   * Handles form submission inside the modal.
   *
   * @param event - Form submit event
   */
  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onConfirm(closeDate, isClosedLost ? lossReason : '');
  }

  return (
    // Backdrop — clicking outside the dialog (or pressing Escape) dismisses the modal
    // role="presentation" because the dialog element itself is the interactive landmark
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="close-deal-modal-overlay"
      onClick={isSubmitting ? undefined : onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !isSubmitting) onCancel();
      }}
    >
      <dialog open data-testid="close-deal-modal" className="relative w-full max-w-md mx-4 p-0">
        {/* Inner wrapper stops backdrop clicks from propagating through the dialog */}
        <div
          role="presentation"
          className="rounded-lg bg-white p-6 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="text-base font-semibold text-gray-900 mb-4">
            {t('pipeline.closeDeal.title', { stage: targetStage })}
          </h2>

          <form onSubmit={handleSubmit}>
            <div className="flex flex-col gap-4 mb-4">
              <Input
                id="close-deal-date"
                data-testid="close-deal-date-input"
                type="date"
                label={t('pipeline.closeDeal.closeDateLabel')}
                value={closeDate}
                max={initialCloseDate}
                onChange={(e) => setCloseDate(e.target.value)}
                disabled={isSubmitting}
              />

              {isClosedLost && (
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="close-deal-loss-reason"
                    className="text-sm font-medium text-gray-700"
                  >
                    {t('deals.lossReasonLabel')}
                  </label>
                  <textarea
                    id="close-deal-loss-reason"
                    data-testid="close-deal-loss-reason-input"
                    value={lossReason}
                    onChange={(e) => setLossReason(e.target.value)}
                    disabled={isSubmitting}
                    rows={3}
                    placeholder=""
                    className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder:text-gray-400 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
                  />
                </div>
              )}
            </div>

            {error && (
              <div
                role="alert"
                data-testid="close-deal-error"
                className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
              >
                {error}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button type="submit" data-testid="close-deal-confirm" disabled={isSubmitting}>
                {t('pipeline.closeDeal.confirm')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                data-testid="close-deal-cancel"
                onClick={onCancel}
                disabled={isSubmitting}
              >
                {t('deals.cancel')}
              </Button>
            </div>
          </form>
        </div>
      </dialog>
    </div>
  );
}
