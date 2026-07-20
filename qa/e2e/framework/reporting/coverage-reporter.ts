/**
 * CoverageReporter — triggers one final backend coverage dump at the end of
 * an E2E run when E2E_COVERAGE_GRANULARITY=per-run.
 *
 * Per-test coverage collection (E2E_COVERAGE_GRANULARITY unset or 'per-test')
 * happens inside the app-level page fixture instead. This reporter exists
 * specifically for the coarse-grained mode: a global teardown step's
 * safety-net reset covers the END of the PREVIOUS run; this reporter's job
 * is the dump at the END of THIS run, so a dump artifact reliably exists
 * even if no individual test called dump() explicitly.
 *
 * Runs outside the fixture/test context (reporters have no access to the
 * `request` fixture), so it authenticates and calls the control API with a
 * plain fetch() rather than RestClient.
 *
 * Register in playwright.config.ts:
 *   reporters: [['./framework/reporting/coverage-reporter.ts']]
 */

import type { Reporter, FullResult } from '@playwright/test/reporter';

const DEFAULT_API_URL = 'http://localhost:3001';
const LOGIN_ENDPOINT = '/api/v1/auth/login';
const DUMP_ENDPOINT = '/api/v1/admin/coverage/dump';
const PER_RUN_MODE = 'per-run';

/** Extracts the raw session cookie from a login response's Set-Cookie header. */
function extractSessionCookie(setCookieHeader: string | null): string | undefined {
  if (!setCookieHeader) return undefined;
  return setCookieHeader.split(';')[0];
}

async function dumpFinalRunCoverage(status: FullResult['status']): Promise<void> {
  const apiUrl = process.env['E2E_API_URL'] ?? DEFAULT_API_URL;
  const email = process.env['E2E_ADMIN_EMAIL'];
  const password = process.env['E2E_ADMIN_PASSWORD'];
  if (!email || !password) {
    // No admin credentials configured — nothing this reporter can do.
    return;
  }

  try {
    const loginResponse = await fetch(`${apiUrl}${LOGIN_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!loginResponse.ok) return;

    const cookie = extractSessionCookie(loginResponse.headers.get('set-cookie'));
    if (!cookie) return;

    await fetch(`${apiUrl}${DUMP_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ label: `run-${status}` }),
    });
  } catch {
    // Coverage instrumentation may simply be disabled for this run (flag off,
    // agent not started) — a failed dump attempt must never fail the E2E run.
  }
}

export class CoverageReporter implements Reporter {
  async onEnd(result: FullResult): Promise<void> {
    if (process.env['E2E_COVERAGE_GRANULARITY'] !== PER_RUN_MODE) return;
    await dumpFinalRunCoverage(result.status);
  }
}

export default CoverageReporter;
