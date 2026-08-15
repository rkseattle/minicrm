/**
 * F10 — File Attachments (Upload, Download, Delete, Authorization)
 *
 * Functional regression tests for the file attachment feature introduced in
 * MINCRM-154, MINCRM-167, MINCRM-169. Covers the full value chain:
 * UI upload → API → storage → presigned URL → download link.
 *
 * Test groups:
 *   Upload (F10-U)  — upload to contact, account, deal; disallowed types; size limit
 *   Download (F10-D) — download link present and reachable
 *   Delete (F10-X)  — delete removes row; 404 via API
 *   Auth (F10-A)    — rep cannot delete another user's attachment
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - All test data managed via restClient + TestDataManager (auto teardown)
 *   - No raw locators in this file — UI interaction via page objects only
 *
 * MINCRM-199, MINCRM-278
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  createTestContact,
  createTestAccount,
  createTestDeal,
  createTestUser,
  createTestRep,
  navigateToContact,
  navigateToAccount,
  navigateToDeal,
} from '@apps/minicrm/helpers.js';
import { RestClientError } from '@framework/clients/rest-client.js';
import { loginAsAdmin, loginAs, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  listAttachments,
  waitForAttachmentDownloadLinkAndGetHref,
  isAttachmentRowHidden,
} from '@behaviors/minicrm/attachments.behaviors.js';
import {
  waitForContactAttachmentsSection,
  uploadContactAttachment,
  waitForContactAttachmentsList,
  waitForContactAttachmentsUploadError,
  clickContactAttachmentDelete,
  confirmContactAttachmentDelete,
} from '@behaviors/minicrm/contacts.behaviors.js';
import {
  waitForAccountAttachmentsSection,
  uploadAccountAttachment,
  waitForAccountAttachmentsList,
} from '@behaviors/minicrm/accounts.behaviors.js';
import {
  waitForDealAttachmentsSection,
  uploadDealAttachment,
  waitForDealAttachmentsList,
} from '@behaviors/minicrm/deals.behaviors.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const REP_PASSWORD = 'BvtPassword1!';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const rep = await createTestRep(testData, restClient);
  await loginViaBrowser(rep.email, rep.password, { page });
});

// ---------------------------------------------------------------------------
// Upload — F10-U
// ---------------------------------------------------------------------------

test('@functional F10-U1: Upload a file to a contact detail page — attachment row appears', async ({
  page,
  restClient,
  testData,
}) => {
  const contact = await createTestContact(testData, restClient);

  await navigateToContact(page, contact.id);

  await waitForContactAttachmentsSection({ page });

  await uploadContactAttachment(
    { page },
    {
      name: 'test-upload.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello world'),
    },
  );

  // Wait for attachment row to appear
  await waitForContactAttachmentsList({ page }, 10_000);

  // Verify API reflects the upload
  const attachments = await listAttachments(restClient, 'contact', contact.id);
  expect(attachments.length, 'attachment should be present in API').toBeGreaterThan(0);
  const created = attachments[0]!;
  expect(created.filename).toBe('test-upload.txt');
  testData.register('attachment', created.id, `/api/v1/attachments/${created.id}`);
});

test('@functional F10-U2: Upload a file to an account detail page — attachment appears', async ({
  page,
  restClient,
  testData,
}) => {
  const account = await createTestAccount(testData, restClient);

  await navigateToAccount(page, account.id);

  await waitForAccountAttachmentsSection({ page });

  await uploadAccountAttachment(
    { page },
    {
      name: 'account-doc.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('account document'),
    },
  );

  await waitForAccountAttachmentsList({ page }, 10_000);

  const attachments = await listAttachments(restClient, 'account', account.id);
  expect(attachments.length, 'attachment created for account').toBeGreaterThan(0);
  const created = attachments[0]!;
  testData.register('attachment', created.id, `/api/v1/attachments/${created.id}`);
});

test('@functional F10-U3: Upload a file to a deal detail page — attachment appears', async ({
  page,
  restClient,
  testData,
}) => {
  const account = await createTestAccount(testData, restClient);
  const deal = await createTestDeal(testData, restClient, { account_id: account.id });

  await navigateToDeal(page, deal.id);

  await waitForDealAttachmentsSection({ page });

  await uploadDealAttachment(
    { page },
    {
      name: 'deal-proposal.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('deal proposal content'),
    },
  );

  await waitForDealAttachmentsList({ page }, 10_000);

  const attachments = await listAttachments(restClient, 'deal', deal.id);
  expect(attachments.length, 'attachment created for deal').toBeGreaterThan(0);
  const created = attachments[0]!;
  testData.register('attachment', created.id, `/api/v1/attachments/${created.id}`);
});

test('@functional F10-U4: Upload a disallowed file type (.exe) — rejected with error message', async ({
  page,
  restClient,
  testData,
}) => {
  const contact = await createTestContact(testData, restClient);

  await navigateToContact(page, contact.id);

  await waitForContactAttachmentsSection({ page });

  await uploadContactAttachment(
    { page },
    {
      name: 'malware.exe',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('MZ'),
    },
  );

  // Client-side guard should show an upload error
  await waitForContactAttachmentsUploadError({ page }, 5_000);

  // No attachment should have been created
  const attachments = await listAttachments(restClient, 'contact', contact.id);
  expect(attachments.length, 'no attachment created for disallowed type').toBe(0);
});

test('@functional F10-U5: Upload a file exceeding the size limit — rejected with error message', async ({
  page,
  restClient,
  testData,
}) => {
  const contact = await createTestContact(testData, restClient);

  await navigateToContact(page, contact.id);

  await waitForContactAttachmentsSection({ page });

  // 26 MB — exceeds the 25 MB server limit; client guard fires first
  const oversizedBuffer = Buffer.alloc(26 * 1024 * 1024, 'x');

  await uploadContactAttachment(
    { page },
    {
      name: 'huge-file.pdf',
      mimeType: 'application/pdf',
      buffer: oversizedBuffer,
    },
  );

  await waitForContactAttachmentsUploadError({ page }, 5_000);
});

// ---------------------------------------------------------------------------
// Download — F10-D
// ---------------------------------------------------------------------------

test('@functional F10-D1: Download link for an uploaded file returns a non-error response', async ({
  page,
  restClient,
  testData,
}) => {
  const contact = await createTestContact(testData, restClient);

  await navigateToContact(page, contact.id);

  await waitForContactAttachmentsSection({ page });

  await uploadContactAttachment(
    { page },
    {
      name: 'download-test.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('downloadable content'),
    },
  );

  // Wait for the uploaded row to render before resolving the download link.
  //
  // uploadContactAttachment only calls setInputFiles and returns — it does not
  // wait for the POST to finish or the list to re-render. The download link's
  // locator is single-strategy with a 2s probe budget, so under CI concurrency
  // it could be probed before the row existed and fail with
  // StrategyExhaustedError rather than a legible "upload did not appear".
  // F10-X1 below already waits this way after ITS upload; this test did not,
  // which is the whole difference. (MINCRM-695, MINCRM-696)
  await waitForContactAttachmentsList({ page }, 10_000);

  const href = await waitForAttachmentDownloadLinkAndGetHref({ page }, 10_000);

  // Register for teardown
  const attachments = await listAttachments(restClient, 'contact', contact.id);
  if (attachments[0]) {
    testData.register('attachment', attachments[0].id, `/api/v1/attachments/${attachments[0].id}`);
  }

  expect(href, 'download link href should be set').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Delete — F10-X
// ---------------------------------------------------------------------------

test('@functional F10-X1: Delete an attachment — row disappears and API returns 404', async ({
  page,
  restClient,
  testData,
}) => {
  const contact = await createTestContact(testData, restClient);

  await navigateToContact(page, contact.id);

  await waitForContactAttachmentsSection({ page });

  await uploadContactAttachment(
    { page },
    {
      name: 'to-be-deleted.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('delete me'),
    },
  );

  // Wait for the upload to complete before querying the API for the attachment ID
  await waitForContactAttachmentsList({ page }, 10_000);

  const attachments = await listAttachments(restClient, 'contact', contact.id);
  expect(attachments.length, 'attachment exists before delete').toBeGreaterThan(0);
  const attachmentId = attachments[0]!.id;

  // Click delete button for this attachment
  await clickContactAttachmentDelete(attachmentId, { page });

  // Confirm deletion in dialog
  await confirmContactAttachmentDelete({ page });

  // Row should be gone (isNotVisible — safe when element is removed from DOM).
  await expect
    .poll(() => isAttachmentRowHidden(attachmentId, { page }), { timeout: 5_000 })
    .toBe(true);

  // API should return 404
  let got404 = false;
  try {
    await restClient.get(`/api/v1/attachments/${attachmentId}/download`);
  } catch (err) {
    if (err instanceof RestClientError && err.status === 404) got404 = true;
  }
  expect(got404, 'API should return 404 after deletion').toBe(true);
});

// ---------------------------------------------------------------------------
// Authorization — F10-A
// ---------------------------------------------------------------------------

test('@functional F10-A1: Rep cannot delete an attachment uploaded by another user', async ({
  page,
  restClient,
  testData,
}) => {
  // Admin uploads the attachment
  await loginAsAdmin(restClient);

  const rep = await createTestUser(testData, restClient, { role: 'rep', password: REP_PASSWORD });

  const contact = await createTestContact(testData, restClient);

  try {
    await navigateToContact(page, contact.id);

    await waitForContactAttachmentsSection({ page });

    await uploadContactAttachment(
      { page },
      {
        name: 'admin-uploaded.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('admin content'),
      },
    );

    // Wait for the upload to complete before querying the API for the attachment ID
    await waitForContactAttachmentsList({ page }, 10_000);

    const attachments = await listAttachments(restClient, 'contact', contact.id);
    expect(attachments.length, 'attachment exists').toBeGreaterThan(0);
    const attachmentId = attachments[0]!.id;
    testData.register('attachment', attachmentId, `/api/v1/attachments/${attachmentId}`);

    // Switch to rep session
    await loginAs(restClient, rep.email, REP_PASSWORD);

    // Rep tries to delete via API — should get 403
    let got403 = false;
    try {
      await restClient.delete(`/api/v1/attachments/${attachmentId}`);
    } catch (err) {
      if (err instanceof RestClientError && err.status === 403) got403 = true;
    }
    expect(got403, 'rep should get 403 when deleting another user attachment').toBe(true);
  } finally {
    // Restore admin session so teardown succeeds.
    await loginAsAdmin(restClient);
  }
});
