/**
 * Email sync behaviors for MiniCRM: connecting mailboxes, seeding the fake providers,
 * running a sync, filing mail, and acting on threads in a record's Emails section.
 *
 * Every REST call validates its response against the shared schema. UI mutations wait on
 * the HTTP response they cause and return its status. Behaviors do NOT contain assertions
 * (no expect() calls) — they return typed results for the spec to assert against.
 *
 * A mailbox is owned by the user who connected it and only that user may delete it, so
 * every connect behavior registers a teardown that signs in as the owner to remove it.
 */

import { isAlreadyGone, RestClientError, type RestClient } from '@framework/clients/rest-client.js';
import type { PageFacade } from '@framework/fixtures/index.js';
import type { AdminMessage, SeedMessage } from '@framework/fakes/mail-provider-emulator.js';
import type { SeedMail } from '@framework/clients/smtp-seed-client.js';
import type { SeededMessage } from '@framework/clients/mail-emulator-client.js';
import {
  connectedAccountEnvelopeSchema,
  connectedAccountListResponseSchema,
  type ConnectedAccountEnvelope,
  type ConnectedAccountListResponse,
  type ConnectedAccountResponse,
} from '@minicrm/shared/schemas/connectedAccountSchema.js';
import {
  emailMessageLinkEnvelopeSchema,
  type EmailLinkRecordType,
} from '@minicrm/shared/schemas/emailMessageSchema.js';
import {
  syncNowResponseSchema,
  type SyncNowResponse,
} from '@minicrm/shared/schemas/testEmailSyncSchema.js';
import type { FeatureFlagKey } from '@minicrm/shared/schemas/featureFlagSchema.js';
import { ProfilePage } from '@pages/minicrm/ProfilePage.js';
import { EmailsSectionPage } from '@pages/minicrm/EmailsSectionPage.js';
import { EmailComposerPage } from '@pages/minicrm/EmailComposerPage.js';
import type { TestDataManager } from '@apps/minicrm/test-data-manager.js';
import { awaitApiResponse, FIRST_INTERACTION_TIMEOUT_MS } from '@apps/minicrm/helpers.js';
import {
  GREENMAIL_IMAP_PORT,
  IMAP_HOST_FOR_SERVER,
  greenMailSmtp,
  mailEmulator,
} from '@apps/minicrm/mail-fakes.js';
import { loginAs, loginAsAdmin } from './auth.behaviors.js';
import { updateFeatureFlag } from './feature-flags.behaviors.js';
import { openProfilePage } from './connected-accounts.behaviors.js';

/** Fixtures required by the browser-side email sync behaviors. */
export interface EmailSyncBehaviorContext {
  page: PageFacade;
}

/** The user a mailbox belongs to, whose session its teardown needs. */
export interface MailboxOwner {
  email: string;
  password: string;
}

/** One sync run's outcome, as the test-only run route reports it. */
export type SyncOutcome = SyncNowResponse['outcome'];

/** Runs a run-now page by page; a seeded mailbox is a few messages, so a handful suffices. */
const MAX_SYNC_ROUNDS = 10;

/** GreenMail's IMAP login takes any password once auth is disabled; one fixed value is enough. */
const GREENMAIL_PASSWORD = 'any-password-1';

/** The flag every email sync route sits behind. */
export const EMAIL_SYNC_FLAG = 'email_sync' satisfies FeatureFlagKey;

// ---------------------------------------------------------------------------
// Feature gate
// ---------------------------------------------------------------------------

/**
 * Turns email sync on for one test, and registers turning it back off.
 *
 * Call it first, before anything else the test registers: teardown runs last-in first-out,
 * so the flag goes off only after every mailbox has been deleted, through routes that sit
 * behind the same flag. Turning it off in an afterEach instead runs before that teardown
 * and refuses every mailbox delete with 403.
 *
 * Writes a global row, so a caller is @serial (resource-registry.ts).
 *
 * @param restClient - The fixture client; left signed in as admin.
 * @param testData - Where the flag's restore is registered.
 */
export async function enableEmailSyncForTest(
  restClient: RestClient,
  testData: TestDataManager,
): Promise<void> {
  await loginAsAdmin(restClient);
  testData.registerCustomTeardown('email-sync-flag-off', async () => {
    await loginAsAdmin(restClient);
    await updateFeatureFlag(restClient, EMAIL_SYNC_FLAG, { enabled: false });
  });
  await updateFeatureFlag(restClient, EMAIL_SYNC_FLAG, { enabled: true });
}

// ---------------------------------------------------------------------------
// Mailboxes
// ---------------------------------------------------------------------------

/**
 * Registers removal of a stored mailbox, signing in as its owner and back as admin after.
 *
 * Owner-scoped: an admin's delete of another user's mailbox answers 404, which a plain
 * registered DELETE would read as already cleaned up while the row leaked.
 */
