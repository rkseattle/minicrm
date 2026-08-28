/**
 * Whether a selected spec file can ever be reconciled against what ran.
 *
 * WHY THIS LIVES IN shared/ RATHER THAN IN EITHER CALLER
 *
 * Two sides need this identical rule and neither can import the other:
 *
 *   - `qa/scripts/targeted-run-plan.ts` decides which Playwright invocations to
 *     plan for a selection.
 *   - `server/src/scripts/verify-test-attestation.ts` decides whether every
 *     required file actually ran, and is compiled into the server image, so it
 *     cannot import from `qa/` — `server/Dockerfile` copies only `server/` and
 *     `shared/`, and an input outside those shifts tsc's inferred rootDir out
 *     from under its hardcoded COPY/CMD paths. CI never builds that image.
 *
 * The two must agree or a push fails on a file nothing could ever have run.
 * Same bar as testStackDbPort.ts: two guards, one rule, drift is dangerous.
 *
 * TWO INDEPENDENT REASONS A FILE CANNOT BE RECONCILED
 *
 * 1. No planned invocation selects it. Playwright greps the file's path plus
 *    its titles, so a path matching the non-serial invert expression is
 *    excluded by path alone, whatever its titles say.
 *
 * 2. It emits no coverage dump. Attestation builds the "did it run" set from
 *    coverage dumps, and dump recording lives inside the `page` fixture. A spec
 *    that never destructures `page` is lazy-skipped by Playwright, emits
 *    nothing, and so cannot appear in that set — it passes, and is reported
 *    missing. Ten functional specs are page-less today, one of them in the
 *    always-run baseline, which is why this is a live failure and not a
 *    hypothetical one.
 *
 * Keep this file dependency-free (no zod, no Node built-ins, no I/O) so every
 * workspace can import it.
 */
/**
 * Titles and paths the non-serial invocation excludes.
 *
 * The one true value: `qa/scripts/targeted-run-plan.ts` re-exports it, and
 * `qa/scripts/check-grep-invert-parity.sh` pins every caller against this
 * declaration, so CI's literal and this constant cannot drift apart.
 */
export const NON_SERIAL_GREP_INVERT = 'visual-regression|serial';
/** Playwright's testDir, relative to the repo root. */
const TEST_DIR_PREFIX = 'qa/e2e/tests/';
/**
 * True when the non-serial invocation's `--grep-invert` excludes this file by
 * its PATH alone, regardless of the titles inside it.
 *
 * visual-regression.spec.ts is the case that matters: not one of its titles
 * contains the string, so a title-only check calls its tests non-serial, plans
 * that half, and Playwright then selects zero.
 */
export function isPathExcludedFromNonSerial(specFile) {
  const normalized = specFile.replace(/\\/g, '/');
  const index = normalized.lastIndexOf(TEST_DIR_PREFIX);
  // lastIndexOf and slice to the testDir-relative form: a checkout living under
  // a directory containing the excluded term must not exclude the whole suite.
  const grepped = index === -1 ? normalized : normalized.slice(index + TEST_DIR_PREFIX.length);
  return new RegExp(NON_SERIAL_GREP_INVERT).test(grepped);
}
/** Source with comments removed, so prose mentioning a fixture cannot pass for using one. */
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const index = line.indexOf('//');
      return index === -1 ? line : line.slice(0, index);
    })
    .join('\n');
}
/**
 * True when a spec destructures Playwright's `page` fixture, and so can emit the
 * coverage dump attestation reconciles against.
 *
 * Requires `page` in a DESTRUCTURING position inside an async callback, not
 * anywhere in the file. A bare word search reports prose describing locators and
 * a `result.page` pagination field as fixture use, and both exist in this suite —
 * one of them in the spec this ticket annotates, where a wrong `true` blocks the
 * push it was meant to enable.
 *
 * A spec reaching `page` only through a helper reads as no use here, and so is
 * EXEMPTED from reconciliation rather than merely reported — the exemption is
 * the permissive direction, and it is why the exempt set is asserted against an
 * explicit list rather than a loose band: growth must be a deliberate edit.
 */
export function emitsCoverageDump(specSource) {
  return /async\s*\(\s*\{[^}]*\bpage\b[^}]*\}/.test(withoutComments(specSource));
}
/**
 * Source to assume when a spec cannot be read.
 *
 * Named rather than inlined at the call site: it must satisfy emitsCoverageDump,
 * so tightening that predicate without updating this would silently invert the
 * fail-safe from "reconcilable" to "exempt".
 */
export const UNREADABLE_SPEC_FALLBACK_SOURCE = 'test("", async ({ page }) => {});';
/**
 * True when a required spec file could actually have run and been recorded.
 *
 * A file failing this is excluded from attestation's shortfall rather than
 * counted as missing: it passed, and nothing it could have done would have made
 * it appear in the ran-files set.
 */
export function isReconcilable(specFile, specSource) {
  return !isPathExcludedFromNonSerial(specFile) && emitsCoverageDump(specSource);
}
