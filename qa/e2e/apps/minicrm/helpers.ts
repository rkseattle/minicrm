/**
 * MiniCRM setup helpers — canonical pattern for creating test entities.
 *
 * MINCRM-110
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
 * MINCRM-129, MINCRM-110
 */

import type { Page, BrowserContext } from '@playwright/test';
import type { RestClient } from '@framework/clients/rest-client.js';
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
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';

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
 * (see docs/dev/dates-and-timezones.md). (MINCRM-700)
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
 * Minimal representation of a MiniCRM contact as returned by POST /api/contacts.
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
  /** Optimistic lock version (MINCRM-349) */
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
 * Minimal representation of a MiniCRM account as returned by POST /api/accounts.
 */
export interface TestAccount {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  employee_range: string | null;
  revenue_range: string | null;
  owner_id: string;
  /** Optimistic lock version (MINCRM-349) */
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

  // Step 1: create via REST with response schema validation (MINCRM-229).
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

  // Step 1: create via REST with response schema validation (MINCRM-229).
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
 * Minimal representation of a MiniCRM deal as returned by POST /api/deals.
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
  /** Optimistic lock version (MINCRM-349) */
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
  // server Zod schema requires z.number(), so we coerce here. (MINCRM-189)
  const payload: Record<string, string | number> = {
    name: overrides.name ?? `Test Deal ${Date.now()}`,
    stage: overrides.stage ?? 'Prospecting',
    account_id: overrides.account_id,
  };
  if (overrides.value !== undefined) payload['value'] = parseFloat(overrides.value);
  if (overrides.currency !== undefined) payload['currency'] = overrides.currency;
  if (overrides.close_date !== undefined) payload['close_date'] = overrides.close_date;

  // Server returns { deal: DealRow } — validate the envelope + inner object (MINCRM-229).
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
 * Minimal representation of a MiniCRM tag as returned by POST /api/tags.
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

  // Server returns { tag: TagRow } on 201 — validate the envelope (MINCRM-370).
  const response = await restClient.post<{ tag: TestTag }>('/api/v1/tags', payload, {
    schema: tagResponseEnvelopeSchema,
  });
  const tag = response.body.tag;

  // Tags require admin to delete (DELETE /api/tags/:id is admin-only).
  testData.register('tag', tag.id, `/api/v1/tags/${tag.id}`);

  return tag;
}

// ---------------------------------------------------------------------------
// Activity / task helper
// ---------------------------------------------------------------------------

/** Activity types accepted by the server. */
export type ActivityType = 'Call' | 'Email' | 'Meeting' | 'Task' | 'Note';

/**
 * Minimal representation of a MiniCRM activity as returned by POST /api/activities.
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
  /** Optimistic lock version (MINCRM-349) */
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

  // Server returns { activity: ActivityRow } — validate the envelope (MINCRM-370).
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
// Lead helper (MINCRM-400)
// ---------------------------------------------------------------------------

