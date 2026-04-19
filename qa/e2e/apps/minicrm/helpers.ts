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

import type { Page } from '@playwright/test';
import type { RestClient } from '@framework/clients/rest-client.js';
import type { TestDataManager } from './test-data-manager.js';

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

  // Step 1: create via REST.
  // Server returns { contact: ContactRow } — unwrap the nested object.
  const response = await restClient.post<{ contact: TestContact }>('/api/contacts', payload);
  const contact = response.body.contact;

  // Step 2: register for teardown immediately so cleanup runs even if the
  // test throws before completing setup.
  testData.register('contact', contact.id, `/api/contacts/${contact.id}`);

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

  // Step 1: create via REST.
  // Server returns { account: AccountRow } — unwrap the nested object.
  const response = await restClient.post<{ account: TestAccount }>('/api/accounts', payload);
  const account = response.body.account;

  // Step 2: register for teardown.
  testData.register('account', account.id, `/api/accounts/${account.id}`);

  // Step 3: return entity.
  return account;
}

// ---------------------------------------------------------------------------
// Deal helper
// ---------------------------------------------------------------------------

/** Pipeline stages accepted by the server. */
export type DealStage =
  | 'Prospecting'
  | 'Qualification'
  | 'Proposal'
  | 'Negotiation'
  | 'Closed Won'
  | 'Closed Lost';

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

  // Server returns { deal: DealRow } — unwrap.
  const response = await restClient.post<{ deal: TestDeal }>('/api/deals', payload);
  const deal = response.body.deal;

  testData.register('deal', deal.id, `/api/deals/${deal.id}`);
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

  // Server returns { tag: TagRow } on 201.
  const response = await restClient.post<{ tag: TestTag }>('/api/tags', payload);
  const tag = response.body.tag;

  // Tags require admin to delete (DELETE /api/tags/:id is admin-only).
  testData.register('tag', tag.id, `/api/tags/${tag.id}`);

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

  // Server returns { activity: ActivityRow } — unwrap.
  const response = await restClient.post<{ activity: TestActivity }>('/api/activities', payload);
  const activity = response.body.activity;

  testData.register('activity', activity.id, `/api/activities/${activity.id}`);
  return activity;
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
  role: 'admin' | 'rep';
  status: 'active' | 'invited' | 'inactive';
}

/** Fields accepted when inviting a user. */
export interface CreateUserOverrides {
  name?: string;
  email?: string;
  role?: 'admin' | 'rep';
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

  // Server returns { user, inviteToken }.
  const response = await restClient.post<{ user: TestUser; inviteToken: string }>(
    '/api/users/invite',
    payload,
  );
  const { user, inviteToken } = response.body;

  // Use POST /api/users/set-password with the invite token rather than
  // admin-set-password. admin-set-password forces must_change_password=true,
  // which causes a password-change redirect on the invited user's first login
  // and breaks the BVT login assertion. set-password with the invite token
  // activates the account with must_change_password=false.
  const password = overrides.password ?? 'BvtPassword1!';
  await restClient.post('/api/users/set-password', { token: inviteToken, password });

  return { ...user, status: 'active' };
}

/**
 * Logs in via the REST API and verifies the session is active before returning.
 *
 * Use this instead of a bare `restClient.post('/api/auth/login', ...)` when the
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
  await restClient.post('/api/auth/login', { email, password });
  await restClient.get('/api/auth/me');
}

// ---------------------------------------------------------------------------
// Navigation helpers (MINCRM-205)
// ---------------------------------------------------------------------------

export async function navigateToContact(page: Page, id: string): Promise<void> {
  await page.goto(`/contacts/${id}`, { waitUntil: 'networkidle' });
}

export async function navigateToAccount(page: Page, id: string): Promise<void> {
  await page.goto(`/accounts/${id}`, { waitUntil: 'networkidle' });
}

export async function navigateToDeal(page: Page, id: string): Promise<void> {
  await page.goto(`/deals/${id}`, { waitUntil: 'networkidle' });
}

export async function navigateToContacts(page: Page): Promise<void> {
  await page.goto('/contacts', { waitUntil: 'networkidle' });
}

export async function navigateToAccounts(page: Page): Promise<void> {
  await page.goto('/accounts', { waitUntil: 'networkidle' });
}

export async function navigateToDashboard(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'networkidle' });
}

export async function navigateToAdminSettings(page: Page): Promise<void> {
  await page.goto('/admin/settings', { waitUntil: 'networkidle' });
}
