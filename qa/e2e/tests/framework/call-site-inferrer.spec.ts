/**
 * Unit tests for inferCallSite.
 *
 * Verifies that inferCallSite correctly extracts page-object class and method
 * names from V8 Error stack strings without requiring a live browser.
 */

import { test, expect } from '@playwright/test';
import { inferCallSite } from '../../framework/healing/call-site-inferrer.js';

const SEGMENTS = ['pages/minicrm'];

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

test('extracts class and method from a standard V8 frame', () => {
  const stack = [
    'Error',
    '    at makeHealingLocator (/repo/qa/e2e/framework/fixtures/heal-methods.ts:451:12)',
    '    at ContactsPage.saveButton (/repo/qa/e2e/pages/minicrm/ContactsPage.ts:88:18)',
    '    at Object.<anonymous> (/repo/qa/e2e/tests/foo.spec.ts:12:5)',
  ].join('\n');

  const result = inferCallSite(stack, SEGMENTS);
  expect(result).toEqual({ pageObject: 'ContactsPage', method: 'saveButton' });
});

test('extracts class and method from an async frame', () => {
  const stack = [
    'Error',
    '    at makeHealingLocator (/repo/qa/e2e/framework/fixtures/heal-methods.ts:451:12)',
    '    at async AdminSettingsPage.openFeaturesTab (/repo/qa/e2e/pages/minicrm/AdminSettingsPage.ts:120:5)',
  ].join('\n');

  const result = inferCallSite(stack, SEGMENTS);
  expect(result).toEqual({ pageObject: 'AdminSettingsPage', method: 'openFeaturesTab' });
});

test('skips non-matching frames and finds the first matching one', () => {
  const stack = [
    'Error',
    '    at Object.<anonymous> (/repo/qa/e2e/tests/foo.spec.ts:5:3)',
    '    at SomethingElse.method (/repo/qa/e2e/behaviors/minicrm/contacts.behaviors.ts:30:7)',
    '    at AccountDetailPage.clickEdit (/repo/qa/e2e/pages/minicrm/AccountDetailPage.ts:54:10)',
    '    at ContactDetailPage.clickEdit (/repo/qa/e2e/pages/minicrm/ContactDetailPage.ts:90:10)',
  ].join('\n');

  // Should return the first pages/minicrm frame encountered.
  const result = inferCallSite(stack, SEGMENTS);
  expect(result).toEqual({ pageObject: 'AccountDetailPage', method: 'clickEdit' });
});

test('accepts multiple path segments and matches any of them', () => {
  const stack = [
    'Error',
    '    at DealsPage.openBoard (/repo/qa/e2e/pages/other/DealsPage.ts:44:6)',
  ].join('\n');

  const result = inferCallSite(stack, ['pages/minicrm', 'pages/other']);
  expect(result).toEqual({ pageObject: 'DealsPage', method: 'openBoard' });
});

test('handles file:// URLs in stack frames', () => {
  const stack = [
    'Error',
    '    at ContactsPage.search (file:///repo/qa/e2e/pages/minicrm/ContactsPage.ts:200:8)',
  ].join('\n');

  const result = inferCallSite(stack, SEGMENTS);
  expect(result).toEqual({ pageObject: 'ContactsPage', method: 'search' });
});

// ---------------------------------------------------------------------------
// Non-matching / edge cases
// ---------------------------------------------------------------------------

test('returns null when no frame matches the path segments', () => {
  const stack = [
    'Error',
    '    at Object.<anonymous> (/repo/qa/e2e/tests/foo.spec.ts:5:3)',
    '    at runTest (/repo/node_modules/playwright/lib/runner.js:100:5)',
  ].join('\n');

  expect(inferCallSite(stack, SEGMENTS)).toBeNull();
});

test('returns null for frames without a dot-separated owner', () => {
  // Plain function calls (not class methods) have no dot in the owner.
  const stack = [
    'Error',
    '    at navigateToContact (/repo/qa/e2e/pages/minicrm/helpers.ts:30:5)',
  ].join('\n');

  // FRAME_RE requires Owner.method — a bare function name has no dot, so it
  // does not match even if the path segment matches.
  expect(inferCallSite(stack, SEGMENTS)).toBeNull();
});

test('returns null for an empty stack string', () => {
  expect(inferCallSite('', SEGMENTS)).toBeNull();
});

test('returns null when path segments list is empty', () => {
  const stack = [
    'Error',
    '    at ContactsPage.save (/repo/qa/e2e/pages/minicrm/ContactsPage.ts:88:5)',
  ].join('\n');

  expect(inferCallSite(stack, [])).toBeNull();
});
