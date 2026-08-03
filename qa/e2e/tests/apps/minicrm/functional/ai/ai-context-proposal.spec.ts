/**
 * F-AI-PROPOSAL — AI ambiguous-query context proposal flow (MINCRM-429, MINCRM-430, MINCRM-435)
 *
 * Tests the ambiguous-query → context-proposal protocol: when the AI detects
 * an ambiguous term or correction worth remembering, it surfaces its
 * interpretation in its reply text and attaches an accept/dismiss chip; the
 * user can accept it (saved to their context panel) or dismiss it (never
 * saved, and not re-proposed again within the same session).
 *
 * Stub note (MINCRM-435):
 *   The E2E server runs with E2E=true, so no real model call is made. The
 *   __E2E_STUB__:CONTEXT_PROPOSAL trigger (see shared/schemas/aiE2eStub.ts)
 *   deterministically returns the real %%CONTEXT_PROPOSAL%% marker text, so
 *   the server's actual extractContextProposal() parser and the client's
 *   real ContextProposalChip component are both exercised end-to-end. The
 *   stub also enforces "no re-proposal in session" server-side: sending the
 *   same trigger again in a session that already saw the marker returns the
 *   plain stub reply instead.
 *
 * Test groups:
 *   F-AI-PROP1 — Ambiguous-query reply surfaces interpretation text and a proposal chip
 *   F-AI-PROP2 — Accepting a proposal saves it to the context panel
 *   F-AI-PROP3 — Dismissing a proposal does not save it, and it is not re-proposed in the same session
 *
 * (MINCRM-429, MINCRM-430, MINCRM-435)
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import { setAiEnabled } from '@behaviors/minicrm/settings.behaviors.js';
import {
  navigateToAiPage,
  waitForAiConversationPanel,
  waitForAiThreadText,
  sendE2eStubMessageViaUI,
  isContextProposalChipVisible,
  acceptContextProposalViaUI,
  dismissContextProposalViaUI,
  getAiSessionMessagesViaApi,
  getContextEntriesViaApi,
  createAiSessionViaApi,
  deleteAllAiSessionsViaApi,
  deleteAllContextEntriesViaApi,
} from '@behaviors/minicrm/ai.behaviors.js';
import {
  E2E_STUB_CONTEXT_PROPOSAL,
  E2E_STUB_CONTEXT_PROPOSAL_LEAD_TEXT,
} from '@minicrm/shared/schemas/aiE2eStub.js';

// Serial mode required: shares the admin account's AI session list and context entries.
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
  await setAiEnabled(restClient, true);
  await deleteAllAiSessionsViaApi(restClient);
  await deleteAllContextEntriesViaApi(restClient);
});

test.afterEach(async ({ restClient }) => {
  // Sessions as well as context entries: beforeEach alone cleans the PREVIOUS
  // test's records, so the last test in the file would leave its session behind
  // for the rest of the run, where it sorts to the top of
  // `ORDER BY updated_at DESC` and becomes the session a later spec's page
  // auto-selects. (MINCRM-686)
  await deleteAllAiSessionsViaApi(restClient);
  await deleteAllContextEntriesViaApi(restClient);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test(
  'F-AI-PROP1 — ambiguous-query reply surfaces interpretation and a proposal chip @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page, restClient }) => {
    const sessionId = await createAiSessionViaApi(restClient); // MINCRM-686-ok: cleared by deleteAllAiSessionsViaApi in beforeEach/afterEach

    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });

    await sendE2eStubMessageViaUI({ page }, 'CONTEXT_PROPOSAL');

    await waitForAiThreadText({ page }, E2E_STUB_CONTEXT_PROPOSAL_LEAD_TEXT);

    const messages = await getAiSessionMessagesViaApi(restClient, sessionId);
    const proposalMessage = messages.find(
      (m) => m.role === 'assistant' && m.context_proposal !== null,
    );
    expect(proposalMessage).toBeDefined();
    expect(proposalMessage?.context_proposal).toMatchObject(E2E_STUB_CONTEXT_PROPOSAL);

    const chipVisible = await isContextProposalChipVisible({ page }, proposalMessage!.id);
    expect(chipVisible).toBe(true);
  },
);

test(
  'F-AI-PROP2 — accepting a proposal saves it to the context panel @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page, restClient }) => {
    const sessionId = await createAiSessionViaApi(restClient); // MINCRM-686-ok: cleared by deleteAllAiSessionsViaApi in beforeEach/afterEach

    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });

    await sendE2eStubMessageViaUI({ page }, 'CONTEXT_PROPOSAL');
    await waitForAiThreadText({ page }, E2E_STUB_CONTEXT_PROPOSAL_LEAD_TEXT);

    const messages = await getAiSessionMessagesViaApi(restClient, sessionId);
    const proposalMessage = messages.find(
      (m) => m.role === 'assistant' && m.context_proposal !== null,
    );
    expect(proposalMessage).toBeDefined();

    await acceptContextProposalViaUI({ page }, proposalMessage!.id);

    await expect(async () => {
      const entries = await getContextEntriesViaApi(restClient);
      const saved = entries.find((e) => e.key === E2E_STUB_CONTEXT_PROPOSAL.key);
      expect(saved).toBeDefined();
      expect(saved?.value).toBe(E2E_STUB_CONTEXT_PROPOSAL.value);
    }).toPass({ timeout: 5000 });
  },
);

test(
  'F-AI-PROP3 — dismissing a proposal does not save it and is not re-proposed in the session @functional @serial',
  { tag: ['@functional', '@serial'] },
  async ({ page, restClient }) => {
    const sessionId = await createAiSessionViaApi(restClient); // MINCRM-686-ok: cleared by deleteAllAiSessionsViaApi in beforeEach/afterEach

    await navigateToAiPage({ page });
    await waitForAiConversationPanel({ page });

    await sendE2eStubMessageViaUI({ page }, 'CONTEXT_PROPOSAL');
    await waitForAiThreadText({ page }, E2E_STUB_CONTEXT_PROPOSAL_LEAD_TEXT);

    const firstMessages = await getAiSessionMessagesViaApi(restClient, sessionId);
    const proposalMessage = firstMessages.find(
      (m) => m.role === 'assistant' && m.context_proposal !== null,
    );
    expect(proposalMessage).toBeDefined();

    await dismissContextProposalViaUI({ page }, proposalMessage!.id);

    // Not saved to the context panel.
    const entries = await getContextEntriesViaApi(restClient);
    const saved = entries.find((e) => e.key === E2E_STUB_CONTEXT_PROPOSAL.key);
    expect(saved).toBeUndefined();

    // Sending the same scenario again in the same session must not re-propose it.
    await sendE2eStubMessageViaUI({ page }, 'CONTEXT_PROPOSAL');

    const secondMessages = await getAiSessionMessagesViaApi(restClient, sessionId);
    const proposalMessages = secondMessages.filter(
      (m) => m.role === 'assistant' && m.context_proposal !== null,
    );
    expect(proposalMessages).toHaveLength(1);
  },
);
