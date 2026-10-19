/**
 * Sends a message through one of the caller's own connected mailboxes, then records it.
 *
 * A send intent is committed immediately before the provider is called, and the message is
 * stored after it answers. The row's `provider_message_id` does not exist until then, so
 * the two cannot share a transaction; the intent is what makes a failure between them
 * recoverable. The sync engine files the Sent copy from it (`emailSendIntentService.ts`).
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

import { createHash } from 'node:crypto';

import { htmlToText } from 'html-to-text';

import pool from '../db.js';
import logger from '../logger.js';
import { announceActivityCreated } from './activityService.js';
import type { AuditActor } from './auditService.js';
import {
  getConnectedAccountInternal,
  getUsableAccessToken,
  updateAccountStatus,
  type ConnectedAccountInternal,
} from './connectedAccountService.js';
import { matchMessagesToRecords } from './emailMatchingService.js';
import { MESSAGE_SELECT, toEmailMessage, type EmailMessageRow } from './emailMessageService.js';
import {
  claimSendIntent,
  fileSentMessage,
  findIntentByKey,
  lockIntent,
  markIntentNotSent,
  markIntentSent,
  markIntentUnconfirmed,
  precheckSendLimit,
  recordPreparedMessageId,
  type IntentUnderKey,
} from './emailSendIntentService.js';
import { escapeHtml } from './emailService.js';
import { findEmailTemplateById } from './emailTemplateService.js';
import { createGmailProvider } from './mail/gmailProvider.js';
import { createGraphProvider } from './mail/graphProvider.js';
import type { MailProvider, SentMessage } from './mail/mailProvider.js';
import {
  boundIndexedId,
  parseMessage,
  storedThreadingHeaders,
  type ParsedMessage,
} from './mail/messageBody.js';
import { buildOutboundDocument, type ParentMessage } from './mail/outboundMessage.js';
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
import { withRlsQuery } from './rlsContextService.js';
import { getDealAutoLink } from './settingsService.js';
import { shouldSkipRateLimit } from '../utils/nodeEnv.js';

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
/** A repeat of a send still in flight under the same key. */
export const SEND_IN_PROGRESS = 'SEND_IN_PROGRESS';
/** A repeat of a send that went out and is not yet filed. */
export const SEND_ALREADY_SENT = 'SEND_ALREADY_SENT';
/** A repeat of a send whose outcome is unknown. Never resent under its key. */
export const SEND_UNCONFIRMED = 'SEND_UNCONFIRMED';
/** A key already used for a different message. */
export const IDEMPOTENCY_KEY_REUSED = 'IDEMPOTENCY_KEY_REUSED';

/** The client's key for one compose, and a hash of the request it was first used with. */
export interface SendIdempotency {
  key: string;
  requestHash: string;
}

/** JSON with every object's keys sorted, so equal values serialize identically. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, field]) => field !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, field]) => `${JSON.stringify(key)}:${canonicalJson(field)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * A hash of a validated request, so a reused key can be told from a retry. Taken after
 * parsing, so a retry the schema normalizes to the same request — trimmed text, a default
 * filled in — hashes the same.
 */
export function requestHashOf(input: SendEmailInput): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

/** A send refusal carrying the API code the controller maps. */
function sendError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