function registerMailboxTeardown(
  testData: TestDataManager,
  restClient: RestClient,
  owner: MailboxOwner,
  accountId: string,
): void {
  testData.registerCustomTeardown(`delete-connected-account-${accountId}`, async () => {
    await loginAs(restClient, owner.email, owner.password);
    try {
      await restClient.delete(`/api/v1/connected-accounts/${accountId}`);
    } catch (err) {
      if (!isAlreadyGone(err)) throw err;
    } finally {
      await loginAsAdmin(restClient);
    }
  });
}

/**
 * Registers a mailbox's teardown from a response body before it is schema-checked, so a
 * row the server committed is still removed when its body drifts from the schema.
 */
function registerTeardownFromRawBody(
  testData: TestDataManager,
  restClient: RestClient,
  owner: MailboxOwner,
  body: unknown,
): void {
  // Safe: optional chaining over unknown, and the id is type-checked before use.
  const rawId = (body as { account?: { id?: unknown } } | null)?.account?.id;
  if (typeof rawId === 'string') registerMailboxTeardown(testData, restClient, owner, rawId);
}

/** What the IMAP connect form answered. */
export interface ImapConnectResult {
  status: number;
  /** The stored mailbox, when the server accepted it. */
  account: ConnectedAccountResponse | null;
}

/**
 * Connects an IMAP mailbox on GreenMail through the profile page's manual form.
 *
 * @param ctx - Playwright fixture context, logged in as `owner`.
 * @param testData - Where the mailbox's teardown is registered.
 * @param restClient - The fixture client the teardown signs in with.
 * @param owner - The signed-in user, who will own the mailbox.
 * @param address - The mailbox address, which is also GreenMail's login.
 * @returns The connect request's status and, on success, the stored account.
 */
export async function connectImapMailboxViaProfile(
  ctx: EmailSyncBehaviorContext,
  testData: TestDataManager,
  restClient: RestClient,
  owner: MailboxOwner,
  address: string,
): Promise<ImapConnectResult> {
  await openProfilePage(ctx);
  const profile = new ProfilePage(ctx);
  await profile.showImapForm();
  await profile.fillImapField('email', address);
  await profile.fillImapField('host', IMAP_HOST_FOR_SERVER);
  await profile.fillImapField('port', String(GREENMAIL_IMAP_PORT));
  await profile.fillImapField('username', address);
  await profile.fillImapField('password', GREENMAIL_PASSWORD);
  await profile.setImapSecure(false);

  const created = awaitApiResponse(ctx.page, 'POST', '/api/v1/connected-accounts');
  await profile.submitImapForm();
  const response = await created;
  if (response.status() !== 201) return { status: response.status(), account: null };
  const body: unknown = await response.json();
  registerTeardownFromRawBody(testData, restClient, owner, body);
  const { account } = connectedAccountEnvelopeSchema.parse(body);
  return { status: 201, account };
}

/**
 * Connects an IMAP mailbox on GreenMail through the API, as the connect form would.
 *
 * @param restClient - Authenticated as `owner`.
 * @param testData - Where the mailbox's teardown is registered.
 * @param owner - The authenticated user, who will own the mailbox.
 * @param address - The mailbox address, which is also GreenMail's login.
 * @returns The stored mailbox.
 */
export async function connectImapMailboxViaApi(
  restClient: RestClient,
  testData: TestDataManager,
  owner: MailboxOwner,
  address: string,
): Promise<ConnectedAccountResponse> {
  // Parsed after the teardown is registered, not by the client, so a drifted body cannot leak the row.
  const res = await restClient.post<unknown>('/api/v1/connected-accounts', {
    email_address: address,
    host: IMAP_HOST_FOR_SERVER,
    port: GREENMAIL_IMAP_PORT,
    username: address,
    password: GREENMAIL_PASSWORD,
    secure: false,
  });
  registerTeardownFromRawBody(testData, restClient, owner, res.body);
  return connectedAccountEnvelopeSchema.parse(res.body).account;
}

/**
 * Connects a Gmail or Microsoft mailbox backed by the emulator, for the caller.
 *
 * The emulator mailbox is registered first, so the server's first request finds it, and
 * its removal registered before the server's row: teardown runs last-in first-out, so the
 * row goes first and nothing can reach the emulator mailbox once it is gone.
 *
 * @param restClient - Authenticated as `owner`.
 * @param testData - Where both teardowns are registered.
 * @param owner - The authenticated user, who will own the mailbox.
 * @param provider - Which provider the emulator plays.
 * @param address - The mailbox address.
 * @returns The stored mailbox and the bearer token that selects it in the emulator.
 */
