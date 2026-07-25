/**
 * Manual-testing coverage session correlation relay. (MINCRM-609..612, MINCRM-663)
 *
 * The manual-testing session recorder now lives in the standalone
 * coverage-dashboard app (SessionRecorderPage.tsx), a separate origin/JS
 * runtime from this CRM client — setting x-coverage-correlation-id on the
 * dashboard's own axios instance has no effect on requests this app makes,
 * since the two apps share no in-memory state. Before the recorder moved
 * out of this client (MINCRM-663), it WAS this client's own page, so its
 * axios instance WAS the one carrying the header; that implicit coupling
 * broke the moment the page moved to a different app (found via Greptile
 * PR review — "CRM requests lose session attribution").
 *
 * Fix: the recorder's check-in screen gives the admin a link back to this
 * app with `?coverageCorrelationId=<id>` appended. On load, this module
 * reads that query param once, persists it to localStorage (survives
 * reloads/navigation for the rest of the manual-testing session, unlike a
 * query param which vanishes on the next navigation), and strips it from
 * the URL so it doesn't linger in the address bar or get shared/bookmarked
 * accidentally. axiosInstance.ts's request interceptor then reads the
 * persisted value on every outgoing request.
 *
 * Browser coverage submission: the OLD in-CRM recorder submitted
 * window.__coverage__ as a browser-source dump from its own checkOutMutation,
 * since it ran inside the same bundle being measured. This client is now
 * the one carrying window.__coverage__ for a manual session (the dashboard
 * never is — see coverage-dashboard's own SessionRecorderPage docblock), so
 * checkOutCoverageSession() below submits it from HERE before clearing the
 * correlation ID — see CoverageSessionIndicator.tsx for where this is
 * actually triggered from (a small floating "check out" affordance shown
 * only while a correlation ID is active).
 *
 * Ending the server-side session from here (found via Greptile PR review —
 * "CRM checkout orphans server sessions"): the CRM only ever learns a
 * correlation ID, never the session's own id/version, so checkOutCoverageSession
 * looks the session up by correlation ID first (GET .../by-correlation/:id)
 * to get both before calling the optimistic-locked /end endpoint. A
 * confirmed 404 there (already ended — e.g. from the dashboard's own
 * check-out; see "Dashboard checkout leaves stale CRM state") is treated as
 * success: the goal state (no active session for this correlation ID) is
 * already true.
 *
 * A FAILED lookup or end request (found via Greptile PR review — "Failed
 * checkout discards session reference") is NOT the same as a confirmed-gone
 * session: a transient network/500 error tells us nothing about whether the
 * server session is still active, so checkOutCoverageSession throws in that
 * case instead of clearing the correlation ID — the admin can retry check-out
 * once the transient failure passes, rather than losing the only reference
 * needed to ever end that session, orphaning it.
 */

import apiClient from './api/axiosInstance.js';
import {
  findActiveCoverageSessionByCorrelationId,
  endCoverageSession as endCoverageSessionOnServer,
} from './api/coverageSessions.js';

const CORRELATION_ID_STORAGE_KEY = 'coverageCorrelationId';
const CORRELATION_ID_QUERY_PARAM = 'coverageCorrelationId';
const COVERAGE_DUMP_ENDPOINT = '/admin/coverage/dump';

/**
 * Reads a coverage correlation ID from the current URL's query string, if
 * present, and persists it to localStorage — then strips the param from
 * the URL via history.replaceState so it doesn't remain visible or get
 * bookmarked/shared. A no-op when the param is absent, which is the
 * normal case for every request that isn't a manual-testing check-in link.
 *
 * Call once at app startup (see main.tsx), before any API request may fire.
 */
export function relayCoverageCorrelationIdFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  const correlationId = params.get(CORRELATION_ID_QUERY_PARAM);
  if (!correlationId) return;

  try {
    window.localStorage.setItem(CORRELATION_ID_STORAGE_KEY, correlationId);
  } catch {
    return;
  }

  params.delete(CORRELATION_ID_QUERY_PARAM);
  const remainingQuery = params.toString();
  const cleanedUrl =
    window.location.pathname + (remainingQuery ? `?${remainingQuery}` : '') + window.location.hash;
  window.history.replaceState({}, '', cleanedUrl);
}

