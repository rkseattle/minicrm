/**
 * Unit tests for the coverage session control client (MINCRM-609..612).
 *
 * All tests mock the Playwright APIRequestContext so no server is required —
 * same pattern as rest-client.spec.ts and browser-coverage-agent.spec.ts.
 */

import { test, expect } from '@framework/fixtures';
import {
  startCoverageSession,
  endCoverageSession,
  getCoverageSession,
  listActiveCoverageSessions,
  recordCoverageSessionDump,
  resolveSessionBuildSha,
  resolveSessionEnvironment,
  CORRELATION_ID_HEADER,
} from '@framework/coverageAgent/coverage-session-control-client';
import type { CoverageSessionMetadata } from '@framework/coverageAgent/coverage-session-control-client';
import { RestClient } from '@framework/clients';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import type { HarnessAdapterShape } from '@minicrm/shared/schemas/coverageHarnessAdapterSchema';
// The SECOND source-level qa -> server/src import, carrying the same
// justification CLAUDE.md documents for the first (merge-junit-results.spec.ts
// -> server/src/scripts/junitXml.ts): a rule is deliberately duplicated across
// the two workspaces because qa/e2e/framework/ must not import server modules
// at runtime, and a test importing the REAL definition is the only thing that
// can pin the copies together. Asserting against a re-declared copy of the
// regex would pass forever while the implementations drifted.
//
// Import-safe for the same reason junitXml.ts is: coverageConfig.ts's only
// transitive dependency is pino (via logger.ts) — no pg.Pool, no
// dotenv/config — so importing it here opens no socket and rewrites no env
// inside a Playwright worker. (MINCRM-688)
import { SAFE_PATH_SEGMENT_PATTERN } from '../../../../server/src/coverageAgent/coverageConfig.js';

// Compile-time-only checkpoint (MINCRM-636): asserts
// coverage-session-control-client.ts's real exports satisfy the documented
// HarnessAdapterShape<RestClient> contract (shared/schemas/
// coverageHarnessAdapterSchema.ts). This file is outside
// qa/e2e/framework/'s zero-app-domain-refs boundary, so it — not the
// framework file itself — is where a @minicrm/shared/schemas import is
// permitted; the client under test stays framework-pure. Never called at
// runtime; its only job is to fail `tsc --noEmit` if either side's
// signature drifts from the other. Direct function references (not arrow
// wrappers) and a real `satisfies` assertion, not a type annotation — a
// wrapper like `(client, params) => startCoverageSession(client, params)`
// still type-checks each parameter contextually but would NOT catch an
// excess parameter or arity drift on the real function the way a direct
// reference does (found via Greptile branch review).
const _playwrightHarnessAdapterCheck = {
  startSession: startCoverageSession,
  endSession: endCoverageSession,
  recordDump: recordCoverageSessionDump,
  injectCorrelationHeader: (headers: Record<string, string>, correlationId: string) => {
    headers[CORRELATION_ID_HEADER] = correlationId;
  },
} satisfies HarnessAdapterShape<RestClient>;
void _playwrightHarnessAdapterCheck;

// ---------------------------------------------------------------------------
// Mock helpers — same shape as rest-client.spec.ts's mockContext/mockApiResponse
// ---------------------------------------------------------------------------

function mockApiResponse(status: number, body: unknown): APIResponse {
  return {
    status: () => status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: () => ({}),
    ok: () => status >= 200 && status < 300,
    url: () => 'http://localhost:3001/api/v1/admin/coverage/sessions',
    body: () => Promise.resolve(Buffer.from(JSON.stringify(body))),
    dispose: () => Promise.resolve(),
  } as unknown as APIResponse;
}

interface CapturedRequest {
  method: string;
  url: string;
  body: unknown;
}

function mockContext(
  handler: (req: CapturedRequest) => APIResponse,
  captured?: CapturedRequest[],
): APIRequestContext {
  const call =
    (method: string) =>
    (url: string, options?: Record<string, unknown>): Promise<APIResponse> => {
      const req: CapturedRequest = { method, url, body: options?.['data'] };
      captured?.push(req);
      return Promise.resolve(handler(req));
    };

  return {
    get: call('GET'),
    post: call('POST'),
    put: call('PUT'),
    patch: call('PATCH'),
    delete: call('DELETE'),
    fetch: call('FETCH'),
    head: call('HEAD'),
    dispose: () => Promise.resolve(),
  } as unknown as APIRequestContext;
}

