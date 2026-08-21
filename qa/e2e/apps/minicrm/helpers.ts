/**
 * MiniCRM setup helpers — canonical pattern for creating test entities.
 *
 *
 *
 * Each helper:
 *   1. Creates the entity via RestClient.
 *   2. Registers the returned ID and delete path with TestDataManager.
 *   3. Returns the created entity so the caller can use it in assertions.
 *
 * Helpers accept an `overrides` object so tests can supply specific field
 * values (e.g. a known email address) without having to re-implement the full
 * default payload.
 *
 * New helpers for other entity types (deals, activities, accounts) follow the
 * exact same shape — see inline comments for the required steps.
 *
 *
 */

import type { Page, BrowserContext } from '@playwright/test';
import type { RestClient } from '@framework/clients/rest-client.js';
import { isAlreadyGone, RestClientError } from '@framework/clients/rest-client.js';
import type { SafePage } from '@framework/types/safe-page.js';
import type { TestDataManager } from './test-data-manager.js';
import { contactResponseEnvelopeSchema } from '@minicrm/shared/schemas/contactSchema.js';
import { accountResponseEnvelopeSchema } from '@minicrm/shared/schemas/accountSchema.js';
import { dealResponseEnvelopeSchema } from '@minicrm/shared/schemas/dealSchema.js';
import { tagResponseEnvelopeSchema } from '@minicrm/shared/schemas/tagSchema.js';
import { activityResponseEnvelopeSchema } from '@minicrm/shared/schemas/activitySchema.js';
import {
  authMeResponseEnvelopeSchema,
  inviteUserResponseEnvelopeSchema,
} from '@minicrm/shared/schemas/userSchema.js';
import {
  inviteUserViaApi,
  setUserPassword,
  deactivateUser,
  suppressUserOnboarding,
} from '@behaviors/minicrm/users.behaviors.js';
import { loginAsAdmin, resolveAdminCredentials } from '@behaviors/minicrm/auth.behaviors.js';

/**
 * The UTC calendar day `dayOffset` days from today, as YYYY-MM-DD.
 *
 * Anchored to UTC midnight rather than shifting the local instant: across a DST
 * transition a local setDate(n) moves the wall clock 24h per day but the instant
 * 23h or 25h, so the UTC-serialized day can land off by one — "tomorrow" is not
 * in the future, and a due-date gate that depends on it does not fire. due_date
 * and close_date are timezone-naive date columns the server resolves in UTC.
 *
 * Mirrors server/src/utils/utcDate.ts's utcDayOffset, which qa/ cannot import
 * (see docs/dev/dates-and-timezones.md).
 */
export function utcDayOffset(dayOffset: number): string {
  const now = new Date();
  const shifted = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset),
  );
  return shifted.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/**
 * Minimal representation of a MiniCRM contact as returned by POST /api/v1/contacts.
 * Field names match the server's snake_case ContactRow shape.
 * Extend as more fields are needed by tests.
 */
export interface TestContact {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  title: string | null;
  department: string | null;
  account_id: string | null;
  owner_id: string;
  /** Optimistic lock version */
  version: number;
}

/**
 * Fields accepted when creating a contact. All fields optional — defaults are
 * applied by the helper so the minimum viable entity can be created with a
 * single call.
 *
 * Uses snake_case to match the server's createContactSchema validation.
 */
export interface CreateContactOverrides {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  title?: string;
  department?: string;
  account_id?: string;
}

/**
 * Minimal representation of a MiniCRM account as returned by POST /api/v1/accounts.
 */
export interface TestAccount {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  employee_range: string | null;
  revenue_range: string | null;
  owner_id: string;
  /** Optimistic lock version */
  version: number;
}

/**
 * Fields accepted when creating an account. All fields optional.
 *
 * Uses snake_case to match the server's validation schema.
 */
