/**
 * Sends a message through one of the caller's own connected mailboxes, then records it.
 *
 * The provider call comes first and the storage after it, in one transaction: the row's
 * `provider_message_id` does not exist until the provider answers. A crash between the two
 * loses the row, not the mail — the message is in the mailbox's Sent folder, and the sync
 * engine ingests it on its next tick.
 *
 * The stored row must read exactly as the sync engine will later derive it from the Sent
 * copy, because that re-read upserts onto it. So `from_address` is the bare mailbox address
 * `directionOf` compares against, and the body columns come from parsing the very document
 * that was sent.
 */

import type {
  EmailLinkRecordType,
  SendEmailInput,
  SendEmailResponse,
} from '@minicrm/shared/schemas/emailMessageSchema.js';
import {
  INSUFFICIENT_SCOPE,
  PROVIDER_AUTH_EXPIRED,
  type OAuthProvider,
} from '@minicrm/shared/schemas/connectedAccountSchema.js';

import { htmlToText } from 'html-to-text';

import pool from '../db.js';
import logger from '../logger.js';
import { announceActivityCreated, insertActivity } from './activityService.js';
import { writeAuditEntry, type AuditActor } from './auditService.js';
import {
  getConnectedAccountInternal,
  getUsableAccessToken,
  updateAccountStatus,
  type ConnectedAccountInternal,
} from './connectedAccountService.js';
import { clearDerivedLinkSuppression, matchMessagesToRecords } from './emailMatchingService.js';
import { MESSAGE_SELECT, toEmailMessage, type EmailMessageRow } from './emailMessageService.js';
import { escapeHtml } from './emailService.js';
import { findEmailTemplateById } from './emailTemplateService.js';
import { createGmailProvider } from './mail/gmailProvider.js';
import { createGraphProvider } from './mail/graphProvider.js';
import type { MailProvider, SentMessage } from './mail/mailProvider.js';
import {
  boundIndexedId,
  parseMessage,
  storedThreadingHeaders,
  truncate,
} from './mail/messageBody.js';
import {
  buildOutboundDocument,
  type OutboundDocument,
  type ParentMessage,
} from './mail/outboundMessage.js';
import { driverFetch } from './mail/transport.js';
import {
  isSendFailure,
  SEND_AUTH_EXPIRED,
  SEND_NOT_SENT,
  SEND_OUTCOME_UNKNOWN,
  SEND_RATE_LIMITED,
  SEND_SCOPE_MISSING,
} from './mail/sendOutcome.js';
import { renderTemplate, type MergeContext } from './mergeTagRenderer.js';
import { refreshAccessToken, type RefreshedTokens } from './oauthProviderService.js';
import { setRlsUserId, withRlsQuery } from './rlsContextService.js';
import { getDealAutoLink } from './settingsService.js';

/** The API's codes for a send that did not complete. The controller maps each to a status. */
export const EMAIL_ACCOUNT_NOT_FOUND = 'EMAIL_ACCOUNT_NOT_FOUND';
export const EMAIL_MESSAGE_NOT_FOUND = 'EMAIL_MESSAGE_NOT_FOUND';
export const TEMPLATE_NOT_FOUND = 'TEMPLATE_NOT_FOUND';
export const PROVIDER_SEND_UNSUPPORTED = 'PROVIDER_SEND_UNSUPPORTED';
export const SEND_FAILED = 'SEND_FAILED';
export const RATE_LIMITED = 'RATE_LIMITED';
export const RECONNECT_REQUIRED = 'RECONNECT_REQUIRED';
/** Sent, but not stored. Never to be retried: the recipient already has the message. */
export const SENT_NOT_RECORDED = 'SENT_NOT_RECORDED';

/** `activities.subject` is varchar(255); a template subject can render far longer. */
const ACTIVITY_SUBJECT_MAX = 255;

/** What an activity names a message whose subject rendered empty; the column needs one. */
const UNTITLED_SUBJECT = '(no subject)';

/** Record types an activity can be filed against; `activities` has no lead column. */
const ACTIVITY_RECORD_FIELDS = {
  contact: 'contact_id',
  account: 'account_id',
  deal: 'deal_id',
} as const satisfies Partial<Record<EmailLinkRecordType, string>>;

