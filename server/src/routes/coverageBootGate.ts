/**
 * Boot-time route-registration gate shared by every Coverage/TIA router.
 * (MINCRM-663, MINCRM-685)
 *
 * Each coverage router registers its routes only when its own env var is
 * 'true' at process boot, so a deployment that did not opt in gets a plain 404
 * on every path rather than a 403 — there is nothing to discover, not merely a
 * gate reporting "off". See routes/coverage.ts's docblock for the full
 * rationale.
 *
 * Extracted because the `if (process.env.X === 'true')` idiom was hand-copied
 * at five call sites, each repeating the bare `'true'` literal that CLAUDE.md's
 * no-magic-strings rule exists to prevent, and because
 * coverageRouteGating.test.ts had to hand-maintain a parallel list of the same
 * five names with nothing tying the two together. COVERAGE_ROUTE_GATE_ENV_VARS
 * below is now that single source of truth for WHICH VARS EXIST — the test
 * imports it to unset them all rather than restating the list. Note what that
 * does not buy: the test's 404 assertions are still hand-written per route, so
 * adding a sixth router to this array does not automatically get it asserted.
 * Whoever adds one must add its cases there too.
 *
 * Deliberately NOT a general-purpose env helper. `isDashboardNoAuthEnabled`
 * and `COVERAGE_CAPABILITY_GATING` read process.env per request by design
 * (see coverageAccessGate.ts); this one is boot-time only, and conflating the
 * two would invite someone to route a per-request check through it.
 */

/**
 * Every boot-time coverage route gate.
 *
 * Ordered by the story that introduced each one (MINCRM-663's two first, then
 * MINCRM-685's three) — deliberately NOT app.ts's mounting order, which is
 * about path specificity and has no bearing on registration.
 */
export const COVERAGE_ROUTE_GATE_ENV_VARS = [
  'COVERAGE_INSTRUMENTATION',
  'COVERAGE_SESSION_MANAGEMENT',
  'COVERAGE_MAPPING_QUERY',
  'COVERAGE_REPORTING_QUERY',
  'COVERAGE_PIPELINE_INGESTION',
] as const;

export type CoverageRouteGateEnvVar = (typeof COVERAGE_ROUTE_GATE_ENV_VARS)[number];

/**
 * Runs `register` only when `envVar` is exactly 'true' at the moment of the
 * call — which, for every caller, is module evaluation.
 *
 * Typed to the union above rather than `string` so a mistyped variable name is
 * a compile error. Otherwise it would fail silently in the worst possible
 * direction: an unrecognized name reads as unset, so the routes would simply
 * never register, and the symptom would be a 404 that looks exactly like a
 * deployment that deliberately opted out.
 *
 * @param envVar - The boot-time gate for this router.
 * @param register - Registers the router's routes. Called at most once.
 */
export function registerRoutesIfEnabled(
  envVar: CoverageRouteGateEnvVar,
  register: () => void,
): void {
  if (process.env[envVar] === 'true') {
    register();
  }
}
