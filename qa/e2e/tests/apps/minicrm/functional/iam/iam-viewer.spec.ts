/**
 * F-VIEWER — Viewer role write-blocking
 *
 * Verifies that users with role='viewer' can read all CRM data (contacts, accounts,
 * deals, activities, leads) but receive 403 VIEWER_WRITE_BLOCKED on every mutating
 * operation (POST, PATCH, DELETE).
 *
 * Also verifies that the viewer's cookie session is rejected at write boundaries
 * and that the error shape conforms to the standard error envelope.
 *
 * Test groups:
 *   Read Access       — viewer GET endpoints return 200
 *   Write Blocked     — viewer POST/PATCH/DELETE endpoints return 403
 *   Error Shape       — 403 response carries code VIEWER_WRITE_BLOCKED
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - API-only; no browser UI navigation (write-blocking is a server-layer concern)
 *   - Each test tears down its own fixtures via try/finally
 *   - restClient is re-authenticated as admin after every viewer call
 *
 * MINCRM-535
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAndVerify } from '@apps/minicrm/helpers.js';
import { RestClient, RestClientError } from '@framework/clients/rest-client.js';
import type { APIRequestContext } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F-VIEWER] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ restClient }) => {
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  inviteToken?: string;
}

interface InviteResponse {
  user: UserRow;
  inviteToken: string;
}

interface ContactRow {
  id: string;
}

interface AccountRow {
  id: string;
}

interface DealRow {
  id: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_PASSWORD = 'ViewerTest1!';

/**
 * Creates an activated viewer user and returns a new RestClient authenticated as that viewer.
 * Caller is responsible for deactivating the user in teardown.
 *
 * @param adminClient - Admin-authenticated RestClient.
 * @param newContext - playwright.request.newContext bound from the test fixture.
 */