/** The activity field for a record type, or null for a type no activity can name. */
function activityFieldFor(
  recordType: EmailLinkRecordType | undefined,
): (typeof ACTIVITY_RECORD_FIELDS)[keyof typeof ACTIVITY_RECORD_FIELDS] | null {
  if (recordType === undefined || recordType === 'lead') return null;
  return ACTIVITY_RECORD_FIELDS[recordType];
}

/** A send refusal carrying the API code the controller maps. */
function sendError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

type TokenRefresh = (provider: OAuthProvider, refreshToken: string) => Promise<RefreshedTokens>;

/** Seams a test replaces so no unit test reaches a provider or an OIDC endpoint. */
export interface SendDependencies {
  provider?: MailProvider;
  refresh?: TokenRefresh;
}

/** The driver for a mailbox, or null for one whose provider cannot send. */
function senderFor(account: ConnectedAccountInternal): MailProvider | null {
  if (account.provider === 'google') {
    return createGmailProvider(account.emailAddress, account.grantedScopes, driverFetch());
  }
  if (account.provider === 'microsoft') {
    return createGraphProvider(account.emailAddress, account.grantedScopes, driverFetch());
  }
  return null;
}

/**
 * Builds a driver, translating a scope refusal at construction into the reconnect code.
 * A driver refuses a mailbox that cannot read mail; such a grant cannot be sending either.
 * Anything else a constructor throws is a fault, not a mailbox state, and propagates.
 */
function constructSender(account: ConnectedAccountInternal): MailProvider | null {
  try {
    return senderFor(account);
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code !== INSUFFICIENT_SCOPE) throw err;
    throw sendError(RECONNECT_REQUIRED, 'Reconnect this mailbox to send from it.');
  }
}

/** A stored message being replied to or forwarded, with what a forward quotes. */
interface OriginalMessage {
  parent: ParentMessage;
  fromAddress: string;
  toAddresses: string[];
  subject: string | null;
  sentAt: Date | null;
  bodyHtml: string | null;
  bodyText: string | null;
}

/** The message being answered or forwarded, read only through the sending mailbox. */
async function findOriginal(
  messageId: string,
  accountId: string,
  relation: ParentMessage['relation'],
): Promise<OriginalMessage> {
  const result = await pool.query<{
    thread_id: string;
    rfc_message_id: string | null;
    references_header: string | null;
    from_address: string;
    to_addresses: string[];
    subject: string | null;
    sent_at: Date | null;
    message_body_html: string | null;
    message_body_text: string | null;
  }>(
    `SELECT thread_id, rfc_message_id, references_header, from_address, to_addresses,
            subject, sent_at, message_body_html, message_body_text
       FROM email_messages WHERE id = $1 AND connected_account_id = $2`,
    [messageId, accountId],
  );
  const row = result.rows[0];
  if (!row) {
    // The same mailbox, not merely the same user: Gmail files a reply into a thread by id,
    // and another mailbox's id names nothing there.
    throw sendError(EMAIL_MESSAGE_NOT_FOUND, 'No such message in this mailbox');
  }
  return {
    parent: {
      relation,
      threadId: row.thread_id,
      rfcMessageId: row.rfc_message_id,
      references: row.references_header,
    },
    fromAddress: row.from_address,
    toAddresses: row.to_addresses,
    subject: row.subject,
    sentAt: row.sent_at,
    bodyHtml: row.message_body_html,
    bodyText: row.message_body_text,
  };
}

/**
 * The forwarded original, quoted beneath the sender's own text the way Gmail lays it out.
 *
 * The original's HTML goes out as the sender received it, as every mail client forwards;
 * whatever renders the stored copy sanitizes it there. Attachments are not carried.
 */
function forwardedBlock(original: OriginalMessage): string {
  const header = [
    '---------- Forwarded message ---------',
    `From: ${original.fromAddress}`,
    ...(original.sentAt ? [`Date: ${original.sentAt.toUTCString()}`] : []),
    `Subject: ${original.subject ?? ''}`,
    `To: ${original.toAddresses.join(', ')}`,
  ]
    .map(escapeHtml)
    .join('<br>');
  const quoted = original.bodyHtml ?? (original.bodyText ? plainTextToHtml(original.bodyText) : '');
  return `<br><div class="forwarded">${header}<br><br>${quoted}</div>`;
}

/**
 * The values a template may reference for one record, keyed `type.column`.
 *
 * An explicit column list per type, never `SELECT *`: a template author chooses tokens,
 * and a new column must not become readable to every template by existing.
 */