export async function connectEmulatedMailbox(
  restClient: RestClient,
  testData: TestDataManager,
  owner: MailboxOwner,
  provider: 'google' | 'microsoft',
  address: string,
): Promise<{ account: ConnectedAccountResponse; token: string }> {
  const token = `token-${crypto.randomUUID()}`;
  const emulator = mailEmulator();
  await emulator.registerMailbox({ token, address });
  testData.registerCustomTeardown('mail-emulator-mailbox', () => emulator.deleteMailbox(token));

  // Parsed after the teardown is registered, not by the client, so a drifted body cannot leak the row.
  const res = await restClient.post<unknown>('/api/v1/test/connected-accounts/oauth', {
    provider,
    email_address: address,
    access_token: token,
  });
  registerTeardownFromRawBody(testData, restClient, owner, res.body);
  return { account: connectedAccountEnvelopeSchema.parse(res.body).account, token };
}

/**
 * Sets the domains one mailbox never syncs, as its owner.
 *
 * @param restClient - Authenticated as the mailbox's owner.
 * @param accountId - The mailbox.
 * @param domains - Domains to exclude.
 * @returns The mailbox as stored after the change.
 */
export async function setMailboxExcludedDomains(
  restClient: RestClient,
  accountId: string,
  domains: string[],
): Promise<ConnectedAccountResponse> {
  const res = await restClient.patch<ConnectedAccountEnvelope>(
    `/api/v1/connected-accounts/${accountId}`,
    { excluded_domains: domains },
    { schema: connectedAccountEnvelopeSchema },
  );
  return res.body.account;
}

/**
 * Reads the status label the profile page shows for one mailbox.
 *
 * @param ctx - Playwright fixture context, on the profile page.
 * @param accountId - The mailbox's id.
 */
export async function readMailboxStatusLabel(
  ctx: EmailSyncBehaviorContext,
  accountId: string,
): Promise<string> {
  return new ProfilePage(ctx).connectedAccountStatusText(accountId, FIRST_INTERACTION_TIMEOUT_MS);
}

/**
 * Lists the caller's own mailboxes.
 *
 * @param restClient - Authenticated as the mailboxes' owner.
 */
export async function listMyMailboxes(restClient: RestClient): Promise<ConnectedAccountResponse[]> {
  const res = await restClient.get<ConnectedAccountListResponse>('/api/v1/connected-accounts', {
    schema: connectedAccountListResponseSchema,
  });
  return res.body.accounts;
}

// ---------------------------------------------------------------------------
// Seeding the fake providers
// ---------------------------------------------------------------------------

/**
 * Delivers one message into a GreenMail mailbox, creating the mailbox if it is new.
 *
 * @param mail - The message; `to` is the mailbox it lands in.
 * @returns The Message-ID it was delivered with.
 */
export async function deliverToImapMailbox(mail: SeedMail): Promise<string> {
  const smtp = greenMailSmtp();
  try {
    return await smtp.deliver(mail);
  } finally {
    smtp.close();
  }
}

/**
 * Stores one message in an emulated Gmail or Graph mailbox.
 *
 * @param token - The mailbox's bearer token, from connectEmulatedMailbox.
 * @param message - The message and where it lands.
 */
export async function seedEmulatedMail(
  token: string,
  message: SeedMessage,
): Promise<SeededMessage> {
  return mailEmulator().seedMessage(token, message);
}

/**
 * Lists what an emulated mailbox holds, sent mail and drafts included.
 *
 * @param token - The mailbox's bearer token.
 */
export async function listEmulatedMail(token: string): Promise<AdminMessage[]> {
  return mailEmulator().listMessages(token);
}

// ---------------------------------------------------------------------------
// Syncing
// ---------------------------------------------------------------------------

/**
 * Syncs one of the caller's mailboxes now, round after round until it reports no more.
 *
 * @param restClient - Authenticated as the mailbox's owner.
 * @param accountId - The mailbox to sync.
 * @returns Every round's outcome, in order; the last one ends the run.
 * @throws When the mailbox still reports more after MAX_SYNC_ROUNDS rounds.
 */
export async function syncMailboxNow(
  restClient: RestClient,
  accountId: string,
): Promise<SyncOutcome[]> {
  const outcomes: SyncOutcome[] = [];
  for (let round = 0; round < MAX_SYNC_ROUNDS; round += 1) {
    const res = await restClient.post<SyncNowResponse>(
      `/api/v1/test/email-sync/accounts/${accountId}/run`,
      {},
      { schema: syncNowResponseSchema },
    );
    outcomes.push(res.body.outcome);
    if (res.body.outcome.status !== 'synced' || !res.body.outcome.has_more) return outcomes;
  }
  throw new Error(`syncMailboxNow: still more to sync after ${String(MAX_SYNC_ROUNDS)} rounds`);
}

// ---------------------------------------------------------------------------
// Filing mail
// ---------------------------------------------------------------------------

