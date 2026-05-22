/**
 * BulkReassignModal component.
 * Owner picker for bulk reassign operations.
 * Accessible dialog with focus trap and Escape dismissal. (MINCRM-188)
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button.js';
import type { ActiveUser } from '@/api/users.js';

interface BulkReassignModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Number of records being reassigned */
  selectedCount: number;
  /** List of active users for the owner picker */
  users: ActiveUser[];
  /** Disables buttons while the mutation is in flight */
  isPending: boolean;
  /** Called with the chosen owner_id when user confirms */
  onConfirm: (ownerId: string) => void;
  /** Called when user cancels or dismisses */
  onCancel: () => void;
}

/**
 * Modal for picking a new owner during a bulk reassign operation.
 * Focus moves to the owner select on open; returns to trigger on close.
 */
export default function BulkReassignModal({
  isOpen,
  selectedCount,
  users,
  isPending,
  onConfirm,
  onCancel,
}: BulkReassignModalProps) {
  const { t } = useTranslation();
  const selectRef = useRef<HTMLSelectElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [selectedOwner, setSelectedOwner] = useState('');

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
    if (selectedOwner) {
      onConfirm(selectedOwner);
    }
  }

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="bulk-reassign-modal-overlay"
      onClick={isPending ? undefined : onCancel}
      onKeyDown={handleKeyDown}
    >
      <dialog
        open
        aria-modal="true"
        aria-labelledby="bulk-reassign-title"
        data-testid="bulk-reassign-modal"
        className="relative w-full max-w-sm mx-4 p-0"
      >
        <div
          role="presentation"
          className="rounded-lg bg-white p-6 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="bulk-reassign-title" className="text-base font-semibold text-gray-900 mb-2">
            {t('bulk.reassignTitle')}
          </h2>

          <p className="text-sm text-gray-600 mb-4">
            {t('bulk.reassignMessage', { count: selectedCount })}
          </p>

          <label
            htmlFor="bulk-reassign-owner"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            {t('bulk.newOwnerLabel')}
          </label>
          <select
            id="bulk-reassign-owner"
            ref={selectRef}
            value={selectedOwner}
            onChange={(e) => setSelectedOwner(e.target.value)}
            disabled={isPending}
            data-testid="bulk-reassign-owner-select"
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 mb-6"
          >
            <option value="">{t('bulk.selectOwner')}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="primary"
              data-testid="bulk-reassign-confirm"
              onClick={handleConfirm}
              disabled={isPending || !selectedOwner}
            >
              {isPending ? t('bulk.reassigning') : t('bulk.reassignConfirm')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              data-testid="bulk-reassign-cancel"
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
