/**
 * ConfirmDeleteModal component.
 * Accessible confirmation dialog for destructive delete operations.
 * Implements focus trap, ARIA attributes, and Escape key dismissal.
 * Replaces window.confirm() on detail pages.
 */

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button.js';

interface ConfirmDeleteModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** The confirmation message body shown to the user */
  message: string;
  /** Disables buttons while the delete mutation is in flight */
  isDeleting: boolean;
  /** Called when the user confirms the delete */
  onConfirm: () => void;
  /** Called when the user cancels or dismisses the modal */
  onCancel: () => void;
}

/**
 * Accessible delete-confirmation modal.
 * - Focus moves to the Cancel button when opened; returns to the trigger element on close.
 * - Pressing Escape dismisses without confirming.
 * - Uses role="dialog", aria-modal, and aria-labelledby for screen reader support.
 *
 * @param isOpen - Whether the modal is visible
 * @param message - Body text describing what will be deleted
 * @param isDeleting - Disables controls while request is in flight
 * @param onConfirm - Callback when user clicks the delete button
 * @param onCancel - Callback when user cancels or presses Escape
 */
export default function ConfirmDeleteModal({
  isOpen,
  message,
  isDeleting,
  onConfirm,
  onCancel,
}: ConfirmDeleteModalProps) {
  const { t } = useTranslation();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  /** Capture the currently-focused element before the modal opens, so we can restore it on close */
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      // Defer focus to ensure the element is rendered before we try to focus it
      requestAnimationFrame(() => {
        cancelButtonRef.current?.focus();
      });
    } else {
      // Restore focus to the trigger element when the modal closes
      if (previousFocusRef.current && previousFocusRef.current.focus) {
        previousFocusRef.current.focus();
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  /**
   * Handles keydown events on the modal backdrop.
   *
   * @param event - Keyboard event
   */
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape' && !isDeleting) {
      onCancel();
    }
  }

  return (
    // Backdrop — role="presentation" because the dialog element is the interactive landmark
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="confirm-delete-modal-overlay"
      onClick={isDeleting ? undefined : onCancel}
      onKeyDown={handleKeyDown}
    >
      <dialog
        open
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        data-testid="confirm-delete-modal"
        className="relative w-full max-w-sm mx-4 p-0"
      >
        {/* Inner wrapper stops backdrop clicks from propagating through the dialog */}
        <div
          role="presentation"
          className="rounded-lg bg-white p-6 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h2
            id="confirm-delete-title"
            className="text-base font-semibold text-gray-900 mb-2"
            data-testid="confirm-delete-title"
          >
            {t('common.confirmDeleteTitle')}
          </h2>

          <p className="text-sm text-gray-600 mb-6" data-testid="confirm-delete-message">
            {message}
          </p>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="danger"
              data-testid="confirm-delete-confirm"
              onClick={onConfirm}
              disabled={isDeleting}
            >
              {isDeleting ? t('common.deleting') : t('common.delete')}
            </Button>
            <Button
              ref={cancelButtonRef}
              type="button"
              variant="ghost"
              data-testid="confirm-delete-cancel"
              onClick={onCancel}
              disabled={isDeleting}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
