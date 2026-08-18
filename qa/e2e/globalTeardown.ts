/**
 * Playwright globalTeardown — coverage reset safety net.
 *
 * Resets the backend V8 coverage agent's counters once after the run
 * completes, so a subsequent run (which may not itself call reset() before
 * its first dump) doesn't inherit stale counters left over from this one.
 * No-ops silently if coverage instrumentation isn't configured or the
 * server isn't reachable — this must never fail the E2E run over a
 * best-effort cleanup step.
 *
 *
 */

import {
  fetchAdminSessionCookie,
  resolveE2eApiUrl,
} from './framework/coverageAgent/admin-session-fetch.js';

const RESET_ENDPOINT = '/api/v1/admin/coverage/reset';

export default async function globalTeardown(): Promise<void> {
  const cookie = await fetchAdminSessionCookie();
  if (!cookie) return;

  try {
    await fetch(`${resolveE2eApiUrl()}${RESET_ENDPOINT}`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
  } catch {
    // Best-effort cleanup only — never fail the run over this.
  }
}
