/**
 * F-OWN — "My Team" Owner Filter (MINCRM-545)
 *
 * Functional regression tests for the three-way owner toggle (All / Mine / My Team)
 * on the Contacts list view. The spec exercises the full filter lifecycle:
 * UI toggle → URL param → API filtering → visible rows.
 *
 * Test groups:
 *   F-OWN1  — owner=me URL param scopes API response to current user's contacts
 *   F-OWN2  — owner=my_team returns contacts owned by co-team members
 *   F-OWN3  — owner=my_team excludes contacts owned by non-team users
 *   F-OWN4  — User with no team memberships sees only own contacts via My Team
 *   F-OWN5  — Clicking "My Team" toggle button sets ?owner=my_team in URL
 *   F-OWN6  — Clicking "All" toggle button after "My Team" clears the URL param
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - Behaviors imported from @behaviors/* only — never @pages/*
 *   - No loginAsAdmin in beforeAll — called at test body start
 *   - All test data managed via restClient + TestDataManager (auto teardown)
 *   - Negative visibility assertions use the API (listContactsViaApi) rather
 *     than DOM checks — cleaner and no SafePage allowlist bypass needed
 *
 * MINCRM-545
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestRep, loginAndVerify, registerAdminTeardown } from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  createContactViaApi,
  listContactsViaApi,
  navigateToContactsWithOwnerFilter,
  clickMyTeamOwnerFilter,
  clickAllOwnerFilter,
  getContactsPageUrl,
} from '@behaviors/minicrm/contacts.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

// ---------------------------------------------------------------------------
// F-OWN1 — owner=me scopes API response to current user's contacts
// ---------------------------------------------------------------------------

test('@functional F-OWN1: owner=me filter returns only the authenticated user contacts', async ({
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);
  const uniqueSuffix = `${Date.now()}-${process.pid}`;

  const repA = await createTestRep(testData, restClient, {
    email: `own1-repA-${uniqueSuffix}@example.com`,
  });
  const repB = await createTestRep(testData, restClient, {
    email: `own1-repB-${uniqueSuffix}@example.com`,
  });

  await loginAndVerify(restClient, repA.email, repA.password);
  const contactA = await createContactViaApi(restClient, {
    first_name: 'OWN1A',
    last_name: 'Contact',
    email: `own1-contact-a-${uniqueSuffix}@example.com`,
  });
  registerAdminTeardown(
    testData,
    restClient,
    'contact',
    contactA.id,
    `/api/v1/contacts/${contactA.id}`,
  );

  await loginAndVerify(restClient, repB.email, repB.password);
  const contactB = await createContactViaApi(restClient, {
    first_name: 'OWN1B',
    last_name: 'Contact',
    email: `own1-contact-b-${uniqueSuffix}@example.com`,
  });
  registerAdminTeardown(
    testData,
    restClient,
    'contact',
    contactB.id,
    `/api/v1/contacts/${contactB.id}`,
  );

  // repA with ?owner=me sees their own contact but not repB's
  await loginAndVerify(restClient, repA.email, repA.password);
  const { data } = await listContactsViaApi(restClient, { owner: 'me', limit: 100 });
  const ids = data.map((c) => c.id);

  expect(ids).toContain(contactA.id);
  expect(ids).not.toContain(contactB.id);
});

// ---------------------------------------------------------------------------
// F-OWN2 — owner=my_team returns contacts owned by co-team members
// ---------------------------------------------------------------------------

test('@functional F-OWN2: owner=my_team filter returns contacts owned by team co-members', async ({
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);
  const uniqueSuffix = `${Date.now()}-${process.pid}`;

  const repA = await createTestRep(testData, restClient, {
    email: `own2-repA-${uniqueSuffix}@example.com`,
  });
  const repB = await createTestRep(testData, restClient, {
    email: `own2-repB-${uniqueSuffix}@example.com`,
  });

  // Create a team and add both reps
  await loginAsAdmin(restClient);
  const adminMeRes = await restClient.get('/api/v1/auth/me');
  const adminId = (adminMeRes.body as { user: { id: string } }).user.id;

  const teamRes = await restClient.post<{ team: { id: string } }>('/api/v1/teams', {
    name: `OWN2-team-${uniqueSuffix}`,
    manager_id: adminId,
  });
  const teamId = teamRes.body.team.id;
  await restClient.post(`/api/v1/teams/${teamId}/members`, {
    user_id: repA.userId,
    role: 'member',
  });
  await restClient.post(`/api/v1/teams/${teamId}/members`, {
    user_id: repB.userId,
    role: 'member',
  });
  registerAdminTeardown(testData, restClient, 'team', teamId, `/api/v1/teams/${teamId}`);

  // repB creates a contact
  await loginAndVerify(restClient, repB.email, repB.password);
  const contactByB = await createContactViaApi(restClient, {
    first_name: 'OWN2B',
    last_name: 'TeamMember',
    email: `own2-contact-b-${uniqueSuffix}@example.com`,
  });
  registerAdminTeardown(
    testData,
    restClient,
    'contact',
    contactByB.id,
    `/api/v1/contacts/${contactByB.id}`,
  );

  // repA with ?owner=my_team should see repB's contact
  await loginAndVerify(restClient, repA.email, repA.password);
  const { data } = await listContactsViaApi(restClient, { owner: 'my_team', limit: 100 });
  const ids = data.map((c) => c.id);

  expect(ids).toContain(contactByB.id);
});

// ---------------------------------------------------------------------------
// F-OWN3 — owner=my_team excludes contacts owned by non-team users
// ---------------------------------------------------------------------------

test('@functional F-OWN3: owner=my_team filter excludes contacts owned by users outside the team', async ({
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);
  const uniqueSuffix = `${Date.now()}-${process.pid}`;

  const repA = await createTestRep(testData, restClient, {
    email: `own3-repA-${uniqueSuffix}@example.com`,
  });
  const outsider = await createTestRep(testData, restClient, {
    email: `own3-outsider-${uniqueSuffix}@example.com`,
  });

  // Create a team with only repA
  await loginAsAdmin(restClient);
  const adminMeRes = await restClient.get('/api/v1/auth/me');
  const adminId = (adminMeRes.body as { user: { id: string } }).user.id;

  const teamRes = await restClient.post<{ team: { id: string } }>('/api/v1/teams', {
    name: `OWN3-team-${uniqueSuffix}`,
    manager_id: adminId,
  });
  const teamId = teamRes.body.team.id;
  await restClient.post(`/api/v1/teams/${teamId}/members`, {
    user_id: repA.userId,
    role: 'member',
  });
  registerAdminTeardown(testData, restClient, 'team', teamId, `/api/v1/teams/${teamId}`);

  // outsider creates a contact
  await loginAndVerify(restClient, outsider.email, outsider.password);
  const outsiderContact = await createContactViaApi(restClient, {
    first_name: 'OWN3Out',
    last_name: 'sider',
    email: `own3-outsider-contact-${uniqueSuffix}@example.com`,
  });
  registerAdminTeardown(
    testData,
    restClient,
    'contact',
    outsiderContact.id,
    `/api/v1/contacts/${outsiderContact.id}`,
  );

  // repA with ?owner=my_team should NOT see the outsider's contact
  await loginAndVerify(restClient, repA.email, repA.password);
  const { data } = await listContactsViaApi(restClient, { owner: 'my_team', limit: 100 });
  const ids = data.map((c) => c.id);

  expect(ids).not.toContain(outsiderContact.id);
});

// ---------------------------------------------------------------------------
// F-OWN4 — User with no team memberships sees only own contacts via My Team
// ---------------------------------------------------------------------------

test('@functional F-OWN4: owner=my_team with no team memberships returns only own contacts', async ({
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);
  const uniqueSuffix = `${Date.now()}-${process.pid}`;

  const repSolo = await createTestRep(testData, restClient, {
    email: `own4-solo-${uniqueSuffix}@example.com`,
  });
  const repOther = await createTestRep(testData, restClient, {
    email: `own4-other-${uniqueSuffix}@example.com`,
  });

  await loginAndVerify(restClient, repSolo.email, repSolo.password);
  const soloContact = await createContactViaApi(restClient, {
    first_name: 'OWN4Solo',
    last_name: 'Contact',
    email: `own4-solo-contact-${uniqueSuffix}@example.com`,
  });
  registerAdminTeardown(
    testData,
    restClient,
    'contact',
    soloContact.id,
    `/api/v1/contacts/${soloContact.id}`,
  );

  await loginAndVerify(restClient, repOther.email, repOther.password);
  const otherContact = await createContactViaApi(restClient, {
    first_name: 'OWN4Other',
    last_name: 'Contact',
    email: `own4-other-contact-${uniqueSuffix}@example.com`,
  });
  registerAdminTeardown(
    testData,
    restClient,
    'contact',
    otherContact.id,
    `/api/v1/contacts/${otherContact.id}`,
  );

  // repSolo has no team memberships — My Team should return only their own contacts
  await loginAndVerify(restClient, repSolo.email, repSolo.password);
  const { data } = await listContactsViaApi(restClient, { owner: 'my_team', limit: 100 });
  const ids = data.map((c) => c.id);

  expect(ids).toContain(soloContact.id);
  expect(ids).not.toContain(otherContact.id);
});

// ---------------------------------------------------------------------------
// F-OWN5 — Clicking "My Team" toggle button sets ?owner=my_team in the URL
// ---------------------------------------------------------------------------

test('@functional F-OWN5: clicking My Team button sets owner=my_team in the URL', async ({
  page,
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);
  const uniqueSuffix = `${Date.now()}-${process.pid}`;

  const rep = await createTestRep(testData, restClient, {
    email: `own5-rep-${uniqueSuffix}@example.com`,
  });

  await loginViaBrowser(rep.email, rep.password, { page });
  await navigateToContactsWithOwnerFilter({ page }, 'all');
  await clickMyTeamOwnerFilter({ page });

  expect(getContactsPageUrl({ page })).toContain('owner=my_team');
});

// ---------------------------------------------------------------------------
// F-OWN6 — Clicking "All" after "My Team" clears the ?owner URL param
// ---------------------------------------------------------------------------

test('@functional F-OWN6: clicking All button after My Team clears the owner URL param', async ({
  page,
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);
  const uniqueSuffix = `${Date.now()}-${process.pid}`;

  const rep = await createTestRep(testData, restClient, {
    email: `own6-rep-${uniqueSuffix}@example.com`,
  });

  await loginViaBrowser(rep.email, rep.password, { page });
  await navigateToContactsWithOwnerFilter({ page }, 'my_team');
  await clickAllOwnerFilter({ page });

  expect(getContactsPageUrl({ page })).not.toContain('owner=');
});
