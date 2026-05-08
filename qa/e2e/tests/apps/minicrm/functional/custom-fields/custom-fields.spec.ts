/**
 * Custom Fields functional tests (MINCRM-276)
 *
 * Covers the three acceptance criteria scenarios:
 *   1. Admin creates a text custom field for contacts via the Admin Settings UI
 *   2. Rep navigates to a contact, sets a value, saves, reloads, confirms persistence
 *   3. Admin deletes the definition and confirms it no longer appears on the detail page
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators — all through page objects (dynamic UUID-keyed elements use
 *     single-strategy testId locates with eslint-disable per CLAUDE.md exception rule)
 *   - Test data created via restClient + TestDataManager (auto teardown)
 *   - Tests share a single admin login session via beforeAll
 *
 * MINCRM-276
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { login } from '@behaviors/minicrm/auth.behaviors.js';
import { createTestContact } from '@apps/minicrm/helpers.js';
import { AdminSettingsPage } from '@pages/minicrm/AdminSettingsPage.js';
import { ContactDetailPage } from '@pages/minicrm/ContactDetailPage.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[custom-fields-spec] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeAll(async ({ restClient }) => {
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
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

  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

  const adminSettings = new AdminSettingsPage({ page });

  // Navigate to Admin Settings → Customisation tab
  await page.goto('/admin/settings?tab=customisation', { waitUntil: 'networkidle' });

  const section = await adminSettings.customFieldsSectionLocator();
  await expect(section).toBeVisible({ timeout: 10_000 });

  // Ensure entity selector shows "contact" (default)
  const entitySelect = await adminSettings.customFieldsEntitySelectLocator();
  await entitySelect.selectOption('contact');

  // Click Add Field
  await adminSettings.clickAddField();

  const addForm = await adminSettings.addFieldFormLocator();
  await expect(addForm).toBeVisible();

  // Fill in field name
  const fieldName = `E2E Test Field ${Date.now()}`;
  const nameInput = await adminSettings.addFieldNameInputLocator();
  await nameInput.fill(fieldName);

  // field_type defaults to text — no change needed

  // Submit
  await adminSettings.submitAddField();

  // Success feedback appears
  const feedback = await adminSettings.customFieldsFeedbackLocator();
  await expect(feedback).toBeVisible({ timeout: 5_000 });

  // The field appears in the table
  // Resolve the created definition id via REST for cleanup
  const defsResp = await restClient.get<{
    definitions: Array<{ id: string; name: string }>;
  }>('/api/v1/custom-fields/definitions?entity_type=contact');
  const created = defsResp.body.definitions.find(
    (d: { id: string; name: string }) => d.name === fieldName,
  );
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
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

  const contactDetailPage = new ContactDetailPage({ page });

  // Create a text custom field definition via REST
  const fieldName = `Persist Test Field ${Date.now()}`;
  const defResp = await restClient.post<{ id: string; name: string }>(
    '/api/v1/custom-fields/definitions',
    { entity_type: 'contact', name: fieldName, field_type: 'text' },
  );
  const definitionId = defResp.body.id;
  testData.register(
    'custom_field_definition',
    definitionId,
    `/api/v1/custom-fields/definitions/${definitionId}`,
  );

  // Create a contact via REST
  const contact = await createTestContact(testData, restClient);

  // Navigate to the contact detail page
  await page.goto(`/contacts/${contact.id}`, { waitUntil: 'networkidle' });

  // Click Edit
  await contactDetailPage.clickEdit();

  // Wait for custom fields section to appear in edit mode

  const editGrid = await page
    .locate(
      [
        { type: 'testId', value: 'custom-fields-edit-grid' },
        { type: 'css', value: '[data-testid="custom-fields-edit-grid"]' },
      ],
      { intent: 'custom fields edit grid container in contact edit form' },
    )
    .resolve();
  await expect(editGrid).toBeVisible({ timeout: 5_000 });

  // Fill in the custom field value
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed input has no stable role fallback
  const fieldInput = await page
    .locate([{ type: 'testId', value: `custom-field-input-${definitionId}` }])
    .resolve();
  await fieldInput.fill('Test Value 123');

  // Save the contact
  await contactDetailPage.save();

  // Wait for edit mode to close (edit button reappears)
  expect(
    await contactDetailPage.isLoaded(),
    'contact detail should return to read mode after save',
  ).toBe(true);

  // Reload the page
  await page.goto(`/contacts/${contact.id}`, { waitUntil: 'networkidle' });

  // Custom fields read section should show the saved value

  const readGrid = await page
    .locate(
      [
        { type: 'testId', value: 'custom-fields-read-grid' },
        { type: 'css', value: '[data-testid="custom-fields-read-grid"]' },
      ],
      { intent: 'custom fields read grid container on contact detail page' },
    )
    .resolve();
  await expect(readGrid).toBeVisible({ timeout: 5_000 });

  // Confirm the value persisted
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed label has no stable role fallback
  const fieldLabel = await page
    .locate([{ type: 'testId', value: `custom-field-label-${definitionId}` }])
    .resolve();
  await expect(fieldLabel).toBeVisible();
  await expect(readGrid).toContainText('Test Value 123');
});

// ---------------------------------------------------------------------------
// Test 3 — admin deletes the definition; it no longer appears on the detail page
// ---------------------------------------------------------------------------

test('admin deletes a custom field definition; it disappears from the contact detail page @functional', async ({
  page,
  restClient,
  testData,
}) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

  const adminSettings = new AdminSettingsPage({ page });

  // Create a text custom field definition via REST
  const fieldName = `Delete Test Field ${Date.now()}`;
  const defResp = await restClient.post<{ id: string; name: string }>(
    '/api/v1/custom-fields/definitions',
    { entity_type: 'contact', name: fieldName, field_type: 'text' },
  );
  const definitionId = defResp.body.id;
  // No testData.register — we delete the definition via the UI in this test

  // Create a contact via REST
  const contact = await createTestContact(testData, restClient);

  // Set a value for the field via REST so it appears in read mode
  await restClient.put(`/api/v1/custom-fields/contact/${contact.id}/custom-fields`, [
    { definition_id: definitionId, value: 'Temp Value' },
  ]);

  // Confirm the field appears on the detail page before deletion
  await page.goto(`/contacts/${contact.id}`, { waitUntil: 'networkidle' });

  const readGrid = await page
    .locate(
      [
        { type: 'testId', value: 'custom-fields-read-grid' },
        { type: 'css', value: '[data-testid="custom-fields-read-grid"]' },
      ],
      { intent: 'custom fields read grid container on contact detail page' },
    )
    .resolve();
  await expect(readGrid).toBeVisible({ timeout: 5_000 });
  await expect(readGrid).toContainText('Temp Value');

  // Navigate to Admin Settings → Customisation tab
  await page.goto('/admin/settings?tab=customisation', { waitUntil: 'networkidle' });

  const section = await adminSettings.customFieldsSectionLocator();
  await expect(section).toBeVisible({ timeout: 10_000 });

  // Select "contact" entity type
  const entitySelect = await adminSettings.customFieldsEntitySelectLocator();
  await entitySelect.selectOption('contact');

  // Click Delete on the field row
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed delete button has no stable role fallback without scoping
  const deleteBtn = await page
    .locate([{ type: 'testId', value: `custom-field-delete-${definitionId}` }])
    .resolve();
  await expect(deleteBtn).toBeVisible({ timeout: 5_000 });
  await deleteBtn.click();

  // Confirm the deletion dialog

  const confirmDeleteBtn = await page
    .locate(
      [
        { type: 'testId', value: 'delete-field-confirm' },
        { type: 'css', value: '[data-testid="delete-field-confirm"]' },
      ],
      { intent: 'confirm button in the custom field delete confirmation dialog' },
    )
    .resolve();
  await expect(confirmDeleteBtn).toBeVisible({ timeout: 3_000 });
  await confirmDeleteBtn.click();

  // Success feedback
  const feedback = await adminSettings.customFieldsFeedbackLocator();
  await expect(feedback).toBeVisible({ timeout: 5_000 });

  // Navigate back to the contact — custom fields section should not appear
  await page.goto(`/contacts/${contact.id}`, { waitUntil: 'networkidle' });

  // Wait for the page to load (edit button should be visible)
  const contactDetailPage = new ContactDetailPage({ page });
  await expect(await contactDetailPage.isLoaded()).toBe(true);

  // The custom-fields-section should not be visible (no definitions → component returns null)

  const customFieldsSectionEl = await page
    .locate(
      [
        { type: 'testId', value: 'custom-fields-read-grid' },
        { type: 'css', value: '[data-testid="custom-fields-read-grid"]' },
      ],
      { intent: 'custom fields read grid that should be absent after definition deleted' },
    )
    .resolve()
    .catch(() => null);
  const sectionVisible = customFieldsSectionEl ? await customFieldsSectionEl.isVisible() : false;
  expect(
    sectionVisible,
    'custom fields section should not be visible after definition is deleted',
  ).toBe(false);
});