export interface CreateAccountOverrides {
  name?: string;
  industry?: string;
  website?: string;
  employee_range?: string;
  revenue_range?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Registers an entity for teardown that must be deleted as an admin, even though
 * the test created it while `restClient` was authenticated as someone else.
 *
 * `TestDataManager.teardown()` issues its DELETEs with the fixture `restClient`
 * in whatever auth state the test left it. Tests that re-authenticate that shared
 * client as a rep — the owner-scoped visibility and owner-filter suites do this
 * between every create — would therefore delete as that rep, and
 * `deleteContactHandler` answers 403 for a non-owner non-admin
 * (`contactController.ts:608-609`), so the record is never removed. Since
 * that 403 is reported rather than swallowed — teardown records
 * `success: false` and the test is annotated — but the row still leaks, which
 * is the silent-failure mode this guard exists to close.
 *
 * Use this instead of `testData.register()` whenever the client may not be an
 * admin at teardown time. It mirrors `createTestRep`'s deactivation callback,
 * which re-authenticates for the same reason.
 *
 * **Side effect:** this leaves `restClient` authenticated as the admin. Teardown
 * runs in reverse registration order, so every entry registered BEFORE this one
 * also runs as admin. That is the safer direction for every ownership-scoped
 * resource in the app, and it is why the auth state is deliberately not
 * restored: putting a rep's session back would re-break the plain `register()`
 * entries below it. Do not rely on the client's auth state after teardown begins.
 *
 * **Not universal, though:** `ai_session` is scoped by `user_id`, not by role
 * (`aiSessionService.ts:398-405`), so an admin deleting another user's session
 * gets a 404 rather than deleting it. Since a 404 is swallowed as "already
 * gone", a rep-owned session registered here would leak silently. `ai.spec.ts`
 * registers only admin-owned sessions, which is why it is correct today.
 *
 * @param testData - TestDataManager instance for the current test.
 * @param restClient - The fixture RestClient, in any auth state.
 * @param entityType - Log label for the entity, e.g. `'contact'`.
 * @param id - The created entity's id.
 * @param deletePath - Full REST path that deletes it, e.g. `/api/v1/contacts/<id>`.
 */
export function registerAdminTeardown(
  testData: TestDataManager,
  restClient: RestClient,
  entityType: string,
  id: string,
  deletePath: string,
): void {
  testData.registerCustomTeardown(`delete-${entityType}-${id}`, async () => {
    await loginAsAdmin(restClient);
    // Swallow ONLY the expected 404. A test that deleted the record itself
    // through the UI leaves nothing to delete here, and surfacing that as a
    // "custom teardown failed" line would train readers to ignore a message
    // that should mean something. Three specs rely on this: leads.spec.ts,
    // pipelines.spec.ts, and ai.spec.ts.
    //
    // Everything else — 403, 500, a network error — is rethrown so
    // TestDataManager records `success: false` and logs it. Those are exactly
    // the cases where the record IS still in the database, and a blanket catch
    // reported successful cleanup while the row leaked: the silent-failure mode
    // this guard exists to close, reintroduced one layer up.
    //
    // `validationError === undefined` is belt-and-braces: RestClientError is
    // one class for two unrelated failures — an error status and a schema
    // parse failure — and only the first means "the record is gone". The two
    // cannot actually collide here, because parseResponse throws on `status >=
    // 400` (rest-client.ts:352-354) before it ever reaches schema validation,
    // so a parse failure always carries a 2xx. The clause costs nothing and
    // keeps the intent explicit rather than resting on that ordering.
    try {
      await restClient.delete(deletePath);
    } catch (err) {
      if (isAlreadyGone(err)) return;
      throw err;
    }
  });
}

/**
 * Extracts the created user's id from an invite response whose shape has not
 * been validated yet.
 *
 * Checks the documented location first, then falls back to the first
 * single-level object property carrying a string `id`. The fallback is a guess:
 * if an envelope ever carries another object with an `id` ahead of the renamed
 * user key, it returns that one. That fails visibly — the PATCH 404s, the entry
 * records `success: false`, and the test is annotated — rather than silently,
 * which is the trade this makes against losing the id entirely. The fallback exists because teardown
 * registration must survive envelope drift: the server has already committed
 * the row by the time the client validates, so a rename like `user` → `data`
 * must not cost us the id we need to clean it up. Returns undefined when no id
 * is discoverable, in which case there is nothing registrable.
 *
 * @param body - The raw, unvalidated response body.
 * @returns The user id, or undefined if none could be found.
 */
function findCreatedUserId(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;

  const record = body as Record<string, unknown>;
  const documented = (record['user'] as { id?: unknown } | undefined)?.id;
  if (typeof documented === 'string') return documented;

  for (const value of Object.values(record)) {
    if (typeof value === 'object' && value !== null) {
      const candidate = (value as { id?: unknown }).id;
      if (typeof candidate === 'string') return candidate;
    }
  }
  return undefined;
}

/**
 * Registers a user for deactivation at teardown.
 *
 * Users cannot be hard-deleted, so cleanup is a PATCH rather than the DELETE a
 * plain `testData.register()` entry would issue. Re-authenticates as admin
 * first: tests routinely leave `restClient` authenticated as the user they just
 * created, and deactivation is admin-only.
 *
 * @param testData - TestDataManager instance for the current test.
 * @param restClient - The fixture RestClient, in any auth state. Must outlive
 *   the test body — the callback runs after it.
 * @param userId - The created user's id.
 * @param label - Teardown-key prefix identifying the kind of user.
 */
export function registerUserDeactivation(
  testData: TestDataManager,
  restClient: RestClient,
  userId: string,
  label = 'user',
): void {
  testData.registerCustomTeardown(`deactivate-${label}-${userId}`, async () => {
    await loginAsAdmin(restClient);
    try {
      await deactivateUser(restClient, userId);
    } catch (err) {
      // Same 404 semantics as every other teardown path: a user that is already
      // gone is cleanup having happened. Unreachable while users are only ever
      // soft-deleted, but leaving this path as the one that treats 404 as
      // failure is the asymmetry that lets the three drift apart.
      if (isAlreadyGone(err)) return;
      throw err;
    }
  });
}

/**
 * Creates a contact via the REST API, registers it with TestDataManager, and
 * returns the created contact.
 *
 * Merge `overrides` to supply specific field values; defaults produce a valid
 * minimal contact that satisfies server-side Zod validation.
 *
 * @param testData - TestDataManager instance for the current test.
 * @param restClient - Authenticated RestClient instance.
 * @param overrides - Optional field overrides for the contact payload.
 * @returns The created contact as returned by the server.
 */
export async function createTestContact(
  testData: TestDataManager,
  restClient: RestClient,
  overrides: CreateContactOverrides = {},
): Promise<TestContact> {
  // phone, title, department are optional (not nullable) in the server schema —
  // omit them entirely rather than sending null, which Zod rejects with 400.
  const payload: Record<string, string | null> = {
    first_name: overrides.first_name ?? 'Test',
    last_name: overrides.last_name ?? 'Contact',
    email:
      overrides.email ??
      `test-contact-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    account_id: overrides.account_id ?? null,
  };
  if (overrides.phone !== undefined) payload['phone'] = overrides.phone;
  if (overrides.title !== undefined) payload['title'] = overrides.title;
  if (overrides.department !== undefined) payload['department'] = overrides.department;

  // Step 1: create via REST with response schema validation.
  // Server returns { contact: ContactRow } — validate the envelope + inner object.
  const response = await restClient.post<{ contact: TestContact }>('/api/v1/contacts', payload, {
    schema: contactResponseEnvelopeSchema,
  });
  const contact = response.body.contact;

  // Step 2: register for teardown immediately so cleanup runs even if the
  // test throws before completing setup.
  testData.register('contact', contact.id, `/api/v1/contacts/${contact.id}`);

  // Step 3: return entity for test assertions.
  return contact;
}

/**
 * Creates an account via the REST API, registers it with TestDataManager, and
 * returns the created account.
 *
 * @param testData - TestDataManager instance for the current test.
 * @param restClient - Authenticated RestClient instance.
 * @param overrides - Optional field overrides for the account payload.
 * @returns The created account as returned by the server.
 */
export async function createTestAccount(
  testData: TestDataManager,
  restClient: RestClient,
  overrides: CreateAccountOverrides = {},
): Promise<TestAccount> {
  // Optional string fields must be omitted when unset — the server Zod schema
  // rejects explicit null values for these fields with a 400 VALIDATION_ERROR.
  const payload: Record<string, string> = {
    name: overrides.name ?? `Test Account ${Date.now()}`,
  };
  if (overrides.industry !== undefined) payload['industry'] = overrides.industry;
  if (overrides.website !== undefined) payload['website'] = overrides.website;
  if (overrides.employee_range !== undefined) payload['employee_range'] = overrides.employee_range;
  if (overrides.revenue_range !== undefined) payload['revenue_range'] = overrides.revenue_range;

  // Step 1: create via REST with response schema validation.
  // Server returns { account: AccountRow } — validate the envelope + inner object.
  const response = await restClient.post<{ account: TestAccount }>('/api/v1/accounts', payload, {
    schema: accountResponseEnvelopeSchema,
  });
  const account = response.body.account;

  // Step 2: register for teardown.
  testData.register('account', account.id, `/api/v1/accounts/${account.id}`);

  // Step 3: return entity.
  return account;
}

// ---------------------------------------------------------------------------
// Deal helper
// ---------------------------------------------------------------------------

/** Pipeline stages accepted by the server. */
export type DealStage =
  'Prospecting' | 'Qualification' | 'Proposal' | 'Negotiation' | 'Closed Won' | 'Closed Lost';

/**
 * Minimal representation of a MiniCRM deal as returned by POST /api/v1/deals.
 */
export interface TestDeal {
  id: string;
  name: string;
  stage: DealStage;
  value: string | null;
  currency: string;
  close_date: string | null;
  loss_reason: string | null;
  account_id: string;
  owner_id: string;
  /** Optimistic lock version */
  version: number;
}

/** Fields accepted when creating a deal. All fields optional except account_id. */
export interface CreateDealOverrides {
  name?: string;
  stage?: DealStage;
  value?: string;
  currency?: string;
  close_date?: string;
  account_id?: string;
}

/**
 * Creates a deal via the REST API, registers it with TestDataManager, and
 * returns the created deal.
 *
 * A deal requires an account. If account_id is not supplied via overrides the
 * caller must pass an account that was already created and registered.
 *
 * @param testData - TestDataManager instance for the current test.
 * @param restClient - Authenticated RestClient instance.
 * @param overrides - Field overrides; account_id is required unless supplied.
 * @returns The created deal as returned by the server.
 */
export async function createTestDeal(
  testData: TestDataManager,
  restClient: RestClient,
  overrides: CreateDealOverrides & { account_id: string },
): Promise<TestDeal> {
  // Optional fields must be omitted when unset — the server Zod schema rejects
  // explicit null for value (expects number) and close_date (expects string).
  // value is a string in the overrides interface for caller convenience but the
  // server Zod schema requires z.number(), so we coerce here.
  const payload: Record<string, string | number> = {
    name: overrides.name ?? `Test Deal ${Date.now()}`,
    stage: overrides.stage ?? 'Prospecting',
    account_id: overrides.account_id,
  };
  if (overrides.value !== undefined) payload['value'] = parseFloat(overrides.value);
  if (overrides.currency !== undefined) payload['currency'] = overrides.currency;
  if (overrides.close_date !== undefined) payload['close_date'] = overrides.close_date;

  // Server returns { deal: DealRow } — validate the envelope + inner object.
  const response = await restClient.post<{ deal: TestDeal }>('/api/v1/deals', payload, {
    schema: dealResponseEnvelopeSchema,
  });
  const deal = response.body.deal;

  testData.register('deal', deal.id, `/api/v1/deals/${deal.id}`);
  return deal;
}

// ---------------------------------------------------------------------------
// Tag helper
// ---------------------------------------------------------------------------

/**
 * Minimal representation of a MiniCRM tag as returned by POST /api/v1/tags.
 */
export interface TestTag {
  id: string;
  name: string;
}

/** Fields accepted when creating a tag. */
export interface CreateTagOverrides {
  name?: string;
}

/**
 * Creates a tag via the REST API, registers it with TestDataManager, and
 * returns the created tag.
 *
 * Tag creation is idempotent on the server — if the name already exists the
 * existing tag is returned. The helper always registers the returned ID so
 * teardown deletes it regardless.
 *
 * @param testData - TestDataManager instance for the current test.
 * @param restClient - Authenticated RestClient instance (admin required for delete).
 * @param overrides - Optional field overrides for the tag payload.
 * @returns The created tag as returned by the server.
 */
export async function createTestTag(
  testData: TestDataManager,
  restClient: RestClient,
  overrides: CreateTagOverrides = {},
): Promise<TestTag> {
  const payload = {
    name: overrides.name ?? `test-tag-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };

  // Server returns { tag: TagRow } on 201 — validate the envelope.
  const response = await restClient.post<{ tag: TestTag }>('/api/v1/tags', payload, {
    schema: tagResponseEnvelopeSchema,
  });
  const tag = response.body.tag;

  // Tags require admin to delete (DELETE /api/v1/tags/:id is admin-only).
  testData.register('tag', tag.id, `/api/v1/tags/${tag.id}`);

  return tag;
}

// ---------------------------------------------------------------------------
// Activity / task helper
// ---------------------------------------------------------------------------

/** Activity types accepted by the server. */
export type ActivityType = 'Call' | 'Email' | 'Meeting' | 'Task' | 'Note';

/**
 * Minimal representation of a MiniCRM activity as returned by POST /api/v1/activities.
 */
export interface TestActivity {
  id: string;
  type: ActivityType;
  subject: string;
  notes: string | null;
  due_date: string | null;
  status: 'open' | 'complete';
  contact_id: string | null;
  account_id: string | null;
  deal_id: string | null;
  owner_id: string;
  /** Optimistic lock version */
  version: number;
}

/** Fields accepted when creating an activity. At least one linked record is required. */
export interface CreateActivityOverrides {
  type?: ActivityType;
  subject?: string;
  notes?: string;
  due_date?: string;
  contact_id?: string;
  account_id?: string;
  deal_id?: string;
  /** Required by the server when type is 'Call' or 'Email'. */
  direction?: 'Inbound' | 'Outbound';
}

/**
 * Creates an activity (task) via the REST API, registers it with
 * TestDataManager, and returns the created activity.
 *
 * At least one of contact_id, account_id, or deal_id must be supplied via
 * overrides — the server enforces this constraint.
 *
 * @param testData - TestDataManager instance for the current test.
 * @param restClient - Authenticated RestClient instance.
 * @param overrides - Field overrides; at least one linked-record ID required.
 * @returns The created activity as returned by the server.
 */
export async function createTestActivity(
  testData: TestDataManager,
  restClient: RestClient,
  overrides: CreateActivityOverrides,
): Promise<TestActivity> {
  // Optional linked-record IDs must be omitted when unset — the server Zod
  // schema rejects explicit null values with a 400 VALIDATION_ERROR.
  const payload: Record<string, string> = {
    type: overrides.type ?? 'Task',
    subject: overrides.subject ?? `Test Task ${Date.now()}`,
  };
  if (overrides.contact_id !== undefined) payload['contact_id'] = overrides.contact_id;
  if (overrides.account_id !== undefined) payload['account_id'] = overrides.account_id;
  if (overrides.deal_id !== undefined) payload['deal_id'] = overrides.deal_id;
  if (overrides.notes !== undefined) payload['notes'] = overrides.notes;
  if (overrides.due_date !== undefined) payload['due_date'] = overrides.due_date;
  if (overrides.direction !== undefined) payload['direction'] = overrides.direction;

  // Server returns { activity: ActivityRow } — validate the envelope.
  const response = await restClient.post<{ activity: TestActivity }>(
    '/api/v1/activities',
    payload,
    {
      schema: activityResponseEnvelopeSchema,
    },
  );
  const activity = response.body.activity;

  testData.register('activity', activity.id, `/api/v1/activities/${activity.id}`);
  return activity;
}

// ---------------------------------------------------------------------------
// Lead helper
// ---------------------------------------------------------------------------

/** Minimal representation of a MiniCRM lead as returned by POST /api/v1/leads. */
export interface TestLead {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string;
  status: string;
  /** Optimistic lock version */
  version: number;
}

/** Fields accepted when creating a lead via createTestLead. */
export interface CreateLeadOverrides {
  first_name?: string;
  last_name?: string;
  email?: string;
  company_name?: string;
}

/**
 * Creates a lead via the REST API, registers it with TestDataManager,
 * and returns the created lead.
 *
 * @param testData - TestDataManager instance for the current test.
 * @param restClient - Authenticated RestClient instance.
 * @param overrides - Field overrides.
 * @returns The created lead as returned by the server.
 */
export async function createTestLead(
  testData: TestDataManager,
  restClient: RestClient,
  overrides: CreateLeadOverrides = {},
): Promise<TestLead> {
  const uniqueSuffix = Date.now();
  const payload: Record<string, string> = {
    first_name: overrides.first_name ?? `TestLead${uniqueSuffix}`,
    email: overrides.email ?? `test-lead-${uniqueSuffix}@example.com`,
  };
  if (overrides.last_name !== undefined) payload['last_name'] = overrides.last_name;
  if (overrides.company_name !== undefined) payload['company_name'] = overrides.company_name;

  const response = await restClient.post<{ lead: TestLead }>('/api/v1/leads', payload);
  const lead = response.body.lead;

  testData.register('lead', lead.id, `/api/v1/leads/${lead.id}`);
  return lead;
}

// ---------------------------------------------------------------------------
// User helper
// ---------------------------------------------------------------------------

/**
 * Minimal representation of a MiniCRM user as returned by POST /api/v1/users/invite.
 */
export interface TestUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'rep' | 'viewer' | 'manager' | 'service_account';
  status: 'active' | 'invited' | 'inactive';
}

