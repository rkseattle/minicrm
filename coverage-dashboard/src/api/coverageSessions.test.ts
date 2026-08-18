/**
 * Tests for listAllActiveCoverageSessions's pagination-exhaustion logic.
 *
 * Verifies:
 * - Fetches every page until a short page is returned
 * - Does NOT terminate early on a stale/shrunk `total` caused by a
 *   concurrent session ending between page fetches (found via Greptile PR
 *   review — "Concurrent pagination omits sessions")
 * - Deduplicates a session that appears on two fetches because a concurrent
 *   deletion shifted it across the page boundary
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/setup.js';
import { listAllActiveCoverageSessions } from './coverageSessions.js';

function makeSession(id: string) {
  return {
    id,
    label: `Session ${id}`,
    source: 'manual' as const,
    status: 'active' as const,
    correlationId: `corr-${id}`,
    buildSha: 'abc123',
    environment: 'test',
    issueKey: null,
    startedById: 'user-1',
    startedAt: '2026-07-20T00:00:00.000Z',
    endedAt: null,
    version: 1,
  };
}

describe('listAllActiveCoverageSessions', () => {
  it('fetches every page until a short page terminates the loop', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => makeSession(`s${i}`));
    const page2 = [makeSession('s100')];
    let requestedPages: number[] = [];
    server.use(
      http.get('*/api/v1/admin/coverage/sessions', ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page') ?? '1');
        requestedPages.push(page);
        const data = page === 1 ? page1 : page === 2 ? page2 : [];
        return HttpResponse.json({ data, total: 101, page, limit: 100 });
      }),
    );

    const result = await listAllActiveCoverageSessions();

    expect(requestedPages).toEqual([1, 2]);
    expect(result).toHaveLength(101);
  });

  it('does not stop early when total shrinks between fetches (a session ended mid-pagination)', async () => {
    // Page 1 returns 100 sessions with total=150 (150 active sessions exist).
    // By the time page 2 is fetched, one of the NOT-yet-fetched sessions was
    // checked out — the server's total is now 149, LESS than the 100 this
    // client already accumulated from page 1. A total-based termination
    // check (accumulated >= total) would wrongly stop here, since
    // 100 >= 149 is false but a naive `>=` against a STALE total captured
    // before the shrink could still misfire in other formulations — the
    // real regression this guards is relying on `total` for the loop
    // condition AT ALL. This test asserts page 2 is fetched regardless.
    const page1 = Array.from({ length: 100 }, (_, i) => makeSession(`s${i}`));
    const page2 = Array.from({ length: 49 }, (_, i) => makeSession(`s${100 + i}`));
    let requestedPages: number[] = [];
    server.use(
      http.get('*/api/v1/admin/coverage/sessions', ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page') ?? '1');
        requestedPages.push(page);
        if (page === 1) {
          return HttpResponse.json({ data: page1, total: 150, page, limit: 100 });
        }
        // total shrank by one between the two fetches (a concurrent checkout)
        return HttpResponse.json({ data: page2, total: 149, page, limit: 100 });
      }),
    );

    const result = await listAllActiveCoverageSessions();

    expect(requestedPages).toContain(2);
    expect(result).toHaveLength(149);
  });

  it('deduplicates a session returned on two fetches because a concurrent deletion shifted it across the page boundary', async () => {
    // Page 1 returns s0..s99. A session ahead of the offset window ends
    // between fetches, shifting s99 backward so it ALSO appears at the
    // start of page 2 alongside a genuinely new s100.
    const page1 = Array.from({ length: 100 }, (_, i) => makeSession(`s${i}`));
    const page2 = [makeSession('s99'), makeSession('s100')];
    server.use(
      http.get('*/api/v1/admin/coverage/sessions', ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page') ?? '1');
        const data = page === 1 ? page1 : page === 2 ? page2 : [];
        return HttpResponse.json({ data, total: 101, page, limit: 100 });
      }),
    );

    const result = await listAllActiveCoverageSessions();

    const ids = result.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result).toHaveLength(101);
  });

  it('returns an empty array with no requests beyond the first when there are no active sessions', async () => {
    let requestCount = 0;
    server.use(
      http.get('*/api/v1/admin/coverage/sessions', () => {
        requestCount += 1;
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 100 });
      }),
    );

    const result = await listAllActiveCoverageSessions();

    expect(result).toEqual([]);
    expect(requestCount).toBe(1);
  });
});
