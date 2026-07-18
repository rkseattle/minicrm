/**
 * TEST-ONLY: deterministic E2E stub scenarios for the AI NLI chat feature.
 *
 * The E2E server always runs with E2E=true, which never calls Anthropic — the
 * real agentic tool-calling loop in aiSessionService.ts never runs, so
 * pending_action / tool_results / context_proposal are never populated by a
 * normal chat turn. Sending a message whose content starts with
 * E2E_STUB_PREFIX opts into one of a fixed set of scenarios below, each
 * returning a deterministic payload shaped like the real thing so E2E specs
 * can exercise the real HTTP contract and real UI components without ever
 * invoking the model. Any message without the prefix is unaffected — it
 * keeps returning E2E_STUB_RESPONSE exactly as before.
 *
 * Consumed by server/src/services/aiSessionService.ts (produces the payloads)
 * and qa/e2e/behaviors/minicrm/ai.behaviors.ts (requests scenarios, asserts
 * against the fixed fixture values). Never referenced outside E2E=true code
 * paths and E2E test code. (MINCRM-435)
 */

export const E2E_STUB_PREFIX = '__E2E_STUB__:';

/** Deterministic response returned for any non-prefixed message in E2E mode. */
export const E2E_STUB_RESPONSE = '[E2E stub response]';

export const E2E_STUB_SCENARIOS = {
  READ_QUERY: 'READ_QUERY',
  MUTATION_CREATE: 'MUTATION_CREATE',
  MUTATION_UPDATE: 'MUTATION_UPDATE',
  MUTATION_BULK: 'MUTATION_BULK',
  MUTATION_BULK_DELETE: 'MUTATION_BULK_DELETE',
  RBAC_DENIED: 'RBAC_DENIED',
  CONTEXT_PROPOSAL: 'CONTEXT_PROPOSAL',
} as const;

export type E2eStubScenario = (typeof E2E_STUB_SCENARIOS)[keyof typeof E2E_STUB_SCENARIOS];

/** Builds the reserved-prefix message content that requests a given stub scenario. */
export function e2eStubMessage(scenario: E2eStubScenario): string {
  return `${E2E_STUB_PREFIX}${scenario}`;
}

/** Extracts the scenario key from message content, or null if not a stub trigger. */
export function parseE2eStubScenario(content: string): E2eStubScenario | null {
  if (!content.startsWith(E2E_STUB_PREFIX)) return null;
  const key = content.slice(E2E_STUB_PREFIX.length);
  return (Object.values(E2E_STUB_SCENARIOS) as string[]).includes(key)
    ? (key as E2eStubScenario)
    : null;
}

// ── Fixed fixture data — both server stub and E2E specs assert against these ──

export const E2E_STUB_READ_QUERY_CONTACT = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'E2E Stub Contact',
  email: 'e2e-stub@example.com',
} as const;

export const E2E_STUB_MUTATION_CREATE = {
  entityType: 'contact',
  fields: { name: 'E2E Stub Contact', email: 'e2e-stub@example.com' },
  summary: 'Create contact "E2E Stub Contact".',
} as const;

export const E2E_STUB_MUTATION_UPDATE = {
  entityType: 'deal',
  entityId: '00000000-0000-4000-8000-000000000002',
  entityName: 'E2E Stub Deal',
  fields: { stage: 'Closed Won' },
  summary: 'Update deal "E2E Stub Deal": set stage to Closed Won.',
} as const;

export const E2E_STUB_BULK_COUNT = 12;
export const E2E_STUB_BULK_SAMPLE = ['Contact A', 'Contact B', 'Contact C'] as const;
export const E2E_STUB_MUTATION_BULK = {
  entityType: 'contact',
  fields: { tag: 'stale' },
  bulkCount: E2E_STUB_BULK_COUNT,
  bulkSample: [...E2E_STUB_BULK_SAMPLE],
  summary: `Update ${E2E_STUB_BULK_COUNT} contacts: add tag "stale".`,
} as const;

export const E2E_STUB_BULK_DELETE_COUNT = 7;
export const E2E_STUB_BULK_DELETE_SAMPLE = ['Contact D', 'Contact E', 'Contact F'] as const;
export const E2E_STUB_MUTATION_BULK_DELETE = {
  entityType: 'contact',
  fields: { reason: 'stale' },
  bulkCount: E2E_STUB_BULK_DELETE_COUNT,
  bulkSample: [...E2E_STUB_BULK_DELETE_SAMPLE],
  summary: `Delete ${E2E_STUB_BULK_DELETE_COUNT} contacts.`,
} as const;

/** Mirrors the exact message shape toolExecutor.ts throws for an admin-only tool. */
export const E2E_STUB_RBAC_DENIED_MESSAGE = "Tool 'deleteAccount' requires admin role";

export const E2E_STUB_CONTEXT_PROPOSAL = {
  key: 'a while',
  value: '30+ days without activity',
  reason: 'You used "a while" — I\'m treating that as 30+ days of inactivity.',
} as const;

export const E2E_STUB_CONTEXT_PROPOSAL_LEAD_TEXT =
  'I\'ll treat "a while" as 30+ days of inactivity for this query.';