async function createActivatedViewer(
  adminClient: RestClient,
  newContext: () => Promise<APIRequestContext>,
): Promise<{ viewerUser: UserRow; viewerClient: RestClient; viewerContext: APIRequestContext }> {
  const uniqueSuffix = `${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const email = `viewer-${uniqueSuffix}@example.com`;
  const name = `Viewer ${uniqueSuffix}`;

  // Invite with viewer role — calling the API directly since helpers type role as 'admin'|'rep'
  const inviteRes = await adminClient.post<InviteResponse>('/api/v1/users/invite', {
    name,
    email,
    role: 'viewer',
  });
  const { user, inviteToken } = inviteRes.body;

  // Activate via invite token (must_change_password stays false)
  await adminClient.post('/api/v1/users/set-password', {
    token: inviteToken,
    password: TEST_PASSWORD,
  });

  // Suppress onboarding widget: log in as viewer, complete onboarding, re-auth as admin
  const viewerOnboardingContext = await newContext();
  const viewerOnboardingClient = new RestClient(viewerOnboardingContext);
  await viewerOnboardingClient.post('/api/v1/auth/login', { email, password: TEST_PASSWORD });
  await viewerOnboardingClient
    .put('/api/v1/settings/onboarding', { onboarding_completed: true })
    .catch(() => null);
  await viewerOnboardingContext.dispose();

  // Create a fresh context for the viewer's persistent session
  const viewerContext = await newContext();
  const viewerClient = new RestClient(viewerContext);
  await loginAndVerify(viewerClient, email, TEST_PASSWORD);

  return { viewerUser: user, viewerClient, viewerContext };
}

/**
 * Deactivates a user, suppressing errors so teardown does not mask test failures.
 */
async function deactivateUser(adminClient: RestClient, userId: string, tag: string): Promise<void> {
  await adminClient.patch(`/api/v1/users/${userId}/deactivate`).catch((err: unknown) => {
    console.error(`[${tag}] teardown: failed to deactivate user ${userId}: ${String(err)}`);
  });
}

// ---------------------------------------------------------------------------
// Read Access tests — viewer can GET
// ---------------------------------------------------------------------------

test('@functional F-VIEWER-R1: viewer can read contacts list', async ({
  playwright,
  restClient,
}) => {
  const { viewerUser, viewerClient, viewerContext } = await createActivatedViewer(restClient, () =>
    playwright.request.newContext(),
  );
  try {
    const res = await viewerClient.get('/api/v1/contacts');
    expect(res.status, 'viewer GET /contacts should return 200').toBe(200);
  } finally {
    await viewerContext.dispose().catch(() => null);
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await deactivateUser(restClient, viewerUser.id, 'F-VIEWER-R1');
  }
});

test('@functional F-VIEWER-R2: viewer can read accounts list', async ({
  playwright,
  restClient,
}) => {
  const { viewerUser, viewerClient, viewerContext } = await createActivatedViewer(restClient, () =>
    playwright.request.newContext(),
  );
  try {
    const res = await viewerClient.get('/api/v1/accounts');
    expect(res.status, 'viewer GET /accounts should return 200').toBe(200);
  } finally {
    await viewerContext.dispose().catch(() => null);
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await deactivateUser(restClient, viewerUser.id, 'F-VIEWER-R2');
  }
});

test('@functional F-VIEWER-R3: viewer can read deals list', async ({ playwright, restClient }) => {
  const { viewerUser, viewerClient, viewerContext } = await createActivatedViewer(restClient, () =>
    playwright.request.newContext(),
  );
  try {
    const res = await viewerClient.get('/api/v1/deals');
    expect(res.status, 'viewer GET /deals should return 200').toBe(200);
  } finally {
    await viewerContext.dispose().catch(() => null);
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await deactivateUser(restClient, viewerUser.id, 'F-VIEWER-R3');
  }
});

test('@functional F-VIEWER-R4: viewer can read leads list', async ({ playwright, restClient }) => {
  const { viewerUser, viewerClient, viewerContext } = await createActivatedViewer(restClient, () =>
    playwright.request.newContext(),
  );
  try {
    const res = await viewerClient.get('/api/v1/leads');
    expect(res.status, 'viewer GET /leads should return 200').toBe(200);
  } finally {
    await viewerContext.dispose().catch(() => null);
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await deactivateUser(restClient, viewerUser.id, 'F-VIEWER-R4');
  }
});

test('@functional F-VIEWER-R5: viewer can read activities list', async ({
  playwright,
  restClient,
}) => {
  const { viewerUser, viewerClient, viewerContext } = await createActivatedViewer(restClient, () =>
    playwright.request.newContext(),
  );
  try {
    const res = await viewerClient.get('/api/v1/activities');
    expect(res.status, 'viewer GET /activities should return 200').toBe(200);
  } finally {
    await viewerContext.dispose().catch(() => null);
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await deactivateUser(restClient, viewerUser.id, 'F-VIEWER-R5');
  }
});

// ---------------------------------------------------------------------------
// Write Blocked tests — viewer POST/PATCH/DELETE return 403
// RestClient throws RestClientError on non-2xx; catch and assert the status.
// ---------------------------------------------------------------------------

test('@functional F-VIEWER-W1: viewer cannot create a contact', async ({
  playwright,
  restClient,
}) => {
  const { viewerUser, viewerClient, viewerContext } = await createActivatedViewer(restClient, () =>
    playwright.request.newContext(),
  );
  try {
    let errorStatus: number | null = null;
    try {
      await viewerClient.post('/api/v1/contacts', {
        first_name: 'Viewer',
        last_name: 'Blocked',
        email: `viewer-blocked-contact-${Date.now()}@example.com`,
      });
    } catch (err: unknown) {
      if (err instanceof RestClientError) errorStatus = err.status;
      else throw err;
    }
    expect(errorStatus, 'viewer POST /contacts should return 403').toBe(403);
  } finally {
    await viewerContext.dispose().catch(() => null);
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await deactivateUser(restClient, viewerUser.id, 'F-VIEWER-W1');
  }
});

test('@functional F-VIEWER-W2: viewer blocked response carries VIEWER_WRITE_BLOCKED code', async ({
  playwright,
  restClient,
}) => {
  const { viewerUser, viewerClient, viewerContext } = await createActivatedViewer(restClient, () =>
    playwright.request.newContext(),
  );
  try {
    let caughtErr: RestClientError | null = null;
    try {
      await viewerClient.post('/api/v1/contacts', {
        first_name: 'Viewer',
        last_name: 'Blocked',
        email: `viewer-blocked-shape-${Date.now()}@example.com`,
      });
    } catch (err: unknown) {
      if (err instanceof RestClientError) caughtErr = err;
      else throw err;
    }
    expect(caughtErr, '403 error should have been thrown').not.toBeNull();
    expect(caughtErr!.status, '403 status').toBe(403);
    const body = caughtErr!.body as { error?: { code?: string; message?: string } };
    expect(body.error?.code, 'error code should be VIEWER_WRITE_BLOCKED').toBe(
      'VIEWER_WRITE_BLOCKED',
    );
    expect(body.error?.message, 'error message should be present').toBeTruthy();
  } finally {
    await viewerContext.dispose().catch(() => null);
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await deactivateUser(restClient, viewerUser.id, 'F-VIEWER-W2');
  }
});

test('@functional F-VIEWER-W3: viewer cannot create an account', async ({
  playwright,
  restClient,
}) => {
  const { viewerUser, viewerClient, viewerContext } = await createActivatedViewer(restClient, () =>
    playwright.request.newContext(),
  );
  try {
    let errorStatus: number | null = null;
    try {
      await viewerClient.post('/api/v1/accounts', { name: 'Viewer Blocked Account' });
    } catch (err: unknown) {
      if (err instanceof RestClientError) errorStatus = err.status;
      else throw err;
    }
    expect(errorStatus, 'viewer POST /accounts should return 403').toBe(403);
  } finally {
    await viewerContext.dispose().catch(() => null);
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await deactivateUser(restClient, viewerUser.id, 'F-VIEWER-W3');
  }
});

test('@functional F-VIEWER-W4: viewer cannot create a deal', async ({
  playwright,
  restClient,
  testData,
}) => {
  // Create a contact (as admin) to satisfy the deal's contact_ids requirement
  const contactRes = await restClient.post<{ contact: ContactRow }>('/api/v1/contacts', {
    first_name: 'DealOwner',
    last_name: `VIEWER-W4-${Date.now()}`,
    email: `deal-owner-viewer-w4-${Date.now()}@example.com`,
  });
  const contactId = contactRes.body.contact.id;
  testData.registerCustomTeardown(`delete-contact-viewer-w4-${contactId}`, async () => {
    await restClient.delete(`/api/v1/contacts/${contactId}`).catch(() => null);
  });

  const { viewerUser, viewerClient, viewerContext } = await createActivatedViewer(restClient, () =>
    playwright.request.newContext(),
  );
  try {
    let errorStatus: number | null = null;
    try {
      await viewerClient.post('/api/v1/deals', {
        name: 'Viewer Blocked Deal',
        stage: 'Prospecting',
        contact_ids: [contactId],
      });
    } catch (err: unknown) {
      if (err instanceof RestClientError) errorStatus = err.status;
      else throw err;
    }
    expect(errorStatus, 'viewer POST /deals should return 403').toBe(403);
  } finally {
    await viewerContext.dispose().catch(() => null);
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await deactivateUser(restClient, viewerUser.id, 'F-VIEWER-W4');
  }
});

test('@functional F-VIEWER-W5: viewer cannot create a lead', async ({ playwright, restClient }) => {
  const { viewerUser, viewerClient, viewerContext } = await createActivatedViewer(restClient, () =>
    playwright.request.newContext(),
  );
  try {
    let errorStatus: number | null = null;
    try {
      await viewerClient.post('/api/v1/leads', {
        first_name: 'Viewer',
        last_name: 'BlockedLead',
        email: `viewer-blocked-lead-${Date.now()}@example.com`,
      });
    } catch (err: unknown) {
      if (err instanceof RestClientError) errorStatus = err.status;
      else throw err;
    }
    expect(errorStatus, 'viewer POST /leads should return 403').toBe(403);
  } finally {
    await viewerContext.dispose().catch(() => null);
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await deactivateUser(restClient, viewerUser.id, 'F-VIEWER-W5');
  }
});

test('@functional F-VIEWER-W6: viewer cannot update a contact', async ({
  playwright,
  restClient,
  testData,
}) => {
  const contactRes = await restClient.post<{ contact: ContactRow }>('/api/v1/contacts', {
    first_name: 'PatchTarget',
    last_name: `VIEWER-W6-${Date.now()}`,
    email: `patch-target-viewer-w6-${Date.now()}@example.com`,
  });
  const contactId = contactRes.body.contact.id;
  testData.registerCustomTeardown(`delete-contact-viewer-w6-${contactId}`, async () => {
    await restClient.delete(`/api/v1/contacts/${contactId}`).catch(() => null);
  });

  const { viewerUser, viewerClient, viewerContext } = await createActivatedViewer(restClient, () =>
    playwright.request.newContext(),
  );
  try {
    let errorStatus: number | null = null;
    try {
      await viewerClient.patch(`/api/v1/contacts/${contactId}`, { first_name: 'ViewerPatched' });
    } catch (err: unknown) {
      if (err instanceof RestClientError) errorStatus = err.status;
      else throw err;
    }
    expect(errorStatus, 'viewer PATCH /contacts/:id should return 403').toBe(403);
  } finally {
    await viewerContext.dispose().catch(() => null);
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await deactivateUser(restClient, viewerUser.id, 'F-VIEWER-W6');
  }
});

test('@functional F-VIEWER-W7: viewer cannot delete a contact', async ({
  playwright,
  restClient,
  testData,
}) => {
  const contactRes = await restClient.post<{ contact: ContactRow }>('/api/v1/contacts', {
    first_name: 'DeleteTarget',
    last_name: `VIEWER-W7-${Date.now()}`,
    email: `delete-target-viewer-w7-${Date.now()}@example.com`,
  });
  const contactId = contactRes.body.contact.id;
  testData.registerCustomTeardown(`delete-contact-viewer-w7-${contactId}`, async () => {
    await restClient.delete(`/api/v1/contacts/${contactId}`).catch(() => null);
  });

  const { viewerUser, viewerClient, viewerContext } = await createActivatedViewer(restClient, () =>
    playwright.request.newContext(),
  );
  try {
    // blockViewer() runs before the handler — returns 403 even if the record ID is valid
    let errorStatus: number | null = null;
    try {
      await viewerClient.delete(`/api/v1/contacts/${contactId}`);
    } catch (err: unknown) {
      if (err instanceof RestClientError) errorStatus = err.status;
      else throw err;
    }
    expect(errorStatus, 'viewer DELETE /contacts/:id should return 403').toBe(403);
  } finally {
    await viewerContext.dispose().catch(() => null);
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await deactivateUser(restClient, viewerUser.id, 'F-VIEWER-W7');
  }
});

test('@functional F-VIEWER-W8: viewer cannot update an account', async ({
  playwright,
  restClient,
  testData,
}) => {
  const accountRes = await restClient.post<{ account: AccountRow }>('/api/v1/accounts', {
    name: `PatchTargetAccount-VIEWER-W8-${Date.now()}`,
  });
  const accountId = accountRes.body.account.id;
  testData.registerCustomTeardown(`delete-account-viewer-w8-${accountId}`, async () => {
    await restClient.delete(`/api/v1/accounts/${accountId}`).catch(() => null);
  });

  const { viewerUser, viewerClient, viewerContext } = await createActivatedViewer(restClient, () =>
    playwright.request.newContext(),
  );
  try {
    let errorStatus: number | null = null;
    try {
      await viewerClient.patch(`/api/v1/accounts/${accountId}`, { name: 'ViewerPatched' });
    } catch (err: unknown) {
      if (err instanceof RestClientError) errorStatus = err.status;
      else throw err;
    }
    expect(errorStatus, 'viewer PATCH /accounts/:id should return 403').toBe(403);
  } finally {
    await viewerContext.dispose().catch(() => null);
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await deactivateUser(restClient, viewerUser.id, 'F-VIEWER-W8');
  }
});

test('@functional F-VIEWER-W9: viewer cannot update a deal', async ({
  playwright,
  restClient,
  testData,
}) => {
  const contactRes = await restClient.post<{ contact: ContactRow }>('/api/v1/contacts', {
    first_name: 'DealContactW9',
    last_name: `VIEWER-W9-${Date.now()}`,
    email: `deal-contact-viewer-w9-${Date.now()}@example.com`,
  });
  const contactId = contactRes.body.contact.id;
  testData.registerCustomTeardown(`delete-contact-viewer-w9-${contactId}`, async () => {
    await restClient.delete(`/api/v1/contacts/${contactId}`).catch(() => null);
  });

  const dealRes = await restClient.post<{ deal: DealRow }>('/api/v1/deals', {
    name: `ViewerDeal-W9-${Date.now()}`,
    stage: 'Prospecting',
    contact_ids: [contactId],
  });
  const dealId = dealRes.body.deal.id;
  testData.registerCustomTeardown(`delete-deal-viewer-w9-${dealId}`, async () => {
    await restClient.delete(`/api/v1/deals/${dealId}`).catch(() => null);
  });

  const { viewerUser, viewerClient, viewerContext } = await createActivatedViewer(restClient, () =>
    playwright.request.newContext(),
  );
  try {
    let errorStatus: number | null = null;
    try {
      await viewerClient.patch(`/api/v1/deals/${dealId}`, { name: 'ViewerPatched' });
    } catch (err: unknown) {
      if (err instanceof RestClientError) errorStatus = err.status;
      else throw err;
    }
    expect(errorStatus, 'viewer PATCH /deals/:id should return 403').toBe(403);
  } finally {
    await viewerContext.dispose().catch(() => null);
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await deactivateUser(restClient, viewerUser.id, 'F-VIEWER-W9');
  }
});
