/**
 * ContactEnrichmentModal component. (MINCRM-439)
 * Lets the user paste freeform text (LinkedIn bio, email signature, vCard,
 * business card text) and calls the AI extractor. Extracted fields are
 * returned to the caller (ContactForm), which pre-fills its own fields —
 * editable before saving. Raw pasted text is never stored beyond this
 * component's local state; it is not sent to any endpoint besides the
 * one-shot enrichment call.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button.js';
import { resolveApiError } from '@/utils/apiError.js';
import { enrichContactFromText } from '@/api/contactEnrichment.js';
import type { ContactEnrichmentFields } from '@shared/schemas/contactEnrichmentSchema.js';

export interface ContactEnrichmentModalProps {
  isOpen: boolean;
  /** Called with extracted fields (and matched account, if any) when the user applies them. */
  onApply: (fields: ContactEnrichmentFields, matchedAccountId: string | null) => void;
  onCancel: () => void;
}

/**
 * Modal for pasting freeform text and extracting contact fields via AI.
 */
export default function ContactEnrichmentModal({
  isOpen,
  onApply,
  onCancel,
}: ContactEnrichmentModalProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const [rawText, setRawText] = useState('');

  const enrichMutation = useMutation({
    mutationFn: () => enrichContactFromText(rawText),
  });

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    } else {
      previousFocusRef.current?.focus();
      setRawText('');
      enrichMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset-on-close only needs isOpen
  }, [isOpen]);

  if (!isOpen) return null;

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape' && !enrichMutation.isPending) {
      onCancel();
    }
  }

  function handleApply(): void {
    if (!enrichMutation.data) return;
    onApply(enrichMutation.data.fields, enrichMutation.data.matched_account_id);
  }

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="contact-enrichment-modal-overlay"
      onClick={enrichMutation.isPending ? undefined : onCancel}
      onKeyDown={handleKeyDown}
    >
      <dialog
        open
        aria-modal="true"
        aria-labelledby="contact-enrichment-title"
        data-testid="contact-enrichment-modal"
        className="relative w-full max-w-lg mx-4 p-0"
      >
        <div
          role="presentation"
          className="rounded-lg bg-white p-6 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="contact-enrichment-title" className="text-base font-semibold text-gray-900 mb-2">
            {t('contactEnrichment.title')}
          </h2>

          <label
            htmlFor="contact-enrichment-input"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            {t('contactEnrichment.inputLabel')}
          </label>
          <textarea
            id="contact-enrichment-input"
            ref={textareaRef}
            data-testid="contact-enrichment-input"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={8}
            disabled={enrichMutation.isPending}
            placeholder={t('contactEnrichment.inputPlaceholder')}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900
                       placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500
                       focus:border-primary-500 resize-none mb-4"
          />

          {enrichMutation.isError && (
            <p
              role="alert"
              className="mb-4 text-xs text-red-600"
              data-testid="contact-enrichment-error"
            >
              {resolveApiError(enrichMutation.error, t)}
            </p>
          )}

          {enrichMutation.data?.insufficient_data && (
            <p
              role="alert"
              className="mb-4 text-xs text-amber-700"
              data-testid="contact-enrichment-insufficient"
            >
              {t('contactEnrichment.insufficientData')}
            </p>
          )}

          <div className="flex items-center gap-3">
            {!enrichMutation.data && (
              <Button
                type="button"
                variant="primary"
                data-testid="contact-enrichment-submit"
                onClick={() => enrichMutation.mutate()}
                disabled={enrichMutation.isPending || !rawText.trim()}
              >
                {enrichMutation.isPending
                  ? t('contactEnrichment.extracting')
                  : t('contactEnrichment.submit')}
              </Button>
            )}
            {enrichMutation.data && !enrichMutation.data.insufficient_data && (
              <Button
                type="button"
                variant="primary"
                data-testid="contact-enrichment-apply"
                onClick={handleApply}
              >
                {t('contactEnrichment.apply')}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              data-testid="contact-enrichment-cancel"
              onClick={onCancel}
              disabled={enrichMutation.isPending}
            >
              {t('activities.cancel')}
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
