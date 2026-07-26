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

// Compile-time-only checkpoint (MINCRM-636): asserts
// coverage-session-control-client.ts's real exports satisfy the documented
// HarnessAdapterShape<RestClient> contract (shared/schemas/
// coverageHarnessAdapterSchema.ts). This file is outside
// qa/e2e/framework/'s zero-app-domain-refs boundary, so it — not the
// framework file itself — is where a @minicrm/shared/schemas import is
// permitted; the client under test stays framework-pure. Never called at
// runtime; its only job is to fail `tsc --noEmit` if either side's
// signature drifts from the other.
const _playwrightHarnessAdapterCheck: HarnessAdapterShape<RestClient> = {
  startSession: (client, params) => startCoverageSession(client, params),
  endSession: (client, sessionId, version) => endCoverageSession(client, sessionId, version),
  recordDump: (client, sessionId, params) => recordCoverageSessionDump(client, sessionId, params),
  injectCorrelationHeader: (headers, correlationId) => {
    headers[CORRELATION_ID_HEADER] = correlationId;
  },
};
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

test.describe('resolveSessionBuildSha', () => {
  const originalGitSha = process.env['GIT_COMMIT_SHA'];
  const originalGithubSha = process.env['GITHUB_SHA'];

  test.afterEach(() => {
    if (originalGitSha === undefined) delete process.env['GIT_COMMIT_SHA'];
    else process.env['GIT_COMMIT_SHA'] = originalGitSha;
    if (originalGithubSha === undefined) delete process.env['GITHUB_SHA'];
    else process.env['GITHUB_SHA'] = originalGithubSha;
  });

  test('prefers GIT_COMMIT_SHA over GITHUB_SHA', () => {
    process.env['GIT_COMMIT_SHA'] = 'explicit-sha';
    process.env['GITHUB_SHA'] = 'github-sha';

    expect(resolveSessionBuildSha()).toBe('explicit-sha');
  });

  test('falls back to GITHUB_SHA when GIT_COMMIT_SHA is unset', () => {
    delete process.env['GIT_COMMIT_SHA'];
    process.env['GITHUB_SHA'] = 'github-sha';

    expect(resolveSessionBuildSha()).toBe('github-sha');
  });

  test('falls back to "unknown" when neither is set', () => {
    delete process.env['GIT_COMMIT_SHA'];
    delete process.env['GITHUB_SHA'];

    expect(resolveSessionBuildSha()).toBe('unknown');
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
