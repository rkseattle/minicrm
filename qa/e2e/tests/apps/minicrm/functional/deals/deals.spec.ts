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
import { PipelineBoardPage } from '@pages/minicrm/PipelineBoardPage.js';
import { DealDetailPage } from '@pages/minicrm/DealDetailPage.js';

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

    const boardPage = new PipelineBoardPage({ page });
    await boardPage.navigate();

    // Open the new deal form using the board's new-deal button
    await boardPage.clickNewDeal();

    // Fill in the deal form via DealDetailPage locators
    const dealFormPage = new DealDetailPage({ page });
    const dealNameInput = await dealFormPage.nameInputLocator();
    const dealName = `D1-Deal ${Date.now()}`;
    await dealNameInput.fill(dealName);

    const stageSelect = await dealFormPage.stageSelectLocator();
    await stageSelect.selectOption('Prospecting');

    const valueInput = await dealFormPage.valueInputLocator();
    await valueInput.fill('15000');

    const closeDateInput = await dealFormPage.closeDateInputLocator();
    const closeDate = new Date();
    closeDate.setMonth(closeDate.getMonth() + 1);
    const closeDateStr = closeDate.toISOString().split('T')[0]!;
    await closeDateInput.fill(closeDateStr);

    const accountSelect = await dealFormPage.accountSelectLocator();
    await accountSelect.selectOption(account.id);

    // Submit the form
    const submitBtn = await dealFormPage.submitLocator();
    await submitBtn.click();

    // Wait for the form to close (submit button detaches from DOM) before querying
    // the API — networkidle alone can resolve before the mutation response lands and
    // the React state update closes the form.
    await submitBtn.waitFor({ state: 'detached', timeout: 15_000 });
    await page.waitForLoadState('networkidle');

    const listResponse = await restClient.get<{ data: DealSingleResponse['deal'][] }>(
      '/api/v1/deals?sort=created_at&dir=desc&limit=100',
    );
    const createdDeal = listResponse.body.data.find((d) => d.name === dealName);
    expect(
      createdDeal,
      `Deal "${dealName}" must appear in the API list sorted newest-first`,
    ).toBeDefined();

    if (createdDeal) {
      // Register for teardown (deal was created via UI, not via helper)
      testData.register('deal', createdDeal.id, `/api/v1/deals/${createdDeal.id}`);

      // Assert the deal card appears on the board in the Prospecting column.
      const dealCard = await new PipelineBoardPage({ page }).dealCardLocator(createdDeal.id);
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

    const dealDetailPage = new DealDetailPage({ page });

    // Open edit form
    await dealDetailPage.clickEdit();

    // Change name and value
    const nameInput = await dealDetailPage.nameInputLocator();
    const updatedName = `D2-Deal-Updated ${test.info().title}`;
    await nameInput.fill(updatedName);

    const valueInput = await dealDetailPage.valueInputLocator();
    await valueInput.fill('9999');

    await dealDetailPage.submitForm();

    await page.waitForLoadState('networkidle');

    // UI assertion — deal name heading shows updated value
    const dealNameEl = await dealDetailPage.dealNameLocator();
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

    const dealDetailPage = new DealDetailPage({ page });

    // Trigger delete flow and confirm in the modal
    await dealDetailPage.clickDelete();
    await dealDetailPage.confirmDelete();

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

    const dealDetailPage = new DealDetailPage({ page });

    // Wait for linked contacts section to be visible
    const contactsHeading = await dealDetailPage.linkedContactsHeadingLocator();
    await expect(contactsHeading).toBeVisible({ timeout: 10_000 });

    // Select contact from the link form dropdown
    const linkSelect = await dealDetailPage.linkContactSelectLocator();
    await linkSelect.selectOption(contact.id);

    const linkBtn = await dealDetailPage.linkContactButtonLocator();
    await linkBtn.click();

    // Assert contact appears in the linked contacts list
    const linkedContactEl = await dealDetailPage.linkedContactLocator(contact.id);
    await expect(linkedContactEl).toBeVisible({ timeout: 10_000 });

    // Unlink the contact
    const unlinkBtn = await dealDetailPage.unlinkContactLocator(contact.id);
    await unlinkBtn.click();

    // After unlinking, the empty state should appear
    const emptyState = await dealDetailPage.linkedContactsEmptyLocator();
    await expect(emptyState).toBeVisible({ timeout: 10_000 });
  },
);
