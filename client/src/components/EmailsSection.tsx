/**
 * EmailsSection — the mail linked to a record, as threads, on its detail page.
 *
 * Hidden outright when email sync is off, when the user cannot manage mailboxes (the list
 * endpoint refuses them at its router), and when the list answers 403: a lead's mail is
 * readable only by its owner and admins, and an error panel would only announce that mail
 * the reader may not see exists.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { Capability } from '@shared/schemas/capabilitySchema.js';
import {
  capabilitiesToSendFrom,
  type EmailLinkRecordType,
  type EmailMessage,
  type EmailThread,
} from '@shared/schemas/emailMessageSchema.js';
import { CONNECTED_ACCOUNTS_QUERY_KEY, getConnectedAccounts } from '@/api/connectedAccounts.js';
import {
  EMAIL_MESSAGE_BODY_QUERY_KEY,
  EMAIL_MESSAGES_QUERY_KEY,
  getEmailMessage,
  listRecordEmailThreads,
  setThreadPrivacy,
} from '@/api/emailMessages.js';
import EmailBodyFrame from '@/components/EmailBodyFrame.js';
import EmailComposer, { type ComposeMode } from '@/components/EmailComposer.js';
import { Button } from '@/components/ui/Button.js';
import { Pagination } from '@/components/ui/Pagination.js';
import { useFeatureFlag } from '@/hooks/useFeatureFlag.js';
import { usePermissions } from '@/hooks/usePermissions.js';
import { formatLocalDate, formatLocalDateTime } from '@/utils/formatLocalDate.js';

/** Threads per page in a sidebar section. */
const THREADS_PER_PAGE = 10;

/** Participants a collapsed row names before summarizing the rest. */
const PARTICIPANTS_SHOWN = 3;

const HTTP_FORBIDDEN = 403;

/** FNV-1a's 32-bit offset basis and prime. */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

interface EmailsSectionProps {
  recordType: EmailLinkRecordType;
  recordId: string;
  /** The record's own address, offered as a new message's recipient. */
  defaultRecipient?: string;
}

/** A thread's identity: provider thread ids are unique only within a mailbox. */
function threadKey(thread: EmailThread): string {
  return `${thread.connected_account_id}:${thread.thread_id}`;
}

/**
 * A thread's identity as a DOM-safe token, for ids and test ids. Built from the same pair as
 * `threadKey`: an IMAP thread id is its root Message-ID, so two mailboxes on one conversation
 * share it, and a stored id may hold characters an id attribute should not.
 */
export function threadDomId(thread: EmailThread): string {
  // FNV-1a, 32-bit: stable and short; a collision needs two threads in one mailbox.
  let hash = FNV_OFFSET_BASIS;
  for (const character of thread.thread_id) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return `${thread.connected_account_id}-${hash.toString(16)}`;
}

/** Messages oldest first, so a conversation reads top to bottom. */
function inOrder(thread: EmailThread): EmailMessage[] {
  return [...thread.messages].sort((a, b) => (a.sent_at ?? '').localeCompare(b.sent_at ?? ''));
}

/** Everyone a thread involves, in the order they first appear. */
function participantsOf(messages: readonly EmailMessage[]): string[] {
  const seen = new Set<string>();
  for (const message of messages) {
    for (const address of [
      message.from_address,
      ...message.to_addresses,
      ...message.cc_addresses,
    ]) {
      seen.add(address);
    }
  }
  return [...seen];
}

function DirectionBadge({ direction }: { direction: EmailMessage['direction'] }) {
  const { t } = useTranslation();
  const outbound = direction === 'outbound';
  return (
    <span
      data-testid={`email-direction-${direction}`}
      className={`inline-flex shrink-0 items-center rounded-sm px-1.5 py-0.5 text-xs font-medium ${
        outbound ? 'bg-primary-50 text-primary-700' : 'bg-gray-100 text-gray-700'
      }`}
    >
      {t(outbound ? 'emails.directionOut' : 'emails.directionIn')}
    </span>
  );
}

/** Marks a thread only its mailbox's owner can read; text, not color alone, carries it. */
function PrivateBadge({ domId }: { domId: string }) {
  const { t } = useTranslation();
  return (
    <span
      data-testid={`email-thread-private-${domId}`}
      className="inline-flex shrink-0 items-center rounded-sm bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800"
    >
      {t('emails.private')}
    </span>
  );
}

