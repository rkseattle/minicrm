/**
 * Pure parser for the test stack's recorded GIT_COMMIT_SHA. (MINCRM-688)
 *
 * Split out of scripts/pre-push-tia.ts so the parsing has a test runner:
 * root `scripts/` is covered by tsconfig.scripts.json for typecheck ONLY —
 * `npm run unit_test` runs the server/client/coverage-dashboard workspaces and
 * Playwright's testDir is qa/e2e/tests, so nothing executes a spec placed next
 * to that script. qa/scripts/**\/*.ts is already in the framework-spec runner's
 * scope (see qa/e2e/tests/framework/), which makes this the closest home that
 * costs no new build wiring.
 *
 * The subprocess call deliberately stays in pre-push-tia.ts. Only the parse
 * lives here, so these tests exercise real logic rather than a mock of
 * execFileSync.
 */

/** Prefix matched and stripped when scanning `docker inspect`'s env output. */
export const GIT_COMMIT_SHA_ENV_PREFIX = 'GIT_COMMIT_SHA=';

/**
 * What the test-server container has for GIT_COMMIT_SHA.
 *
 * `empty` is kept distinct from `unreadable` on purpose: an empty value is the
 * defect this ticket names (docker-compose.test.yml's `${GIT_COMMIT_SHA:-}`
 * default, when the operator never exported the variable), and it means every
 * dump the stack produces is tagged 'unknown'. Collapsing it into "could not
 * check" would hide precisely the condition worth reporting.
 */
export type ContainerCommitSha =
  { kind: 'present'; value: string } | { kind: 'empty' } | { kind: 'unreadable' };

/**
 * Parses the output of
 *   docker inspect <name> --format '{{.State.Running}}\n{{range .Config.Env}}{{println .}}{{end}}'
 *
 * Returns `unreadable` for a container that is not running. `docker inspect`
 * succeeds for any container that EXISTS — created, exited, dead — and returns
 * its full creation-time config, but a stopped stack produces no coverage
 * dumps at all, so reporting its SHA as stale would be a claim about a run
 * that cannot happen.
 */
export function parseContainerCommitSha(raw: string): ContainerCommitSha {
  const [runningLine, ...envLines] = raw.split('\n');
  if (runningLine?.trim() !== 'true') return { kind: 'unreadable' };

  // Scans BACKWARDS, not forwards: `{{println .}}` emits one line per env var,
  // but a variable whose own VALUE contains a newline followed by
  // "GIT_COMMIT_SHA=..." is indistinguishable from a real entry and would win a
  // forward scan. Docker appends the real environment in declaration order, and
  // docker-compose.test.yml declares GIT_COMMIT_SHA itself, so the last match
  // cannot be shadowed by an earlier variable's embedded newline. A manual loop
  // rather than Array.findLast, which needs an ES2023 lib this workspace does
  // not target.
  let line: string | undefined;
  for (let i = envLines.length - 1; i >= 0; i -= 1) {
    const entry = envLines[i];
    if (entry !== undefined && entry.startsWith(GIT_COMMIT_SHA_ENV_PREFIX)) {
      line = entry;
      break;
    }
  }
  if (line === undefined) return { kind: 'unreadable' };

  const value = line.slice(GIT_COMMIT_SHA_ENV_PREFIX.length).trim();
  return value ? { kind: 'present', value } : { kind: 'empty' };
}
