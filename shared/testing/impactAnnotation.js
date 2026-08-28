/**
 * The `impacts` spec annotation type, in one place.
 *
 * WHY THIS LIVES IN shared/ RATHER THAN BESIDE EITHER SIDE
 *
 * Two sides need this identical string and neither can import the other:
 *
 *   - A Playwright spec under `qa/e2e/tests/` writes it, declaring the source
 *     paths whose change should select that spec.
 *   - `server/src/coverageAgent/testSelection/` reads it, parsing spec source
 *     statically during selection — which runs before any test does, so a
 *     runtime annotation push would be invisible to it.
 *
 * `server/src` cannot import from `qa/`: `server/tsconfig.json` includes only
 * `src/**` with paths reaching `../shared/*`, and `server/Dockerfile` copies
 * only `server/` and `shared/`, so an input outside those shifts tsc's inferred
 * rootDir out from under the Dockerfile's hardcoded COPY/CMD paths. CI never
 * builds that image, so none of it would be caught there.
 *
 * DOCUMENTED EXCEPTION to CLAUDE.md's description of `shared/` as Zod schemas
 * used by both client and server, on the same narrow bar `testStackDbPort.ts`
 * meets: two sides need one rule, neither can import the other, and drift is
 * dangerous rather than untidy. A literal copied into both sides would let a
 * rename disable selection for every annotated spec with all of them still
 * passing — the annotation would simply never match, and a spec that silently
 * stops being selected looks exactly like one correctly not selected.
 *
 * Keep this file dependency-free (no zod, no Node built-ins, no I/O) so every
 * workspace can import it.
 */
/**
 * Annotation type declaring source paths whose change must select this spec.
 *
 * For blast radius a spec's own location does not imply: a spec under
 * `data-integrity/` can guard cascade behavior defined by `db/migrations/**`,
 * which no directory convention or single manifest entry can express.
 */
export const IMPACTS_ANNOTATION = 'impacts';
/**
 * The name specs import IMPACTS_ANNOTATION by.
 *
 * Declared beside the constant so the static reader resolves an import against
 * one source of truth: a rename that updated only one of the two would leave
 * every annotated spec reading as unannotated.
 */
export const IMPACTS_ANNOTATION_EXPORT_NAME = 'IMPACTS_ANNOTATION';