/**
 * Returns the currently-persisted coverage correlation ID, or null if none
 * is set (the normal case — most admins never touch the manual-testing
 * recorder). Read by axiosInstance.ts's request interceptor on every call,
 * and by CoverageSessionIndicator to decide whether to render at all.
 *
 * Guards against a missing/non-functional localStorage rather than trusting
 * it unconditionally: unlike every other localStorage caller in this codebase
 * (each gated behind a user action — a widget click, a settings save), this
 * one runs on the hot path of every single outgoing API request, so it is the
 * first code to touch localStorage in test files that never stub it. Found
 * via GlobalSearch.test.tsx (and ~most of the client suite) failing after
 * this interceptor was added — this environment's jsdom localStorage has no
 * getItem by default outside the handful of test files that explicitly
 * `vi.stubGlobal('localStorage', ...)`.
 */
export function getPersistedCoverageCorrelationId(): string | null {
  try {
    return window.localStorage.getItem(CORRELATION_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Reads window.__coverage__ from this tab. Undefined on a non-instrumented build. */
function pullBrowserCoverage(): Record<string, unknown> | undefined {
  const globalWithCoverage = window as unknown as { __coverage__?: Record<string, unknown> };
  return globalWithCoverage.__coverage__;
}

/**
 * Clears the persisted correlation ID without touching the server-side
 * session or submitting a coverage dump — for when CoverageSessionIndicator's
 * own server-reconciliation useQuery discovers the session was already
 * ended from elsewhere (the dashboard's own check-out) and there is nothing
 * left to end or attribute a dump to. checkOutCoverageSession (the explicit
 * "Check out" button path) calls this too, after its own end-session and
 * dump-submission steps.
 */
export function clearPersistedCoverageCorrelationId(): void {
  try {
    window.localStorage.removeItem(CORRELATION_ID_STORAGE_KEY);
  } catch {
    // Nothing further to do — see getPersistedCoverageCorrelationId's docblock.
  }
}

/** Thrown by checkOutCoverageSession when the session's current state could
 *  not be determined — the correlation ID is deliberately left persisted so
 *  the admin can retry rather than losing the only reference able to end it. */
export class CoverageSessionCheckoutFailedError extends Error {
  constructor() {
    super('Could not confirm the coverage session state — check-out was not completed.');
  }
}

/**
 * Submits this tab's accumulated window.__coverage__ (if any) as a
 * browser-source dump, then clears the persisted correlation ID —
 * mirroring the old in-CRM recorder's own checkOutMutation, just triggered
 * from CoverageSessionIndicator's "Check out" button instead of a
 * component unmount. Best-effort: coverage_instrumentation may be off
 * independently of the session itself being active (the two are
 * deliberately decoupled — see migration 157's own docblock), and the
 * served bundle may not even be an instrumented build, so a failed/absent
 * dump must never block clearing the correlation ID.
 *
 * Throws CoverageSessionCheckoutFailedError (and leaves the correlation ID
 * persisted) if the by-correlation lookup fails for a reason OTHER than a
 * confirmed 404 — see this module's own docblock on why that distinction
 * matters.
 */
export async function checkOutCoverageSession(): Promise<void> {
  const correlationId = getPersistedCoverageCorrelationId();

  const coverageMap = pullBrowserCoverage();
  if (coverageMap && Object.keys(coverageMap).length > 0) {
    await apiClient
      .post(COVERAGE_DUMP_ENDPOINT, {
        label: 'manual-testing-session',
        source: 'browser',
        payload: coverageMap,
      })
      .catch(() => undefined);
  }

  if (correlationId) {
    const lookup = await findActiveCoverageSessionByCorrelationId(correlationId);
    if (lookup.status === 'lookup-failed') {
      throw new CoverageSessionCheckoutFailedError();
    }
    if (lookup.status === 'found') {
      // A 409 version conflict here (e.g. the dashboard ended it in the gap
      // between the lookup above and this call) is the goal state, not a
      // failure — swallow it the same way a failed dump submission above
      // must never block clearing the correlation ID below.
      await endCoverageSessionOnServer(lookup.session.id, lookup.session.version).catch(
        () => undefined,
      );
    }
    // status === 'not-found': already ended elsewhere — nothing to end.
  }

  clearPersistedCoverageCorrelationId();
}