/** The hourly ceiling's refusal, saying when enough counted sends leave the window. */
function limitError(
  retryAfterSeconds: number,
): Error & { code: string; retryAfterSeconds: number } {
  return Object.assign(
    sendError(RATE_LIMITED, 'Too many messages sent this hour, please try again later.'),
    { retryAfterSeconds },
  );
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
 * Answers a repeat of a send from what its key recorded, never sending again.
 *
 * @returns the first send's response, when it was filed.
 * @throws a send error naming why no response can be replayed.
 */
async function answerFromIntent(
  existing: IntentUnderKey,
  requestHash: string,
): Promise<SendEmailResponse> {
  if (existing.requestHash !== requestHash) {
    throw sendError(IDEMPOTENCY_KEY_REUSED, 'This key was already used for a different message.');
  }
  switch (existing.status) {
    case 'filed':
      if (existing.message) {
        return { message: existing.message, unresolved_merge_tags: existing.unresolvedMergeTags };
      }
      // Filed under a message since deleted: it went, and sync will not fetch it again.
      throw sendError(SEND_ALREADY_SENT, 'This message was sent.');
    case 'pending':
      throw sendError(SEND_IN_PROGRESS, 'This message is still being sent.');
    case 'unconfirmed':
      throw sendError(
        SEND_UNCONFIRMED,
        'This message may have been sent. Check Sent before sending it again.',
      );
    case 'not_sent':
      // A concurrent retry reclaimed the key and was refused again before this read.
      throw sendError(SEND_FAILED, 'The message was not sent. Try again.');
    case 'sent':
      break;
  }
  throw sendError(
    SEND_ALREADY_SENT,
    'This message was sent. It appears on its record after the mailbox next syncs.',
  );
}

/**
 * Answers a request whose key was used before, before any other work is done — so a replay
 * renders nothing, refreshes no token, and reads no record that may since have gone. A
 * duplicate sent at the same moment as the first instead loses at the intent insert,
 * after that work.
 *
 * @returns the first send's response, or null for a new key or a refused send to retry.
 * @throws a send error for a repeat that cannot be answered with a response.
 */
export async function replaySend(
  userId: string,
  idempotency: SendIdempotency,
): Promise<SendEmailResponse | null> {
  const existing = await findIntentByKey(userId, idempotency.key);
  if (!existing) return null;
  if (existing.status === 'not_sent' && existing.requestHash === idempotency.requestHash) {
    return null;
  }
  return answerFromIntent(existing, idempotency.requestHash);
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
  idempotency: SendIdempotency,
  dependencies: SendDependencies = {},
): Promise<SendEmailResponse> {
  const account = await getConnectedAccountInternal(input.connected_account_id, userId);
  if (!account) throw sendError(EMAIL_ACCOUNT_NOT_FOUND, 'No such mailbox');

  const enforceLimit = !shouldSkipRateLimit();
  if (enforceLimit) {
    const retryAfterSeconds = await precheckSendLimit(userId, idempotency.key);
    if (retryAfterSeconds !== null) throw limitError(retryAfterSeconds);
  }

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

  // Parsed from the bytes that will be sent, so the stored columns match what a re-sync
  // derives, and the activity text is fixed before anything can fail.
  const parsed = await parseMessage(document.mime);
  // The stored form, from the same function sync stores with, so the two always match.
  const threading = storedThreadingHeaders(parsed.threading);
  const claim = await claimSendIntent(
    {
      userId: actor.id,
      actorName: actor.name,
      connectedAccountId: account.id,
      // Safe: buildOutboundDocument always writes one; a null would fail the insert, unsent.
      rfcMessageId: threading.rfcMessageId!,
      recordType: input.record_type ?? null,
      recordId: input.record_id ?? null,
      // Only an override: a filing otherwise takes the stored body, so no second copy waits here.
      activityNotes,
      toAddresses: parsed.toAddresses,
      ccAddresses: parsed.ccAddresses,
      idempotencyKey: idempotency.key,
      requestHash: idempotency.requestHash,
      unresolvedMergeTags: content.unresolved,
    },
    enforceLimit,
  );
  if (claim.kind === 'limited') throw limitError(claim.retryAfterSeconds);
  if (claim.kind === 'taken') {
    // A concurrent request with this key got there first; answer as it will.
    const existing = await findIntentByKey(userId, idempotency.key);
    if (!existing) throw new Error('emailSendService: a claimed key has no intent');
    return answerFromIntent(existing, idempotency.requestHash);
  }
  const { intentId } = claim;

  let sent: SentMessage;
  try {
    sent = await provider.send(auth, document.mime, parent?.threadId ?? null, (preparedId) =>
      recordPreparedMessageId(intentId, preparedId),
    );
  } catch (err) {
    await settleRefusedIntent(intentId, err);
    throw await apiFailureFor(err, account);
  }
  const { providerMessageId } = sent;
  // The provider's own thread wins whenever it reports one: the sync engine stores every
  // later message in the conversation under it, and a provider may decline the thread we
  // asked for — Gmail does when the subject changed. Ours is the fallback.
  const threadId = sent.threadId !== null ? boundIndexedId(sent.threadId) : document.threadId;

  try {
    // Its own commit, before the filing: if that fails, sync needs this id to find the copy.
    await markIntentSent(intentId, providerMessageId);
  } catch (err) {
    // Filing can still succeed; failing that, the sweep and the Message-ID cover it.
    logger.error({ err, intentId }, 'emailSendService: could not mark intent sent');
  }

  try {
    const message = await recordSent(
      account,
      intentId,
      { providerMessageId, threadId },
      parsed,
      threading,
      fromAddress,
    );
    return { message, unresolved_merge_tags: content.unresolved };
  } catch (err) {
    logger.error(
      { err, accountId: account.id, providerMessageId, intentId },
      'emailSendService: sent a message but could not record it',
    );
    throw sendError(
      SENT_NOT_RECORDED,
      'The message was sent but could not be saved here. It will be filed on its record when this mailbox next syncs.',
    );
  }
}

/** Driver codes that mean the provider refused and nothing went. */
const NOT_SENT_CODES: ReadonlySet<string> = new Set([
  SEND_NOT_SENT,
  SEND_AUTH_EXPIRED,
  SEND_SCOPE_MISSING,
  SEND_RATE_LIMITED,
]);

/**
 * Settles an intent whose send threw. Only a refusal that is known not to have sent is
 * `not_sent`; anything else may have gone, and must never be retried as though it had not.
 */
async function settleRefusedIntent(intentId: string, err: unknown): Promise<void> {
  try {
    if (isSendFailure(err) && NOT_SENT_CODES.has(err.code)) {
      await markIntentNotSent(intentId);
    } else {
      await markIntentUnconfirmed(intentId);
    }
  } catch (settleErr) {
    // The scheduler's sweep reports it unconfirmed within the hour; the user's answer is the
    // provider's, which is what they need now.
    logger.error({ err: settleErr, intentId }, 'emailSendService: could not settle intent');
  }
}

/**
 * Stores a sent message and files it from its intent, in one transaction.
 *
 * The intent is locked before the message is written: the sync engine takes the same two
 * locks in the same order, and whichever path gets the intent first files it.
 */
async function recordSent(
  account: ConnectedAccountInternal,
  intentId: string,
  stored: { providerMessageId: string; threadId: string },
  parsed: ParsedMessage,
  threading: ReturnType<typeof storedThreadingHeaders>,
  fromAddress: string,
): Promise<SendEmailResponse['message']> {
  const dealAutoLink = await getDealAutoLink();

  const client = await pool.connect();
  let activityId: string | null = null;
  let storedRow: EmailMessageRow;
  try {
    await client.query('BEGIN');

    const intent = await lockIntent(client, intentId);
    if (!intent) throw new Error(`emailSendService: intent ${intentId} vanished`);

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
    storedRow = row;

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

    // Already filed means the sync engine stored the Sent copy and filed it first.
    if (intent.status !== 'filed') {
      activityId = await fileSentMessage(
        client,
        intent,
        {
          id: row.id,
          providerMessageId: stored.providerMessageId,
          subject: row.subject,
          bodyText: parsed.bodyText,
          toAddresses: row.to_addresses,
          ccAddresses: row.cc_addresses,
        },
        account.emailAddress,
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (activityId) {
    const announced = activityId;
    void announceActivityCreated(announced).catch((err: unknown) => {
      logger.warn({ err, activityId: announced }, 'emailSendService: activity side effects failed');
    });
  }
  return toEmailMessage(storedRow);
}
