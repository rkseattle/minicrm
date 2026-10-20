/**
 * EmailComposer — compose a new message, or reply, through one of the user's mailboxes,
 * filed against the record it was opened from.
 *
 * Sends through useMailboxSend, so a retry never mails a recipient twice and a send that
 * may have gone freezes the form.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import type { ConnectedAccountResponse } from '@shared/schemas/connectedAccountSchema.js';
import {
  EMAIL_SEND_SUBJECT_MAX,
  type EmailLinkRecordType,
  type EmailMessage,
  type SendEmailInput,
} from '@shared/schemas/emailMessageSchema.js';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { Select } from '@/components/ui/Select.js';
import { Textarea } from '@/components/ui/Textarea.js';
import { CLOSE_AFTER_SENT_MS, useMailboxSend } from '@/hooks/useMailboxSend.js';
import { parseRecipients, replyRecipients, replySubject } from '@/utils/emailCompose.js';
import { resolveApiError } from '@/utils/apiError.js';
import { keepTabInside } from '@/utils/focusTrap.js';
import { plainTextToHtml } from '@/utils/plainTextToHtml.js';

/** What the composer was opened to do. */
export type ComposeMode =
  { kind: 'new'; defaultTo?: string } | { kind: 'reply'; message: EmailMessage; mailboxId: string };

interface EmailComposerProps {
  mode: ComposeMode;
  recordType: EmailLinkRecordType;
  recordId: string;
  /** The user's active mailboxes that can send. A reply uses its thread's mailbox only. */
  mailboxes: readonly ConnectedAccountResponse[];
  onClose: () => void;
}