/** Fields accepted when inviting a user. */
export interface CreateUserOverrides {
  name?: string;
  email?: string;
  role?: 'admin' | 'rep' | 'viewer' | 'manager' | 'service_account';
  /** Password to set immediately after invite via admin-set-password. */
  password?: string;
}

/**
 * Invites a user via POST /api/v1/users/invite, immediately sets their password
 * via POST /api/v1/users/set-password with the invite token, and returns the
 * created user.
 *
 * **Teardown:** registered automatically. Users cannot be hard-deleted, so
 * cleanup is a `registerCustomTeardown` entry issuing
 * `PATCH /api/v1/users/:id/deactivate` rather than a plain `register()` DELETE.
 * The entry is registered as soon as the server reports an id — before the
 * response envelope is validated, and before set-password and onboarding — so
 * every step that can throw after the row exists is covered.
 *
 * `testData` is required rather than optional deliberately: an optional
 * parameter would leave the unregistered path reachable, and forgetting it at
 * one of the call sites is the defect this helper had.
 *
 * @param testData - TestDataManager instance for the current test.
 * @param restClient - The fixture RestClient, authenticated as admin. Must
 *   outlive the test body: the teardown callback closes over it and runs after
 *   the test, so a client from `playwright.request.newContext()` that the test
 *   disposes would leave the callback throwing against a dead context.
 * @param overrides - Optional field overrides.
 * @returns The created user as returned by the server.
 */
