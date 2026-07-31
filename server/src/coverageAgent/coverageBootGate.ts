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
 * Whether a coverage router's boot gate is open — the single definition of
 * what "enabled" means for these vars.
 *
 * Exported because `registerRoutesIfEnabled` is not the only consumer:
 * coverageHealthService reports which routers registered, and that report has
 * to agree with what actually happened. Two copies of `=== 'true'` could drift
 * — a report claiming a router is live when it registered nothing is worse
 * than no report at all — so both go through here.
 *
 * Typed to the union above rather than `string` so a mistyped variable name is
 * a compile error. Otherwise it fails silently in the worst direction: an
 * unrecognized name reads as unset, the routes never register, and the symptom
 * is a 404 indistinguishable from a deployment that deliberately opted out.
 *
 * Exact string equality, not a truthiness or case-insensitive check: 'TRUE'
 * and '1' are NOT enabled. Deliberate, and matching every other coverage env
 * read in the repo — a gate that guesses at intent is a gate an operator
 * cannot reason about.
 */
export function isRouteGateEnabled(envVar: CoverageRouteGateEnvVar): boolean {
  return process.env[envVar] === 'true';
}

/**
 * What each gate read AT MODULE LOAD — the values the route modules actually
 * registered against.
 *
 * Snapshotted rather than re-read, because "did this router register?" is a
 * question about the past. Route registration happens once, during module
 * evaluation; `process.env` can be mutated afterwards, and a later read would
 * answer with the current value while the routes stay as they were registered.
 * That divergence is not hypothetical — coverageRouteGating.test.ts and
 * coverageHealthRouteGating.test.ts both boot an app with the gates deleted and
 * then restore the environment, so a live read there reports every router
 * enabled while every one of their paths 404s.
 *
 * Consumed by coverageHealthService, whose whole job is to tell an operator
 * which routers are live. A report that can disagree with reality is worse than
 * no report, so it reads this snapshot.
 *
 * Evaluation order is safe: every route module imports this one, so this
 * initializer runs before any registerRoutesIfEnabled call.
 */
export const COVERAGE_ROUTE_GATES_AT_BOOT: Readonly<Record<CoverageRouteGateEnvVar, boolean>> =
  Object.freeze(
    Object.fromEntries(
      COVERAGE_ROUTE_GATE_ENV_VARS.map((key) => [key, isRouteGateEnabled(key)]),
    ) as Record<CoverageRouteGateEnvVar, boolean>,
  );

/**
 * Runs `register` only when `envVar`'s gate is open at the moment of the call —
 * which, for every caller, is module evaluation.
 *
 * @param envVar - The boot-time gate for this router.
 * @param register - Registers the router's routes. Called at most once.
 */
export function registerRoutesIfEnabled(
  envVar: CoverageRouteGateEnvVar,
  register: () => void,
): void {
  if (isRouteGateEnabled(envVar)) {
    register();
  }
}