async function mergeContextFor(
  recordType: EmailLinkRecordType,
  recordId: string,
): Promise<MergeContext> {
  const queries: Record<EmailLinkRecordType, string> = {
    contact: `SELECT c.first_name AS "contact.first_name", c.last_name AS "contact.last_name",
                     c.email AS "contact.email", c.phone AS "contact.phone",
                     c.title AS "contact.title", c.department AS "contact.department",
                     a.name AS "account.name", a.industry AS "account.industry",
                     a.website AS "account.website"
                FROM contacts c LEFT JOIN accounts a ON a.id = c.account_id
               WHERE c.id = $1`,
    lead: `SELECT first_name AS "lead.first_name", last_name AS "lead.last_name",
                  email AS "lead.email", phone AS "lead.phone",
                  company_name AS "lead.company_name", industry AS "lead.industry"
             FROM leads WHERE id = $1`,
    account: `SELECT name AS "account.name", industry AS "account.industry",
                     website AS "account.website"
                FROM accounts WHERE id = $1`,
    deal: `SELECT d.name AS "deal.name", d.close_date::text AS "deal.close_date",
                  a.name AS "account.name", a.industry AS "account.industry",
                  a.website AS "account.website"
             FROM deals d LEFT JOIN accounts a ON a.id = d.account_id
            WHERE d.id = $1`,
  };
  const result = await withRlsQuery((client) =>
    client.query<Record<string, string | null>>(queries[recordType], [recordId]),
  );
  return result.rows[0] ?? {};
}

/** A typed plain-text body as the HTML a message carries, line breaks kept. */
function plainTextToHtml(body: string): string {
  return `<p>${escapeHtml(body).replace(/\r?\n/g, '<br>')}</p>`;
}

/** The subject and HTML body to send, and the merge tags a template left empty. */
async function contentFor(
  input: SendEmailInput,
): Promise<{ subject: string; bodyHtml: string; unresolved: string[] }> {
  if (input.template_id === undefined) {
    // Safe: the schema requires both whenever no template is named.
    return { subject: input.subject!, bodyHtml: input.body_html!, unresolved: [] };
  }

  const template = await findEmailTemplateById(input.template_id);
  // A disabled template is withdrawn from use; answering as absent keeps one code for both.
  if (!template || !template.enabled) {
    throw sendError(TEMPLATE_NOT_FOUND, 'No such template');
  }
  // Safe: the schema requires a record whenever a template is named.
  const context = await mergeContextFor(input.record_type!, input.record_id!);
  const rendered = renderTemplate(template, context);
  return {
    subject: rendered.subject,
    bodyHtml: rendered.bodyHtml,
    unresolved: rendered.unresolved,
  };
}

/** The credentials to send with, a fresh access token in place of a possibly stale one. */
async function sendingAuth(
  account: ConnectedAccountInternal,
  userId: string,
  actor: AuditActor,
  refresh: TokenRefresh,
): Promise<ConnectedAccountInternal['auth']> {
  if (account.auth.kind !== 'oauth') return account.auth;
  let token: string | null;
  try {
    token = await getUsableAccessToken(account.id, userId, actor, refresh);
  } catch (err) {
    // A refresh that timed out or met a 5xx is not a verdict on the grant: nothing was
    // sent, and the same request may succeed in a moment.
    logger.warn({ err, accountId: account.id }, 'emailSendService: token refresh failed');
    throw sendError(SEND_FAILED, 'The message was not sent. Try again in a moment.');
  }
  if (token === null) {
    throw sendError(PROVIDER_AUTH_EXPIRED, 'This mailbox needs to be reconnected.');
  }
  return { ...account.auth, access_token: token };
}

/**
 * Translates a driver's send failure into the API's code.
 *
 * Only an expired credential is recorded on the account: a throttle or a missing send
 * scope says nothing about whether the mailbox can still sync.
 */
