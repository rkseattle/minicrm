/**
 * EmailDraftPanel component. (MINCRM-437)
 *
 * Sidebar panel for an AI-generated follow-up email draft. Slides in from the
 * right edge of the viewport. Not persisted: the draft lives only in this
 * component's state until the rep copies it or dismisses the panel. Supports
 * regenerating with a different tone.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button.js';
import { Select } from '@/components/ui/Select.js';
import { resolveApiError } from '@/utils/apiError.js';
import { generateEmailDraft } from '@/api/emailDraft.js';
import { EMAIL_DRAFT_TONES } from '@shared/schemas/emailDraftSchema.js';
import type { EmailDraftResponse, EmailDraftTone } from '@shared/schemas/emailDraftSchema.js';

interface EmailDraftPanelProps {
  contactId: string;
  initialDraft: EmailDraftResponse;
  onDismiss: () => void;
}

const TONE_KEY_MAP: Record<EmailDraftTone, string> = {
  Professional: 'toneProfessional',
  Friendly: 'toneFriendly',
  Concise: 'toneConcise',
};

/**
 * Sidebar panel showing an AI-generated email draft, editable inline, with a
 * tone selector and copy-to-clipboard. Focus moves into the panel on open.
 */
export default function EmailDraftPanel({
  contactId,
  initialDraft,
  onDismiss,
}: EmailDraftPanelProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const [subject, setSubject] = useState(initialDraft.subject);
  const [body, setBody] = useState(initialDraft.body);
  const [tone, setTone] = useState<EmailDraftTone>(initialDraft.tone);
  const [copySuccess, setCopySuccess] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const regenerateMutation = useMutation({
    mutationFn: (nextTone: EmailDraftTone) => generateEmailDraft(contactId, nextTone),
    onSuccess: (result) => {
      setSubject(result.subject);
      setBody(result.body);
      setTone(result.tone);
    },
  });

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    requestAnimationFrame(() => {
      panelRef.current?.focus();
    });
    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      onDismiss();
    }
  }

  function handleToneChange(nextTone: EmailDraftTone): void {
    setTone(nextTone);
    regenerateMutation.mutate(nextTone);
  }

  async function handleCopyToClipboard(): Promise<void> {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopyError(null);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      setCopyError(t('emailDraft.clipboardError'));
    }
  }

  return (
    <div role="presentation" onKeyDown={handleKeyDown}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('emailDraft.panelTitle')}
        tabIndex={-1}
        data-testid="email-draft-panel"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-xl border-l border-gray-200"
      >
        <header className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-4 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">{t('emailDraft.panelTitle')}</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="email-draft-dismiss"
            onClick={onDismiss}
          >
            {t('emailDraft.dismiss')}
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <label
            htmlFor="email-draft-tone"
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            {t('emailDraft.toneLabel')}
          </label>
          <Select
            id="email-draft-tone"
            data-testid="email-draft-tone-select"
            value={tone}
            disabled={regenerateMutation.isPending}
            onChange={(e) => handleToneChange(e.target.value as EmailDraftTone)}
            className="mb-4"
          >
            {EMAIL_DRAFT_TONES.map((toneOption) => (
              <option key={toneOption} value={toneOption}>
                {t(`emailDraft.${TONE_KEY_MAP[toneOption]}`)}
              </option>
            ))}
          </Select>

          {regenerateMutation.isError && (
            <p role="alert" className="mb-4 text-xs text-red-600" data-testid="email-draft-error">
              {resolveApiError(regenerateMutation.error, t)}
            </p>
          )}

          {regenerateMutation.isPending ? (
            <div className="space-y-2" aria-hidden="true">
              <div className="h-4 w-1/2 bg-gray-100 rounded animate-pulse" />
              <div className="h-24 w-full bg-gray-100 rounded animate-pulse" />
            </div>
          ) : (
            <>
              <label
                htmlFor="email-draft-subject"
                className="block text-xs font-medium text-gray-700 mb-1"
              >
                {t('emailDraft.subjectLabel')}
              </label>
              <input
                id="email-draft-subject"
                type="text"
                data-testid="email-draft-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900
                         focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 mb-4"
              />

              <label
                htmlFor="email-draft-body"
                className="block text-xs font-medium text-gray-700 mb-1"
              >
                {t('emailDraft.bodyLabel')}
              </label>
              <textarea
                id="email-draft-body"
                data-testid="email-draft-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={14}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900
                         focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
              />
            </>
          )}

          {copyError && (
            <p
              role="alert"
              className="mt-3 text-xs text-red-600"
              data-testid="email-draft-copy-error"
            >
              {copyError}
            </p>
          )}
        </div>

        <footer className="border-t border-gray-200 px-5 py-4 shrink-0">
          <Button
            type="button"
            variant="primary"
            size="sm"
            data-testid="email-draft-copy-button"
            onClick={handleCopyToClipboard}
            disabled={regenerateMutation.isPending}
          >
            {copySuccess ? t('emailDraft.copied') : t('emailDraft.copyToClipboard')}
          </Button>
        </footer>
      </div>
    </div>
  );
}
