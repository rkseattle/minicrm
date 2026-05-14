/**
 * GdprEraseModal component.
 * Confirmation dialog for GDPR Art. 17 personal data erasure.
 * Requires the admin to type "ERASE" and provides an optional reference note.
 * (MINCRM-364)
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button.js';

interface GdprEraseModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** 'contact' or 'lead' — controls which fields are listed */
  recordType: 'contact' | 'lead';
  /** Disables controls while the erasure mutation is in flight */
  isErasing: boolean;
  /** Called when the admin confirms erasure, with an optional reference note */
  onConfirm: (notes?: string) => void;
  /** Called when the admin cancels or dismisses the modal */
  onCancel: () => void;
}

/** Contact PII fields that will be erased, for display in the confirmation */
const CONTACT_PII_FIELDS = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'title',
  'department',
  'address_line1',
  'address_line2',
  'city',
  'state_region',
  'postal_code',
  'country',
  'linkedin_url',
  'twitter_x_url',
  'other_url',
];

/** Lead PII fields that will be erased, for display in the confirmation */
const LEAD_PII_FIELDS = ['first_name', 'last_name', 'email', 'phone', 'company_name', 'notes'];

const CONFIRM_WORD = 'ERASE';

/**
 * Accessible modal that requires deliberate confirmation before erasing personal data.
 * Explains exactly what will be erased and what will be preserved.
 */
export default function GdprEraseModal({
  isOpen,
  recordType,
  isErasing,
  onConfirm,
  onCancel,
}: GdprEraseModalProps) {
  const { t } = useTranslation();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [notes, setNotes] = useState('');

  const piiFields = recordType === 'contact' ? CONTACT_PII_FIELDS : LEAD_PII_FIELDS;
  const isConfirmed = confirmText === CONFIRM_WORD;

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      requestAnimationFrame(() => {
        cancelButtonRef.current?.focus();
      });
    } else {
      previousFocusRef.current?.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape' && !isErasing) {
      onCancel();
    }
  }

  function handleConfirm(): void {
    if (!isConfirmed || isErasing) return;
    onConfirm(notes.trim() || undefined);
  }

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="gdpr-erase-modal-overlay"
      onClick={isErasing ? undefined : onCancel}
      onKeyDown={handleKeyDown}
    >
      <dialog
        open
        aria-modal="true"
        aria-labelledby="gdpr-erase-title"
        data-testid="gdpr-erase-modal"
        className="relative w-full max-w-lg mx-4 p-0"
      >
        <div
          role="presentation"
          className="rounded-lg bg-white p-6 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h2
            id="gdpr-erase-title"
            className="text-base font-semibold text-gray-900 mb-1"
            data-testid="gdpr-erase-title"
          >
            {t('gdpr.eraseModal.title')}
          </h2>

          <p className="text-sm text-gray-600 mb-4">{t('gdpr.eraseModal.intro')}</p>

          {/* What will be erased */}
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2">
              {t('gdpr.eraseModal.willBeErased')}
            </p>
            <ul
              className="text-xs text-red-800 list-disc ps-4 space-y-0.5"
              data-testid="gdpr-erase-field-list"
            >
              {piiFields.map((field) => (
                <li key={field}>{field}</li>
              ))}
            </ul>
            {recordType === 'contact' && (
              <p className="text-xs text-red-800 mt-2">
                {t('gdpr.eraseModal.alsoActivitiesAndNotes')}
              </p>
            )}
            {recordType === 'lead' && (
              <p className="text-xs text-red-800 mt-2">{t('gdpr.eraseModal.alsoNotes')}</p>
            )}
          </div>

          {/* What will be preserved */}
          <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-md">
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">
              {t('gdpr.eraseModal.willBePreserved')}
            </p>
            <p className="text-xs text-gray-600">{t('gdpr.eraseModal.preservedDescription')}</p>
          </div>

          {/* Optional reference note */}
          <div className="mb-4">
            <label
              htmlFor="gdpr-erase-notes"
              className="block text-xs font-semibold text-gray-700 mb-1"
            >
              {t('gdpr.eraseModal.notesLabel')}
            </label>
            <input
              id="gdpr-erase-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('gdpr.eraseModal.notesPlaceholder')}
              disabled={isErasing}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
              data-testid="gdpr-erase-notes-input"
            />
          </div>

          {/* Confirm word input */}
          <div className="mb-5">
            <label
              htmlFor="gdpr-erase-confirm"
              className="block text-xs font-semibold text-gray-700 mb-1"
            >
              {t('gdpr.eraseModal.confirmLabel', { word: CONFIRM_WORD })}
            </label>
            <input
              id="gdpr-erase-confirm"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={CONFIRM_WORD}
              disabled={isErasing}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
              data-testid="gdpr-erase-confirm-input"
              autoComplete="off"
            />
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="danger"
              disabled={!isConfirmed || isErasing}
              onClick={handleConfirm}
              data-testid="gdpr-erase-confirm-button"
            >
              {isErasing ? t('gdpr.eraseModal.erasing') : t('gdpr.eraseModal.confirmButton')}
            </Button>
            <Button
              ref={cancelButtonRef}
              type="button"
              variant="ghost"
              disabled={isErasing}
              onClick={onCancel}
              data-testid="gdpr-erase-cancel-button"
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