/**
 * Files one message against a record by hand.
 *
 * @param restClient - Authenticated as the message's mailbox owner.
 * @param messageId - The stored message's id.
 * @param recordType - What the record is.
 * @param recordId - Which record.
 * @returns The link's id, which unlinking takes.
 */
export async function linkMessageToRecord(
  restClient: RestClient,
  messageId: string,
  recordType: EmailLinkRecordType,
  recordId: string,
): Promise<string> {
  const res = await restClient.post<{ link: { id: string } }>(
    `/api/v1/email-messages/${messageId}/links`,
    { record_type: recordType, record_id: recordId },
    { schema: emailMessageLinkEnvelopeSchema },
  );
  return res.body.link.id;
}

/**
 * Removes one link, reporting the status rather than throwing on a refusal.
 *
 * @param restClient - Authenticated as a caller who may edit the linked record.
 * @param messageId - The linked message.
 * @param linkId - The link to remove.
 */
export async function unlinkMessageFromRecord(
  restClient: RestClient,
  messageId: string,
  linkId: string,
): Promise<number> {
  try {
    const res = await restClient.delete(`/api/v1/email-messages/${messageId}/links/${linkId}`);
    return res.status;
  } catch (err) {
    if (err instanceof RestClientError) return err.status;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Threads in a record's Emails section
// ---------------------------------------------------------------------------

/**
 * Reads the subject of every thread the open record's Emails section lists.
 *
 * DOM catch-up only: call after the section's list request has answered.
 *
 * @param ctx - Playwright fixture context, on a record detail page.
 */
export async function readTimelineThreadSubjects(ctx: EmailSyncBehaviorContext): Promise<string[]> {
  return new EmailsSectionPage(ctx).threadSubjects(FIRST_INTERACTION_TIMEOUT_MS);
}

/**
 * Expands one thread, if it is not already open, and counts the messages it shows.
 *
 * @param ctx - Playwright fixture context, on a record detail page.
 * @param subject - The thread's latest subject.
 */
export async function countMessagesInThread(
  ctx: EmailSyncBehaviorContext,
  subject: string,
): Promise<number> {
  const section = new EmailsSectionPage(ctx);
  await section.expandThread(subject, FIRST_INTERACTION_TIMEOUT_MS);
  return section.threadMessageCount(subject, FIRST_INTERACTION_TIMEOUT_MS);
}

/**
 * Waits for a thread to show the Private badge; DOM catch-up after the privacy request.
 *
 * @param ctx - Playwright fixture context, on a record detail page.
 * @param subject - The thread's latest subject.
 */
export async function waitForThreadMarkedPrivate(
  ctx: EmailSyncBehaviorContext,
  subject: string,
): Promise<void> {
  await new EmailsSectionPage(ctx).waitForPrivateBadge(subject, FIRST_INTERACTION_TIMEOUT_MS);
}

/**
 * Toggles whether a thread is private, from its expanded row.
 *
 * @param ctx - Playwright fixture context, on a record detail page.
 * @param subject - The thread's latest subject.
 * @returns The status of the privacy request the click sent.
 */
export async function toggleThreadPrivacy(
  ctx: EmailSyncBehaviorContext,
  subject: string,
): Promise<number> {
  const section = new EmailsSectionPage(ctx);
  await section.expandThread(subject, FIRST_INTERACTION_TIMEOUT_MS);
  const button = await section.threadPrivacyButtonLocator(subject, FIRST_INTERACTION_TIMEOUT_MS);

  const patched = awaitApiResponse(ctx.page, 'PATCH', (url) =>
    url.pathname.endsWith('/thread-privacy'),
  );
  await button.click();
  return (await patched).status();
}

/**
 * Replies to one message from its thread, writing only the body.
 *
 * Opens the thread and then the message itself: only the latest message starts open, and
 * Reply renders only inside an open one.
 *
 * @param ctx - Playwright fixture context, on a record detail page.
 * @param subject - The thread's latest subject, to open it.
 * @param messageId - The message being answered.
 * @param body - The reply's text.
 * @returns The status of the send request.
 */
export async function replyToMessage(
  ctx: EmailSyncBehaviorContext,
  subject: string,
  messageId: string,
  body: string,
): Promise<number> {
  const section = new EmailsSectionPage(ctx);
  await section.expandThread(subject, FIRST_INTERACTION_TIMEOUT_MS);
  await section.openMessage(messageId, FIRST_INTERACTION_TIMEOUT_MS);
  await (await section.replyButtonLocator(messageId, FIRST_INTERACTION_TIMEOUT_MS)).click();

  const composer = new EmailComposerPage(ctx);
  await composer.fillBody(body, FIRST_INTERACTION_TIMEOUT_MS);
  const sent = awaitApiResponse(ctx.page, 'POST', '/api/v1/email-messages/send');
  await composer.clickSend();
  return (await sent).status();
}