const SAMPLE_SESSION: CoverageSessionMetadata = {
  id: 'session-1',
  label: 'my session',
  source: 'automated-e2e',
  status: 'active',
  correlationId: 'corr-1',
  buildSha: 'abc123',
  environment: 'ci',
  issueKey: null,
  startedById: 'user-1',
  startedAt: '2026-07-21T00:00:00.000Z',
  endedAt: null,
  version: 1,
};

test.describe('startCoverageSession', () => {
  test('POSTs to /admin/coverage/sessions and returns the session', async () => {
    const captured: CapturedRequest[] = [];
    const ctx = mockContext(() => mockApiResponse(201, { session: SAMPLE_SESSION }), captured);
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:3001' });

    const result = await startCoverageSession(client, {
      label: 'my session',
      source: 'automated-e2e',
      buildSha: 'abc123',
      environment: 'ci',
    });

    expect(result).toEqual(SAMPLE_SESSION);
    expect(captured[0].method).toBe('POST');
    expect(captured[0].url).toContain('/api/v1/admin/coverage/sessions');
    expect(captured[0].body).toMatchObject({ label: 'my session', source: 'automated-e2e' });
  });
});

test.describe('endCoverageSession', () => {
  test('POSTs to /:sessionId/end with the version and returns the updated session', async () => {
    const captured: CapturedRequest[] = [];
    const endedSession = { ...SAMPLE_SESSION, status: 'ended' as const, version: 2 };
    const ctx = mockContext(() => mockApiResponse(200, { session: endedSession }), captured);
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:3001' });

    const result = await endCoverageSession(client, 'session-1', 1);

    expect(result.status).toBe('ended');
    expect(captured[0].url).toContain('/sessions/session-1/end');
    expect(captured[0].body).toEqual({ version: 1 });
  });
});

test.describe('getCoverageSession', () => {
  test('GETs /:sessionId and returns the session', async () => {
    const captured: CapturedRequest[] = [];
    const ctx = mockContext(() => mockApiResponse(200, { session: SAMPLE_SESSION }), captured);
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:3001' });

    const result = await getCoverageSession(client, 'session-1');

    expect(result).toEqual(SAMPLE_SESSION);
    expect(captured[0].method).toBe('GET');
    expect(captured[0].url).toContain('/sessions/session-1');
  });
});

test.describe('listActiveCoverageSessions', () => {
  test('GETs /admin/coverage/sessions and returns the paginated data array', async () => {
    const captured: CapturedRequest[] = [];
    const ctx = mockContext(
      () => mockApiResponse(200, { data: [SAMPLE_SESSION], total: 1, page: 1, limit: 25 }),
      captured,
    );
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:3001' });

    const result = await listActiveCoverageSessions(client);

    expect(result).toEqual([SAMPLE_SESSION]);
    expect(captured[0].method).toBe('GET');
  });

  test('returns an empty array when no sessions are active', async () => {
    const ctx = mockContext(() => mockApiResponse(200, { data: [], total: 0, page: 1, limit: 25 }));
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:3001' });

    const result = await listActiveCoverageSessions(client);

    expect(result).toEqual([]);
  });
});

test.describe('recordCoverageSessionDump', () => {
  test('POSTs to /:sessionId/dumps and returns the recorded attribution', async () => {
    const captured: CapturedRequest[] = [];
    const sessionDump = {
      id: 'sd-1',
      sessionId: 'session-1',
      dumpId: 'dump-1',
      correlationId: 'corr-1',
      testId: 'spec.ts:1',
      testName: 'my test',
      testFile: 'tests/apps/minicrm/functional/deals/deal-creation.spec.ts',
      attempt: 1,
      recordedAt: '2026-07-21T00:00:00.000Z',
    };
    const ctx = mockContext(() => mockApiResponse(201, { sessionDump }), captured);
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:3001' });

    const result = await recordCoverageSessionDump(client, 'session-1', {
      dumpId: 'dump-1',
      correlationId: 'corr-1',
      testId: 'spec.ts:1',
      testName: 'my test',
      testFile: 'tests/apps/minicrm/functional/deals/deal-creation.spec.ts',
      attempt: 1,
    });

    expect(result).toEqual(sessionDump);
    expect(captured[0].url).toContain('/sessions/session-1/dumps');
    expect(captured[0].body).toMatchObject({ dumpId: 'dump-1', correlationId: 'corr-1' });
  });
});

/**
 * Collects warnings into an array via an injected sink. Nothing global is
 * patched — unlike ai-healer.spec.ts's console.warn save/replace/restore,
 * which is safe there but would race here, since the resolver under test runs
 * concurrently for every functional test in the same worker.
 */
