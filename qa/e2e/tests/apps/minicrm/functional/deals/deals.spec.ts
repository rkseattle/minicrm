/**
 * F7-D — Deal CRUD functional tests (MINCRM-314)
 *
 * Covers the core deal lifecycle journeys through the UI:
 *   Create  — open new deal form, fill fields, submit, assert card on board
 *   Edit    — navigate to deal detail, change name/value, assert update
 *   Delete  — trigger delete flow, confirm, assert redirect and 404
 *   Link    — link a contact to a deal via detail page, assert in list, unlink
 *
 * Each test seeds its own data via restClient and cleans up via TestDataManager.
 * UI actions use page.locate() healing locators throughout.
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators — all through page.locate() healing locators
 *   - Test data managed via restClient + TestDataManager (auto teardown)
 *
 * MINCRM-314
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { RestClientError } from '@framework/clients/rest-client.js';
import {
  createTestAccount,
  createTestContact,
  createTestDeal,
  createTestActivity,
  createTestRep,
  navigateToDeal,
} from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser, loginAs } from '@behaviors/minicrm/auth.behaviors.js';
import {
  getDealById,
  listDealsViaApi,
  navigateToPipelineBoard,
  clickNewDealOnBoard,
  getDealCardLocator,
  getDealNameInputLocator,
  getDealStageSelectOnFormLocator,
  getDealValueInputLocator,
  getDealCloseDateInputLocator,
  getDealAccountSelectLocator,
  getDealFormSubmitLocator,
  openDealEditForm,
  submitDealForm,
  getDealNameHeadingLocator,
  clickDeleteDeal,
  confirmDeleteDeal,
  getDealLinkedContactsHeadingLocator,
  getDealLinkContactSelectLocator,
  getDealLinkContactButtonLocator,
  getDealLinkedContactLocator,
  getDealUnlinkContactLocator,
  getDealLinkedContactsEmptyLocator,
  waitForDealsListUrl,
  type DealRow,
} from '@behaviors/minicrm/deals.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const rep = await createTestRep(testData, restClient);
  await loginViaBrowser(rep.email, rep.password, { page });
  await loginAs(restClient, rep.email, rep.password);
});

// ---------------------------------------------------------------------------
// F7-D1 — Create deal via UI; card appears on pipeline board
// ---------------------------------------------------------------------------

test(
  'F7-D1: creating a deal via the new deal form adds a card to the pipeline board',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
    test.skip(isMobile, 'new-deal-button is desktop-only on the pipeline board');

    const account = await createTestAccount(testData, restClient, {
      name: `D1-Acct ${test.info().title}`,
    });

    await navigateToPipelineBoard({ page });

    // Open the new deal form using the board's new-deal button
    await clickNewDealOnBoard({ page });

    // Fill in the deal form via DealDetailPage locators

    const dealNameInput = await getDealNameInputLocator({ page });
    const dealName = `D1-Deal ${Date.now()}`;
    await dealNameInput.fill(dealName);

    const stageSelect = await getDealStageSelectOnFormLocator({ page });
    await stageSelect.selectOption('Prospecting');

    const valueInput = await getDealValueInputLocator({ page });
    await valueInput.fill('15000');

    const closeDateInput = await getDealCloseDateInputLocator({ page });
    const closeDate = new Date();
    closeDate.setMonth(closeDate.getMonth() + 1);
    const closeDateStr = closeDate.toISOString().split('T')[0]!;
    await closeDateInput.fill(closeDateStr);

    const accountSelect = await getDealAccountSelectLocator({ page });
    await accountSelect.selectOption(account.id);

    // Submit the form
    const submitBtn = await getDealFormSubmitLocator({ page });
    await submitBtn.click();

    // Wait for the form submit button to detach (form closed) before querying the API.
    await submitBtn.waitFor({ state: 'detached', timeout: 15_000 });

    const listResponse = await listDealsViaApi(restClient, {
      sort: 'created_at',
      dir: 'desc',
      limit: 100,
    });
    const createdDeal = listResponse.data.find((d) => d.name === dealName);
    expect(
      createdDeal,
      `Deal "${dealName}" must appear in the API list sorted newest-first`,
    ).toBeDefined();

    if (createdDeal) {
      // Register for teardown (deal was created via UI, not via helper)
      testData.register('deal', createdDeal.id, `/api/v1/deals/${createdDeal.id}`);

      // Assert the deal card appears on the board in the Prospecting column.
      const dealCard = await getDealCardLocator(createdDeal.id, { page });
      await expect(dealCard).toBeVisible({ timeout: 10_000 });

      // Verify via API
      const fetchedDeal = await getDealById(restClient, createdDeal.id);
      expect(fetchedDeal.stage).toBe('Prospecting');
      expect(parseFloat(fetchedDeal.value ?? '0')).toBe(15000);
    }
  },
);

// ---------------------------------------------------------------------------
// F7-D2 — Edit deal via detail page; UI and API reflect updated values
// ---------------------------------------------------------------------------

test(
  'F7-D2: editing a deal name and value via the detail page persists the changes',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `D2-Acct ${test.info().title}`,
    });
    const deal = await createTestDeal(testData, restClient, {
      name: `D2-Deal-Original ${test.info().title}`,
      stage: 'Qualification',
      value: '5000',
      account_id: account.id,
    });

    await navigateToDeal(page, deal.id);

    // Open edit form
    await openDealEditForm({ page });

    // Change name and value
    const nameInput = await getDealNameInputLocator({ page });
    const updatedName = `D2-Deal-Updated ${test.info().title}`;
    await nameInput.fill(updatedName);

    const valueInput = await getDealValueInputLocator({ page });
    await valueInput.fill('9999');

    await submitDealForm({ page });

    // UI assertion — deal name heading shows updated value; wait directly for it
    // since it reflects the exact mutation result the test cares about.
    const dealNameEl = await getDealNameHeadingLocator({ page });
    await expect(dealNameEl).toHaveText(updatedName, { timeout: 10_000 });

    // API assertion — GET returns updated fields
    const fetched = await getDealById(restClient, deal.id);
    expect(fetched.name).toBe(updatedName);
    expect(parseFloat(fetched.value ?? '0')).toBe(9999);
  },
);

// ---------------------------------------------------------------------------
// F7-D3 — Delete deal via UI; deal and cascade activities return 404
// ---------------------------------------------------------------------------

test(
  'F7-D3: deleting a deal via the confirm dialog removes it and cascades to linked activities',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `D3-Acct ${test.info().title}`,
    });
    const deal = await createTestDeal(testData, restClient, {
      name: `D3-Deal ${test.info().title}`,
      stage: 'Prospecting',
      value: '1000',
      account_id: account.id,
    });

    // Create an activity linked only to this deal (will cascade-delete with the deal)
    const activity = await createTestActivity(testData, restClient, {
      type: 'Task',
      subject: `D3-Task ${test.info().title}`,
      deal_id: deal.id,
    });

    await navigateToDeal(page, deal.id);

    // Trigger delete flow and confirm in the modal
    await clickDeleteDeal({ page });
    await confirmDeleteDeal({ page });

    // Should redirect to /deals after deletion
    await waitForDealsListUrl({ page }, 10_000);

    // API assertion — deal returns 404
    await expect(restClient.get<{ deal: DealRow }>(`/api/v1/deals/${deal.id}`)).rejects.toThrow(
      RestClientError,
    );
    try {
      await restClient.get<{ deal: DealRow }>(`/api/v1/deals/${deal.id}`);
    } catch (err) {
      expect(err).toBeInstanceOf(RestClientError);
      expect((err as RestClientError).status).toBe(404);
    }

    // Cascade assertion — activity linked only to the deleted deal returns 404
    await expect(restClient.get(`/api/v1/activities/${activity.id}`)).rejects.toThrow(
      RestClientError,
    );
    try {
      await restClient.get(`/api/v1/activities/${activity.id}`);
    } catch (err) {
      expect(err).toBeInstanceOf(RestClientError);
      expect((err as RestClientError).status).toBe(404);
    }
  },
);

// ---------------------------------------------------------------------------
// F7-D4 — Link a contact to a deal and then unlink it
// ---------------------------------------------------------------------------

test(
  'F7-D4: linking a contact to a deal via the detail page adds it to the contacts list',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
    test.skip(isMobile, 'link-contact-form requires sufficient viewport width');

    const account = await createTestAccount(testData, restClient, {
      name: `D4-Acct ${test.info().title}`,
    });
    const deal = await createTestDeal(testData, restClient, {
      name: `D4-Deal ${test.info().title}`,
      stage: 'Proposal',
      value: '25000',
      account_id: account.id,
    });
    const contact = await createTestContact(testData, restClient, {
      first_name: 'D4',
      last_name: 'Contact',
      email: `d4-contact-${Date.now()}@example.com`,
    });

    await navigateToDeal(page, deal.id);

    // Wait for linked contacts section to be visible
    const contactsHeading = await getDealLinkedContactsHeadingLocator({ page });
    await expect(contactsHeading).toBeVisible({ timeout: 10_000 });

    // Select contact from the link form dropdown
    const linkSelect = await getDealLinkContactSelectLocator({ page });
    await linkSelect.selectOption(contact.id);

    const linkBtn = await getDealLinkContactButtonLocator({ page });
    await linkBtn.click();

    // Assert contact appears in the linked contacts list
    const linkedContactEl = await getDealLinkedContactLocator(contact.id, { page });
    await expect(linkedContactEl).toBeVisible({ timeout: 10_000 });

    // Unlink the contact
    const unlinkBtn = await getDealUnlinkContactLocator(contact.id, { page });
    await unlinkBtn.click();

    // After unlinking, the empty state should appear
    const emptyState = await getDealLinkedContactsEmptyLocator({ page });
    await expect(emptyState).toBeVisible({ timeout: 10_000 });
  },
);
