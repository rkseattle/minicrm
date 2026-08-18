/**
 * Single source of truth for the MiniCRM API origin used by app-layer E2E code.
 *
 * Lives in apps/minicrm/ rather than framework/: the port is a MiniCRM deployment
 * detail, and framework/ must stay free of application-domain references (CLAUDE.md,
 * enforced by qa/scripts/check-framework-purity.sh). The framework's own RestClient
 * keeps its product-agnostic :3001 default; this is what MiniCRM's own specs use.
 *
 * The literal was previously duplicated across four files, two of which defaulted to
 * :3001 — the DEV server — so an unset E2E_API_URL silently pointed the suite at the dev
 * stack and, through it, the dev database. That is the leak class this ticket closes.
 *
 * In practice the fallback is unreachable for a normal run: globalSetup.ts throws when
 * E2E_API_URL is unset outside CI. It is retained so a spec imported in isolation (or a
 * CI job that sets the var itself) still resolves a sane origin rather than `undefined`.
 */

/** Host origin of the E2E app server published by docker-compose.test.yml. */
const DEFAULT_E2E_API_URL = 'http://localhost:3002';

/** Resolves the API origin for MiniCRM app-layer E2E code. */
export function resolveApiBaseUrl(): string {
  return process.env['E2E_API_URL'] ?? DEFAULT_E2E_API_URL;
}
