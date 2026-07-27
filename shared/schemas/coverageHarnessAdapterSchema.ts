/**
 * Coverage/TIA harness adapter SDK contract. (MINCRM-636)
 *
 * A HarnessAdapter is the shape a test-harness integration (Playwright
 * today; a future framework's own reference client) uses to tag coverage
 * sessions and propagate the correlation ID that partitions coverage by
 * test. Generic over `TClient` (the underlying HTTP client type, e.g.
 * qa/'s own RestClient) so this file never needs to import a qa/-specific
 * type to stay type-checkable.
 *
 * Documented exception to shared/schemas/'s usual "Zod schemas used by both
 * client and server" contract (see CLAUDE.md's Project Layout table): this
 * file contains a plain TS interface, no Zod, and today only qa/ imports
 * it. It lives here anyway rather than in a qa-local location because it
 * imports the Zod types below from coverageSessionSchema.ts, and
 * qa/e2e/framework/ must stay free of any @minicrm/shared/schemas import
 * (enforced by qa/scripts/check-framework-purity.sh) — there is no
 * qa-local home for this file that avoids that same import (found via
 * Greptile branch review). If a second non-Zod, qa-only shared contract
 * like this one is ever added, that's the trigger to introduce a proper
 * shared/types/ directory rather than growing this exception informally.
 *
 * The reference implementation of this contract is
 * qa/e2e/framework/coverageAgent/coverage-session-control-client.ts's
 * exported functions, plus qa/e2e/apps/minicrm/fixtures.ts's own
 * page.context().setExtraHTTPHeaders(...) call for correlation-header
 * injection — see docs/dev/coverage-tia-sdk.md for the full mapping.
 */

import type {
  CoverageSession,
  RecordCoverageSessionDumpRequest,
  CoverageSessionDump,
  StartCoverageSessionRequest,
} from './coverageSessionSchema.js';

/**
 * Documents the harness-adapter contract MINCRM-636's "harness adapter
 * contract for tagging sessions" AC calls for, as real function signatures
 * — not prose — so a new harness integration's own client can be
 * type-checked against this shape directly (`satisfies HarnessAdapterShape<MyClient>`),
 * and so drift between this doc and the real Playwright client's exports is
 * a compile error, not a stale comment.
 */
export interface HarnessAdapterShape<TClient> {
  /** Begins a coverage session, minting a correlationId the caller must propagate via injectCorrelationHeader. */
  startSession(client: TClient, params: StartCoverageSessionRequest): Promise<CoverageSession>;
  /** Ends an active session. Optimistic-locked on `version` — see CoverageSession. */
  endSession(client: TClient, sessionId: string, version: number): Promise<CoverageSession>;
  /** Attributes a produced dumpId to the session (call after the dump itself is persisted). */
  recordDump(
    client: TClient,
    sessionId: string,
    params: RecordCoverageSessionDumpRequest,
  ): Promise<CoverageSessionDump>;
  /**
   * Propagates CORRELATION_ID_HEADER into every request the test/browser
   * makes for the session's duration, so the backend agent's dumps are
   * attributable back to this session. Not itself an HTTP call — the
   * Playwright reference implementation is
   * `page.context().setExtraHTTPHeaders(...)`, a browser-context mutation,
   * not a REST call through TClient — so this member is intentionally
   * synchronous and takes no TClient.
   */
  injectCorrelationHeader(headers: Record<string, string>, correlationId: string): void;
}
