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
  navigateToDeal,
} from '@apps/minicrm/helpers.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F7-D] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Shared response types
// ---------------------------------------------------------------------------

interface DealSingleResponse {
  deal: {
    id: string;
    name: string;
    stage: string;
    value: string | null;
    currency: string;
    close_date: string | null;
    account_id: string | null;
    owner_id: string;
  };
}

// ---------------------------------------------------------------------------
// F7-D1 — Create deal via UI; card appears on pipeline board
// ---------------------------------------------------------------------------

test(
  'F7-D1: creating a deal via the new deal form adds a card to the pipeline board',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
    test.skip(isMobile, 'new-deal-button is desktop-only on the pipeline board');

    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const account = await createTestAccount(testData, restClient, {
      name: `D1-Acct ${test.info().title}`,
    });

    await page.goto('/deals', { waitUntil: 'networkidle' });

    // Open the new deal form
    const newDealBtn = await page
      .locate(
        [
          { type: 'testId', value: 'new-deal-button' },
          { type: 'css', value: '[data-testid="new-deal-button"]' },
        ],
        { intent: 'button that opens the new deal creation form' },
      )
      .resolve();
    await newDealBtn.click();

    // Fill in the deal form
    const dealNameInput = await page
      .locate(
        [
          { type: 'testId', value: 'deal-name-input' },
          { type: 'css', value: '[data-testid="deal-name-input"]' },
        ],
        { intent: 'deal name text input field' },
      )
      .resolve();
    const dealName = `D1-Deal ${Date.now()}`;
    await dealNameInput.fill(dealName);

    const stageSelect = await page
      .locate(
        [
          { type: 'testId', value: 'deal-stage-select' },
          { type: 'css', value: '[data-testid="deal-stage-select"]' },
        ],
        { intent: 'deal pipeline stage selector' },
      )
      .resolve();
    await stageSelect.selectOption('Prospecting');

    const valueInput = await page
      .locate(
        [
          { type: 'testId', value: 'deal-value-input' },
          { type: 'css', value: '[data-testid="deal-value-input"]' },
        ],
        { intent: 'deal monetary value input field' },
      )
      .resolve();
    await valueInput.fill('15000');

    const closeDateInput = await page
      .locate(
        [
          { type: 'testId', value: 'deal-close-date-input' },
          { type: 'css', value: '[data-testid="deal-close-date-input"]' },
        ],
        { intent: 'deal expected close date input' },
      )
      .resolve();
    const closeDate = new Date();
    closeDate.setMonth(closeDate.getMonth() + 1);
    const closeDateStr = closeDate.toISOString().split('T')[0]!;
    await closeDateInput.fill(closeDateStr);

    const accountSelect = await page
      .locate(
        [
          { type: 'testId', value: 'deal-account-select' },
          { type: 'css', value: '[data-testid="deal-account-select"]' },
        ],
        { intent: 'account selector on the deal form' },
      )
      .resolve();
    await accountSelect.selectOption(account.id);

    // Submit the form
    const submitBtn = await page
      .locate(
        [
          { type: 'testId', value: 'deal-form-submit' },
          { type: 'css', value: '[data-testid="deal-form-submit"]' },
        ],
        { intent: 'submit button on the new deal form' },
      )
      .resolve();
    await submitBtn.click();

    // Wait for the board to show the new deal card — look it up via API first
    // to get the ID, then assert the card by testId
    await page.waitForLoadState('networkidle');

    // The deal should now exist — find it by name via API
    const listResponse = await restClient.get<{ deals: DealSingleResponse['deal'][] }>(
      '/api/v1/deals',
    );
    const createdDeal = listResponse.body.deals.find((d) => d.name === dealName);
    expect(createdDeal, `Deal "${dealName}" must appear in the API list`).toBeDefined();

    if (createdDeal) {
      // Register for teardown (was created via UI, not via helper)
      testData.register('deal', createdDeal.id, `/api/v1/deals/${createdDeal.id}`);

      // Assert the deal card appears on the board in the Prospecting column
      const dealCard = await page
        .locate(
          [
            { type: 'testId', value: `deal-card-${createdDeal.id}` },
            { type: 'css', value: `[data-testid="deal-card-${createdDeal.id}"]` },
          ],
          { intent: `deal card for the newly created deal ${createdDeal.id}` },
        )
        .resolve();
      await expect(dealCard).toBeVisible({ timeout: 10_000 });

      // Verify via API
      const fetchedResponse = await restClient.get<DealSingleResponse>(
        `/api/v1/deals/${createdDeal.id}`,
      );
      expect(fetchedResponse.body.deal.stage).toBe('Prospecting');
      expect(parseFloat(fetchedResponse.body.deal.value ?? '0')).toBe(15000);
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
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

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
    const editBtn = await page
      .locate(
        [
          { type: 'testId', value: 'edit-deal-button' },
          { type: 'css', value: '[data-testid="edit-deal-button"]' },
        ],
        { intent: 'button to open the deal edit form' },
      )
      .resolve();
    await editBtn.click();

    // Change name and value
    const nameInput = await page
      .locate(
        [
          { type: 'testId', value: 'deal-name-input' },
          { type: 'css', value: '[data-testid="deal-name-input"]' },
        ],
        { intent: 'deal name input field in the edit form' },
      )
      .resolve();
    const updatedName = `D2-Deal-Updated ${test.info().title}`;
    await nameInput.fill(updatedName);

    const valueInput = await page
      .locate(
        [
          { type: 'testId', value: 'deal-value-input' },
          { type: 'css', value: '[data-testid="deal-value-input"]' },
        ],
        { intent: 'deal value input field in the edit form' },
      )
      .resolve();
    await valueInput.fill('9999');

    const submitBtn = await page
      .locate(
        [
          { type: 'testId', value: 'deal-form-submit' },
          { type: 'css', value: '[data-testid="deal-form-submit"]' },
        ],
        { intent: 'save button on the deal edit form' },
      )
      .resolve();
    await submitBtn.click();

    await page.waitForLoadState('networkidle');

    // UI assertion — deal name heading shows updated value
    const dealNameEl = await page
      .locate(
        [
          { type: 'testId', value: 'deal-name' },
          { type: 'css', value: '[data-testid="deal-name"]' },
        ],
        { intent: 'deal name heading on the deal detail page' },
      )
      .resolve();
    await expect(dealNameEl).toHaveText(updatedName, { timeout: 10_000 });

    // API assertion — GET returns updated fields
    const fetched = await restClient.get<DealSingleResponse>(`/api/v1/deals/${deal.id}`);
    expect(fetched.body.deal.name).toBe(updatedName);
    expect(parseFloat(fetched.body.deal.value ?? '0')).toBe(9999);
  },
);