async function apiFailureFor(err: unknown, account: ConnectedAccountInternal): Promise<Error> {
  if (!isSendFailure(err)) return err instanceof Error ? err : new Error(String(err));
  switch (err.code) {
    case SEND_AUTH_EXPIRED:
      try {
        await updateAccountStatus(account.id, account.userId, 'error', PROVIDER_AUTH_EXPIRED);
      } catch (statusErr) {
        // The user still needs the reconnect answer; the badge catches up on the next sync.
        logger.error({ err: statusErr, accountId: account.id }, 'emailSendService: status write');
      }
      return sendError(PROVIDER_AUTH_EXPIRED, 'This mailbox needs to be reconnected.');
    case SEND_SCOPE_MISSING:
      return sendError(RECONNECT_REQUIRED, 'Reconnect this mailbox to allow sending from it.');
    case SEND_RATE_LIMITED:
      return sendError(RATE_LIMITED, 'The mail provider is limiting sends. Try again later.');
    case SEND_OUTCOME_UNKNOWN:
      return sendError(
        SEND_FAILED,
        'The mail provider did not confirm the send. Check Sent before sending again.',
      );
    case SEND_NOT_SENT:
    default:
      return sendError(SEND_FAILED, 'The message was not sent.');
  }
}

/**
 * Sends one message and records it, its links, its activity, and its audit entry.
 *
 * The caller has already established that a named record exists and that the user may file
 * mail against it; this function trusts that and checks only what it alone can see.
 *
 * @throws an error whose `code` is one of this module's exported codes, or
 *   `PROVIDER_AUTH_EXPIRED`.
 */
export async function sendEmail(
  input: SendEmailInput,
  userId: string,
  actor: AuditActor,
  dependencies: SendDependencies = {},
): Promise<SendEmailResponse> {
  const account = await getConnectedAccountInternal(input.connected_account_id, userId);
  if (!account) throw sendError(EMAIL_ACCOUNT_NOT_FOUND, 'No such mailbox');

  const provider = dependencies.provider ?? constructSender(account);
  if (!provider?.send) {
    throw sendError(PROVIDER_SEND_UNSUPPORTED, 'This mailbox cannot send yet.');
  }

  const original = input.in_reply_to_message_id
    ? await findOriginal(input.in_reply_to_message_id, account.id, 'reply')
    : input.forward_of_message_id
      ? await findOriginal(input.forward_of_message_id, account.id, 'forward')
      : null;
  const parent = original?.parent ?? null;
  const content = await contentFor(input);
  // The activity carries only what the sender wrote: a forwarded original is mail from this
  // mailbox, readable through it alone, and an activity is visible to everyone on the record.
  const activityNotes =
    parent?.relation === 'forward'
      ? htmlToText(content.bodyHtml, { wordwrap: false }).trim()
      : null;
  if (original && parent?.relation === 'forward') content.bodyHtml += forwardedBlock(original);
  const fromAddress = account.emailAddress.trim().toLowerCase();
  const document = await buildOutboundDocument(
    {
      fromAddress,
      toAddresses: input.to,
      ccAddresses: input.cc,
      subject: content.subject,
      bodyHtml: content.bodyHtml,
    },
    parent,
  );
  const auth = await sendingAuth(
    account,
    userId,
    actor,
    dependencies.refresh ?? refreshAccessToken,
  );

  let sent: SentMessage;
  try {
    sent = await provider.send(auth, document.mime, parent?.threadId ?? null);
  } catch (err) {
    throw await apiFailureFor(err, account);
  }
  const { providerMessageId } = sent;
  // The provider's own thread wins whenever it reports one: the sync engine stores every
  // later message in the conversation under it, and a provider may decline the thread we
  // asked for — Gmail does when the subject changed. Ours is the fallback.
  const threadId = sent.threadId !== null ? boundIndexedId(sent.threadId) : document.threadId;

  try {
    const message = await recordSent(
      account,
      { providerMessageId, threadId },
      document,
      fromAddress,
      input,
      actor,
      activityNotes,
    );
    return { message, unresolved_merge_tags: content.unresolved };
  } catch (err) {
    logger.error(
      { err, accountId: account.id, providerMessageId },
      'emailSendService: sent a message but could not record it',
    );
    throw sendError(
      SENT_NOT_RECORDED,
      'The message was sent but could not be saved here. It will appear after the next sync, but not on the record you sent it from.',
    );
  }
}

