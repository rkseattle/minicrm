/**
 * Client-side coverage agent — pulls Istanbul coverage from the browser
 * and submits it to the control API's dump-ingestion endpoint.
 *
 * There is no server-side "browser agent" to control the way there is for
 * the backend V8 agent: the server cannot reach into a page it did not
 * render. Instead this module pulls window.__coverage__ itself
 * (page.evaluate) and POSTs the already-collected payload — the server's
 * job is purely to accept, tag, and store it.
 *
 * No-op by design when the served bundle was not built with coverage
 * instrumentation on: window.__coverage__ is simply absent in that case,
 * and pullBrowserCoverage returns undefined rather than throwing, so this
 * module is safe to call unconditionally from any test.
 */

import type { SafePage } from '../types/safe-page.js';
import type { RestClient } from '../clients/rest-client.js';

/** Raw Istanbul coverage map shape — one entry per instrumented source file. */
export type IstanbulCoverageMap = Record<string, unknown>;

const COVERAGE_DUMP_ENDPOINT = '/api/v1/admin/coverage/dump';

/**
 * Reads window.__coverage__ from the page. Returns undefined if the served
 * bundle was not instrumented (the common case — coverage instrumentation
 * is opt-in), so callers can no-op rather than branching on env vars themselves.
 */
export async function pullBrowserCoverage(
  page: SafePage,
): Promise<IstanbulCoverageMap | undefined> {
  // page.evaluate() runs inside the browser context — the callback is
  // serialized and evaluated by V8 there, so `window` is available at
  // runtime even though the Node.js tsconfig has no DOM lib. `globalThis`
  // + an `unknown` cast satisfies the compiler without adding DOM to the
  // lib (which would conflict with Node.js types across the QA workspace) —
  // same pattern as collectWebVitals in performance/perf-metrics.ts.
  return page.evaluate(() => {
    const globalWithCoverage = globalThis as unknown as { __coverage__?: IstanbulCoverageMap };
    return globalWithCoverage.__coverage__;
  });
}

/**
 * Submits an already-pulled Istanbul coverage payload to the control API,
 * tagging it as a browser-origin dump. Returns the persisted dump's metadata.
 */
export async function submitBrowserDump(
  restClient: RestClient,
  coverageMap: IstanbulCoverageMap,
  label: string,
): Promise<{ dumpId: string }> {
  const response = await restClient.post<{ dump: { dumpId: string } }>(COVERAGE_DUMP_ENDPOINT, {
    label,
    source: 'browser',
    payload: coverageMap,
  });
  return response.body.dump;
}

/**
 * Convenience wrapper: pulls coverage from the page and submits it if
 * present. No-ops (returns undefined) when the page was not instrumented,
 * so this is safe to call unconditionally from a test's cleanup path.
 */
export async function pullAndSubmitBrowserCoverage(
  page: SafePage,
  restClient: RestClient,
  label: string,
): Promise<{ dumpId: string } | undefined> {
  const coverageMap = await pullBrowserCoverage(page);
  if (!coverageMap || Object.keys(coverageMap).length === 0) {
    return undefined;
  }
  return submitBrowserDump(restClient, coverageMap, label);
}