// ---------------------------------------------------------------------------
// F7-D3 — Delete deal via UI; deal and cascade activities return 404
// ---------------------------------------------------------------------------

test(
  'F7-D3: deleting a deal via the confirm dialog removes it and cascades to linked activities',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

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

    // Trigger delete flow
    const deleteBtn = await page
      .locate(
        [
          { type: 'testId', value: 'delete-deal-button' },
          { type: 'css', value: '[data-testid="delete-deal-button"]' },
        ],
        { intent: 'button to initiate deal deletion' },
      )
      .resolve();
    await deleteBtn.click();

    // Confirm in the modal
    const confirmBtn = await page
      .locate(
        [
          { type: 'testId', value: 'confirm-delete-confirm' },
          { type: 'css', value: '[data-testid="confirm-delete-confirm"]' },
        ],
        { intent: 'confirm button in the delete confirmation modal' },
      )
      .resolve();
    await confirmBtn.click();

    // Should redirect to /deals after deletion
    await page.waitForURL('/deals', { timeout: 10_000 });

    // API assertion — deal returns 404
    await expect(restClient.get<DealSingleResponse>(`/api/v1/deals/${deal.id}`)).rejects.toThrow(
      RestClientError,
    );
    try {
      await restClient.get<DealSingleResponse>(`/api/v1/deals/${deal.id}`);
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

    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

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
    const contactsHeading = await page
      .locate(
        [
          { type: 'testId', value: 'linked-contacts-heading' },
          { type: 'css', value: '[data-testid="linked-contacts-heading"]' },
        ],
        { intent: 'linked contacts section heading on deal detail page' },
      )
      .resolve();
    await expect(contactsHeading).toBeVisible({ timeout: 10_000 });

    // Select contact from the link form dropdown
    const linkSelect = await page
      .locate(
        [
          { type: 'testId', value: 'link-contact-select' },
          { type: 'css', value: '[data-testid="link-contact-select"]' },
        ],
        { intent: 'dropdown to select a contact to link to the deal' },
      )
      .resolve();
    await linkSelect.selectOption(contact.id);

    const linkBtn = await page
      .locate(
        [
          { type: 'testId', value: 'link-contact-button' },
          { type: 'css', value: '[data-testid="link-contact-button"]' },
        ],
        { intent: 'button to confirm linking the selected contact to the deal' },
      )
      .resolve();
    await linkBtn.click();

    // Assert contact appears in the linked contacts list
    const linkedContactEl = await page
      .locate(
        [
          { type: 'testId', value: `linked-contact-${contact.id}` },
          { type: 'css', value: `[data-testid="linked-contact-${contact.id}"]` },
        ],
        { intent: `linked contact entry for contact ${contact.id}` },
      )
      .resolve();
    await expect(linkedContactEl).toBeVisible({ timeout: 10_000 });

    // Unlink the contact
    const unlinkBtn = await page
      .locate(
        [
          { type: 'testId', value: `unlink-contact-${contact.id}` },
          { type: 'css', value: `[data-testid="unlink-contact-${contact.id}"]` },
        ],
        { intent: `button to remove the linked contact ${contact.id} from the deal` },
      )
      .resolve();
    await unlinkBtn.click();

    // After unlinking, the empty state should appear
    const emptyState = await page
      .locate(
        [
          { type: 'testId', value: 'linked-contacts-empty' },
          { type: 'css', value: '[data-testid="linked-contacts-empty"]' },
        ],
        { intent: 'empty state message when no contacts are linked to the deal' },
      )
      .resolve();
    await expect(emptyState).toBeVisible({ timeout: 10_000 });
  },
);
