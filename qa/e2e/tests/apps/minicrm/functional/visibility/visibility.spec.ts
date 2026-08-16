/**
 * F-VIS — Data Visibility Scoping (MINCRM-534, MINCRM-538)
 *
 * Functional regression tests for the org-level visibility policy configuration
 * and its enforcement across contacts for admin, manager, and rep roles.
 *
 * Test groups:
 *   F-VIS1  — Admin navigates to the visibility settings tab and sees the panel
 *   F-VIS2  — Admin changes a contact policy to 'private' and saves successfully
 *   F-VIS3  — Rep with org policy sees all contacts in the API response
 *   F-VIS4  — Rep with private policy sees only their own contacts
 *   F-VIS5  — Manager sees only team-scoped contacts regardless of policy
 *   F-VIS6  — Manager can reassign a contact to a team member
 *   F-VIS7  — Manager cannot reassign a contact to a user outside their team (403)
 *   F-VIS8  — Rep cannot access the PUT /settings/visibility endpoint (403)
 *   F-VIS9  — Rep with private account policy cannot read an account owned by another rep
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional @serial
 *   - @serial causes CI to run this file in a dedicated single-worker job (e2e-serial)
 *     isolated from the parallel sharded runners — prevents concurrent shard
 *     beforeEach/afterEach resets from racing with tests that mutate global visibility
 *     policy. See MINCRM-549 and ci.yml e2e-serial job.
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - Behaviors imported from @behaviors/* only — never @pages/*
 *   - System settings mutated here are reset in afterEach via resetVisibilitySettings
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  createTestAdmin,
  createTestRep,
  loginAndVerify,
  registerAdminTeardown,
  registerUserDeactivation,
} from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  inviteUserViaApi,
  setUserPassword,
  suppressUserOnboarding,
} from '@behaviors/minicrm/users.behaviors.js';
import {
  navigateToAdminSettings,
  expectVisibilitySettingsPanelVisible,
  expectVisibilityContactsSelectVisible,
  expectVisibilityAccountsSelectVisible,
  selectVisibilityContacts,
  clickVisibilitySaveButton,
  expectVisibilitySaveSuccessVisible,
  resetVisibilitySettings,
} from '@behaviors/minicrm/settings.behaviors.js';
import { createContactViaApi, listContactsViaApi } from '@behaviors/minicrm/contacts.behaviors.js';
import { createAccountViaApi } from '@behaviors/minicrm/accounts.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
  await resetVisibilitySettings(restClient);
});

test.afterEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
  await resetVisibilitySettings(restClient);
});

// ---------------------------------------------------------------------------
// F-VIS1 — Admin navigates to the visibility settings tab and sees the panel
// ---------------------------------------------------------------------------

test('@functional @serial F-VIS1: admin can navigate to the visibility tab and see the settings panel', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  await navigateToAdminSettings({ page }, 'users');

  await expectVisibilitySettingsPanelVisible({ page }, 10_000);

  await expectVisibilityContactsSelectVisible({ page });
  await expectVisibilityAccountsSelectVisible({ page });
});

// ---------------------------------------------------------------------------
// F-VIS2 — Admin changes contact policy to 'private' and saves
// ---------------------------------------------------------------------------

test('@functional @serial F-VIS2: admin can change a visibility policy and see the save success message', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  await navigateToAdminSettings({ page }, 'users');

  await expectVisibilityContactsSelectVisible({ page }, 10_000);

  await selectVisibilityContacts('private', { page });

  await clickVisibilitySaveButton({ page });

  await expectVisibilitySaveSuccessVisible({ page }, 5_000);
});

// ---------------------------------------------------------------------------
// F-VIS3 — Rep with org policy sees all contacts
// ---------------------------------------------------------------------------

test('@functional @serial F-VIS3: rep with org policy can list contacts owned by other users', async ({
  restClient,
  testData,
}) => {
  // Create two reps; rep A creates a contact; rep B should see it under org policy
  const repA = await createTestRep(testData, restClient);
  const repB = await createTestRep(testData, restClient);

  // Ensure org policy is active
  await loginAsAdmin(restClient);
  await restClient.put('/api/v1/settings/visibility', {
    contact: 'org',
    deal: 'org',
    activity: 'org',
  });

  // Rep A creates a contact
  await loginAndVerify(restClient, repA.email, repA.password);
  const contact = await createContactViaApi(restClient, {
    first_name: 'Org',
    last_name: 'Visible',
    email: `org-visible-${Date.now()}@example.com`,
  });
  registerAdminTeardown(
    testData,
    restClient,
    'contact',
    contact.id,
    `/api/v1/contacts/${contact.id}`,
  );

  // Rep B should see it — use large limit + newest-first so the just-created contact is in the first page
  await loginAndVerify(restClient, repB.email, repB.password);
  const { data } = await listContactsViaApi(restClient, {
    limit: 100,
    sort: 'created_at',
    dir: 'desc',
  });
  const ids = data.map((c) => c.id);
  expect(ids).toContain(contact.id);
});

// ---------------------------------------------------------------------------
// F-VIS4 — Rep with private policy sees only own contacts
// ---------------------------------------------------------------------------

test('@functional @serial F-VIS4: rep with private policy cannot see contacts owned by other users', async ({
  restClient,
  testData,
}) => {
  const repA = await createTestRep(testData, restClient);
  const repB = await createTestRep(testData, restClient);

  // Create contacts first, then set the policy — no concurrent shard resets
  // can race here because this file runs in the dedicated e2e-serial job (--workers=1).

  // Rep A creates a contact that repB should NOT see
  await loginAndVerify(restClient, repA.email, repA.password);
  const contactOwnedByA = await createContactViaApi(restClient, {
    first_name: 'Private',
    last_name: 'Contact',
    email: `priv-contact-${Date.now()}@example.com`,
  });
  registerAdminTeardown(
    testData,
    restClient,
    'contact',
    contactOwnedByA.id,
    `/api/v1/contacts/${contactOwnedByA.id}`,
  );

  // Rep B creates their own contact
  await loginAndVerify(restClient, repB.email, repB.password);
  const repBContact = await createContactViaApi(restClient, {
    first_name: 'RepB',
    last_name: 'Own',
    email: `repb-own-${Date.now()}@example.com`,
  });
  registerAdminTeardown(
    testData,
    restClient,
    'contact',
    repBContact.id,
    `/api/v1/contacts/${repBContact.id}`,
  );

  // Set private policy as admin, then verify as repB
  await loginAsAdmin(restClient);
  await restClient.put('/api/v1/settings/visibility', { contact: 'private' });
  await loginAndVerify(restClient, repB.email, repB.password);

  // Rep B's contact list should contain their own contact but NOT rep A's
  const { data } = await listContactsViaApi(restClient, {
    limit: 100,
    sort: 'created_at',
    dir: 'desc',
  });
  const ids = data.map((c) => c.id);
  expect(ids).toContain(repBContact.id);
  expect(ids).not.toContain(contactOwnedByA.id);
});

// ---------------------------------------------------------------------------
// F-VIS5 — Manager sees only team-scoped contacts
// ---------------------------------------------------------------------------

test('@functional @serial F-VIS5: manager sees only contacts owned by their team members', async ({
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);

  // Create a manager user
  const uniqueSuffix = `${Date.now()}-${process.pid}`;
  const managerEmail = `manager-vis5-${uniqueSuffix}@example.com`;
  const managerPassword = 'BvtPassword1!';
  const { user: managerUser, inviteToken: managerToken } = await inviteUserViaApi(restClient, {
    name: `Manager VIS5 ${uniqueSuffix}`,
    email: managerEmail,
    role: 'manager',
  });
  // Register before the steps below, both of which are network calls that
  // can throw with the user already created. (MINCRM-668)
  registerUserDeactivation(testData, restClient, managerUser.id, 'manager-vis5');

  await setUserPassword(restClient, managerToken, managerPassword);
  await suppressUserOnboarding(restClient, managerEmail, managerPassword);

  // Create a team member
  const memberEmail = `member-vis5-${uniqueSuffix}@example.com`;
  const memberPassword = 'BvtPassword1!';
  const { user: memberUser, inviteToken: memberToken } = await inviteUserViaApi(restClient, {
    name: `Member VIS5 ${uniqueSuffix}`,
    email: memberEmail,
    role: 'rep',
  });
  // Register before the steps below, both of which are network calls that
  // can throw with the user already created. (MINCRM-668)
  registerUserDeactivation(testData, restClient, memberUser.id, 'member-vis5');

  await setUserPassword(restClient, memberToken, memberPassword);
  await suppressUserOnboarding(restClient, memberEmail, memberPassword);

  // Create an outsider rep
  const outsider = await createTestRep(testData, restClient, {
    email: `outsider-vis5-${uniqueSuffix}@example.com`,
  });

  // Create a team managed by managerUser with memberUser as a member
  await loginAsAdmin(restClient);
  const teamRes = await restClient.post<{ team: { id: string } }>('/api/v1/teams', {
    name: `VIS5-team-${uniqueSuffix}`,
    manager_id: managerUser.id,
  });
  const teamId = teamRes.body.team.id;
  await restClient.post(`/api/v1/teams/${teamId}/members`, {
    user_id: memberUser.id,
    role: 'member',
  });
  registerAdminTeardown(testData, restClient, 'team', teamId, `/api/v1/teams/${teamId}`);

  // Member creates a contact
  await loginAndVerify(restClient, memberEmail, memberPassword);
  const memberContact = await createContactViaApi(restClient, {
    first_name: 'TeamMember',
    last_name: 'Contact',
    email: `member-contact-vis5-${uniqueSuffix}@example.com`,
  });
  registerAdminTeardown(
    testData,
    restClient,
    'contact',
    memberContact.id,
    `/api/v1/contacts/${memberContact.id}`,
  );

  // Outsider creates a contact
  await loginAndVerify(restClient, outsider.email, outsider.password);
  const outsiderContact = await createContactViaApi(restClient, {
    first_name: 'Outsider',
    last_name: 'Contact',
    email: `outsider-contact-vis5-${uniqueSuffix}@example.com`,
  });
  registerAdminTeardown(
    testData,
    restClient,
    'contact',
    outsiderContact.id,
    `/api/v1/contacts/${outsiderContact.id}`,
  );

  // Manager should see member's contact but NOT outsider's contact — use large limit + newest-first
  await loginAndVerify(restClient, managerEmail, managerPassword);
  const { data } = await listContactsViaApi(restClient, {
    limit: 100,
    sort: 'created_at',
    dir: 'desc',
  });
  const ids = data.map((c) => c.id);

  expect(ids).toContain(memberContact.id);
  expect(ids).not.toContain(outsiderContact.id);
});

// ---------------------------------------------------------------------------
// F-VIS6 — Manager can reassign a contact to a team member
// ---------------------------------------------------------------------------

test('@functional @serial F-VIS6: manager can reassign a contact to a member of their team', async ({
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);

  const uniqueSuffix = `${Date.now()}-${process.pid}`;
  const managerEmail = `manager-vis6-${uniqueSuffix}@example.com`;
  const managerPassword = 'BvtPassword1!';
  const { user: managerUser, inviteToken: managerToken } = await inviteUserViaApi(restClient, {
    name: `Manager VIS6 ${uniqueSuffix}`,
    email: managerEmail,
    role: 'manager',
  });
  // Register before the steps below, both of which are network calls that
  // can throw with the user already created. (MINCRM-668)
  registerUserDeactivation(testData, restClient, managerUser.id, 'manager-vis6');

  await setUserPassword(restClient, managerToken, managerPassword);
  await suppressUserOnboarding(restClient, managerEmail, managerPassword);

  const memberEmail = `member-vis6-${uniqueSuffix}@example.com`;
  const memberPassword = 'BvtPassword1!';
  const { user: memberUser, inviteToken: memberToken } = await inviteUserViaApi(restClient, {
    name: `Member VIS6 ${uniqueSuffix}`,
    email: memberEmail,
    role: 'rep',
  });
  // Register before the steps below, both of which are network calls that
  // can throw with the user already created. (MINCRM-668)
  registerUserDeactivation(testData, restClient, memberUser.id, 'member-vis6');

  await setUserPassword(restClient, memberToken, memberPassword);
  await suppressUserOnboarding(restClient, memberEmail, memberPassword);

  // Create team
  await loginAsAdmin(restClient);
  const teamRes = await restClient.post<{ team: { id: string } }>('/api/v1/teams', {
    name: `VIS6-team-${uniqueSuffix}`,
    manager_id: managerUser.id,
  });
  const teamId = teamRes.body.team.id;
  await restClient.post(`/api/v1/teams/${teamId}/members`, {
    user_id: memberUser.id,
    role: 'member',
  });
  registerAdminTeardown(testData, restClient, 'team', teamId, `/api/v1/teams/${teamId}`);

  // Manager creates a contact owned by themselves
  await loginAndVerify(restClient, managerEmail, managerPassword);
  const contact = await createContactViaApi(restClient, {
    first_name: 'ReassignMe',
    last_name: 'Contact',
    email: `reassign-vis6-${uniqueSuffix}@example.com`,
  });
  registerAdminTeardown(
    testData,
    restClient,
    'contact',
    contact.id,
    `/api/v1/contacts/${contact.id}`,
  );

  // Manager reassigns the contact to the team member — should succeed
  const updated = await restClient.patch<{ contact: { owner_id: string } }>(
    `/api/v1/contacts/${contact.id}`,
    { owner_id: memberUser.id, version: contact.version },
  );
  expect(updated.body.contact.owner_id).toBe(memberUser.id);
});

// ---------------------------------------------------------------------------
// F-VIS7 — Manager cannot reassign contact to outside-team user (403)
// ---------------------------------------------------------------------------

test('@functional @serial F-VIS7: manager gets 403 when reassigning a contact to a user outside their team', async ({
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);

  const uniqueSuffix = `${Date.now()}-${process.pid}`;
  const managerEmail = `manager-vis7-${uniqueSuffix}@example.com`;
  const managerPassword = 'BvtPassword1!';
  const { user: managerUser, inviteToken: managerToken } = await inviteUserViaApi(restClient, {
    name: `Manager VIS7 ${uniqueSuffix}`,
    email: managerEmail,
    role: 'manager',
  });
  // Register before the steps below, both of which are network calls that
  // can throw with the user already created. (MINCRM-668)
  registerUserDeactivation(testData, restClient, managerUser.id, 'manager-vis7');

  await setUserPassword(restClient, managerToken, managerPassword);
  await suppressUserOnboarding(restClient, managerEmail, managerPassword);

  // Create a team (empty — no members that the manager can reassign to,
  // except the manager themselves)
  await loginAsAdmin(restClient);
  const teamRes = await restClient.post<{ team: { id: string } }>('/api/v1/teams', {
    name: `VIS7-team-${uniqueSuffix}`,
    manager_id: managerUser.id,
  });
  const teamId = teamRes.body.team.id;
  registerAdminTeardown(testData, restClient, 'team', teamId, `/api/v1/teams/${teamId}`);

  // Create an outsider rep
  const outsider = await createTestRep(testData, restClient, {
    email: `outsider-vis7-${uniqueSuffix}@example.com`,
  });

  // Manager creates a contact
  await loginAndVerify(restClient, managerEmail, managerPassword);
  const contact = await createContactViaApi(restClient, {
    first_name: 'Locked',
    last_name: 'Contact',
    email: `locked-vis7-${uniqueSuffix}@example.com`,
  });
  registerAdminTeardown(
    testData,
    restClient,
    'contact',
    contact.id,
    `/api/v1/contacts/${contact.id}`,
  );

  // Attempt to reassign to outsider — should fail with 403
  let caughtStatus: number | undefined;
  try {
    await restClient.patch(`/api/v1/contacts/${contact.id}`, {
      owner_id: outsider.userId,
      version: contact.version,
    });
  } catch (err: unknown) {
    const e = err as { status?: number };
    caughtStatus = e.status;
  }
  expect(caughtStatus).toBe(403);
});

// ---------------------------------------------------------------------------
// F-VIS8 — Rep cannot access PUT /settings/visibility (403)
// ---------------------------------------------------------------------------

test('@functional @serial F-VIS8: rep cannot call the visibility settings PUT endpoint', async ({
  restClient,
  testData,
}) => {
  const rep = await createTestRep(testData, restClient);
  await loginAndVerify(restClient, rep.email, rep.password);

  let caughtStatus: number | undefined;
  try {
    await restClient.put('/api/v1/settings/visibility', { contact: 'private' });
  } catch (err: unknown) {
    const e = err as { status?: number };
    caughtStatus = e.status;
  }
  expect(caughtStatus).toBe(403);
});

// ---------------------------------------------------------------------------
// F-VIS9 — Rep with private account policy cannot read another rep's account
// ---------------------------------------------------------------------------

test('@functional @serial F-VIS9: rep with private account policy cannot read an account owned by another rep', async ({
  restClient,
  testData,
}) => {
  const repA = await createTestRep(testData, restClient);
  const repB = await createTestRep(testData, restClient);

  // Account created by admin, owned by rep A — set the policy after creation so
  // no concurrent shard reset can race here (this file runs in the dedicated
  // e2e-serial job, --workers=1).
  await loginAsAdmin(restClient);
  const account = await createAccountViaApi(restClient, {
    name: `VIS9-Account-${Date.now()}`,
    owner_id: repA.userId,
  });
  // Admin-authenticated teardown: the client is re-authenticated as repB below,
  // and account deletion is owner-or-admin gated.
  registerAdminTeardown(
    testData,
    restClient,
    'account',
    account.id,
    `/api/v1/accounts/${account.id}`,
  );
  await restClient.put('/api/v1/settings/visibility', { account: 'private' });

  await loginAndVerify(restClient, repB.email, repB.password);

  let caughtStatus: number | undefined;
  try {
    await restClient.get(`/api/v1/accounts/${account.id}`);
  } catch (err: unknown) {
    const e = err as { status?: number };
    caughtStatus = e.status;
  }
  expect(caughtStatus).toBe(403);
});