function captureWarnings(): {
  emitted: string[];
  sink: (message: string) => void;
  seen: Set<string>;
} {
  const emitted: string[] = [];
  // A fresh warn-once set per capture, so each test's latch is entirely its
  // own and no test depends on being the first to trip a shared one.
  return { emitted, sink: (message: string) => emitted.push(message), seen: new Set<string>() };
}

test.describe('resolveSessionBuildSha', () => {
  // Every case injects its own env, warn sink, and warn-once set rather than
  // mutating module or process state: fixtures.ts calls
  // resolveSessionBuildSha() for EVERY test, and fullyParallel means
  // functional tests share this worker process, so touching a global here
  // would corrupt unrelated runs — the very defect this module prevents.

  test('prefers GIT_COMMIT_SHA over GITHUB_SHA', () => {
    expect(
      resolveSessionBuildSha({ GIT_COMMIT_SHA: 'explicit-sha', GITHUB_SHA: 'github-sha' }),
    ).toBe('explicit-sha');
  });

  test('falls back to GITHUB_SHA when GIT_COMMIT_SHA is unset', () => {
    expect(resolveSessionBuildSha({ GITHUB_SHA: 'github-sha' })).toBe('github-sha');
  });

  test('falls back to "unknown" AND warns when neither is set', () => {
    // THE AC-1 case: a local run with nothing exported. Silent degradation to
    // 'unknown' is the defect the ticket exists for, so the warning is the
    // behaviour under test — asserting only the return value here would let
    // the warn call be deleted with the suite still green.
    const warnings = captureWarnings();

    expect(resolveSessionBuildSha({}, warnings.sink, warnings.seen)).toBe('unknown');

    expect(warnings.emitted).toHaveLength(1);
    expect(warnings.emitted[0]).toContain('GIT_COMMIT_SHA');
  });

  test('falls back to GITHUB_SHA when GIT_COMMIT_SHA is set but EMPTY', () => {
    // The regression this guards: an empty explicit override used to win the
    // `??` chain and return '', which the API rejects (buildSha is min(1)) —
    // and the per-test fixture swallows a failed session start, so the run
    // recorded no session at all. docker-compose.test.yml's
    // `GIT_COMMIT_SHA: ${GIT_COMMIT_SHA:-}` produces exactly this value.
    expect(resolveSessionBuildSha({ GIT_COMMIT_SHA: '', GITHUB_SHA: 'github-sha' })).toBe(
      'github-sha',
    );
  });

  test('falls back to "unknown" and warns when both are set but empty', () => {
    // The docker-compose.test.yml `${GIT_COMMIT_SHA:-}` shape — an empty
    // string reaching the resolver rather than an unset variable. Must be
    // indistinguishable from "unset", warning included.
    const warnings = captureWarnings();

    expect(
      resolveSessionBuildSha({ GIT_COMMIT_SHA: '', GITHUB_SHA: '' }, warnings.sink, warnings.seen),
    ).toBe('unknown');

    expect(warnings.emitted).toHaveLength(1);
  });

  test('degrades to "unknown" and warns when the resolved value is malformed', () => {
    const warnings = captureWarnings();

    // A branch-style ref rather than a SHA — the shape a misfiring
    // `$(git rev-parse ...)` or a hand-set variable tends to produce.
    const resolved = resolveSessionBuildSha(
      { GIT_COMMIT_SHA: 'feature/some-branch' },
      warnings.sink,
      warnings.seen,
    );

    expect(resolved).toBe('unknown');
    expect(warnings.emitted).toHaveLength(1);
    expect(warnings.emitted[0]).toContain('GIT_COMMIT_SHA');
    expect(warnings.emitted[0]).toContain('feature/some-branch');
  });

  test('names the operator-facing consequence and remedy when it degrades', () => {
    // AC-1's "warns visibly" is the acceptance criterion, so the CONTENT is
    // under test — a bare "degraded" line would satisfy a toHaveLength check
    // while telling an operator nothing actionable.
    const warnings = captureWarnings();

    resolveSessionBuildSha({}, warnings.sink, warnings.seen);

    expect(warnings.emitted).toHaveLength(1);
    const [message] = warnings.emitted;
    expect(message).toContain('no-session-attribution');
    expect(message).toContain('git rev-parse HEAD');
    expect(message).toContain('docs/dev/coverage.md');
  });

  test('warns only once per distinct reason', () => {
    const warnings = captureWarnings();

    resolveSessionBuildSha({}, warnings.sink, warnings.seen);
    resolveSessionBuildSha({}, warnings.sink, warnings.seen);
    resolveSessionBuildSha({}, warnings.sink, warnings.seen);

    expect(warnings.emitted).toHaveLength(1);

    // A DIFFERENT misconfiguration still gets its own line — the latch
    // suppresses repeats, not distinct problems.
    resolveSessionBuildSha({ GIT_COMMIT_SHA: 'refs/heads/x' }, warnings.sink, warnings.seen);
    expect(warnings.emitted).toHaveLength(2);
  });

  test('does not warn when a well-formed SHA resolves', () => {
    const warnings = captureWarnings();

    const resolved = resolveSessionBuildSha(
      { GIT_COMMIT_SHA: 'e9f97b2f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d' },
      warnings.sink,
    );

    expect(resolved).toBe('e9f97b2f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d');
    expect(warnings.emitted).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Cross-workspace parity with the server's resolver.
  //
  // The QA side tags coverage SESSIONS (what the attestation gate joins on);
  // server/src/coverageAgent/coverageConfig.ts tags coverage DUMPS (what the
  // coverage map keys on). A split between them is invisible until a gate
  // reports no-session-attribution or a generated map turns out to be
  // unusable, so the accept/reject sets must not drift.
  //
  // The two resolvers are deliberately NOT shared code: this module runs in
  // the QA workspace's own process and must stay free of server imports.
  //
  // What this test covers, precisely: that the QA RESOLVER — not merely its
  // regex — accepts and rejects what the server's rule does. It runs the real
  // resolveSessionBuildSha() over the corpus, so it also catches a resolver
  // that stops consulting its pattern, mangles the value, or short-circuits.
  // Its detection power for pure REGEX drift is bounded by the corpus, which
  // is why it is not the only guard: qa/scripts/check-sha-pattern-parity.sh
  // diffs the three definitions as source text and catches any character
  // change, including ones no corpus would distinguish. The two are
  // complementary — text equality there, behavioural equivalence here.
  //
  // The server's real pattern is IMPORTED, never copied, so this test moves
  // with the server's rule rather than a snapshot of it. Importing
  // coverageConfig.ts is safe here for the same reason junitXml.ts is — it
  // pulls in only pino via logger.ts, no pg.Pool and no dotenv/config, so no
  // socket is opened and no env is rewritten inside a Playwright worker.
  // -------------------------------------------------------------------------
  test('accepts and rejects exactly what the server-side SHA validation does', () => {
    const corpus = [
      'e9f97b2f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d', // real 40-hex SHA
      'a1b2c3d4.feature-branch_v2', // safe punctuation
      '..abc', // leading dots, but not a traversal segment
      'refs/heads/main', // path separator
      '../../tmp/evil', // traversal
      '.', // bare dot
      '..', // bare dot-dot
      'has space', // whitespace
      'quoted"value', // quote from a misfiring $(...)
    ];

    for (const candidate of corpus) {
      const serverWouldAccept = SAFE_PATH_SEGMENT_PATTERN.test(candidate);
      const qaAccepted =
        resolveSessionBuildSha({ GIT_COMMIT_SHA: candidate }, () => {}) === candidate;

      expect(
        qaAccepted,
        `"${candidate}": QA resolver ${qaAccepted ? 'accepted' : 'rejected'} it but the ` +
          `server-side rule would ${serverWouldAccept ? 'accept' : 'reject'} it`,
      ).toBe(serverWouldAccept);
    }
  });
});

test.describe('resolveSessionEnvironment', () => {
  const originalEnv = process.env['E2E_ENVIRONMENT'];

  test.afterEach(() => {
    if (originalEnv === undefined) delete process.env['E2E_ENVIRONMENT'];
    else process.env['E2E_ENVIRONMENT'] = originalEnv;
  });

  test('uses E2E_ENVIRONMENT when set', () => {
    process.env['E2E_ENVIRONMENT'] = 'ci';
    expect(resolveSessionEnvironment()).toBe('ci');
  });

  test('falls back to "local" when unset', () => {
    delete process.env['E2E_ENVIRONMENT'];
    expect(resolveSessionEnvironment()).toBe('local');
  });
});

test.describe('CORRELATION_ID_HEADER', () => {
  test('is the exact header name the server middleware reads', () => {
    expect(CORRELATION_ID_HEADER).toBe('x-coverage-correlation-id');
  });
});
