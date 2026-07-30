/**
 * Pure parser for the test stack's recorded GIT_COMMIT_SHA. (MINCRM-688)
 *
 * Split out of scripts/pre-push-tia.ts so the parsing has a test runner:
 * root `scripts/` is covered by tsconfig.scripts.json for typecheck ONLY —
 * `npm run unit_test` runs the server/client/coverage-dashboard workspaces and
 * Playwright's testDir is qa/e2e/tests, so nothing executes a spec placed next
 * to that script. Specs under qa/e2e/tests/framework/ can import from here, and
 * qa/scripts is already in CI's `qa` paths filter, which makes this the closest
 * home that costs no new build wiring.
 *
 * Note this file is NOT counted by the c8 gate: qa/package.json's
 * test:framework:coverage restricts --include to e2e/framework/**, so the
 * coverage percentage is unaffected either way. The reason to put it here is
 * that its tests RUN, not that they score.
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
 *   docker inspect <name> --format '{{json .State.Running}}\n{{json .Config.Env}}'
 *
 * JSON, deliberately, NOT `{{range .Config.Env}}{{println .}}{{end}}`: that
 * form emits one line per variable, so a variable whose own VALUE contains a
 * newline followed by "GIT_COMMIT_SHA=..." is indistinguishable from a real
 * entry. Neither a forward nor a backward scan fixes that — docker-compose.
 * test.yml declares GIT_COMMIT_SHA in the MIDDLE of its environment block,
 * with JWT_SECRET, CORS_ORIGIN, NODE_ENCRYPTION_KEY and the SMTP_* values
 * (several sourced from .env) after it, so a decoy can be positioned on either
 * side of the real entry. JSON preserves the array boundaries, which makes the
 * ambiguity structurally impossible rather than merely unlikely.
 *
 * Returns `unreadable` for a container that is not running. `docker inspect`
 * succeeds for any container that EXISTS — created, exited, dead — and returns
 * its full creation-time config, but a stopped stack produces no coverage
 * dumps at all, so reporting its SHA as stale would be a claim about a run
 * that cannot happen.
 */
export function parseContainerCommitSha(raw: string): ContainerCommitSha {
  const newlineIndex = raw.indexOf('\n');
  if (newlineIndex === -1) return { kind: 'unreadable' };

  const runningRaw = raw.slice(0, newlineIndex).trim();
  const envRaw = raw.slice(newlineIndex + 1).trim();
  if (runningRaw !== 'true') return { kind: 'unreadable' };

  let envEntries: unknown;
  try {
    envEntries = JSON.parse(envRaw);
  } catch {
    return { kind: 'unreadable' };
  }
  if (!Array.isArray(envEntries)) return { kind: 'unreadable' };

  const line = envEntries.find(
    (entry): entry is string =>
      typeof entry === 'string' && entry.startsWith(GIT_COMMIT_SHA_ENV_PREFIX),
  );
  if (line === undefined) return { kind: 'unreadable' };

  const value = line.slice(GIT_COMMIT_SHA_ENV_PREFIX.length).trim();
  return value ? { kind: 'present', value } : { kind: 'empty' };
}