/** Stores a sent message with its links, activity, and audit entry, in one transaction. */
async function recordSent(
  account: ConnectedAccountInternal,
  stored: { providerMessageId: string; threadId: string },
  document: OutboundDocument,
  fromAddress: string,
  input: SendEmailInput,
  actor: AuditActor,
  /** The activity's notes when they must differ from the sent body; null to use the body. */
  activityNotes: string | null,
): Promise<SendEmailResponse['message']> {
  // Parsed from the bytes that were sent, so the columns match what a re-sync derives.
  const parsed = await parseMessage(document.mime);
  const threading = storedThreadingHeaders(parsed.threading);
  const dealAutoLink = await getDealAutoLink();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const upserted = await client.query<EmailMessageRow & { inserted: boolean }>(
      `INSERT INTO email_messages AS m
         (connected_account_id, provider_message_id, thread_id, direction, from_address,
          to_addresses, cc_addresses, subject, has_attachments, sent_at,
          message_body_text, message_body_html, message_snippet,
          rfc_message_id, references_header)
       VALUES ($1, $2, $3, 'outbound', $4, $5, $6, $7, false, now(), $8, $9, $10, $11, $12)
       ON CONFLICT (connected_account_id, provider_message_id) DO UPDATE
         -- The sync engine read the Sent copy first. Its thread may be the RFC root rather
         -- than the parent's, and only this path knows which conversation was answered.
         SET thread_id = EXCLUDED.thread_id,
             direction = 'outbound',
             rfc_message_id = COALESCE(m.rfc_message_id, EXCLUDED.rfc_message_id),
             references_header = COALESCE(m.references_header, EXCLUDED.references_header)
       RETURNING ${MESSAGE_SELECT}, (xmax = 0) AS inserted`,
      [
        account.id,
        stored.providerMessageId,
        stored.threadId,
        fromAddress,
        parsed.toAddresses,
        parsed.ccAddresses,
        parsed.subject,
        parsed.bodyText,
        parsed.bodyHtml,
        parsed.snippet,
        threading.rfcMessageId,
        threading.references,
      ],
    );
    const row = upserted.rows[0]!; // Safe: an upsert returns its row on either branch.

    // Only a new row is matched: one the sync engine stored first was matched then, and
    // matching it again would restore links its owner removed.
    if (row.inserted) {
      await matchMessagesToRecords(
        client,
        [
          {
            id: row.id,
            fromAddress: row.from_address,
            toAddresses: row.to_addresses,
            ccAddresses: row.cc_addresses,
          },
        ],
        dealAutoLink,
      );
    }

    if (input.record_type !== undefined && input.record_id !== undefined) {
      // Sent from a record, so filed there whatever its addresses match: a deal has none,
      // and a contact may have been written to at an address it does not hold.
      await client.query(
        `INSERT INTO email_message_links (email_message_id, record_type, record_id, match_type)
         VALUES ($1, $2, $3, 'manual')
         ON CONFLICT (email_message_id, record_type, record_id) DO NOTHING`,
        [row.id, input.record_type, input.record_id],
      );
      await clearDerivedLinkSuppression(client, row.id, input.record_type, input.record_id);
    }

    const links = await client.query<{ record_type: string; record_id: string }>(
      `SELECT record_type, record_id FROM email_message_links
        WHERE email_message_id = $1 ORDER BY record_type, record_id`,
      [row.id],
    );

    // Set only now: matching must see every record, as it does for sync, while the activity
    // write is the caller's own and goes through their row policies.
    await setRlsUserId(client);
    const activityField = activityFieldFor(input.record_type);
    // Inside the transaction: a stored message with no activity is the timeline gap
    // this write exists to close.
    const activityId = activityField
      ? await insertActivity(
          client,
          {
            type: 'Email',
            direction: 'Outbound',
            subject: truncate(row.subject?.trim() || UNTITLED_SUBJECT, ACTIVITY_SUBJECT_MAX),
            notes: (activityNotes ?? parsed.bodyText) || undefined,
            [activityField]: input.record_id,
            owner_id: actor.id,
          },
          actor,
        )
      : null;

    await writeAuditEntry(client, {
      recordType: 'connected_account',
      recordId: account.id,
      recordName: account.emailAddress,
      eventType: 'email_sent',
      fieldName: 'email_message',
      newValue: JSON.stringify({
        message_id: row.id,
        recipient_count: row.to_addresses.length + row.cc_addresses.length,
        to: row.to_addresses,
        cc: row.cc_addresses,
        linked_records: links.rows.map((link) => `${link.record_type}:${link.record_id}`),
      }),
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    if (activityId) {
      void announceActivityCreated(activityId).catch((err: unknown) => {
        logger.warn({ err, activityId }, 'emailSendService: activity side effects failed');
      });
    }
    return toEmailMessage(row);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
