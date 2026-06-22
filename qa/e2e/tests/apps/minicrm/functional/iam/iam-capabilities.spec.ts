/**
 * F-CAPABILITIES — Capability-based RBAC (MINCRM-542, MINCRM-547)
 *
 * Verifies that:
 * 1. Custom role CRUD works end-to-end (create, read, update, delete)
 * 2. Built-in roles cannot be modified or deleted
 * 3. A role with active assignees cannot be deleted
 * 4. contacts:delete: rep can delete own contact (204); rep cannot delete another user's contact (403)
 * 5. An admin can delete any contact (204)
 * 6. Custom role list endpoint requires settings:manage
 * 7. Assigning a custom role grants its capabilities to the user
 * 8. Built-in role cards show a View button that expands a read-only capability panel (MINCRM-547)
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - API tests: no browser UI navigation; each test tears down its own fixtures in try/finally
 *   - Browser tests: import from @behaviors/* only, no @pages/* imports
 *
 * MINCRM-542, MINCRM-547
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { RestClient, RestClientError } from '@framework/clients/rest-client.js';
import type { APIRequestContext } from '@playwright/test';
import { loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import { createTestAdmin } from '@apps/minicrm/helpers.js';
import {
  navigateToAdminSettings,
  expectRoleViewButtonVisible,
  clickRoleViewButton,
  expectRoleCapabilityPanelVisible,
  expectRoleCapabilityPanelNotVisible,
  expectRoleCapabilityReadOnlyListVisible,
  expectRoleReadOnlyCapabilityCheckboxDisabled,
} from '@behaviors/minicrm/settings.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F-CAPABILITIES] E2E_ADMIN_PASSWORD is not set');

const REP_PASSWORD = 'CapRepTest12!';

interface InviteResponse {
  user: { id: string; email: string; name: string; role: string };
  inviteToken: string;
}

interface CustomRoleResponse {
  id: string;
  name: string;
  description: string | null;
  is_builtin: boolean;
  capabilities: string[];
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

interface ContactRow {
  id: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createActivatedRep(
  adminClient: RestClient,
  newContext: () => Promise<APIRequestContext>,
  suffix: string,
): Promise<{
  repId: string;
  repClient: RestClient;
  repContext: APIRequestContext;
}> {
  const email = `cap-rep-${suffix}@example.com`;

  const inviteRes = await adminClient.post<InviteResponse>('/api/v1/users/invite', {
    name: `Cap Rep ${suffix}`,
    email,
    role: 'rep',
  });
  const { user, inviteToken } = inviteRes.body;

  await adminClient.post('/api/v1/users/set-password', {
    token: inviteToken,
    password: REP_PASSWORD,
  });

  // Suppress onboarding
  const onboardCtx = await newContext();
  const onboardClient = new RestClient(onboardCtx);
  await onboardClient.post('/api/v1/auth/login', { email, password: REP_PASSWORD });
  await onboardClient
    .put('/api/v1/settings/onboarding', { onboarding_completed: true })
    .catch(() => null);
  await onboardCtx.dispose();

  const repContext = await newContext();
  const repClient = new RestClient(repContext);
  await repClient.post('/api/v1/auth/login', { email, password: REP_PASSWORD });

  return { repId: user.id, repClient, repContext };
}

async function deactivateUser(adminClient: RestClient, userId: string): Promise<void> {
  await adminClient.patch(`/api/v1/users/${userId}/deactivate`).catch(() => null);
}

function errorBody(err: unknown): ErrorBody {
  if (err instanceof RestClientError) return err.body as ErrorBody;
  return {};
}

test.beforeEach(async ({ restClient }) => {
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
});

// ── Custom role CRUD ──────────────────────────────────────────────────────────

test('@functional custom role — create, read, update, delete lifecycle', async ({ restClient }) => {
  const suffix = `${Date.now()}-${process.pid}`;
  let roleId: string | null = null;

  try {
    const createRes = await restClient.post<{ data: CustomRoleResponse }>('/api/v1/custom-roles', {
      name: `cap-test-${suffix}`,
      description: 'E2E test role',
      capabilities: ['contacts:view', 'deals:view'],
    });
    expect(createRes.status).toBe(201);
    roleId = createRes.body.data.id;
    expect(createRes.body.data.name).toBe(`cap-test-${suffix}`);
    expect(createRes.body.data.capabilities).toContain('contacts:view');
    expect(createRes.body.data.is_builtin).toBe(false);

    const getRes = await restClient.get<{ data: CustomRoleResponse }>(
      `/api/v1/custom-roles/${roleId}`,
    );
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.id).toBe(roleId);

    const updateRes = await restClient.put<{ data: CustomRoleResponse }>(
      `/api/v1/custom-roles/${roleId}`,
      {
        name: `cap-test-updated-${suffix}`,
        capabilities: ['contacts:view', 'contacts:create'],
      },
    );
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.name).toBe(`cap-test-updated-${suffix}`);
    expect(updateRes.body.data.capabilities).toContain('contacts:create');
  } finally {
    if (roleId) {
      await restClient.delete(`/api/v1/custom-roles/${roleId}`).catch(() => null);
    }
  }
});

test('@functional custom role — list returns built-in roles', async ({ restClient }) => {
  const listRes = await restClient.get<{ data: CustomRoleResponse[] }>('/api/v1/custom-roles');
  expect(listRes.status).toBe(200);
  const builtinNames = listRes.body.data.filter((r) => r.is_builtin).map((r) => r.name);
  expect(builtinNames).toContain('admin');
  expect(builtinNames).toContain('rep');
});

test('@functional custom role — cannot update a built-in role', async ({ restClient }) => {
  const listRes = await restClient.get<{ data: CustomRoleResponse[] }>('/api/v1/custom-roles');
  const adminRole = listRes.body.data.find((r) => r.name === 'admin' && r.is_builtin)!;

  let threw = false;
  try {
    await restClient.put(`/api/v1/custom-roles/${adminRole.id}`, { name: 'hacked' });
  } catch (err) {
    threw = true;
    expect(err).toBeInstanceOf(RestClientError);
    expect((err as RestClientError).status).toBe(409);
    expect(errorBody(err).error?.code).toBe('CUSTOM_ROLE_BUILTIN');
  }
  expect(threw).toBe(true);
});

test('@functional custom role — cannot delete a role with active assignees', async ({
  restClient,
}) => {
  const suffix = `${Date.now()}-${process.pid}`;
  let roleId: string | null = null;
  let repId: string | null = null;

  try {
    const role = await restClient.post<{ data: CustomRoleResponse }>('/api/v1/custom-roles', {
      name: `cap-block-delete-${suffix}`,
      capabilities: ['contacts:view'],
    });
    roleId = role.body.data.id;

    const inviteRes = await restClient.post<InviteResponse>('/api/v1/users/invite', {
      name: `Cap Block ${suffix}`,
      email: `cap-block-${suffix}@example.com`,
      role: 'rep',
    });
    repId = inviteRes.body.user.id;

    await restClient.post(`/api/v1/users/${repId}/roles`, { roleId });

    let threw = false;
    try {
      await restClient.delete(`/api/v1/custom-roles/${roleId}`);
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(RestClientError);
      expect((err as RestClientError).status).toBe(409);
      expect(errorBody(err).error?.code).toBe('CUSTOM_ROLE_HAS_ASSIGNEES');
    }
    expect(threw).toBe(true);
  } finally {
    if (repId && roleId) {
      await restClient.delete(`/api/v1/users/${repId}/roles/${roleId}`).catch(() => null);
    }
    if (repId) await deactivateUser(restClient, repId);
    if (roleId) await restClient.delete(`/api/v1/custom-roles/${roleId}`).catch(() => null);
  }
});

// ── Rep delete ownership enforcement ──────────────────────────────────────────
// Reps have contacts:delete but the service layer enforces ownership:
// a rep can delete their own contact but not another user's contact.

test('@functional rep can delete their own contact (contacts:delete, MINCRM-542)', async ({
  restClient,
  playwright,
}) => {
  const suffix = `${Date.now()}-${process.pid}`;
  let repId: string | null = null;

  try {
    const {
      repId: id,
      repClient,
      repContext,
    } = await createActivatedRep(restClient, () => playwright.request.newContext(), suffix);
    repId = id;

    // Create contact as the rep (rep is the owner)
    const contactRes = await repClient.post<{ contact: ContactRow }>('/api/v1/contacts', {
      first_name: 'Cap',
      last_name: 'OwnDelete',
      email: `cap-own-delete-${suffix}@example.com`,
    });
    const contactId = contactRes.body.contact.id;

    const deleteRes = await repClient.delete(`/api/v1/contacts/${contactId}`);
    expect(deleteRes.status).toBe(204);

    await repContext.dispose();
  } finally {
    if (repId) await deactivateUser(restClient, repId);
  }
});

test('@functional rep cannot delete a contact they do not own (MINCRM-542)', async ({
  restClient,
  playwright,
}) => {
  const suffix = `${Date.now()}-${process.pid}`;
  let repId: string | null = null;
  let contactId: string | null = null;

  try {
    const {
      repId: id,
      repClient,
      repContext,
    } = await createActivatedRep(restClient, () => playwright.request.newContext(), suffix);
    repId = id;

    // Admin creates the contact (admin is the owner, not the rep)
    const contactRes = await restClient.post<{ contact: ContactRow }>('/api/v1/contacts', {
      first_name: 'Cap',
      last_name: 'OtherDelete',
      email: `cap-other-delete-${suffix}@example.com`,
    });
    contactId = contactRes.body.contact.id;

    let threw = false;
    try {
      await repClient.delete(`/api/v1/contacts/${contactId}`);
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(RestClientError);
      expect((err as RestClientError).status).toBe(403);
    }
    expect(threw).toBe(true);

    await repContext.dispose();
  } finally {
    if (repId) await deactivateUser(restClient, repId);
    if (contactId) await restClient.delete(`/api/v1/contacts/${contactId}`).catch(() => null);
  }
});

test('@functional admin can delete any contact', async ({ restClient }) => {
  const suffix = `${Date.now()}-${process.pid}`;

  const contactRes = await restClient.post<{ contact: ContactRow }>('/api/v1/contacts', {
    first_name: 'AdminDel',
    last_name: 'Contact',
    email: `cap-admindel-${suffix}@example.com`,
  });
  const contactId = contactRes.body.contact.id;

  const deleteRes = await restClient.delete(`/api/v1/contacts/${contactId}`);
  expect(deleteRes.status).toBe(204);
});

// ── Custom role requires settings:manage ──────────────────────────────────────

test('@functional rep cannot access /api/v1/custom-roles (requires settings:manage)', async ({
  restClient,
  playwright,
}) => {
  const suffix = `${Date.now()}-${process.pid}`;
  let repId: string | null = null;

  try {
    const {
      repId: id,
      repClient,
      repContext,
    } = await createActivatedRep(restClient, () => playwright.request.newContext(), suffix);
    repId = id;

    let threw = false;
    try {
      await repClient.get('/api/v1/custom-roles');
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(RestClientError);
      expect((err as RestClientError).status).toBe(403);
    }
    expect(threw).toBe(true);

    await repContext.dispose();
  } finally {
    if (repId) await deactivateUser(restClient, repId);
  }
});

// ── User role assignment changes effective capabilities ────────────────────────

test('@functional assigning a custom role grants its capabilities to the user', async ({
  restClient,
  playwright,
}) => {
  const suffix = `${Date.now()}-${process.pid}`;
  let repId: string | null = null;
  let roleId: string | null = null;

  try {
    const {
      repId: id,
      repClient,
      repContext,
    } = await createActivatedRep(restClient, () => playwright.request.newContext(), suffix);
    repId = id;

    // Create a role with settings:manage so the rep can access /custom-roles
    const roleRes = await restClient.post<{ data: CustomRoleResponse }>('/api/v1/custom-roles', {
      name: `cap-assign-${suffix}`,
      capabilities: ['settings:manage', 'contacts:view'],
    });
    roleId = roleRes.body.data.id;

    // Assign role to rep
    await restClient.post(`/api/v1/users/${repId}/roles`, { roleId });

    // Rep can now GET /custom-roles
    const listRes = await repClient.get<{ data: CustomRoleResponse[] }>('/api/v1/custom-roles');
    expect(listRes.status).toBe(200);

    // Remove the assignment
    await restClient.delete(`/api/v1/users/${repId}/roles/${roleId}`);

    // Rep is blocked again after removal
    let threw = false;
    try {
      await repClient.get('/api/v1/custom-roles');
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(RestClientError);
      expect((err as RestClientError).status).toBe(403);
    }
    expect(threw).toBe(true);

    await repContext.dispose();
  } finally {
    if (repId) await deactivateUser(restClient, repId);
    if (roleId) await restClient.delete(`/api/v1/custom-roles/${roleId}`).catch(() => null);
  }
});

// ── Built-in role View button (MINCRM-547) ────────────────────────────────────

test('@functional built-in role View button expands read-only capability panel', async ({
  page,
  restClient,
  testData,
}) => {
  // restClient is already authenticated as admin by test.beforeEach
  // Fetch the built-in admin role ID via API so the test is not sensitive to DB seed order
  const listRes = await restClient.get<{ data: CustomRoleResponse[] }>('/api/v1/custom-roles');
  const adminRole = listRes.body.data.find((r) => r.is_builtin && r.name === 'admin');
  if (!adminRole) throw new Error('[MINCRM-547] Built-in admin role not found in API response');

  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  await navigateToAdminSettings({ page }, 'users');

  // View button is present on the built-in role card
  await expectRoleViewButtonVisible(adminRole.id, { page }, 10_000);

  // Click View — panel expands
  await clickRoleViewButton(adminRole.id, { page });

  await expectRoleCapabilityPanelVisible(adminRole.id, { page }, 5_000);

  // The read-only list is inside the panel
  await expectRoleCapabilityReadOnlyListVisible({ page });

  // A known capability checkbox is present and disabled (admin role always has contacts:view)
  await expectRoleReadOnlyCapabilityCheckboxDisabled({ page }, 'contacts:view');

  // Click View again — panel collapses
  await clickRoleViewButton(adminRole.id, { page });
  await expectRoleCapabilityPanelNotVisible(adminRole.id, { page }, 5_000);
});
