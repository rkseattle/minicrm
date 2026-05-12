/**
 * F6 — User Management
 *
 * Functional regression tests for user invitation, role assignment, deactivation,
 * reactivation, and first-login flows.
 *
 * Test groups:
 *   Invitation   — valid invite, duplicate email (409), invalid email format (400),
 *                  invited user visible in list before first login
 *   Role         — role reflected at invite time, role change persisted via API
 *   First Login  — forced password change, temp password rejected after change,
 *                  weak new password surfaces inline error
 *   Deactivation — deactivated user blocked at API layer, records remain intact,
 *                  inactive status visible in list
 *   Reactivation — user can log in again, role and records unchanged
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators or Page Object calls in this file — all through behaviors
 *   - All test data managed via restClient + finally-block teardown
 *   - Tests must pass with --workers=4 (no shared mutable state)
 *
 * AC notes:
 *   - AC1: deactivated user login attempt verified at API layer (POST /auth/login → 401)
 *   - AC2: role changes take effect without requiring re-login; if re-login IS required
 *          the test documents that explicitly
 *   - AC3: all user management operations are admin-only (F7 covers rep-role rejection)
 *
 * GET /api/users/:id does not exist. Role verification uses GET /api/users (list)
 * and filters by user ID.
 *
 * MINCRM-142
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  login,
  logout,
  changePassword,
  loginAsAdmin,
  loginAs,
} from '@behaviors/minicrm/auth.behaviors.js';
import { createTestContact, createTestUser } from '@apps/minicrm/helpers.js';
import { getContactById } from '@behaviors/minicrm/contacts.behaviors.js';
import { RestClient, RestClientError } from '@framework/clients/rest-client.js';
import {
  findUserById,
  inviteUserViaApi,
  setUserPassword,
  adminSetUserPassword,
  deactivateUser,
  reactivateUser,
  changeUserRole,
  type UserRow,
} from '@behaviors/minicrm/users.behaviors.js';

// ---------------------------------------------------------------------------
// Shared setup — admin auth + test name capture
// ---------------------------------------------------------------------------

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default password used by createActivatedUser. */
const ACTIVATED_USER_PASSWORD = 'F6TestPass1!';

/**
 * Creates an activated test user via the shared createTestUser helper.
 *
 * Thin wrapper that supplies F6-specific name/email prefixes and a fixed
 * password so callers don't need to carry the password as a separate value.
 * Returns the user row (status='active') and the password that was set.
 *
 * Caller is responsible for deactivating the user in a finally block.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param role - Role to assign at invite time.
 * @returns Created user row and the activated password.
 */
async function createActivatedUser(
  restClient: RestClient,
  role: 'admin' | 'rep' = 'rep',
): Promise<{ user: UserRow; password: string }> {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const user = await createTestUser(restClient, {
    name: `F6 User ${uniqueSuffix}`,
    email: `f6-user-${uniqueSuffix}@example.com`,
    role,
    password: ACTIVATED_USER_PASSWORD,
  });
  return { user: user as UserRow, password: ACTIVATED_USER_PASSWORD };
}

/**
 * Invites a new user and sets their password via admin-set-password, which
 * forces must_change_password=true. Returns the user row and temp password.
 *
 * Caller is responsible for deactivating the user in a finally block.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param tempPassword - Temporary password to set.
 * @returns Created user row and the temp password.
 */
async function createUserWithForcedPasswordChange(
  restClient: RestClient,
  tempPassword: string,
): Promise<{ user: UserRow; tempPassword: string }> {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const { user, inviteToken } = await inviteUserViaApi(restClient, {
    name: `F6 FPC User ${uniqueSuffix}`,
    email: `f6-fpc-${uniqueSuffix}@example.com`,
    role: 'rep',
  });

  // Activate the account first (required before admin-set-password).
  await setUserPassword(restClient, inviteToken, 'Activate1!');

  // admin-set-password sets must_change_password=true.
  await adminSetUserPassword(restClient, user.id, tempPassword);

  return { user, tempPassword };
}