/** Minimal representation of a MiniCRM lead as returned by POST /api/v1/leads. */
export interface TestLead {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string;
  status: string;
  /** Optimistic lock version (MINCRM-349) */
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
 * Minimal representation of a MiniCRM user as returned by POST /api/users/invite.
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
 * Invites a user via POST /api/users/invite, immediately sets their password
 * via POST /api/users/set-password with the invite token, and returns the
 * created user.
 *
 * **Teardown note:** Users cannot be hard-deleted; `TestDataManager` tears down
 * via DELETE which does not match `PATCH /api/users/:id/deactivate`. This helper
 * does NOT register with TestDataManager. Callers must deactivate the user
 * manually, e.g. via a `try/finally` block with `PATCH /api/users/:id/deactivate`.
 *
 * @param restClient - Authenticated RestClient instance (must be admin).
 * @param overrides - Optional field overrides.
 * @returns The created user as returned by the server.
 */
export async function createTestUser(
  restClient: RestClient,
  overrides: CreateUserOverrides = {},
): Promise<TestUser> {
  // crypto.randomUUID() is cryptographically random — collision-safe under high parallelism.
  const uniqueSuffix = `${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const payload = {
    name: overrides.name ?? `BVT User ${uniqueSuffix}`,
    email: overrides.email ?? `bvt-user-${uniqueSuffix}@example.com`,
    role: overrides.role ?? 'rep',
  };

  // Server returns { user, inviteToken } — validate the envelope (MINCRM-370).
  const response = await restClient.post<{ user: TestUser; inviteToken: string }>(
    '/api/v1/users/invite',
    payload,
    { schema: inviteUserResponseEnvelopeSchema },
  );
  const { user, inviteToken } = response.body;

  // Use POST /api/users/set-password with the invite token rather than
  // admin-set-password. admin-set-password forces must_change_password=true,
  // which causes a password-change redirect on the invited user's first login
  // and breaks the BVT login assertion. set-password with the invite token
  // activates the account with must_change_password=false.
  const password = overrides.password ?? 'BvtPassword1!';
  await restClient.post('/api/v1/users/set-password', { token: inviteToken, password });

  // Suppress the onboarding widget for this test user so it does not appear
  // as a z-50 fixed overlay and intercept pointer events in other tests. (MINCRM-410)
  const adminEmail = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
  const adminPassword = process.env['E2E_ADMIN_PASSWORD'];
  if (!adminPassword) throw new Error('[createTestUser] E2E_ADMIN_PASSWORD is not set');
  await restClient.post('/api/v1/auth/login', { email: user.email, password });
  try {
    await restClient.put('/api/v1/settings/onboarding', { onboarding_completed: true });
  } finally {
    // Always re-authenticate as admin so the caller's restClient is back in admin context,
    // even if the onboarding PUT throws.
    await restClient.post('/api/v1/auth/login', { email: adminEmail, password: adminPassword });
  }

  return { ...user, status: 'active' };
}

// ---------------------------------------------------------------------------
// Ephemeral user helpers (MINCRM-415)
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
 * widget never appears during the test. (MINCRM-415)
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
  await setUserPassword(restClient, inviteToken, password);
  await suppressUserOnboarding(restClient, email, password);

  // Register deactivation as a custom teardown — users cannot be hard-deleted.
  // Re-auth as admin first: tests may re-auth restClient as the rep for data
  // creation, and deactivateUser requires admin. (MINCRM-415)
  testData.registerCustomTeardown(`deactivate-rep-${user.id}`, async () => {
    await loginAsAdmin(restClient);
    await deactivateUser(restClient, user.id);
  });

  return { userId: user.id, email, password };
}

/**
 * Creates an ephemeral admin user for a single test.
 *
 * Identical to createTestRep() but the user is invited with role='admin'.
 * Use this for tests that exercise admin-only functionality (user management,
 * pipeline stages, branding, webhooks, system settings) so the shared admin
 * account is never mutated. (MINCRM-415)
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
  await setUserPassword(restClient, inviteToken, password);
  await suppressUserOnboarding(restClient, email, password);

  testData.registerCustomTeardown(`deactivate-admin-${user.id}`, async () => {
    await loginAsAdmin(restClient);
    await deactivateUser(restClient, user.id);
  });

  return { userId: user.id, email, password };
}

/**
 * Logs in via the REST API and verifies the session is active before returning.
 *
 * Use this instead of a bare `restClient.post('/api/v1/auth/login', ...)` when the
 * client will immediately make authenticated requests — the GET /api/auth/me call
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
  // immediately rather than surfacing as a type error in downstream helpers (MINCRM-370).
  await restClient.get('/api/v1/auth/me', { schema: authMeResponseEnvelopeSchema });
}

// ---------------------------------------------------------------------------
// Navigation helpers (MINCRM-205)
// ---------------------------------------------------------------------------

export async function navigateToContact(page: SafePage, id: string): Promise<void> {
  await page.goto(`/contacts/${id}`, { waitUntil: 'networkidle' });
}

export async function navigateToAccount(page: SafePage, id: string): Promise<void> {
  await page.goto(`/accounts/${id}`, { waitUntil: 'networkidle' });
}

export async function navigateToDeal(page: SafePage, id: string): Promise<void> {
  await page.goto(`/deals/${id}`, { waitUntil: 'networkidle' });
}

export async function navigateToLead(page: SafePage, id: string): Promise<void> {
  await page.goto(`/leads/${id}`, { waitUntil: 'networkidle' });
}

export async function navigateToContacts(page: SafePage): Promise<void> {
  await page.goto('/contacts', { waitUntil: 'networkidle' });
}

export async function navigateToAccounts(page: SafePage): Promise<void> {
  await page.goto('/accounts', { waitUntil: 'networkidle' });
}

export async function navigateToDashboard(page: SafePage): Promise<void> {
  await page.goto('/', { waitUntil: 'networkidle' });
}

export async function navigateToAdminSettings(page: SafePage): Promise<void> {
  await page.goto('/admin/settings', { waitUntil: 'networkidle' });
}

// ---------------------------------------------------------------------------
// Feature flag route interception (MINCRM-477)
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
      // Context closed before the route could be fulfilled — safe to ignore.
    }
  });
}
