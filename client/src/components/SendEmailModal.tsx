/**
 * SendEmailModal — compose and send an outbound email to a contact.
 * Accessible dialog: Tab stays inside it, and Escape dismisses it.
 *
 * Sends through the org's SMTP by default, or through one of the user's connected
 * mailboxes when they pick one; only a mailbox can send a template.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveApiError } from '@/utils/apiError.js';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Capability } from '@shared/schemas/capabilitySchema.js';
import {
  capabilitiesToSendFrom,
  EMAIL_SEND_SUBJECT_MAX,
  type SendEmailInput,
} from '@shared/schemas/emailMessageSchema.js';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { Select } from '@/components/ui/Select.js';
import { Textarea } from '@/components/ui/Textarea.js';
import { sendContactEmail } from '@/api/contacts.js';
import { CONNECTED_ACCOUNTS_QUERY_KEY, getConnectedAccounts } from '@/api/connectedAccounts.js';
import { EMAIL_TEMPLATES_QUERY_KEY, listEmailTemplates } from '@/api/emailTemplates.js';
import { useFeatureFlag } from '@/hooks/useFeatureFlag.js';
import { useFocusTrap } from '@/hooks/useFocusTrap.js';
import { CLOSE_AFTER_SENT_MS, useMailboxSend } from '@/hooks/useMailboxSend.js';
import { usePermissions } from '@/hooks/usePermissions.js';
import { plainTextToHtml } from '@/utils/plainTextToHtml.js';
import { sanitizeEmailHtml } from '@/utils/sanitizeEmailHtml.js';

/** The selector value for the org's own SMTP, which every user has. */
const ORG_SMTP = 'org';

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
  const subjectRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mailboxSend = useMailboxSend();
  const { frozen, reset: resetMailboxSend } = mailboxSend;

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sendAs, setSendAs] = useState(ORG_SMTP);
  const [templateId, setTemplateId] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { enabled: emailSyncEnabled } = useFeatureFlag('email_sync');
  const { can } = usePermissions();
  // Sending through a mailbox files the message on the contact, which needs those writes too.
  const mailboxesAvailable =
    emailSyncEnabled &&
    can(Capability.ConnectedAccountsManage) &&
    capabilitiesToSendFrom('contact').every((capability) => can(capability));

  const {
    data: accountsData,
    isLoading: accountsLoading,
    isError: accountsFailed,
  } = useQuery({
    queryKey: CONNECTED_ACCOUNTS_QUERY_KEY,
    queryFn: getConnectedAccounts,
    enabled: isOpen && mailboxesAvailable,
  });
  // Gated on availability, not just the query: a disabled query still returns cached data.
  const sendableAccounts = useMemo(
    () =>
      mailboxesAvailable
        ? (accountsData?.accounts ?? []).filter(
            (account) => account.status === 'active' && account.can_send,
          )
        : [],
    [accountsData, mailboxesAvailable],
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

  // A confirmation timer must not outlive its compose: cleared on close and on unmount.
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
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
        resetMailboxSend();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen, resetMailboxSend]);

  function finishSent(message: string, throughMailbox: boolean): void {
    setSuccessMessage(message);
    setErrorMessage(null);
    if (throughMailbox) mailboxSend.refreshMail();
    onSent();
    // Close after a brief pause so the user sees the confirmation
    closeTimerRef.current = setTimeout(onClose, CLOSE_AFTER_SENT_MS);
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

  /** Sends through a connected mailbox; a frozen compose resends its stored request. */
  async function sendFromMailbox(): Promise<SentOutcome> {
    const { response, mailbox } = await mailboxSend.send(() => ({
      input: currentMailboxInput(),
      mailbox: sendableAccounts.find((account) => account.id === effectiveSendAs)?.email_address,
    }));
    const unresolved = response.unresolved_merge_tags;
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
    onError: (error: unknown) => {
      if (fromMailbox || frozen) {
        const failure = mailboxSend.settleFailure(error);
        if (failure.kind === 'went') {
          finishSent(t(`errors.${failure.code}`), true);
          return;
        }
      }
      setErrorMessage(resolveApiError(error, t));
    },
  });

  useFocusTrap(dialogRef, isOpen);

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
  // Once sent, an edit plus a click would be a new key: a second real send.
  const inputsDisabled = sendMutation.isPending || frozen || successMessage !== null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="send-email-modal"
      onClick={sendMutation.isPending ? undefined : onClose}
      onKeyDown={handleKeyDown}
    >
      <dialog
        ref={dialogRef}
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
          {mailboxesAvailable && accountsFailed && (
            <p data-testid="send-email-accounts-error" className="mb-4 text-sm text-amber-700">
              {t('contacts.sendEmail.accountsLoadError')}
            </p>
          )}

          {/* Send as — only when the user has a mailbox that can send */}
          {sendableAccounts.length > 0 && (
            <div className="mb-4">
              <Select
                id="send-email-from"
                label={t('contacts.sendEmail.sendAsLabel')}
                value={effectiveSendAs}
                onChange={(e) => handleSendAsChange(e.target.value)}
                disabled={inputsDisabled}
                data-testid="send-email-from"
              >
                <option value={ORG_SMTP}>{t('contacts.sendEmail.sendAsOrg')}</option>
                {sendableAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.email_address}
                  </option>
                ))}
              </Select>
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
              <Select
                id="send-email-template"
                label={t('contacts.sendEmail.templateLabel')}
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                disabled={inputsDisabled}
                data-testid="send-email-template"
              >
                <option value="">{t('contacts.sendEmail.templateNone')}</option>
                {templates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </Select>
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
            <Input
              id="send-email-to"
              type="email"
              label={t('contacts.sendEmail.toLabel')}
              readOnly
              value={contactEmail}
              data-testid="send-email-to"
              className="bg-gray-50 text-gray-600 cursor-default"
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
                <Input
                  id="send-email-subject"
                  ref={subjectRef}
                  type="text"
                  label={t('contacts.sendEmail.subjectLabel')}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={inputsDisabled}
                  data-testid="send-email-subject"
                  maxLength={EMAIL_SEND_SUBJECT_MAX}
                  placeholder={t('contacts.sendEmail.subjectPlaceholder')}
                />
              </div>

              {/* Body */}
              <div className="mb-5">
                <Textarea
                  id="send-email-body"
                  label={t('contacts.sendEmail.bodyLabel')}
                  rows={4}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={inputsDisabled}
                  data-testid="send-email-body"
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
              disabled={sendMutation.isPending || !canSubmit || successMessage !== null}
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
