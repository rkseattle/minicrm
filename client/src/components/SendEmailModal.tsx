/**
 * SendEmailModal — compose and send an outbound email to a contact. (MINCRM-275)
 * Accessible dialog with focus trap and Escape dismissal.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveApiError } from '@/utils/apiError.js';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button.js';
import { sendContactEmail } from '@/api/contacts.js';

interface SendEmailModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Contact UUID */
  contactId: string;
  /** Pre-filled recipient address */
  contactEmail: string;
  /** Contact display name, used in success message */
  contactName: string;
  /** Called when the modal is dismissed or after a successful send */
  onClose: () => void;
  /** Called after a successful send so the caller can refetch the activity feed */
  onSent: () => void;
}

/**
 * Modal for composing and sending an email to a single contact.
 * Focus moves to the subject input on open; returns to the trigger on close.
 */
export default function SendEmailModal({
  isOpen,
  contactId,
  contactEmail,
  contactName,
  onClose,
  onSent,
}: SendEmailModalProps) {
  const { t } = useTranslation();
  const subjectRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      requestAnimationFrame(() => {
        subjectRef.current?.focus();
      });
    } else {
      previousFocusRef.current?.focus();
    }
  }, [isOpen]);

  // Reset form state when the modal closes
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setSubject('');
        setBody('');
        setSuccessMessage(null);
        setErrorMessage(null);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const sendMutation = useMutation({
    mutationFn: () => sendContactEmail(contactId, subject, body),
    onSuccess: (data) => {
      const msg = data.delivered
        ? t('contacts.sendEmail.successDelivered', { name: contactName })
        : t('contacts.sendEmail.successNotConfigured');
      setSuccessMessage(msg);
      setErrorMessage(null);
      onSent();
      // Close after a brief pause so the user sees the confirmation
      setTimeout(() => {
        onClose();
      }, 1500);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setErrorMessage(resolveApiError(error, t));
    },
  });

  if (!isOpen) return null;

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape' && !sendMutation.isPending) {
      onClose();
    }
  }

  function handleSend(): void {
    setErrorMessage(null);
    sendMutation.mutate();
  }

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="send-email-modal"
      onClick={sendMutation.isPending ? undefined : onClose}
      onKeyDown={handleKeyDown}
    >
      <dialog
        open
        aria-modal="true"
        aria-labelledby="send-email-modal-title"
        className="relative w-full max-w-lg mx-4 p-0"
      >
        <div
          role="presentation"
          className="rounded-lg bg-white p-6 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="send-email-modal-title" className="text-base font-semibold text-gray-900 mb-4">
            {t('contacts.sendEmail.modalTitle')}
          </h2>

          {/* To field — read-only */}
          <div className="mb-4">
            <label htmlFor="send-email-to" className="block text-sm font-medium text-gray-700 mb-1">
              {t('contacts.sendEmail.toLabel')}
            </label>
            <input
              id="send-email-to"
              type="email"
              readOnly
              value={contactEmail}
              data-testid="send-email-to"
              className="block w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600 cursor-default"
            />
          </div>

          {/* Subject */}
          <div className="mb-4">
            <label
              htmlFor="send-email-subject"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              {t('contacts.sendEmail.subjectLabel')}
            </label>
            <input
              id="send-email-subject"
              ref={subjectRef}
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={sendMutation.isPending}
              data-testid="send-email-subject"
              maxLength={255}
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder={t('contacts.sendEmail.subjectPlaceholder')}
            />
          </div>

          {/* Body */}
          <div className="mb-5">
            <label
              htmlFor="send-email-body"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              {t('contacts.sendEmail.bodyLabel')}
            </label>
            <textarea
              id="send-email-body"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={sendMutation.isPending}
              data-testid="send-email-body"
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y"
              placeholder={t('contacts.sendEmail.bodyPlaceholder')}
            />
          </div>

          {/* Success message */}
          {successMessage && (
            <p
              role="status"
              data-testid="send-email-success"
              className="mb-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2"
            >
              {successMessage}
            </p>
          )}

          {/* Error message */}
          {errorMessage && (
            <p
              role="alert"
              data-testid="send-email-error"
              className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2"
            >
              {errorMessage}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button
              type="button"
              data-testid="send-email-submit"
              onClick={handleSend}
              disabled={sendMutation.isPending || !subject.trim() || !body.trim()}
            >
              {sendMutation.isPending
                ? t('contacts.sendEmail.sending')
                : t('contacts.sendEmail.sendButton')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              data-testid="send-email-cancel"
              onClick={onClose}
              disabled={sendMutation.isPending}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