export async function createTestUser(
  testData: TestDataManager,
  restClient: RestClient,
  overrides: CreateUserOverrides = {},
): Promise<TestUser> {
  // Resolve admin credentials BEFORE creating anything. This read used to sit
  // just above the onboarding step, where throwing left an invited user behind
  // that nothing could clean up — the registered teardown calls loginAsAdmin,
  // which needs the same variable and would throw too. Failing here means no
  // row is created, so there is nothing to leak.
  resolveAdminCredentials('createTestUser');

  // crypto.randomUUID() is cryptographically random — collision-safe under high parallelism.
  const uniqueSuffix = `${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const payload = {
    name: overrides.name ?? `BVT User ${uniqueSuffix}`,
    email: overrides.email ?? `bvt-user-${uniqueSuffix}@example.com`,
    role: overrides.role ?? 'rep',
  };

  // Post WITHOUT the schema, then validate separately below. The server commits
  // the user row before the client validates, so passing `schema` here would
  // throw on envelope drift with the row already created and no teardown
  // registered — leaking exactly the user this helper exists to clean up.
  // api-contract.spec.ts CT-3 exercises that failure deliberately.
  const response = await restClient.post<{ user: TestUser; inviteToken: string }>(
    '/api/v1/users/invite',
    payload,
  );

  // Register as soon as an id is readable, before any assertion about shape.
  // Search the envelope for the id rather than hard-coding `body.user.id`: the
  // likeliest drift is the `user` key itself being renamed, and a TypeError
  // there would skip registration and leak the row the server already
  // committed — the very failure this ordering exists to prevent.
  const createdId = findCreatedUserId(response.body);
  if (createdId !== undefined) {
    registerUserDeactivation(testData, restClient, createdId);
  }

  // Now enforce the response contract. A failure here still tears
  // the user down, because registration already happened. RestClientError
  // rather than a plain Error so callers keep the status, body, and structured
  // Zod detail that `parseResponse` would have given them.
  const parsed = inviteUserResponseEnvelopeSchema.safeParse(response.body);
  if (!parsed.success) {
    throw new RestClientError(
      response.status,
      response.body,
      parsed.error,
      `POST /api/v1/users/invite response failed schema validation: ${parsed.error.message}`,
    );
  }
  const { user, inviteToken } = parsed.data;

  // Use POST /api/v1/users/set-password with the invite token rather than
  // admin-set-password. admin-set-password forces must_change_password=true,
  // which causes a password-change redirect on the invited user's first login
  // and breaks the BVT login assertion. set-password with the invite token
  // activates the account with must_change_password=false.
  const password = overrides.password ?? 'BvtPassword1!';
  await restClient.post('/api/v1/users/set-password', { token: inviteToken, password });

  // Suppress the onboarding widget for this test user so it does not appear
  // as a z-50 fixed overlay and intercept pointer events in other tests.
  await restClient.post('/api/v1/auth/login', { email: user.email, password });
  try {
    await restClient.put('/api/v1/settings/onboarding', { onboarding_completed: true });
  } finally {
    // Always re-authenticate as admin so the caller's restClient is back in admin
    // context, even if the onboarding PUT throws. loginAsAdmin rather than a raw
    // POST: it retries once on ECONNRESET, which the set-password bcrypt hash a
    // few lines above makes this the likeliest call site to need.
    await loginAsAdmin(restClient);
  }

  return { ...user, status: 'active' };
}

// ---------------------------------------------------------------------------
// Ephemeral user helpers
// ---------------------------------------------------------------------------

/** Credentials returned by createTestRep / createTestAdmin. */
export interface EphemeralUserCredentials {
  userId: string;
  email: string;
  password: string;
}

/** Optional overrides for ephemeral user creation. */
export interface InviteUserParams {
  name?: string;
  email?: string;
}

/**
 * Creates an ephemeral rep user for a single test.
 *
 * Wraps inviteUserViaApi + setUserPassword + suppressUserOnboarding in one
 * call. Registers a deactivation callback with TestDataManager so the user
 * is deactivated automatically after the test, even on failure.
 *
 * Every test that drives the browser as a non-admin user should call this
 * instead of createTestUser() so cleanup is guaranteed and the onboarding
 * widget never appears during the test.
 *
 * @param testData - TestDataManager instance for the current test.
 * @param restClient - Admin-authenticated RestClient.
 * @param overrides - Optional name / email overrides.
 * @returns Credentials for the created rep user.
 */
export async function createTestRep(
  testData: TestDataManager,
  restClient: RestClient,
  overrides: InviteUserParams = {},
): Promise<EphemeralUserCredentials> {
  const uniqueSuffix = `${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const email = overrides.email ?? `rep-${uniqueSuffix}@example.com`;
  const name = overrides.name ?? `Rep ${uniqueSuffix}`;
  const password = 'BvtPassword1!';

  const { user, inviteToken } = await inviteUserViaApi(restClient, { name, email, role: 'rep' });

  // Register before set-password and onboarding, not after: the row exists from
  // the moment the invite returns, and both steps below are network calls that
  // can throw with the user already created.
  registerUserDeactivation(testData, restClient, user.id, 'rep');

  await setUserPassword(restClient, inviteToken, password);
  await suppressUserOnboarding(restClient, email, password);

  return { userId: user.id, email, password };
}

/**
 * Creates an ephemeral admin user for a single test.
 *
 * Identical to createTestRep() but the user is invited with role='admin'.
 * Use this for tests that exercise admin-only functionality (user management,
 * pipeline stages, branding, webhooks, system settings) so the shared admin
 * account is never mutated.
 *
 * @param testData - TestDataManager instance for the current test.
 * @param restClient - Admin-authenticated RestClient.
 * @param overrides - Optional name / email overrides.
 * @returns Credentials for the created admin user.
 */
export async function createTestAdmin(
  testData: TestDataManager,
  restClient: RestClient,
  overrides: InviteUserParams = {},
): Promise<EphemeralUserCredentials> {
  const uniqueSuffix = `${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const email = overrides.email ?? `admin-${uniqueSuffix}@example.com`;
  const name = overrides.name ?? `Admin ${uniqueSuffix}`;
  const password = 'BvtPassword1!';

  const { user, inviteToken } = await inviteUserViaApi(restClient, { name, email, role: 'admin' });

  // Register before set-password and onboarding, not after: the row exists from
  // the moment the invite returns, and both steps below are network calls that
  // can throw with the user already created.
  registerUserDeactivation(testData, restClient, user.id, 'admin');

  await setUserPassword(restClient, inviteToken, password);
  await suppressUserOnboarding(restClient, email, password);

  return { userId: user.id, email, password };
}

/**
 * Logs in via the REST API and verifies the session is active before returning.
 *
 * Use this instead of a bare `restClient.post('/api/v1/auth/login', ...)` when the
 * client will immediately make authenticated requests — the GET /api/v1/auth/me call
 * confirms the session cookie has been set and the server has accepted it, which
 * prevents race conditions under parallel CI load.
 *
 * @param restClient - RestClient instance to authenticate.
 * @param email - User email address.
 * @param password - User password.
 */
export async function loginAndVerify(
  restClient: RestClient,
  email: string,
  password: string,
): Promise<void> {
  await restClient.post('/api/v1/auth/login', { email, password });
  // Validate the /me response envelope so a session-shape regression fails here
  // immediately rather than surfacing as a type error in downstream helpers.
  await restClient.get('/api/v1/auth/me', { schema: authMeResponseEnvelopeSchema });
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

/** How long to wait for the feature-flag query that gates flag-dependent subtrees. */
const FLAG_QUERY_TIMEOUT_MS = 15_000;

/**
 * Probe budget for the FIRST interaction with a control that renders only after
 * an async gate resolves.
 *
 * The healing locator probes each strategy for 2s by default, which is right for
 * an element already on the page and wrong for the first click after a
 * navigation. `navigateAndSettle` waits on `requestfinished` for the flags query,
 * which fires when the HTTP response lands — NOT when React has re-rendered the
 * subtree that response unblocks. `EntityDetailSidebar` renders `<ActivityTimeline>`
 * only under `!activitiesLoading && activitiesEnabled`, so between the response
 * and the commit the control is genuinely absent from the DOM, and under CI's four
 * concurrent workers that gap can outlast a 2s probe. The probe then gives up
 * before the element can exist, and reports StrategyExhaustedError — which reads
 * as selector drift. That is how F-AS2 failed on `add-activity-button` while
 * three sibling shards passed.
 *
 * So the budget covers render latency after a settled request, not a second
 * unwaited fetch. Deliberately equal to FLAG_QUERY_TIMEOUT_MS above: both absorb
 * the same contended-server tail. Pass it explicitly at the racy call site rather
 * than raising DEFAULT_FALLBACK_TIMEOUT_MS, so genuine selector drift still fails
 * in 2s everywhere else instead of stalling a 50-minute suite.
 */
export const FIRST_INTERACTION_TIMEOUT_MS = 15_000;

/**
 * Navigates and then waits for the app to be genuinely ready to query, rather
 * than for the network to fall quiet.
 *
 * `waitUntil: 'networkidle'` is not a readiness signal here. Under the CI Vite
 * dev server every lazy route is a separate uncached module request, so the
 * 500ms idle window can elapse during the JS module waterfall — before the
 * page's own API queries have even been registered. A CI trace measured
 * networkidle returning 1.7s before the deal page issued its first request.
 *
 * What actually gates rendering is `GET /api/v1/feature-flags/me`: useFeatureFlag
 * backs every flag check with that one cached query, and EntityDetailSidebar
 * will not mount the tags, activity, or notes subtrees until it resolves — so
 * their elements do not exist, and a locator probing for them fails against a
 * DOM that is merely early, not wrong. Worse, one-shot `page.evaluate` sweeps
 * that assert emptiness (the pseudo-locale hardcoded-string and overflow scans)
 * silently PASS against a half-rendered page.
 *
 * The listener is armed before `goto` so a fast response cannot be missed. The
 * wait is tolerant by design: the query is cached per browser context, so a
 * second navigation in the same test legitimately issues no new request — and
 * `domcontentloaded` alone is a correct floor for pages with no flag-gated
 * content. Never silently swallow a real failure; this only tolerates absence.
 */
export async function gotoAndSettle(page: SafePage, url: string): Promise<void> {
  await navigateAndSettle(page, () => page.goto(url, { waitUntil: 'domcontentloaded' }));
}

/**
 * As `gotoAndSettle`, but for navigations that are not a `goto` — `reload`,
 * `goBack`, `goForward`. Same rationale; the caller supplies the action so the
 * flag listener can be armed before it starts.
 */
export async function navigateAndSettle(
  page: SafePage,
  navigate: () => Promise<unknown>,
): Promise<void> {
  // Waits on `requestfinished`, NOT waitForResponse.
  //
  // withFlags installs a route interceptor that calls `route.fetch()` and then
  // `route.fulfill()` with the overridden flags. `route.fetch()` issues its own
  // request to the real endpoint, and waitForResponse matches THAT — resolving
  // before fulfill() has delivered the override, so navigation proceeds while
  // the page still holds the real flag values. F7-DH3 caught this: it asserts a
  // panel is hidden with the flag off, and saw it visible.
  //
  // `requestfinished` fires when the page's own request completes, which for an
  // intercepted route is after fulfill() — so it observes the value the app
  // actually receives rather than the one the interceptor was about to rewrite.
  const flagsSettled = page
    .waitForEvent('requestfinished', {
      predicate: (request) => request.url().includes('/api/v1/feature-flags/me'),
      timeout: FLAG_QUERY_TIMEOUT_MS,
    })
    .catch(() => undefined);

  await navigate();
  await flagsSettled;
}

export async function navigateToContact(page: SafePage, id: string): Promise<void> {
  await gotoAndSettle(page, `/contacts/${id}`);
}

export async function navigateToAccount(page: SafePage, id: string): Promise<void> {
  await gotoAndSettle(page, `/accounts/${id}`);
}

export async function navigateToDeal(page: SafePage, id: string): Promise<void> {
  await gotoAndSettle(page, `/deals/${id}`);
}

export async function navigateToLead(page: SafePage, id: string): Promise<void> {
  await gotoAndSettle(page, `/leads/${id}`);
}

export async function navigateToContacts(page: SafePage): Promise<void> {
  await gotoAndSettle(page, '/contacts');
}

export async function navigateToAccounts(page: SafePage): Promise<void> {
  await gotoAndSettle(page, '/accounts');
}

export async function navigateToDashboard(page: SafePage): Promise<void> {
  await gotoAndSettle(page, '/');
}

export async function navigateToAdminSettings(page: SafePage): Promise<void> {
  await gotoAndSettle(page, '/admin/settings');
}

// ---------------------------------------------------------------------------
// Feature flag route interception
// ---------------------------------------------------------------------------

/**
 * Intercepts GET /api/v1/feature-flags/me for the given page or browser context
 * and merges the provided overrides into the response. All unspecified flags
 * retain the seed defaults returned by the server.
 *
 * Scoped to the browser context, so it is parallel-safe and never mutates
 * global DB state. Must be called before page.goto() so the route handler is
 * registered before the first navigation triggers the flag fetch.
 *
 * @example
 * await withFlags(page, { reporting: false });
 * await page.goto('/');
 * await expect(page.getByTestId('nav-top-reports')).not.toBeVisible();
 */
export async function withFlags(
  pageOrContext: Page | BrowserContext,
  overrides: Record<string, boolean>,
): Promise<void> {
  await pageOrContext.route('**/api/v1/feature-flags/me', async (route) => {
    // The page or context may be torn down while a flag fetch is still in flight
    // (e.g. during afterEach cleanup). Swallow the closed-context error so it
    // does not propagate as an unhandled rejection and fail the test.
    try {
      const response = await route.fetch();
      const body = (await response.json()) as { flags: Record<string, boolean> };
      const merged: { flags: Record<string, boolean> } = {
        ...body,
        flags: { ...body.flags, ...overrides },
      };
      await route.fulfill({ json: merged });
    } catch {
      // The inner route.fetch() failed. Two situations reach here and they need
      // different handling:
      //
      //  - The page/context was torn down mid-flight (afterEach cleanup).
      //    Nothing can be done and nothing needs to be: the test is over.
      //  - The fetch failed while the test is still running. Returning without
      //    fulfilling leaves the browser's request PENDING FOREVER — which is
      //    what the F7-DH3 trace recorded (two flag requests, status -1, never
      //    completed). A hung request is the worst outcome: the query never
      //    settles, so a test waiting for flag-gated content waits out its full
      //    timeout with no diagnosable cause.
      //
      // abort() terminates the request so the query settles into an error state
      // instead of hanging. Since a later change, an unresolved flag map means every
      // feature reads as OFF, so a negative-direction assertion still gets the
      // right answer, and a positive-direction one fails fast and legibly rather
      // than timing out.
      if (!route.request().frame().page().isClosed()) {
        await route.abort().catch(() => undefined);
      }
    }
  });
}
