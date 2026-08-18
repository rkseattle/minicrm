/**
 * The single definition of what counts as a work-item ID in a comment, and what is
 * exempt. Imported by both enforcers so they cannot disagree:
 *
 *   - eslint-plugins/no-work-item-id-in-comment.mjs — lints .ts/.tsx/.mjs/.cjs/.js
 *   - scripts/strip-work-item-ids.ts — covers db/migrations and qa/migrations,
 *     which eslint.config.mjs ignores, and does the removal pass
 *
 * Shared rather than hand-synced deliberately. This repo has twice been bitten by
 * copies of a rule drifting apart — see qa/scripts/check-sha-pattern-parity.sh and
 * shared/testing/testStackDbPort.ts, where hand-synced copies drifted into a bypass
 * that reached the dev database. Those copies exist because their workspaces cannot
 * share a runtime import; these two can, so they do.
 *
 * Kept dependency-free (no node built-ins, no packages) so an ESLint plugin loaded
 * at config time and a tsx script can both import it.
 */

/**
 * A work-item ID, optionally carrying the `-ok` suffix. The suffix is captured here
 * rather than excluded so callers can tell a suppression marker from a reference and
 * filter per occurrence.
 */
export const WORK_ITEM_ID = /\b(?:MINCRM|LAR|MININT)-\d+(?:-ok)?\b/g;

/**
 * A suppression marker, anchored so it matches a whole token rather than a prefix.
 * `qa/scripts/check-e2e-cleanup.sh` and `check-e2e-beforeall.sh` match these strings
 * literally, which makes the spelling an API: removing one breaks a live CI guard.
 */
export const SUPPRESSION_MARKER = /^(?:MINCRM|LAR|MININT)-\d+-ok$/;

/**
 * A real `@openapi` block opens with the tag alone on its line, which is what
 * swagger-jsdoc requires before it will read the YAML beneath. A docblock that
 * merely mentions "@openapi JSDoc" in prose is ordinary commentary and stays in
 * scope — matching the tag anywhere let file headers in routes/sso.ts, routes/teams.ts
 * and routes/mfa.ts exempt every ID beneath them.
 */
export const OPENAPI_BLOCK = /^\s*\*?\s*@openapi\s*$/m;

/** Whole-comment exemption. Only `@openapi` qualifies; `-ok` is per-occurrence. */
export function isExemptComment(commentValue) {
  return OPENAPI_BLOCK.test(commentValue);
}

/** Reportable IDs in a comment: every match that is not itself a suppression marker. */
export function reportableWorkItemIds(commentValue) {
  return (commentValue.match(WORK_ITEM_ID) ?? []).filter((id) => !SUPPRESSION_MARKER.test(id));
}