export default function EmailComposer({
  mode,
  recordType,
  recordId,
  mailboxes,
  onClose,
}: EmailComposerProps) {
  const { t } = useTranslation();
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const mailboxSend = useMailboxSend();
  const { frozen } = mailboxSend;

  const isReply = mode.kind === 'reply';
  const [mailboxId, setMailboxId] = useState(isReply ? mode.mailboxId : (mailboxes[0]?.id ?? ''));
  const [to, setTo] = useState(
    isReply ? replyRecipients(mode.message).join(', ') : (mode.defaultTo ?? ''),
  );
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState(isReply ? replySubject(mode.message.subject) : '');
  const [body, setBody] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Recipients are checked when a field is left, not on each half-typed keystroke.
  const [toChecked, setToChecked] = useState(false);
  const [ccChecked, setCcChecked] = useState(false);

  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Safe: activeElement is an Element; only focus(), which HTMLElement adds, is called on it.
    const opener = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => firstFieldRef.current?.focus());
    return () => {
      // A confirmation timer must not outlive this composer and close the next one.
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      opener?.focus();
    };
  }, []);

  function finishSent(message: string): void {
    setSuccessMessage(message);
    setErrorMessage(null);
    mailboxSend.refreshMail();
    closeTimerRef.current = setTimeout(onClose, CLOSE_AFTER_SENT_MS);
  }

  const toList = parseRecipients(to);
  const ccList = parseRecipients(cc);

  function currentRequest(): { input: SendEmailInput; mailbox: string | undefined } {
    return {
      input: {
        connected_account_id: mailboxId,
        // Never null here: Send is disabled while either list is unreadable.
        to: toList ?? [],
        cc: ccList ?? [],
        subject,
        body_html: plainTextToHtml(body),
        record_type: recordType,
        record_id: recordId,
        ...(isReply ? { in_reply_to_message_id: mode.message.id } : {}),
      },
      mailbox: mailboxes.find((candidate) => candidate.id === mailboxId)?.email_address,
    };
  }

  const sendMutation = useMutation({
    mutationFn: () => mailboxSend.send(currentRequest),
    onSuccess: ({ mailbox }) => finishSent(t('emails.composer.sent', { mailbox })),
    onError: (error: unknown) => {
      const failure = mailboxSend.settleFailure(error);
      if (failure.kind === 'went') {
        finishSent(t(`errors.${failure.code}`));
        return;
      }
      setErrorMessage(resolveApiError(error, t));
    },
  });

  const sent = successMessage !== null;
  // Once sent, an edit plus a click would be a new key: a second real send.
  const inputsDisabled = sendMutation.isPending || frozen || sent;
  // A frozen compose always has its stored request to resend, whatever the form now shows.
  const canSubmit =
    !sent &&
    (frozen ||
      (mailboxId !== '' &&
        toList !== null &&
        toList.length > 0 &&
        ccList !== null &&
        subject.trim() !== '' &&
        body.trim() !== ''));

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape' && !sendMutation.isPending) onClose();
    keepTabInside(e, dialogRef.current);
  }

  const titleId = 'email-composer-title';
  const recipientsInvalid = t('emails.composer.recipientsInvalid');

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="email-composer"
      onClick={sendMutation.isPending ? undefined : onClose}
      onKeyDown={handleKeyDown}
    >
      <dialog
        ref={dialogRef}
        open
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-lg mx-4 p-0"
      >
        <div
          role="presentation"
          className="rounded-lg bg-white p-6 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id={titleId} className="text-base font-semibold text-gray-900 mb-4">
            {t(isReply ? 'emails.composer.replyTitle' : 'emails.composer.newTitle')}
          </h2>

          <div className="mb-4">
            <Select
              id="email-composer-from"
              label={t('emails.composer.from')}
              value={mailboxId}
              onChange={(e) => setMailboxId(e.target.value)}
              // A reply must go from the mailbox that holds the conversation.
              disabled={inputsDisabled || isReply}
              data-testid="email-composer-from"
            >
              {mailboxes.map((mailbox) => (
                <option key={mailbox.id} value={mailbox.id}>
                  {mailbox.email_address}
                </option>
              ))}
            </Select>
          </div>

          <div className="mb-4">
            <Input
              id="email-composer-to"
              ref={firstFieldRef}
              type="text"
              label={t('emails.composer.to')}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              onBlur={() => setToChecked(true)}
              disabled={inputsDisabled}
              data-testid="email-composer-to"
              aria-describedby="email-composer-recipients-hint"
              error={toChecked && toList === null ? recipientsInvalid : undefined}
            />
            <p id="email-composer-recipients-hint" className="mt-1 text-xs text-gray-500">
              {t('emails.composer.recipientsHint')}
            </p>
          </div>

          <div className="mb-4">
            <Input
              id="email-composer-cc"
              type="text"
              label={t('emails.composer.cc')}
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              onBlur={() => setCcChecked(true)}
              disabled={inputsDisabled}
              data-testid="email-composer-cc"
              aria-describedby="email-composer-recipients-hint"
              error={ccChecked && ccList === null ? recipientsInvalid : undefined}
            />
          </div>

          <div className="mb-4">
            <Input
              id="email-composer-subject"
              type="text"
              label={t('emails.composer.subject')}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={inputsDisabled}
              maxLength={EMAIL_SEND_SUBJECT_MAX}
              data-testid="email-composer-subject"
            />
          </div>

          <div className="mb-5">
            <Textarea
              id="email-composer-body"
              label={t('emails.composer.body')}
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={inputsDisabled}
              data-testid="email-composer-body"
            />
          </div>

          {successMessage && (
            <p
              role="status"
              data-testid="email-composer-success"
              className="mb-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2"
            >
              {successMessage}
            </p>
          )}

          {errorMessage && (
            <p
              role="alert"
              data-testid="email-composer-error"
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
              data-testid="email-composer-send"
              onClick={() => {
                setErrorMessage(null);
                sendMutation.mutate();
              }}
              disabled={sendMutation.isPending || !canSubmit}
            >
              {sendMutation.isPending ? t('emails.composer.sending') : t('emails.composer.send')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              data-testid="email-composer-cancel"
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
