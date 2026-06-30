/**
 * F-AI-NLI-ENT — NLI entity tools: notes, tags, reports (MINCRM-432, MINCRM-433, MINCRM-424)
 *
 * Validates the UI layer for notes cross-entity search, tag operations, and
 * report generation/save intents sent through the AI conversation panel.
 *
 * E2E scope:
 *   The E2E server runs with E2E=true, returning the deterministic stub
 *   "[E2E stub response]" without calling Anthropic or any tools. These tests
 *   therefore validate:
 *     - Message sends complete without errors and the stub reply appears
 *     - The conversation thread correctly renders user turns for entity-specific
 *       prompts (notes by keyword/author/date, tag attach/rename, report generation)
 *     - Result rendering components (NoteResultCard, ReportResultCard) are exercised
 *       by the NliResultBlock unit tests (already present)
 *
 * Test groups:
 *   F-AI-NLI-ENT1 — Note cross-entity search by keyword resolves to stub reply
 *   F-AI-NLI-ENT2 — Note cross-entity search by author resolves to stub reply
 *   F-AI-NLI-ENT3 — Tag attach intent resolves to stub reply
 *   F-AI-NLI-ENT4 — Tag rename intent resolves to stub reply
 *   F-AI-NLI-ENT5 — Report generation intent (win_loss) resolves to stub reply
 *   F-AI-NLI-ENT6 — Report save intent resolves to stub reply
 *
 * Serial mode: tests share the admin AI session list.
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import { setAiEnabled, resetAiSettings } from '@behaviors/minicrm/settings.behaviors.js';
import {
  navigateToAiPage,
  waitForAiConversationPanel,
  waitForAiThreadText,
  sendAiMessageViaUI,
  deleteAllAiSessionsViaApi,
} from '@behaviors/minicrm/ai.behaviors.js';

test.describe.configure({ mode: 'serial' });

const E2E_STUB = '[E2E stub response]';

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
  await setAiEnabled(restClient, true);
  await deleteAllAiSessionsViaApi(restClient);
});

test.afterEach(async ({ restClient }) => {
  await resetAiSettings(restClient);
});

// ── Notes cross-entity search ─────────────────────────────────────────────────

test('F-AI-NLI-ENT1 — Note cross-entity search by keyword sends and receives stub reply @functional', async ({
  page,
}) => {
  await navigateToAiPage({ page });
  await waitForAiConversationPanel({ page });

  const result = await sendAiMessageViaUI({ page }, "Show me all notes mentioning 'budget freeze'");

  await waitForAiThreadText({ page }, E2E_STUB);
  // waitForAiThreadText confirms "budget freeze" user turn text is in the thread
  await waitForAiThreadText({ page }, 'budget freeze');
  expect(result.userMessageVisible).toBe(true);
});

test('F-AI-NLI-ENT2 — Note cross-entity search by author sends and receives stub reply @functional', async ({
  page,
}) => {
  await navigateToAiPage({ page });
  await waitForAiConversationPanel({ page });

  const result = await sendAiMessageViaUI({ page }, 'Show me all notes I added this week');

  await waitForAiThreadText({ page }, E2E_STUB);
  expect(result.userMessageVisible).toBe(true);
});

// ── Tag operations ────────────────────────────────────────────────────────────

test('F-AI-NLI-ENT3 — Tag attach intent sends and receives stub reply @functional', async ({
  page,
}) => {
  await navigateToAiPage({ page });
  await waitForAiConversationPanel({ page });

  const result = await sendAiMessageViaUI({ page }, "Tag Acme Corp as 'enterprise'");

  await waitForAiThreadText({ page }, E2E_STUB);
  expect(result.userMessageVisible).toBe(true);
});

test('F-AI-NLI-ENT4 — Tag rename intent sends and receives stub reply @functional', async ({
  page,
}) => {
  await navigateToAiPage({ page });
  await waitForAiConversationPanel({ page });

  const result = await sendAiMessageViaUI({ page }, "Rename the 'cold' tag to 'dormant'");

  await waitForAiThreadText({ page }, E2E_STUB);
  // waitForAiThreadText confirms "dormant" user turn text is in the thread
  await waitForAiThreadText({ page }, 'dormant');
  expect(result.userMessageVisible).toBe(true);
});

// ── Report generation and save ────────────────────────────────────────────────

test('F-AI-NLI-ENT5 — Report generation intent sends and receives stub reply @functional', async ({
  page,
}) => {
  await navigateToAiPage({ page });
  await waitForAiConversationPanel({ page });

  const result = await sendAiMessageViaUI(
    { page },
    'Build me a win/loss report for the last 30 days',
  );

  await waitForAiThreadText({ page }, E2E_STUB);
  expect(result.userMessageVisible).toBe(true);
});

test('F-AI-NLI-ENT6 — Report save intent sends and receives stub reply @functional', async ({
  page,
}) => {
  await navigateToAiPage({ page });
  await waitForAiConversationPanel({ page });

  const result = await sendAiMessageViaUI({ page }, 'Save this report as Q2 Pipeline Trend');

  await waitForAiThreadText({ page }, E2E_STUB);
  // waitForAiThreadText confirms "Q2 Pipeline Trend" user turn text is in the thread
  await waitForAiThreadText({ page }, 'Q2 Pipeline Trend');
  expect(result.userMessageVisible).toBe(true);
});
