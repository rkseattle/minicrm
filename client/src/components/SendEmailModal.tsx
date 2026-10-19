/**
 * SendEmailModal — compose and send an outbound email to a contact.
 * Accessible dialog with focus trap and Escape dismissal.
 *
 * Sends through the org's SMTP by default, or through one of the user's connected
 * mailboxes when they pick one; only a mailbox can send a template.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AxiosError } from 'axios';
import { resolveApiError } from '@/utils/apiError.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Capability } from '@shared/schemas/capabilitySchema.js';
import type { SendEmailInput } from '@shared/schemas/emailMessageSchema.js';
import { Button } from '@/components/ui/Button.js';
import { sendContactEmail } from '@/api/contacts.js';
import { CONNECTED_ACCOUNTS_QUERY_KEY, getConnectedAccounts } from '@/api/connectedAccounts.js';
import { EMAIL_MESSAGES_QUERY_KEY, sendEmailMessage } from '@/api/emailMessages.js';
import { EMAIL_TEMPLATES_QUERY_KEY, listEmailTemplates } from '@/api/emailTemplates.js';
import { useFeatureFlag } from '@/hooks/useFeatureFlag.js';
import { usePermissions } from '@/hooks/usePermissions.js';
import { newIdempotencyKey } from '@/utils/idempotencyKey.js';
import { plainTextToHtml } from '@/utils/plainTextToHtml.js';
import { sanitizeEmailHtml } from '@/utils/sanitizeEmailHtml.js';

/** The selector value for the org's own SMTP, which every user has. */
const ORG_SMTP = 'org';

/** How long the confirmation shows before the modal closes. */
const CLOSE_AFTER_SENT_MS = 1500;

/** Codes that mean the message went, though the request did not succeed as asked. */
const WENT_ANYWAY = new Set(['SENT_NOT_RECORDED', 'SEND_ALREADY_SENT']);

/**
 * Refusals that say for certain nothing was sent. Any other failure — no response, a 5xx
 * without a code, a send still in flight, an unconfirmed outcome — may have mailed the
 * recipient, so the compose freezes: only a retry of the very same request, under the same
 * key, which the server answers from the first attempt.
 */
const DEFINITELY_NOT_SENT = new Set([
  'VALIDATION_ERROR',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_INVALID',
  'FORBIDDEN',
  'NOT_FOUND',
  'EMAIL_ACCOUNT_NOT_FOUND',
  'EMAIL_MESSAGE_NOT_FOUND',
  'TEMPLATE_NOT_FOUND',
  'PROVIDER_SEND_UNSUPPORTED',
  'PROVIDER_AUTH_EXPIRED',
  'RECONNECT_REQUIRED',
  'RATE_LIMITED',
  'SEND_FAILED',
]);

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

/** The outcome a send reports to the user. */
interface SentOutcome {
  message: string;
}