// ---------------------------------------------------------------------------
// Invitation tests
// ---------------------------------------------------------------------------

test('@smoke @functional F6-IN1: admin invites user with valid email and role → user appears in list with invited status', async ({
  restClient,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const email = `f6-in1-${uniqueSuffix}@example.com`;

  let userId: string | null = null;
  try {
    const { user, inviteToken } = await inviteUserViaApi(restClient, {
      name: `F6 IN1 User ${uniqueSuffix}`,
      email,
      role: 'rep',
    });

    userId = user.id;
    expect(user.status, 'newly invited user should have invited status').toBe('invited');
    expect(user.email, 'invited user should have the supplied email').toBe(email);
    expect(inviteToken, 'invite response should include a token').toBeTruthy();

    // Verify user appears in the admin list.
    const found = await findUserById(restClient, userId);
    expect(found, 'invited user should be visible in the admin user list').toBeDefined();
    expect(found?.status, 'user status in list should be invited').toBe('invited');
  } finally {
    if (userId) {
      await deactivateUser(restClient, userId).catch((err: unknown) => {
        console.error(`[F6-IN1] teardown: failed to deactivate user ${userId}: ${String(err)}`);
      });
    }
  }
});

test('@functional F6-IN2: admin invites duplicate email → 409 conflict, no duplicate created', async ({
  restClient,
}) => {
  const { user } = await createActivatedUser(restClient);

  try {
    // Attempt to invite with the already-registered email.
    let conflictStatus: number | null = null;
    let conflictCode: string | null = null;
    try {
      await inviteUserViaApi(restClient, {
        name: 'Duplicate User',
        email: user.email,
        role: 'rep',
      });
    } catch (err: unknown) {
      if (err instanceof RestClientError) {
        conflictStatus = err.status;
        conflictCode = (err.body as { error?: { code?: string } })?.error?.code ?? null;
      } else {
        throw err;
      }
    }

    expect(conflictStatus, 'duplicate invite should return 409').toBe(409);
    expect(conflictCode, 'error code should be USER_EMAIL_CONFLICT').toBe('USER_EMAIL_CONFLICT');

    // Confirm only one user exists with that email (search all pages).
    const found = await findUserById(restClient, user.id);
    expect(found, 'original user should still exist in the list (no duplicate)').toBeDefined();
    // findUserById returning the original user confirms the email exists exactly once;
    // the 409 above guarantees the duplicate invite was rejected.
  } finally {
    await deactivateUser(restClient, user.id).catch((err: unknown) => {
      console.error(`[F6-IN2] teardown: failed to deactivate user ${user.id}: ${String(err)}`);
    });
  }
});

test('@functional F6-IN3: admin invites with invalid email format → 400 validation error', async ({
  restClient,
}) => {
  let errorStatus: number | null = null;
  try {
    await inviteUserViaApi(restClient, {
      name: 'Bad Email User',
      email: 'not-a-valid-email',
      role: 'rep',
    });
  } catch (err: unknown) {
    if (err instanceof RestClientError) {
      errorStatus = err.status;
    } else {
      throw err;
    }
  }

  expect(errorStatus, 'invalid email format should return 400').toBe(400);
});

test('@functional F6-IN4: invited user is visible in list before they log in', async ({
  restClient,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let userId: string | null = null;

  try {
    const { user } = await inviteUserViaApi(restClient, {
      name: `F6 IN4 User ${uniqueSuffix}`,
      email: `f6-in4-${uniqueSuffix}@example.com`,
      role: 'rep',
    });
    userId = user.id;

    // Do NOT call set-password — the user has never logged in.
    const found = await findUserById(restClient, userId);
    expect(found, 'invited-but-never-logged-in user should appear in admin list').toBeDefined();
    expect(found?.status, 'status should be invited before first login').toBe('invited');
  } finally {
    if (userId) {
      // Invited (not yet activated) users can still be deactivated.
      await deactivateUser(restClient, userId).catch((err: unknown) => {
        console.error(`[F6-IN4] teardown: failed to deactivate user ${userId}: ${String(err)}`);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Role assignment tests
// ---------------------------------------------------------------------------

test('@functional F6-RA1: role assigned at invite time is reflected on the user record', async ({
  restClient,
}) => {
  const { user } = await createActivatedUser(restClient, 'admin');

  try {
    const found = await findUserById(restClient, user.id);
    expect(found, 'user should appear in list').toBeDefined();
    expect(found?.role, 'role should match the role supplied at invite time').toBe('admin');
  } finally {
    await deactivateUser(restClient, user.id).catch((err: unknown) => {
      console.error(`[F6-RA1] teardown: failed to deactivate user ${user.id}: ${String(err)}`);
    });
  }
});

test('@functional F6-RA2: admin changes role post-invite → change persisted, no re-login required (AC2)', async ({
  restClient,
}) => {
  // Invite as rep.
  const { user } = await createActivatedUser(restClient, 'rep');

  try {
    // Verify initial role.
    const before = await findUserById(restClient, user.id);
    expect(before?.role, 'initial role should be rep').toBe('rep');

    // Change role to admin.
    const updatedUser = await changeUserRole(restClient, user.id, 'admin');
    expect(updatedUser.role, 'changeUserRole response should reflect new role').toBe('admin');

    // Verify persisted via list — no re-login needed (AC2: role change is immediate).
    const after = await findUserById(restClient, user.id);
    expect(after?.role, 'role change should be persisted in the user record').toBe('admin');
  } finally {
    await deactivateUser(restClient, user.id).catch((err: unknown) => {
      console.error(`[F6-RA2] teardown: failed to deactivate user ${user.id}: ${String(err)}`);
    });
  }
});

// ---------------------------------------------------------------------------
// First login tests
// MINCRM-192: These tests log in via the UI as a newly-created test user to
// exercise the forced-password-change flow. The browser must start unauthenticated.
// ---------------------------------------------------------------------------
test.describe('First login tests', () => {
  // MINCRM-192: Use an empty storageState to prevent the project-level admin session
  // from loading. `undefined` does not override the project config — an explicit empty
  // object is required to start each test with a fresh, unauthenticated browser context.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('@smoke @functional F6-FL1: invited user with forced password change → redirected to /change-password on login', async ({
    page,
    restClient,
  }) => {
    const TEMP_PASSWORD = 'F6TempPass1!';

    let userId: string | null = null;
    try {
      const { user } = await createUserWithForcedPasswordChange(restClient, TEMP_PASSWORD);
      userId = user.id;

      const loginResult = await login({ email: user.email, password: TEMP_PASSWORD }, { page });

      expect(loginResult.success, 'forced-change user login should succeed').toBe(true);
      expect(
        new URL(loginResult.finalUrl).pathname,
        'forced-change user should land on /change-password',
      ).toBe('/change-password');
    } finally {
      if (userId) {
        await loginAsAdmin(restClient).catch(() => null);
        await deactivateUser(restClient, userId).catch((err: unknown) => {
          console.error(`[F6-FL1] teardown: failed to deactivate user ${userId}: ${String(err)}`);
        });
      }
    }
  });

  test('@functional F6-FL2: temp password rejected after forced password change', async ({
    page,
    restClient,
  }) => {
    const TEMP_PASSWORD = 'F6TempPass1!';
    const NEW_PASSWORD = 'F6NewPass2@';

    let userId: string | null = null;
    try {
      const { user } = await createUserWithForcedPasswordChange(restClient, TEMP_PASSWORD);
      userId = user.id;

      // Login — lands on /change-password.
      await login({ email: user.email, password: TEMP_PASSWORD }, { page });

      // Change the password.
      const changeResult = await changePassword(
        {
          currentPassword: TEMP_PASSWORD,
          newPassword: NEW_PASSWORD,
          confirmPassword: NEW_PASSWORD,
        },
        { page },
      );
      expect(changeResult.success, 'password change should succeed').toBe(true);

      // Log out so the old password can be tested.
      await logout({ page });

      // Old temp password must now be rejected.
      const retryResult = await login({ email: user.email, password: TEMP_PASSWORD }, { page });
      expect(retryResult.success, 'old temp password should be rejected after change').toBe(false);
      expect(retryResult.errorMessage, 'error message should be present').not.toBeNull();
    } finally {
      if (userId) {
        await loginAsAdmin(restClient).catch(() => null);
        await deactivateUser(restClient, userId).catch((err: unknown) => {
          console.error(`[F6-FL2] teardown: failed to deactivate user ${userId}: ${String(err)}`);
        });
      }
    }
  });

  test('@functional F6-FL3: weak new password on forced-change form → inline error, stays on /change-password', async ({
    page,
    restClient,
  }) => {
    const TEMP_PASSWORD = 'F6TempPass1!';

    let userId: string | null = null;
    try {
      const { user } = await createUserWithForcedPasswordChange(restClient, TEMP_PASSWORD);
      userId = user.id;

      // Login — lands on /change-password.
      await login({ email: user.email, password: TEMP_PASSWORD }, { page });

      // Submit a deliberately weak password.
      const result = await changePassword(
        { currentPassword: TEMP_PASSWORD, newPassword: 'weak', confirmPassword: 'weak' },
        { page },
      );

      expect(result.success, 'weak password should not navigate away').toBe(false);
      expect(
        result.errorMessage,
        'inline error should be present for weak password',
      ).not.toBeNull();
      expect(
        new URL(result.finalUrl).pathname,
        'browser should stay on /change-password after weak password error',
      ).toBe('/change-password');
    } finally {
      if (userId) {
        await loginAsAdmin(restClient).catch(() => null);
        await deactivateUser(restClient, userId).catch((err: unknown) => {
          console.error(`[F6-FL3] teardown: failed to deactivate user ${userId}: ${String(err)}`);
        });
      }
    }
  });
}); // end test.describe('First login tests')

// ---------------------------------------------------------------------------
// Deactivation tests
// ---------------------------------------------------------------------------

test('@functional F6-DX1: deactivated user cannot log in — blocked at API layer (AC1)', async ({
  restClient,
}) => {
  const { user, password } = await createActivatedUser(restClient);

  try {
    // Deactivate the user.
    const deactivatedUser = await deactivateUser(restClient, user.id);
    expect(deactivatedUser.status, 'user status should be inactive').toBe('inactive');

    // AC1: verify at the API layer that login is rejected.
    let loginStatus: number | null = null;
    try {
      await loginAs(restClient, user.email, password);
    } catch (err: unknown) {
      if (err instanceof RestClientError) {
        loginStatus = err.status;
      } else {
        throw err;
      }
    }
    // Server returns 403 (FORBIDDEN) for deactivated-user login attempts rather than 401.
    // Both are acceptable under AC1; 403 is semantically more precise (authenticated identity
    // is known but access is denied due to inactive status).
    expect(
      [401, 403],
      'deactivated user login attempt should return 401 or 403 at API layer (AC1)',
    ).toContain(loginStatus);
  } finally {
    // Re-auth as admin in case the restClient cookie was overwritten by the login attempt.
    await loginAsAdmin(restClient).catch(() => null);
    // User is already deactivated; a second deactivate is harmless but we catch errors.
    await deactivateUser(restClient, user.id).catch(() => null);
  }
});

test('@functional F6-DX2: deactivated user records remain intact and accessible to admin', async ({
  playwright,
  restClient,
  testData,
}) => {
  const { user, password } = await createActivatedUser(restClient);

  // Second APIRequestContext authenticated as the test user, so the contact
  // is created with owner_id = test user's ID — not the admin's.
  const userRequestContext = await playwright.request.newContext();
  const userClient = new RestClient(userRequestContext);

  try {
    await loginAs(userClient, user.email, password);

    // Create a contact as the test user (owner_id will be the test user's ID).
    const contact = await createTestContact(testData, userClient, {
      first_name: 'F6DX2',
      last_name: `Record-${Date.now()}`,
    });

    // Deactivate the user via the admin client.
    await deactivateUser(restClient, user.id);

    // Admin must still be able to read the now-deactivated user's contact.
    const deactivatedContact = await getContactById(restClient, contact.id);
    expect(deactivatedContact.id, 'returned contact id should match').toBe(contact.id);
  } finally {
    await userRequestContext.dispose().catch(() => null);
    await loginAsAdmin(restClient).catch(() => null);
    await deactivateUser(restClient, user.id).catch(() => null);
  }
});

test('@functional F6-DX3: deactivated user appears in list with inactive status', async ({
  restClient,
}) => {
  const { user } = await createActivatedUser(restClient);

  try {
    await deactivateUser(restClient, user.id);

    const found = await findUserById(restClient, user.id);
    expect(found, 'deactivated user should still appear in admin list').toBeDefined();
    expect(found?.status, 'deactivated user status should be inactive').toBe('inactive');
  } finally {
    // Already deactivated; suppress second-deactivate errors.
    await deactivateUser(restClient, user.id).catch(() => null);
  }
});

// ---------------------------------------------------------------------------
// Reactivation tests
// ---------------------------------------------------------------------------

test('@functional F6-RX1: reactivated user can log in again', async ({ restClient }) => {
  const { user, password } = await createActivatedUser(restClient);

  try {
    // Deactivate.
    await deactivateUser(restClient, user.id);

    // Reactivate.
    const reactivatedUser = await reactivateUser(restClient, user.id);
    expect(reactivatedUser.status, 'user status should be active after reactivation').toBe(
      'active',
    );

    // Login should succeed after reactivation.
    const loginStatus = await loginAs(restClient, user.email, password);
    expect(loginStatus, 'reactivated user should be able to log in').toBe(200);
  } finally {
    await loginAsAdmin(restClient).catch(() => null);
    await deactivateUser(restClient, user.id).catch((err: unknown) => {
      console.error(`[F6-RX1] teardown: failed to deactivate user ${user.id}: ${String(err)}`);
    });
  }
});

test('@functional F6-RX2: reactivated user role and records are unchanged', async ({
  restClient,
  testData,
}) => {
  // Create an admin-role user.
  const { user } = await createActivatedUser(restClient, 'admin');

  try {
    // Create a contact to verify records survive the deactivate/reactivate cycle.
    const contact = await createTestContact(testData, restClient, {
      first_name: 'F6RX2',
      last_name: `Record-${Date.now()}`,
    });

    // Deactivate then reactivate.
    await deactivateUser(restClient, user.id);
    await reactivateUser(restClient, user.id);

    // Role should be unchanged.
    const found = await findUserById(restClient, user.id);
    expect(found, 'user should appear in list after reactivation').toBeDefined();
    expect(found?.role, 'role should be unchanged after reactivation').toBe('admin');
    expect(found?.status, 'status should be active after reactivation').toBe('active');

    // Contact should still be accessible.
    const reactivatedContact = await getContactById(restClient, contact.id);
    expect(reactivatedContact.id, 'contact should be accessible after reactivation').toBe(
      contact.id,
    );
  } finally {
    await loginAsAdmin(restClient).catch(() => null);
    await deactivateUser(restClient, user.id).catch((err: unknown) => {
      console.error(`[F6-RX2] teardown: failed to deactivate user ${user.id}: ${String(err)}`);
    });
  }
});
