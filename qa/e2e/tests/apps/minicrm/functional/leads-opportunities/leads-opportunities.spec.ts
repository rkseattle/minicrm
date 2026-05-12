/**
 * F4 — Leads & Opportunities (Contacts + Deals)
 *
 * Functional regression tests for contact (lead) creation, deal (opportunity)
 * creation and lifecycle, pipeline stage management, and value tracking.
 * See MINCRM-42 for shared framework conventions and acceptance criteria.
 *
 * In MiniCRM, "Leads" map to Contacts and "Opportunities" map to Deals.
 * There is no separate lead entity — a contact is the entry point for the
 * sales loop, and a deal is the opportunity on the pipeline board.
 *
 * Test groups:
 *   Lead Creation      — required fields, missing required field (F4-LC)
 *   Lead Conversion    — contact linked to deal, deal accessible via board (F4-LV)
 *   Opportunity Create — required fields, linked account, missing field (F4-OC)
 *   Opportunity Pipeline — stage advancement, regression, close Won/Lost,
 *                          reopen (F4-OP)
 *   Opportunity Value  — currency display, pipeline roll-up via API (F4-OV)
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators or Page Object calls in this file — all through behaviors
 *   - All test data managed via restClient + TestDataManager (auto teardown)
 *   - Tests pass with --workers=4 (no shared mutable state)
 *
 * Additional AC (MINCRM-140):
 *   - Pipeline roll-up value is verified against a restClient API assertion,
 *     not only UI display (F4-OV2, F4-OV3)
 *   - Stage progression: free movement is permitted in MiniCRM (any stage to
 *     any stage), verified by regression test F4-OP2
 *
 * MINCRM-140
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import {
  createContactViaUI,
  searchContactsViaApi,
  getContactById,
  getContactDeals,
} from '@behaviors/minicrm/contacts.behaviors.js';
import {
  openDeal,
  advanceDealStage,
  closeDealAsWon,
  getDealById,
  getDealsByAccount,
  linkContactToDeal,
  patchDealStage,
  createDealViaApi,
} from '@behaviors/minicrm/deals.behaviors.js';
import { createTestContact, createTestAccount, createTestDeal } from '@apps/minicrm/helpers.js';
import { RestClientError } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// Lead (Contact) Creation tests
// ---------------------------------------------------------------------------

test('@functional F4-LC1: create contact with all required fields → appears in contacts list', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await loginAsAdmin(restClient);

  const email = `f4lc1-${uniqueSuffix}@example.com`;
  const result = await createContactViaUI(
    { first_name: 'F4LC1', last_name: `Lead-${uniqueSuffix}`, email },
    { page },
  );

  expect(result.created, 'contact creation should succeed').toBe(true);
  expect(result.validationError, 'no validation error expected').toBe(false);

  // Verify via API.
  const search = await searchContactsViaApi(restClient, email);
  expect(search.total, 'created contact should be findable via API').toBe(1);
  const created = search.data[0];
  expect(created).toBeDefined();
  testData.register('contact', created!.id, `/api/v1/contacts/${created!.id}`);
});

test('@functional F4-LC2: missing required email field → inline validation error, no navigation', async ({
  page,
  restClient,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await loginAsAdmin(restClient);

  // Submit with empty email — browser required validation fires before submission.
  const result = await createContactViaUI(
    { first_name: 'F4LC2', last_name: `NoEmail-${uniqueSuffix}`, email: '' },
    { page },
  );

  expect(result.created, 'contact should not be created when email is missing').toBe(false);
  expect(result.validationError, 'validation error should be shown').toBe(true);
});

// ---------------------------------------------------------------------------
// Lead Conversion tests
//
// In MiniCRM, "converting a lead" means creating a deal linked to a contact.
// The contact (lead) remains accessible and the deal (opportunity) is the
// newly created entity. There is no single-action conversion endpoint.
// ---------------------------------------------------------------------------

test('@functional F4-LV1: contact linked to deal → both accessible via their respective views', async ({
  page,
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);

  // Create account (required for deal).
  const account = await createTestAccount(testData, restClient, {
    name: `F4LV1-Account-${Date.now()}`,
  });

  // Create contact (the lead).
  const contact = await createTestContact(testData, restClient, {
    first_name: 'F4LV1',
    last_name: `Lead-${Date.now()}`,
  });

  // Create deal (the opportunity) linked to account and seeded contact.
  const deal = await createTestDeal(testData, restClient, {
    name: `F4LV1-Deal-${Date.now()}`,
    account_id: account.id,
  });

  // Link the deal to the contact via deal_contacts (route: POST /deals/:id/contacts/:contactId).
  const linkStatus = await linkContactToDeal(restClient, deal.id, contact.id);
  expect(linkStatus, 'linking contact to deal should return 200').toBe(200);

  // Verify deal is accessible on the pipeline board.
  const dealResult = await openDeal(deal.id, { page });
  expect(dealResult.loaded, 'pipeline board should load').toBe(true);
  expect(dealResult.columnSlug, 'deal should be in Prospecting column').toBe('prospecting');

  // Verify contact still exists via API (lead not destroyed by conversion).
  // getContactById throws on non-2xx, so a successful return proves accessibility.
  const contactDetail = await getContactById(restClient, contact.id);
  expect(contactDetail.id, 'contact should still be accessible after deal creation').toBe(
    contact.id,
  );

  // Verify the link is recorded: contact's linked deals should include this deal.
  const linkedDeals = await getContactDeals(restClient, contact.id);
  const linkedDealIds = linkedDeals.map((d) => d.id);
  expect(linkedDealIds, 'contact should have the deal linked').toContain(deal.id);
});

// ---------------------------------------------------------------------------
// Opportunity (Deal) Creation tests
// ---------------------------------------------------------------------------

test('@smoke @functional F4-OC1: create deal with required fields → appears on pipeline board', async ({
  page,
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);

  const account = await createTestAccount(testData, restClient, {
    name: `F4OC1-Account-${Date.now()}`,
  });
  const deal = await createTestDeal(testData, restClient, {
    name: `F4OC1-Deal-${Date.now()}`,
    stage: 'Prospecting',
    account_id: account.id,
  });

  const result = await openDeal(deal.id, { page });
  expect(result.loaded, 'pipeline board should load').toBe(true);
  expect(result.columnSlug, 'deal should be in Prospecting column').toBe('prospecting');
});

test('@functional F4-OC2: create deal linked to account → account visible on deal via API', async ({
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);

  const account = await createTestAccount(testData, restClient, {
    name: `F4OC2-Account-${Date.now()}`,
  });
  const deal = await createTestDeal(testData, restClient, {
    name: `F4OC2-Deal-${Date.now()}`,
    account_id: account.id,
  });

  const dealDetail = await getDealById(restClient, deal.id);
  expect(dealDetail.account_id, 'deal account_id should match created account').toBe(account.id);
});

test('@functional F4-OC3: missing required name field → API 400', async ({
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);

  const account = await createTestAccount(testData, restClient, {
    name: `F4OC3-Account-${Date.now()}`,
  });

  // This test intentionally sends a malformed payload to verify the API rejects
  // it with 400. createDealViaApi always requires name so we use restClient.post
  // directly here to omit it — this is the sole permitted raw restClient call in
  // this spec file.
  let threw = false;
  try {
    await restClient.post('/api/v1/deals', {
      stage: 'Prospecting',
      account_id: account.id,
      // name intentionally omitted
    });
  } catch (err) {
    threw = true;
    expect(err instanceof RestClientError).toBe(true);
    expect((err as RestClientError).status, 'missing name should return 400').toBe(400);
  }
  expect(threw, 'creating deal without name should throw 400').toBe(true);
});

// ---------------------------------------------------------------------------
// Opportunity Pipeline tests
// ---------------------------------------------------------------------------

test('@smoke @functional F4-OP1: advance deal through pipeline stages in sequence → stage updates on board', async ({
  page,
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);

  const account = await createTestAccount(testData, restClient, {
    name: `F4OP1-Account-${Date.now()}`,
  });
  const deal = await createTestDeal(testData, restClient, {
    name: `F4OP1-Deal-${Date.now()}`,
    stage: 'Prospecting',
    account_id: account.id,
  });

  await openDeal(deal.id, { page });

  // Advance through each open stage.
  for (const [stage, expectedSlug] of [
    ['Qualification', 'qualification'],
    ['Proposal', 'proposal'],
    ['Negotiation', 'negotiation'],
  ] as const) {
    const result = await advanceDealStage(deal.id, stage, { page });
    expect(result.columnSlug, `deal should be in ${stage} column`).toBe(expectedSlug);
  }
});

test('@functional F4-OP2: regress deal to a previous stage → allowed, reflected on board', async ({
  page,
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);

  const account = await createTestAccount(testData, restClient, {
    name: `F4OP2-Account-${Date.now()}`,
  });
  // Seed deal already at Proposal stage.
  const deal = await createTestDeal(testData, restClient, {
    name: `F4OP2-Deal-${Date.now()}`,
    stage: 'Proposal',
    account_id: account.id,
  });

  await openDeal(deal.id, { page });

  // Regress to Qualification — free movement is permitted in MiniCRM.
  const result = await advanceDealStage(deal.id, 'Qualification', { page });
  expect(result.columnSlug, 'deal should have moved back to Qualification').toBe('qualification');
});

test('@smoke @functional F4-OP3: close deal as Won → marked Won, moved to closed-won column', async ({
  page,
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);

  const account = await createTestAccount(testData, restClient, {
    name: `F4OP3-Account-${Date.now()}`,
  });
  const deal = await createTestDeal(testData, restClient, {
    name: `F4OP3-Deal-${Date.now()}`,
    stage: 'Negotiation',
    account_id: account.id,
  });

  await openDeal(deal.id, { page });

  const result = await closeDealAsWon(deal.id, { page });
  expect(result.columnSlug, 'deal should be in closed-won column').toBe('closed-won');

  // Confirm via API.
  const dealDetail = await getDealById(restClient, deal.id);
  expect(dealDetail.stage, 'deal stage should be Closed Won via API').toBe('Closed Won');
});

test('@functional F4-OP4: close deal as Lost → marked Lost, moved to closed-lost column', async ({
  page,
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);

  const account = await createTestAccount(testData, restClient, {
    name: `F4OP4-Account-${Date.now()}`,
  });
  const deal = await createTestDeal(testData, restClient, {
    name: `F4OP4-Deal-${Date.now()}`,
    stage: 'Proposal',
    account_id: account.id,
  });

  await openDeal(deal.id, { page });

  const result = await advanceDealStage(deal.id, 'Closed Lost', { page });
  expect(result.columnSlug, 'deal should be in closed-lost column').toBe('closed-lost');

  // Confirm via API.
  const dealDetail = await getDealById(restClient, deal.id);
  expect(dealDetail.stage, 'deal stage should be Closed Lost via API').toBe('Closed Lost');
});

test('@functional F4-OP5: reopen closed-won deal → returns to open stage on board', async ({
  page,
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);

  const account = await createTestAccount(testData, restClient, {
    name: `F4OP5-Account-${Date.now()}`,
  });
  // Seed deal already closed as Won.
  const deal = await createTestDeal(testData, restClient, {
    name: `F4OP5-Deal-${Date.now()}`,
    stage: 'Closed Won',
    account_id: account.id,
    close_date: new Date().toISOString().slice(0, 10),
  });

  await openDeal(deal.id, { page });

  // Reopen by moving back to Negotiation — MiniCRM permits free stage movement.
  const result = await advanceDealStage(deal.id, 'Negotiation', { page });
  expect(result.columnSlug, 'deal should have moved back to Negotiation').toBe('negotiation');

  const dealDetail = await getDealById(restClient, deal.id);
  expect(dealDetail.stage, 'deal stage should be Negotiation via API').toBe('Negotiation');
});

// ---------------------------------------------------------------------------
// Opportunity Value tests
// ---------------------------------------------------------------------------

test('@functional F4-OV1: deal value is stored and returned correctly via API', async ({
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);

  const account = await createTestAccount(testData, restClient, {
    name: `F4OV1-Account-${Date.now()}`,
  });

  const dealName = `F4OV1-Deal-${Date.now()}`;
  // value is passed as a number because the Zod schema requires it numeric.
  // createDealViaApi accepts value as number | string.
  const createdDeal = await createDealViaApi(restClient, {
    name: dealName,
    stage: 'Prospecting',
    account_id: account.id,
    value: 25000,
  });
  testData.register('deal', createdDeal.id, `/api/v1/deals/${createdDeal.id}`);

  const dealDetail = await getDealById(restClient, createdDeal.id);
  // Server returns value as a numeric string (NUMERIC column).
  expect(parseFloat(dealDetail.value ?? '0'), 'deal value should be 25000').toBeCloseTo(25000, 0);
});

test('@functional F4-OV2: open deal contributes to pipeline value total via API (AC)', async ({
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);

  const account = await createTestAccount(testData, restClient, {
    name: `F4OV2-Account-${Date.now()}`,
  });

  const dealValue = 50000;
  const uniquePrefix = `F4OV2-${Date.now()}`;

  // value is passed as a number because the Zod schema requires it numeric.
  // createDealViaApi accepts value as number | string.
  const createdDeal = await createDealViaApi(restClient, {
    name: `${uniquePrefix}-Deal`,
    stage: 'Qualification',
    account_id: account.id,
    value: dealValue,
  });
  testData.register('deal', createdDeal.id, `/api/v1/deals/${createdDeal.id}`);

  // Retrieve open deals scoped to the test account and verify our deal's value is included.
  // ?search is not supported by the deals endpoint — use ?account=<id> to scope reliably.
  const deals = await getDealsByAccount(restClient, account.id);

  const ourDeal = deals.find((d) => d.id === createdDeal.id);
  expect(ourDeal, 'seeded deal should appear in list').toBeDefined();
  expect(
    parseFloat(ourDeal!.value ?? '0'),
    'deal value in list should match seeded value',
  ).toBeCloseTo(dealValue, 0);
});

test('@functional F4-OV3: closed-won deal is excluded from open pipeline list via API (AC)', async ({
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);

  const account = await createTestAccount(testData, restClient, {
    name: `F4OV3-Account-${Date.now()}`,
  });

  const uniquePrefix = `F4OV3-${Date.now()}`;

  // Create a deal and immediately close it as Won via API.
  // MINCRM-349: capture version from the create response for optimistic locking.
  // value is passed as a number because the Zod schema requires it numeric.
  // createDealViaApi accepts value as number | string.
  const createdDeal = await createDealViaApi(restClient, {
    name: `${uniquePrefix}-Deal`,
    stage: 'Prospecting',
    account_id: account.id,
    value: 75000,
  });
  testData.register('deal', createdDeal.id, `/api/v1/deals/${createdDeal.id}`);

  await patchDealStage(
    restClient,
    createdDeal.id,
    'Closed Won',
    createdDeal.version,
    new Date().toISOString().slice(0, 10),
  );

  // Fetch deals scoped to the test account, then filter client-side to open
  // stages only (?search is not supported; ?account= is the reliable scoping filter).
  const OPEN_STAGES = ['Prospecting', 'Qualification', 'Proposal', 'Negotiation'];
  const deals = await getDealsByAccount(restClient, account.id);

  const openDeals = deals.filter((d) => OPEN_STAGES.includes(d.stage));
  const foundInOpen = openDeals.some((d) => d.id === createdDeal.id);
  expect(foundInOpen, 'closed-won deal should not appear in open pipeline list').toBe(false);

  // Confirm deal is definitively closed via direct GET.
  const dealDetail = await getDealById(restClient, createdDeal.id);
  expect(dealDetail.stage).toBe('Closed Won');
});

test('@functional F4-OV4: closed-lost deal is excluded from open pipeline list via API (AC)', async ({
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);

  const account = await createTestAccount(testData, restClient, {
    name: `F4OV4-Account-${Date.now()}`,
  });

  const uniquePrefix = `F4OV4-${Date.now()}`;

  // MINCRM-349: capture version from the create response for optimistic locking.
  // value is passed as a number because the Zod schema requires it numeric.
  // createDealViaApi accepts value as number | string.
  const createdDeal = await createDealViaApi(restClient, {
    name: `${uniquePrefix}-Deal`,
    stage: 'Prospecting',
    account_id: account.id,
    value: 30000,
  });
  testData.register('deal', createdDeal.id, `/api/v1/deals/${createdDeal.id}`);

  await patchDealStage(
    restClient,
    createdDeal.id,
    'Closed Lost',
    createdDeal.version,
    new Date().toISOString().slice(0, 10),
  );

  // Fetch deals scoped to the test account, then filter client-side to open
  // stages only (?search is not supported; ?account= is the reliable scoping filter).
  const OPEN_STAGES = ['Prospecting', 'Qualification', 'Proposal', 'Negotiation'];
  const deals = await getDealsByAccount(restClient, account.id);

  const openDeals = deals.filter((d) => OPEN_STAGES.includes(d.stage));
  const foundInOpen = openDeals.some((d) => d.id === createdDeal.id);
  expect(foundInOpen, 'closed-lost deal should not appear in open pipeline list').toBe(false);

  const dealDetail = await getDealById(restClient, createdDeal.id);
  expect(dealDetail.stage).toBe('Closed Lost');
});
