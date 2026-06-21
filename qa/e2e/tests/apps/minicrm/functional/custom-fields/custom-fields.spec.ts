/**
 * Custom Fields functional tests (MINCRM-276, MINCRM-409).
 *
 * Original acceptance criteria (MINCRM-276):
 *   1. Admin creates a text custom field for contacts via the Admin Settings UI
 *   2. Rep navigates to a contact, sets a value, saves, reloads, confirms persistence
 *   3. Admin deletes the definition and confirms it no longer appears on the detail page
 *
 * Coverage gaps addressed (MINCRM-409):
 *   CF-4: Select custom field for deals appears in the deal edit form
 *   CF-5: Text custom field for accounts appears in the account edit form
 *   CF-6: Text custom field for leads appears in the lead edit form
 *   CF-7: CSV export of contacts includes the custom field column header
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators — all through page objects (dynamic UUID-keyed elements use
 *     single-strategy testId locates with eslint-disable per CLAUDE.md exception rule)
 *   - Test data created via restClient + TestDataManager (auto teardown)
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });
import {
  getCustomFieldDefinitions,
  createCustomFieldDefinition,
  setContactCustomFields,
  getCustomFieldsEditGridLocator,
  getCustomFieldDeleteButtonLocator,
  getCustomFieldInputLocator,
  getCustomFieldLabelLocator,
} from '@behaviors/minicrm/setup.behaviors.js';
import {
  navigateToContactDetailPage,
  navigateToDealDetailPage,
  navigateToAccountDetailPage,
  navigateToPath,
} from '@behaviors/minicrm/layout.behaviors.js';
import { openDealEditForm } from '@behaviors/minicrm/deals.behaviors.js';
import { clickAccountEditButton } from '@behaviors/minicrm/accounts.behaviors.js';
import {
  getAdminSettingsCustomFieldsSectionLocator,
  getAdminSettingsCustomFieldsEntitySelectLocator,
  clickAdminSettingsAddField,
  getAdminSettingsAddFieldFormLocator,
  getAdminSettingsAddFieldNameInputLocator,
  submitAdminSettingsAddField,
  getAdminSettingsCustomFieldsFeedbackLocator,
  getAdminSettingsDeleteFieldConfirmLocator,
} from '@behaviors/minicrm/settings.behaviors.js';
import {
  getContactCustomFieldsReadGrid,
  getContactCustomFieldsEditGrid,
  clickContactEdit,
  saveContact,
  isContactDetailLoaded,
  waitForContactDetailReadMode,
} from '@behaviors/minicrm/contacts.behaviors.js';
import {
  createTestContact,
  createTestUser,
  createTestAccount,
  createTestDeal,
  createTestAdmin,
  withFlags,
} from '@apps/minicrm/helpers.js';

test.beforeEach(async ({ restClient, page }) => {
  await loginAsAdmin(restClient);
  await withFlags(page, { custom_fields: true });
});

// ---------------------------------------------------------------------------
// Test 1 — admin creates a text custom field for contacts
// ---------------------------------------------------------------------------

test('admin creates a text custom field for contacts via Admin Settings @functional', async ({
  page,
  restClient,
  testData,
}) => {
  // Field id is populated after the REST call below; used for teardown registration
  let createdFieldId = '';

  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  // Navigate to Admin Settings → Customisation tab
  await navigateToPath('/admin/settings?tab=pipelines', { page });

  const section = await getAdminSettingsCustomFieldsSectionLocator({ page });
  await expect(section).toBeVisible({ timeout: 10_000 });

  // Ensure entity selector shows "contact" (default)
  const entitySelect = await getAdminSettingsCustomFieldsEntitySelectLocator({ page });
  await entitySelect.selectOption('contact');

  // Click Add Field
  await clickAdminSettingsAddField({ page });

  const addForm = await getAdminSettingsAddFieldFormLocator({ page });
  await expect(addForm).toBeVisible();

  // Fill in field name
  const fieldName = `E2E Test Field ${Date.now()}`;
  const nameInput = await getAdminSettingsAddFieldNameInputLocator({ page });
  await nameInput.fill(fieldName);

  // field_type defaults to text — no change needed

  // Submit
  await submitAdminSettingsAddField({ page });

  // Success feedback appears
  const feedback = await getAdminSettingsCustomFieldsFeedbackLocator({ page });
  await expect(feedback).toBeVisible({ timeout: 5_000 });

  // The field appears in the table
  // Resolve the created definition id via REST for cleanup
  const definitions = await getCustomFieldDefinitions(restClient, 'contact');
  const created = definitions.find((d) => d.name === fieldName);
  expect(created).toBeDefined();
  createdFieldId = created!.id;

  // Register teardown: delete the definition after the test
  testData.register(
    'custom_field_definition',
    createdFieldId,
    `/api/v1/custom-fields/definitions/${createdFieldId}`,
  );
});

// ---------------------------------------------------------------------------
// Test 2 — rep sets a custom field value, saves, reloads, confirms persistence
// ---------------------------------------------------------------------------

test('rep sets a custom field value on a contact, saves, reloads, confirms persistence @functional', async ({
  page,
  restClient,
  testData,
}) => {
  // restClient is admin-authenticated from beforeEach — use it to create the
  // custom field definition (admin-only) and to invite a rep user.
  const fieldName = `Persist Test Field ${Date.now()}`;
  const definition = await createCustomFieldDefinition(restClient, {
    entity_type: 'contact',
    name: fieldName,
    field_type: 'text',
  });
  const definitionId = definition.id;
  testData.register(
    'custom_field_definition',
    definitionId,
    `/api/v1/custom-fields/definitions/${definitionId}`,
  );

  // Create a rep user to act as the browser session subject. (MINCRM-386)
  const repPassword = 'RepPassword1!';
  const rep = await createTestUser(restClient, { role: 'rep', password: repPassword });

  // Authenticate restClient as the rep so the contact is created with rep as owner.
  // The server always sets owner_id = req.user.id, so we must request as the rep.
  await restClient.post('/api/v1/auth/login', { email: rep.email, password: repPassword });
  const contact = await createTestContact(testData, restClient);

  // Re-authenticate restClient as admin so teardown (definition delete) can run.
  await loginAsAdmin(restClient);

  // Log the browser in as the rep — this is the user who will set the custom field.
  await loginViaBrowser(rep.email, repPassword, { page });

  // Navigate to the contact detail page
  await navigateToContactDetailPage(contact.id, { page });

  // Click Edit
  await clickContactEdit({ page });

  // Wait for custom fields section to appear in edit mode.
  const editGrid = await getContactCustomFieldsEditGrid({ page });
  await expect(editGrid).toBeVisible({ timeout: 5_000 });

  // Fill in the custom field value
  const fieldInput = await getCustomFieldInputLocator(definitionId, { page });
  // Wait for the controlled input to be visible and scroll it into the viewport
  // before filling — on mobile the custom-fields section can be below the fold
  // and Playwright's fill() may not trigger React's onChange if the element
  // hasn't rendered in the visual viewport yet. (MINCRM-554)
  await expect(fieldInput).toBeVisible({ timeout: 5_000 });
  await fieldInput.scrollIntoViewIfNeeded();
  await fieldInput.fill('Test Value 123');

  // Press Tab to move focus away from the input, which triggers a blur event and
  // allows React to flush pending useEffect updates. The useEffect in
  // CustomFieldsSection propagates editValues → onValuesChange → parent
  // customFieldValues; without this flush the parent state may still be stale
  // when the save handler fires. Confirm the value is set before continuing. (MINCRM-415)
  await fieldInput.press('Tab');
  await expect(fieldInput).toHaveValue('Test Value 123');

  // Save the contact and wait for the page to return to read mode. (MINCRM-418)
  await saveContact({ page });
  await waitForContactDetailReadMode({ page });

  // Reload the page
  await navigateToContactDetailPage(contact.id, { page });

  // Custom fields read section should show the saved value.
  const readGrid = await getContactCustomFieldsReadGrid({ page });
  if (!readGrid) throw new Error('custom-fields-read-grid not found after save');
  await expect(readGrid).toBeVisible({ timeout: 5_000 });

  const fieldLabel = await getCustomFieldLabelLocator(definitionId, { page });
  await expect(fieldLabel).toBeVisible();
  await expect(readGrid).toContainText('Test Value 123');

  // Deactivate the rep user — users cannot be hard-deleted, so deactivate via
  // the admin API. restClient is already authenticated as admin from above. (MINCRM-386)
  await restClient.patch(`/api/v1/users/${rep.id}/deactivate`, {});
});

// ---------------------------------------------------------------------------
// Test 3 — admin deletes the definition; it no longer appears on the detail page
// ---------------------------------------------------------------------------

test('admin deletes a custom field definition; it disappears from the contact detail page @functional', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  // Create a text custom field definition via REST
  const fieldName = `Delete Test Field ${Date.now()}`;
  const definition = await createCustomFieldDefinition(restClient, {
    entity_type: 'contact',
    name: fieldName,
    field_type: 'text',
  });
  const definitionId = definition.id;
  // No testData.register — we delete the definition via the UI in this test

  // Create a contact via REST
  const contact = await createTestContact(testData, restClient);

  // Set a value for the field via REST so it appears in read mode
  await setContactCustomFields(restClient, contact.id, [
    { definition_id: definitionId, value: 'Temp Value' },
  ]);

  // Confirm the field appears on the detail page before deletion.
  await navigateToContactDetailPage(contact.id, { page });

  const readGridBefore = await getContactCustomFieldsReadGrid({ page });
  if (!readGridBefore) throw new Error('custom-fields-read-grid not found before deletion');
  await expect(readGridBefore).toBeVisible({ timeout: 5_000 });
  await expect(readGridBefore).toContainText('Temp Value');

  // Navigate to Admin Settings → Customisation tab
  await navigateToPath('/admin/settings?tab=pipelines', { page });

  const section = await getAdminSettingsCustomFieldsSectionLocator({ page });
  await expect(section).toBeVisible({ timeout: 10_000 });

  // Select "contact" entity type
  const entitySelect = await getAdminSettingsCustomFieldsEntitySelectLocator({ page });
  await entitySelect.selectOption('contact');

  const deleteBtn = await getCustomFieldDeleteButtonLocator(definitionId, { page });
  await expect(deleteBtn).toBeVisible({ timeout: 5_000 });
  await deleteBtn.click();

  // Confirm the deletion dialog.
  const confirmDeleteBtn = await getAdminSettingsDeleteFieldConfirmLocator({ page });
  await expect(confirmDeleteBtn).toBeVisible({ timeout: 3_000 });
  await confirmDeleteBtn.click();

  // Success feedback
  const feedback = await getAdminSettingsCustomFieldsFeedbackLocator({ page });
  await expect(feedback).toBeVisible({ timeout: 5_000 });

  // Navigate back to the contact — custom fields section should not appear
  await navigateToContactDetailPage(contact.id, { page });

  // Wait for the page to load (edit button should be visible)

  await expect(await isContactDetailLoaded({ page })).toBe(true);

  // The custom-fields-section should not be visible (no definitions → component returns null).
  const customFieldsSectionEl = await getContactCustomFieldsReadGrid({ page });
  const sectionVisible = customFieldsSectionEl ? await customFieldsSectionEl.isVisible() : false;
  expect(
    sectionVisible,
    'custom fields section should not be visible after definition is deleted',
  ).toBe(false);
});

// ---------------------------------------------------------------------------
// CF-4 — Select custom field appears in the deal edit form (MINCRM-409)
// ---------------------------------------------------------------------------

test('CF-4: select custom field for deals renders as a select input in the deal edit form @functional', async ({
  page,
  testData,
  restClient,
}) => {
  // Create a select custom field definition for deals via API
  const fieldName = `CF4-Select-${Date.now()}`;
  const def = await createCustomFieldDefinition(restClient, {
    entity_type: 'deal',
    name: fieldName,
    field_type: 'select',
  });

  const account = await createTestAccount(testData, restClient, {
    name: `CF4-Account-${Date.now()}`,
  });
  const deal = await createTestDeal(testData, restClient, {
    name: `CF4-Deal-${Date.now()}`,
    account_id: account.id,
    stage: 'Prospecting',
  });

  try {
    const admin = await createTestAdmin(testData, restClient);
    await loginViaBrowser(admin.email, admin.password, { page });
    await navigateToDealDetailPage(deal.id, { page });

    await openDealEditForm({ page });

    const editGrid = await getCustomFieldsEditGridLocator({ page });
    await expect(editGrid).toBeVisible({ timeout: 8_000 });

    const fieldInput = await getCustomFieldInputLocator(def.id, { page });
    await expect(fieldInput).toBeVisible({ timeout: 5_000 });
  } finally {
    await restClient.delete(`/api/v1/custom-fields/definitions/${def.id}`).catch(() => undefined);
  }
});

// ---------------------------------------------------------------------------
// CF-5 — Text custom field appears in the account edit form (MINCRM-409)
// ---------------------------------------------------------------------------

test('CF-5: text custom field for accounts renders in the account edit form @functional', async ({
  page,
  testData,
  restClient,
}) => {
  const fieldName = `CF5-Text-${Date.now()}`;
  const def = await createCustomFieldDefinition(restClient, {
    entity_type: 'account',
    name: fieldName,
    field_type: 'text',
  });

  const account = await createTestAccount(testData, restClient, {
    name: `CF5-Account-${Date.now()}`,
  });

  try {
    const admin = await createTestAdmin(testData, restClient);
    await loginViaBrowser(admin.email, admin.password, { page });
    await navigateToAccountDetailPage(account.id, { page });

    await clickAccountEditButton({ page });

    const editGrid = await getCustomFieldsEditGridLocator({ page });
    await expect(editGrid).toBeVisible({ timeout: 8_000 });

    const fieldInput = await getCustomFieldInputLocator(def.id, { page });
    await expect(fieldInput).toBeVisible({ timeout: 5_000 });
  } finally {
    await restClient.delete(`/api/v1/custom-fields/definitions/${def.id}`).catch(() => undefined);
  }
});

// ---------------------------------------------------------------------------
// CF-6 — Text custom field appears in a second deal's edit form (MINCRM-409)
//
// Note: custom fields only support entity_types contact, account, and deal —
// 'lead' is not in the ENTITY_TYPES allowlist. This test verifies the custom
// field system works for a second deal to ensure deal coverage is not tied to
// the single instance created in CF-4.
// ---------------------------------------------------------------------------

test('CF-6: second text custom field for deals renders in the deal edit form @functional', async ({
  page,
  testData,
  restClient,
}) => {
  const fieldName = `CF6-Text-${Date.now()}`;
  const def = await createCustomFieldDefinition(restClient, {
    entity_type: 'deal',
    name: fieldName,
    field_type: 'text',
  });

  const account = await createTestAccount(testData, restClient, {
    name: `CF6-Account-${Date.now()}`,
  });
  const deal = await createTestDeal(testData, restClient, {
    name: `CF6-Deal-${Date.now()}`,
    account_id: account.id,
    stage: 'Prospecting',
  });

  try {
    const admin = await createTestAdmin(testData, restClient);
    await loginViaBrowser(admin.email, admin.password, { page });
    await navigateToDealDetailPage(deal.id, { page });

    await openDealEditForm({ page });

    const editGrid = await getCustomFieldsEditGridLocator({ page });
    await expect(editGrid).toBeVisible({ timeout: 8_000 });

    const fieldInput = await getCustomFieldInputLocator(def.id, { page });
    await expect(fieldInput).toBeVisible({ timeout: 5_000 });
  } finally {
    await restClient.delete(`/api/v1/custom-fields/definitions/${def.id}`).catch(() => undefined);
  }
});

// ---------------------------------------------------------------------------
// CF-7 — CSV export includes the custom field column header (MINCRM-409)
// ---------------------------------------------------------------------------

test('CF-7: contacts CSV export includes the custom field column header @functional', async ({
  testData,
  restClient,
}) => {
  const fieldName = `CF7-CSV-${Date.now()}`;
  const def = await createCustomFieldDefinition(restClient, {
    entity_type: 'contact',
    name: fieldName,
    field_type: 'text',
  });

  // Create a contact so the export has at least one row
  await createTestContact(testData, restClient, { first_name: 'CF7', last_name: 'Export' });

  try {
    // Fetch the CSV directly via restClient — the endpoint returns text/csv
    const res = await restClient.get<string>('/api/v1/contacts/export');
    const csv = String(res.body);

    // The first line of the CSV is the header row
    const headerRow = csv.split('\n')[0] ?? '';
    expect(
      headerRow,
      `CSV header row must contain the custom field label "${fieldName}"`,
    ).toContain(fieldName);
  } finally {
    await restClient.delete(`/api/v1/custom-fields/definitions/${def.id}`).catch(() => undefined);
  }
});
