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
 *
 * MINCRM-276
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { login } from '@behaviors/minicrm/auth.behaviors.js';
import {
  getCustomFieldDefinitions,
  createCustomFieldDefinition,
  setContactCustomFields,
} from '@behaviors/minicrm/setup.behaviors.js';
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
} from '@behaviors/minicrm/contacts.behaviors.js';
import { createTestContact } from '@apps/minicrm/helpers.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[custom-fields-spec] E2E_ADMIN_PASSWORD is not set');

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

  // Navigate to Admin Settings → Customisation tab
  await page.goto('/admin/settings?tab=customisation', { waitUntil: 'networkidle' });

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
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

  // Create a text custom field definition via REST
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

  // Create a contact via REST
  const contact = await createTestContact(testData, restClient);

  // Navigate to the contact detail page
  await page.goto(`/contacts/${contact.id}`, { waitUntil: 'networkidle' });

  // Click Edit
  await clickContactEdit({ page });

  // Wait for custom fields section to appear in edit mode.
  const editGrid = await getContactCustomFieldsEditGrid({ page });
  await expect(editGrid).toBeVisible({ timeout: 5_000 });

  // Fill in the custom field value
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed input has no stable role fallback
  const fieldInput = await page
    .locate([{ type: 'testId', value: `custom-field-input-${definitionId}` }])
    .resolve();
  await fieldInput.fill('Test Value 123');

  // Save the contact
  await saveContact({ page });

  // Wait for edit mode to close (edit button reappears)
  expect(
    await isContactDetailLoaded({ page }),
    'contact detail should return to read mode after save',
  ).toBe(true);

  // Reload the page
  await page.goto(`/contacts/${contact.id}`, { waitUntil: 'networkidle' });

  // Custom fields read section should show the saved value.
  const readGrid = await getContactCustomFieldsReadGrid({ page });
  if (!readGrid) throw new Error('custom-fields-read-grid not found after save');
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
  await page.goto(`/contacts/${contact.id}`, { waitUntil: 'networkidle' });

  const readGridBefore = await getContactCustomFieldsReadGrid({ page });
  if (!readGridBefore) throw new Error('custom-fields-read-grid not found before deletion');
  await expect(readGridBefore).toBeVisible({ timeout: 5_000 });
  await expect(readGridBefore).toContainText('Temp Value');

  // Navigate to Admin Settings → Customisation tab
  await page.goto('/admin/settings?tab=customisation', { waitUntil: 'networkidle' });

  const section = await getAdminSettingsCustomFieldsSectionLocator({ page });
  await expect(section).toBeVisible({ timeout: 10_000 });

  // Select "contact" entity type
  const entitySelect = await getAdminSettingsCustomFieldsEntitySelectLocator({ page });
  await entitySelect.selectOption('contact');

  // Click Delete on the field row
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed delete button has no stable role fallback without scoping
  const deleteBtn = await page
    .locate([{ type: 'testId', value: `custom-field-delete-${definitionId}` }])
    .resolve();
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
  await page.goto(`/contacts/${contact.id}`, { waitUntil: 'networkidle' });

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