/** A template body's text, for a preview that never renders the sender's markup. */
function templatePreviewText(html: string): string {
  const parsed = new DOMParser().parseFromString(sanitizeEmailHtml(html), 'text/html');
  return parsed.body.textContent ?? '';
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
  const queryClient = useQueryClient();
  const subjectRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  // One idempotency key per compose: kept while the request is unchanged, so a retry never
  // sends twice, and replaced once the user edits, since an edited message is a new send.
  const attemptRef = useRef<{
    key: string;
    request: string;
    input: SendEmailInput;
    mailbox: string | undefined;
  } | null>(null);

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sendAs, setSendAs] = useState(ORG_SMTP);
  const [templateId, setTemplateId] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [frozen, setFrozen] = useState(false);

  const { enabled: emailSyncEnabled } = useFeatureFlag('email_sync');
  const { can } = usePermissions();
  const mailboxesAvailable = emailSyncEnabled && can(Capability.ConnectedAccountsManage);

  const {
    data: accountsData,
    isLoading: accountsLoading,
    isError: accountsFailed,
  } = useQuery({
    queryKey: CONNECTED_ACCOUNTS_QUERY_KEY,
    queryFn: getConnectedAccounts,
    enabled: isOpen && mailboxesAvailable,
  });
  const sendableAccounts = useMemo(
    () =>
      (accountsData?.accounts ?? []).filter(
        (account) => account.status === 'active' && account.can_send,
      ),
    [accountsData],
  );
  // A refetch can drop the chosen mailbox; fall back rather than send through a choice the
  // form no longer shows. A frozen compose is unaffected: it resends its stored request.
  const mailboxGone =
    accountsData !== undefined &&
    sendAs !== ORG_SMTP &&
    !sendableAccounts.some((account) => account.id === sendAs);
  const effectiveSendAs = mailboxGone ? ORG_SMTP : sendAs;
  const fromMailbox = effectiveSendAs !== ORG_SMTP;

  const {
    data: templatesData,
    isLoading: templatesLoading,
    isError: templatesFailed,
  } = useQuery({
    queryKey: EMAIL_TEMPLATES_QUERY_KEY,
    queryFn: listEmailTemplates,
    enabled: isOpen && fromMailbox,
  });
  const templates = templatesData?.data ?? [];
  // Looked up afresh each render, so a template a refetch dropped simply falls away.
  const template = fromMailbox
    ? templates.find((candidate) => candidate.id === templateId)
    : undefined;

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
        setSendAs(ORG_SMTP);
        setTemplateId('');
        setSuccessMessage(null);
        setErrorMessage(null);
        setFrozen(false);
        attemptRef.current = null;
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  function finishSent(message: string, throughMailbox: boolean): void {
    setSuccessMessage(message);
    setErrorMessage(null);
    if (throughMailbox) void queryClient.invalidateQueries({ queryKey: EMAIL_MESSAGES_QUERY_KEY });
    onSent();
    // Close after a brief pause so the user sees the confirmation
    setTimeout(() => {
      onClose();
    }, CLOSE_AFTER_SENT_MS);
  }

  /** The request this compose describes now, from what the form shows. */
  function currentMailboxInput(): SendEmailInput {
    return template
      ? {
          connected_account_id: effectiveSendAs,
          to: [contactEmail],
          cc: [],
          template_id: template.id,
          record_type: 'contact',
          record_id: contactId,
        }
      : {
          connected_account_id: effectiveSendAs,
          to: [contactEmail],
          cc: [],
          subject,
          body_html: plainTextToHtml(body),
          record_type: 'contact',
          record_id: contactId,
        };
  }

  /**
   * Sends through a connected mailbox under this compose's key. A frozen compose resends the
   * stored request itself, never one rebuilt from the form: a refetch can change what the
   * form shows, and a changed request would be a new send to a recipient who may already
   * have the first.
   */
  async function sendFromMailbox(): Promise<SentOutcome> {
    let attempt = attemptRef.current;
    if (!frozen || !attempt) {
      const input = currentMailboxInput();
      const request = JSON.stringify(input);
      if (attempt?.request !== request) {
        attempt = {
          key: newIdempotencyKey(),
          request,
          input,
          mailbox: sendableAccounts.find((account) => account.id === effectiveSendAs)
            ?.email_address,
        };
      }
      attemptRef.current = attempt;
    }
    const { mailbox } = attempt;
    const sent = await sendEmailMessage(attempt.input, attempt.key);
    const unresolved = sent.unresolved_merge_tags;
    return {
      message:
        unresolved.length > 0
          ? t('contacts.sendEmail.sentWithBlanks', { mailbox, tags: unresolved.join(', ') })
          : t('contacts.sendEmail.sentFromMailbox', { mailbox }),
    };
  }

  async function sendFromOrg(): Promise<SentOutcome> {
    const data = await sendContactEmail(contactId, subject, body);
    return {
      message: data.delivered
        ? t('contacts.sendEmail.successDelivered', { name: contactName })
        : t('contacts.sendEmail.successNotConfigured'),
    };
  }

  const sendMutation = useMutation({
    mutationFn: () => (fromMailbox || frozen ? sendFromMailbox() : sendFromOrg()),
    onSuccess: (outcome) => finishSent(outcome.message, fromMailbox || frozen),
    onError: (error: AxiosError<{ error?: { code?: string } }>) => {
      const code = error.response?.data?.error?.code;
      if (code && WENT_ANYWAY.has(code)) {
        finishSent(t(`errors.${code}`), true);
        return;
      }
      if (fromMailbox && !(code && DEFINITELY_NOT_SENT.has(code))) setFrozen(true);
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

  function handleSendAsChange(value: string): void {
    setSendAs(value);
    // A template renders only through a mailbox; org SMTP takes typed text alone.
    if (value === ORG_SMTP) setTemplateId('');
  }

  // A frozen compose always has its stored request to resend, whatever the form now shows.
  const canSubmit =
    frozen || template !== undefined || (subject.trim() !== '' && body.trim() !== '');
  const inputsDisabled = sendMutation.isPending || frozen;

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

          {accountsLoading && mailboxesAvailable && (
            <p data-testid="send-email-accounts-loading" className="mb-4 text-sm text-gray-500">
              {t('contacts.sendEmail.accountsLoading')}
            </p>
          )}
          {accountsFailed && (
            <p data-testid="send-email-accounts-error" className="mb-4 text-sm text-amber-700">
              {t('contacts.sendEmail.accountsLoadError')}
            </p>
          )}

          {/* Send as — only when the user has a mailbox that can send */}
          {sendableAccounts.length > 0 && (
            <div className="mb-4">
              <label
                htmlFor="send-email-from"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('contacts.sendEmail.sendAsLabel')}
              </label>
              <select
                id="send-email-from"
                value={effectiveSendAs}
                onChange={(e) => handleSendAsChange(e.target.value)}
                disabled={inputsDisabled}
                data-testid="send-email-from"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value={ORG_SMTP}>{t('contacts.sendEmail.sendAsOrg')}</option>
                {sendableAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.email_address}
                  </option>
                ))}
              </select>
            </div>
          )}

          {fromMailbox && templatesLoading && (
            <p data-testid="send-email-templates-loading" className="mb-4 text-sm text-gray-500">
              {t('contacts.sendEmail.templatesLoading')}
            </p>
          )}
          {fromMailbox && templatesFailed && (
            <p data-testid="send-email-templates-error" className="mb-4 text-sm text-amber-700">
              {t('contacts.sendEmail.templatesLoadError')}
            </p>
          )}

          {/* Template — only through a mailbox, which renders it against the contact */}
          {fromMailbox && templates.length > 0 && (
            <div className="mb-4">
              <label
                htmlFor="send-email-template"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('contacts.sendEmail.templateLabel')}
              </label>
              <select
                id="send-email-template"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                disabled={inputsDisabled}
                data-testid="send-email-template"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value="">{t('contacts.sendEmail.templateNone')}</option>
                {templates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
              {(templatesData?.total ?? 0) > templates.length && (
                <p
                  data-testid="send-email-templates-truncated"
                  className="mt-1 text-xs text-gray-500"
                >
                  {t('contacts.sendEmail.templatesTruncated', {
                    shown: templates.length,
                    total: templatesData?.total,
                  })}
                </p>
              )}
            </div>
          )}

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

          {template ? (
            <div className="mb-5" data-testid="send-email-template-preview">
              <p className="text-sm font-medium text-gray-700 mb-1">
                {t('contacts.sendEmail.templatePreviewLabel')}
              </p>
              <p className="text-sm font-semibold text-gray-900 break-words">{template.subject}</p>
              <p className="mt-1 text-sm text-gray-600 whitespace-pre-wrap break-words">
                {templatePreviewText(template.body)}
              </p>
            </div>
          ) : (
            <>
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
                  disabled={inputsDisabled}
                  data-testid="send-email-subject"
                  maxLength={255}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
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
                  disabled={inputsDisabled}
                  data-testid="send-email-body"
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 resize-y"
                  placeholder={t('contacts.sendEmail.bodyPlaceholder')}
                />
              </div>
            </>
          )}

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
              {frozen && (
                <span className="block mt-1">{t('contacts.sendEmail.composeFrozen')}</span>
              )}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button
              type="button"
              data-testid="send-email-submit"
              onClick={handleSend}
              disabled={sendMutation.isPending || !canSubmit}
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