/** One message's body, read only once the reader opens that message. */
function MessageBody({ message, allowImages }: { message: EmailMessage; allowImages: boolean }) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: [...EMAIL_MESSAGE_BODY_QUERY_KEY, message.id],
    queryFn: () => getEmailMessage(message.id),
  });

  if (isLoading) {
    return (
      <p className="text-sm text-gray-500" data-testid={`email-body-loading-${message.id}`}>
        {t('emails.bodyLoading')}
      </p>
    );
  }
  if (isError || !data) {
    return (
      <p className="text-sm text-red-600" data-testid={`email-body-error-${message.id}`}>
        {t('emails.bodyLoadError')}
      </p>
    );
  }
  if (data.body_html) {
    return (
      <EmailBodyFrame
        html={data.body_html}
        allowImages={allowImages}
        title={message.subject ?? t('emails.noSubject')}
      />
    );
  }
  return (
    <p
      className="text-sm text-gray-700 whitespace-pre-wrap wrap-break-word"
      data-testid={`email-body-text-${message.id}`}
    >
      {data.body_text ?? message.snippet ?? ''}
    </p>
  );
}

export default function EmailsSection({
  recordType,
  recordId,
  defaultRecipient,
}: EmailsSectionProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [privacyFailedKey, setPrivacyFailedKey] = useState<string | null>(null);
  const privacyMutation = useMutation({
    mutationFn: ({
      messageId,
      isPrivate,
    }: {
      messageId: string;
      isPrivate: boolean;
      key: string;
    }) => setThreadPrivacy(messageId, isPrivate),
    onMutate: () => setPrivacyFailedKey(null),
    onError: (_err, { key }) => setPrivacyFailedKey(key),
    onSettled: () => queryClient.invalidateQueries({ queryKey: EMAIL_MESSAGES_QUERY_KEY }),
  });
  const { enabled: emailSyncEnabled } = useFeatureFlag('email_sync');
  const { can } = usePermissions();
  const visible = emailSyncEnabled && can(Capability.ConnectedAccountsManage);

  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [imagesShown, setImagesShown] = useState<ReadonlySet<string>>(new Set());
  // Messages the reader toggled. A thread opens on its latest message, as Gmail and Outlook do,
  // so toggling the latest closes it and toggling any other opens it.
  const [toggledMessages, setToggledMessages] = useState<ReadonlySet<string>>(new Set());
  const [compose, setCompose] = useState<ComposeMode | null>(null);

  const threads = useQuery({
    queryKey: [...EMAIL_MESSAGES_QUERY_KEY, recordType, recordId, page],
    queryFn: () => listRecordEmailThreads({ recordType, recordId, page, limit: THREADS_PER_PAGE }),
    enabled: visible,
  });
  const accounts = useQuery({
    queryKey: CONNECTED_ACCOUNTS_QUERY_KEY,
    queryFn: getConnectedAccounts,
    enabled: visible,
  });
  const sendable = (accounts.data?.accounts ?? []).filter(
    (account) => account.status === 'active' && account.can_send,
  );

  // Safe: any error shape; only the optional response status is read.
  const forbidden = (threads.error as AxiosError | null)?.response?.status === HTTP_FORBIDDEN;
  if (!visible || forbidden) return null;

  function toggle(set: ReadonlySet<string>, key: string): Set<string> {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  }

  /** Arrow keys move between thread rows; Home and End jump to the first and last. */
  function handleRowKeyDown(e: React.KeyboardEvent<HTMLButtonElement>): void {
    const list = e.currentTarget.closest('ul');
    if (!list) return;
    const rows = [...list.querySelectorAll<HTMLButtonElement>('[data-thread-row]')];
    const index = rows.indexOf(e.currentTarget);
    const target =
      e.key === 'ArrowDown'
        ? rows[Math.min(index + 1, rows.length - 1)]
        : e.key === 'ArrowUp'
          ? rows[Math.max(index - 1, 0)]
          : e.key === 'Home'
            ? rows[0]
            : e.key === 'End'
              ? rows[rows.length - 1]
              : undefined;
    if (!target) return;
    e.preventDefault();
    target.focus();
  }

  // The server refuses a send from a record the user may not file mail on or log activity to.
  const maySendHere = capabilitiesToSendFrom(recordType).every((capability) => can(capability));
  // Only a loaded list proves the user has no mailbox; loading or failed proves nothing.
  const noMailbox = accounts.isSuccess && sendable.length === 0;
  const composeBlockedReason = !maySendHere
    ? t('emails.noPermissionTooltip')
    : noMailbox
      ? t('emails.noMailboxTooltip')
      : null;

  /** Why a thread's Reply is disabled, or undefined when it is enabled or still loading. */
  const replyBlockedReason = (canReply: boolean): string | undefined =>
    !maySendHere
      ? t('emails.noPermissionTooltip')
      : canReply || !accounts.isSuccess
        ? undefined
        : t('emails.replyUnavailable');

  return (
    <section
      className="mt-8 bg-white shadow-xs rounded-lg border border-gray-200 p-6"
      data-testid="emails-section"
      aria-labelledby="emails-section-title"
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 id="emails-section-title" className="text-lg font-semibold text-gray-900">
          {t('emails.sectionTitle')}
        </h2>
        <span title={composeBlockedReason ?? undefined}>
          <Button
            type="button"
            size="sm"
            data-testid="emails-compose"
            disabled={!maySendHere || sendable.length === 0}
            aria-describedby={composeBlockedReason ? 'emails-compose-blocked' : undefined}
            onClick={() => setCompose({ kind: 'new', defaultTo: defaultRecipient })}
          >
            {t('emails.compose')}
          </Button>
        </span>
      </div>
      {composeBlockedReason && (
        <p id="emails-compose-blocked" className="sr-only">
          {composeBlockedReason}
        </p>
      )}
      {accounts.isError && (
        <p className="mb-4 text-sm text-amber-700" data-testid="emails-accounts-error">
          {t('emails.accountsLoadError')}
        </p>
      )}

      {threads.isLoading && (
        <div className="space-y-2" data-testid="emails-loading" aria-hidden="true">
          <div className="h-12 bg-gray-100 rounded-sm animate-pulse" />
          <div className="h-12 bg-gray-100 rounded-sm animate-pulse" />
        </div>
      )}

      {threads.isError && (
        <p className="text-sm text-red-600" data-testid="emails-error">
          {t('emails.loadError')}
        </p>
      )}

      {threads.isSuccess && threads.data.data.length === 0 && page === 1 && (
        <p className="text-sm text-gray-500" data-testid="emails-empty">
          {t('emails.empty')}
        </p>
      )}
      {/* A page past the end, after mail was unlinked or removed: offer the way back. */}
      {threads.isSuccess && threads.data.data.length === 0 && page > 1 && (
        <Pagination
          page={page}
          limit={THREADS_PER_PAGE}
          total={threads.data.total}
          onPageChange={setPage}
        />
      )}

      {threads.isSuccess && threads.data.data.length > 0 && (
        <>
          <ul className="divide-y divide-gray-100" data-testid="emails-thread-list">
            {threads.data.data.map((thread) => {
              const key = threadKey(thread);
              const domId = threadDomId(thread);
              const messages = inOrder(thread);
              // Safe: the API never returns a thread without a message.
              const latest = messages[messages.length - 1]!;
              const participants = participantsOf(messages);
              const isOpen = expanded.has(key);
              const threadPrivate = messages.some((message) => message.is_private);
              const canReply =
                maySendHere &&
                sendable.some((account) => account.id === thread.connected_account_id);
              return (
                <li key={key} data-testid={`email-thread-${domId}`}>
                  <button
                    type="button"
                    data-thread-row
                    onKeyDown={handleRowKeyDown}
                    aria-expanded={isOpen}
                    aria-controls={isOpen ? `email-thread-body-${domId}` : undefined}
                    onClick={() => setExpanded((current) => toggle(current, key))}
                    data-testid={`email-thread-row-${domId}`}
                    className="w-full py-3 text-start focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 rounded-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <DirectionBadge direction={latest.direction} />
                      {threadPrivate && <PrivateBadge domId={domId} />}
                      <span
                        className="text-sm text-gray-600 truncate min-w-0"
                        data-testid="email-thread-participants"
                      >
                        {participants.slice(0, PARTICIPANTS_SHOWN).join(', ')}
                        {participants.length > PARTICIPANTS_SHOWN &&
                          ` ${t('emails.participantsMore', { count: participants.length - PARTICIPANTS_SHOWN })}`}
                      </span>
                      <span
                        className="ms-auto shrink-0 text-xs text-gray-500"
                        data-testid="email-thread-date"
                      >
                        {formatLocalDate(latest.sent_at, i18n.language)}
                      </span>
                    </div>
                    <p
                      className="mt-1 text-sm font-medium text-gray-900 wrap-break-word"
                      data-testid="email-thread-subject"
                    >
                      {latest.subject ?? t('emails.noSubject')}
                    </p>
                    {latest.snippet && (
                      <p
                        className="mt-0.5 text-sm text-gray-500 truncate"
                        data-testid="email-thread-snippet"
                      >
                        {latest.snippet}
                      </p>
                    )}
                  </button>

                  {isOpen && (
                    <div id={`email-thread-body-${domId}`} className="pb-4 space-y-4">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <p
                          id={`email-thread-privacy-hint-${domId}`}
                          className="me-auto text-xs text-gray-500"
                          data-testid={`email-thread-privacy-hint-${domId}`}
                        >
                          {t(threadPrivate ? 'emails.makeVisibleHint' : 'emails.markPrivateHint')}
                        </p>
                        {privacyFailedKey === key && (
                          <p
                            role="alert"
                            className="me-auto text-xs text-red-600"
                            data-testid={`email-thread-privacy-error-${domId}`}
                          >
                            {t('emails.privacyError')}
                          </p>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-describedby={`email-thread-privacy-hint-${domId}`}
                          disabled={privacyMutation.isPending}
                          data-testid={`email-thread-privacy-${domId}`}
                          onClick={() =>
                            privacyMutation.mutate({
                              messageId: latest.id,
                              isPrivate: !threadPrivate,
                              key,
                            })
                          }
                        >
                          {t(threadPrivate ? 'emails.makeVisible' : 'emails.markPrivate')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-testid={`email-thread-show-images-${domId}`}
                          disabled={imagesShown.has(key)}
                          onClick={() => setImagesShown((current) => toggle(current, key))}
                        >
                          {t(imagesShown.has(key) ? 'emails.imagesShown' : 'emails.showImages')}
                        </Button>
                      </div>
                      {messages.map((message) => {
                        const messageOpen =
                          toggledMessages.has(message.id) !== (message === latest);
                        return (
                          <article
                            key={message.id}
                            className="rounded-sm border border-gray-100 p-3"
                            data-testid={`email-message-${message.id}`}
                          >
                            <button
                              type="button"
                              aria-expanded={messageOpen}
                              aria-controls={
                                messageOpen ? `email-message-body-${message.id}` : undefined
                              }
                              onClick={() =>
                                setToggledMessages((current) => toggle(current, message.id))
                              }
                              data-testid={`email-message-toggle-${message.id}`}
                              className="flex w-full items-center gap-2 min-w-0 text-start rounded-sm focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500"
                            >
                              <DirectionBadge direction={message.direction} />
                              <span className="text-sm text-gray-700 truncate min-w-0">
                                {message.from_address}
                              </span>
                              <span className="ms-auto shrink-0 text-xs text-gray-500">
                                {formatLocalDateTime(message.sent_at, i18n.language)}
                              </span>
                            </button>
                            {messageOpen ? (
                              <div id={`email-message-body-${message.id}`} className="mt-2">
                                <MessageBody message={message} allowImages={imagesShown.has(key)} />
                                <div className="mt-2" title={replyBlockedReason(canReply)}>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    data-testid={`email-reply-${message.id}`}
                                    disabled={!canReply}
                                    aria-describedby={
                                      replyBlockedReason(canReply)
                                        ? `email-reply-blocked-${message.id}`
                                        : undefined
                                    }
                                    onClick={() =>
                                      setCompose({
                                        kind: 'reply',
                                        message,
                                        mailboxId: thread.connected_account_id,
                                      })
                                    }
                                  >
                                    {t('emails.reply')}
                                  </Button>
                                  {replyBlockedReason(canReply) && (
                                    <p id={`email-reply-blocked-${message.id}`} className="sr-only">
                                      {replyBlockedReason(canReply)}
                                    </p>
                                  )}
                                </div>
                              </div>
                            ) : (
                              message.snippet && (
                                <p
                                  className="mt-1 text-sm text-gray-500 truncate"
                                  data-testid={`email-message-snippet-${message.id}`}
                                >
                                  {message.snippet}
                                </p>
                              )
                            )}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <Pagination
            page={page}
            limit={THREADS_PER_PAGE}
            total={threads.data.total}
            onPageChange={setPage}
          />
        </>
      )}

      {compose && (
        <EmailComposer
          mode={compose}
          recordType={recordType}
          recordId={recordId}
          mailboxes={
            compose.kind === 'reply'
              ? sendable.filter((account) => account.id === compose.mailboxId)
              : sendable
          }
          onClose={() => setCompose(null)}
        />
      )}
    </section>
  );
}
