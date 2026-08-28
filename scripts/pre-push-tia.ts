/**
 * pre-push-tia.ts — Local pre-push hook body: run the TIA-selected subset
 * plus the always-run baseline before allowing a push.
 *
 * Invoked by .husky/pre-push. Resolves the local diff (current branch vs.
 * main) to affected tests via server/src/scripts/select-tests.ts — the
 * SAME script the CI select-mode job calls, so local and CI
 * selection can never diverge (both are one code path, not two hand-synced
 * implementations).
 *
 * Modes:
 *   - targeted: runs only the selected spec files via Playwright, scoped to
 *     this workspace's qa/e2e test runner.
 *   - full-suite: the safety net decided a partial run isn't safe for this
 *     diff (unmapped changes, low confidence, a widen-always dependency
 *     file, or a stale/missing map) — falls back to the full @functional
 *     suite (non-serial then serial, two scoped Playwright invocations —
 *     see runFullSuiteFallbackAndAttest below), matching
 *     .claude/gates/e2e-run.md's own documented full-suite procedure.
 *     "Everything" means every @functional-tagged test, never literally
 *     every spec Playwright can discover (that included qa/e2e/framework/'s
 *     own self-tests until this was fixed).
 *
 * After the run, server/src/scripts/verify-test-attestation.ts
 * — the SAME shared gate CI's own attestation step uses — verifies
 * results.xml is all-passing AND (for targeted mode) that every selected
 * spec file is attributed as having actually run, via session attribution
 * bound to the local HEAD SHA. A failed attestation blocks the push exactly
 * like a failed test run would — this is what makes "the selected subset
 * ran" a provable claim instead of merely an attempted one.
 *
 * Escape hatch: SKIP_TIA_PREPUSH=1 git push skips the TIA-selected E2E run.
 * Typecheck and the audit gate still run — they execute before the bypass is
 * read, being seconds of work that no E2E run would have covered.
 * Every bypass is appended to a local, gitignored audit log
 * (.git/tia-prepush-bypass.log) with a timestamp and the branch being
 * pushed — visible locally, never uploaded, never blocking (a missing log
 * write is not fatal).
 */

import { execFileSync, execSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Pure parse only — the execFileSync call stays here. Lives under qa/scripts/
// because root scripts/ has no test runner; see that module's own docblock.
import {
  parseContainerCommitSha,
  type ContainerCommitSha,
} from '../qa/scripts/container-commit-sha.js';
// Same arrangement, same reason: the resolution rule needs a test runner, which
// root scripts/ does not have. See that module's docblock.
import {
  resolveTestStackDbEnv,
  parseEnvFileContents,
  pickDbCoordinates,
  DevDatabaseRefusedError,
  DEV_DB_PORT,
  TEST_DB_PORT,
  type TestStackDbEnv,
  type TestStackDbSource,
} from '../qa/scripts/test-stack-db-env.js';
// Same arrangement again: the decision of WHICH halves to run is a pure rule
// that needs a test runner, and root scripts/ has none.
import {
  planTargetedInvocations,
  NON_SERIAL_GREP_INVERT,
  SERIAL_GREP,
} from '../qa/scripts/targeted-run-plan.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const BYPASS_LOG_PATH = resolve(REPO_ROOT, '.git', 'tia-prepush-bypass.log');

/**
 * Database coordinates as they existed in the REAL environment, captured before
 * any .env file is loaded.
 *
 * resolveTestStackDbEnv() consults this rather than process.env, because after
 * loadRootEnv() the two are not the same thing: root .env legitimately names the
 * DEV database (DB_PORT=5432), and it is loaded for its secrets, not its
 * database coordinates (see loadRootEnv's docblock). Reading the post-load value
 * made the dev-port guard fire on a perfectly healthy setup — every push was
 * refused with "DB_PORT=5432 is the dev database" while the test stack was up on
 * 5433, because first-write-wins meant qa/e2e/.env's DB_PORT=5433 could never
 * override root's.
 *
 * Snapshotting the pre-file environment keeps the guard's real contract — an
 * operator who deliberately EXPORTS DB_PORT=5432 is still refused outright,
 * which is the case it exists for — while a value that merely came from a file
 * this hook chose to load cannot trigger it.
 */
const EXPORTED_DB_PORT = process.env.DB_PORT;
const EXPORTED_DB_HOST = process.env.DB_HOST;
const EXPORTED_DB_USER = process.env.DB_USER;
const EXPORTED_DB_PASSWORD = process.env.DB_PASSWORD;

/**
 * Reads the DB coordinates AND credentials straight out of qa/e2e/.env, bypassing process.env.
 *
 * Necessary because by the time anything resolves coordinates, loadRootEnv() has
 * flattened root .env and qa/e2e/.env into one namespace where root's DEV values
 * win. Going back to the file is what lets a developer's non-default test-stack
 * host/port — the documented way to run the stack somewhere other than
 * localhost:5433 — still take effect, without root .env's dev port ever being
 * mistaken for one. Missing file or missing keys yield {}, so the resolver falls
 * through to its defaults.
 */
function readE2eEnvFileDbSource(): TestStackDbSource {
  let contents: string;
  try {
    contents = readFileSync(resolve(REPO_ROOT, 'qa', 'e2e', '.env'), 'utf8');
  } catch {
    return {};
  }
  return pickDbCoordinates(parseEnvFileContents(contents));
}

// Same "never overwrite an already-set var" pattern as scripts/e2e-setup.ts —
// so a caller's own explicit env (e.g. CI, or a developer's shell export)
// always wins over the .env file's defaults.
//
// Parsing and the precedence rule both live in qa/scripts/test-stack-db-env.ts
// so they have a test runner. This function is the only thing that mutates
// process.env, and it delegates rather than reimplementing — an earlier version
// of this fix kept a tested COPY of the rule here, which would have gone on
// passing while this loop drifted away from it.
function loadEnvFile(path: string): void {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    return; // Optional — CI supplies vars via the environment directly.
  }

  const parsed = parseEnvFileContents(contents);
  // process.env as the pre-existing layer: anything already set (a real export,
  // or an earlier file) wins, which is what makes this first-write-wins.
  for (const [key, value] of Object.entries(parsed)) {
    if (!(key in process.env)) process.env[key] = value;
  }
}

/**
 * Loads root .env AND qa/e2e/.env — this hook's own runPlaywright() below
 * shells out to `npm run test` in qa/, the exact same E2E entrypoint
 * CLAUDE.md's own documented command always runs with
 * `env $(cat qa/e2e/.env ...)` sourced first (E2E_ADMIN_EMAIL/PASSWORD,
 * E2E_API_URL, AUTH_COOKIE_NAME etc. all live only in qa/e2e/.env, never
 * root .env — confirmed by grepping both files). Without this, a full-suite fallback
 * run from this hook silently no-ops (globalSetup skips the admin login
 * and writes an empty storageState, then Playwright reports zero tests
 * collected) instead of actually gating the push — found while verifying
 * this push's own attestation fix actually ran real tests, not by
 * inspection alone.
 *
 * Root .env is loaded for its secrets, NOT its database coordinates: it names the DEV
 * database (DB_NAME=minicrm, COVERAGE_DB_NAME=minicrm_coverage) on port 5432. Every
 * subprocess below is given testStackDbEnv() explicitly so those values can never
 * reach a child.
 *
 * PRECEDENCE, and why it does not matter for DB coordinates. loadEnvFile is
 * first-write-wins, so root .env shadows qa/e2e/.env for any key both define.
 * An earlier version of this comment said "there are none today" — that is no
 * longer true: qa/e2e/.env now defines DB_PORT=5433, DB_NAME=minicrm_e2e and
 * COVERAGE_DB_NAME=minicrm_coverage_e2e, all of which root .env also defines
 * with DEV values that therefore win.
 *
 * That shadowing is harmless BECAUSE nothing downstream reads DB coordinates
 * out of process.env: testStackDbEnv() hardcodes the database names and takes
 * port/host from EXPORTED_DB_PORT/EXPORTED_DB_HOST, the pre-file snapshot. Do
 * not "fix" the shadowing by reordering these two loads or by making the second
 * one override — qa/e2e/.env would then leak its DB_NAME into this process, and
 * the guard's meaning would change from "an operator exported the dev port" to
 * "some file mentioned it". Fix the reader, not the loader.
 */
function loadRootEnv(): void {
  loadEnvFile(resolve(REPO_ROOT, '.env'));
  loadEnvFile(resolve(REPO_ROOT, 'qa', 'e2e', '.env'));
}

/**
 * Database coordinates for every subprocess this hook spawns.
 *
 * Applied to ALL of them, not just the four that talk to the coverage database: the
 * Playwright children read DB_NAME/COVERAGE_DB_NAME too (globalSetup's stale-data guard,
 * the coverage ingest/dump path), and inheriting root .env's dev values there is the
 * same leak in a different costume.
 *
 * COVERAGE_DB_NAME must be minicrm_coverage_e2e, not minicrm_coverage_test: E2E runs
 * deposit coverage into the _e2e database (docker-compose.test.yml), so pointing TIA at
 * the unit-test database would find zero mappings and silently degrade every push to a
 * full-suite run — defeating the point of test selection. .claude/gates/e2e-run.md's own
 * dump:coverage-map invocation passes the same value.
 */
/**
 * Resolves once at first use, following scripts/e2e-setup.ts's resolve-then-reject
 * shape rather than blindly overriding: an operator running the test stack on a
 * non-default port can still export DB_PORT, but the dev port is refused outright
 * because every child below reads or writes test data.
 *
 * "Export" is meant literally — this passes EXPORTED_DB_PORT (the environment as
 * it was BEFORE any .env file was loaded), not process.env. Reading process.env
 * here conflated a deliberate export with root .env's dev coordinates, which this
 * hook loads for its secrets and explicitly does not want as DB coordinates, and
 * refused every push on a healthy setup.
 *
 * The rule itself lives in qa/scripts/test-stack-db-env.ts so it has a test
 * runner — root scripts/ has none. Only the reporting and the exit stay here.
 */
function resolveTestStackDbEnvOrExit(): TestStackDbEnv {
  // qa/e2e/.env is re-read directly rather than consulted through process.env:
  // by now root .env has already been flattened in and would shadow it, which is
  // the whole defect. Reading the file names its values as coming from the TEST
  // stack's own config, so a developer's non-default host/port there still
  // reaches every child.
  const e2eEnvFile = readE2eEnvFileDbSource();
  try {
    return resolveTestStackDbEnv(
      {
        DB_PORT: EXPORTED_DB_PORT,
        DB_HOST: EXPORTED_DB_HOST,
        DB_USER: EXPORTED_DB_USER,
        DB_PASSWORD: EXPORTED_DB_PASSWORD,
      },
      e2eEnvFile,
    );
  } catch (err) {
    if (err instanceof DevDatabaseRefusedError) {
      console.error(
        `[pre-push:tia] REFUSING TO RUN: DB_PORT=${DEV_DB_PORT} is the dev database.\n` +
          '  This hook runs E2E suites and rewrites coverage/TIA data. The test stack\n' +
          `  listens on ${TEST_DB_PORT}: docker compose -f docker-compose.test.yml up -d`,
      );
      process.exit(1);
    }
    throw err;
  }
}

/**
 * Lazily memoized: module-scope evaluation would run BEFORE main()'s loadRootEnv() call
 * and so never observe DB_PORT/DB_HOST from the .env files, silently resolving defaults
 * instead of the developer's configuration.
 */
let cachedTestStackDbEnv: TestStackDbEnv | undefined;
function testStackDbEnv(): TestStackDbEnv {
  cachedTestStackDbEnv ??= resolveTestStackDbEnvOrExit();
  return cachedTestStackDbEnv;
}

function currentBranchName(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function resolveHeadSha(): string {
  return execSync('git rev-parse HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

/** Resolves main's own tip SHA — the coverage_test_links load target, matching select-tests.ts's own baseSha convention (mapping lookups are always scoped to the diff's BASE, not HEAD — see select-tests.ts's module docblock). Falls back to the literal ref "main" if rev-parse fails (e.g. no local main tracking branch yet) — load-coverage-map.ts still works with a symbolic ref, it just can't be used consistently as a cache key across runs. */
function resolveMainSha(): string {
  try {
    return execSync('git rev-parse main', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'main';
  }
}

function logBypass(reason: string): void {
  const line = `${new Date().toISOString()} branch=${currentBranchName()} reason=${reason}\n`;
  try {
    appendFileSync(BYPASS_LOG_PATH, line, 'utf8');
  } catch {
    // A failed audit-log write must never itself block the push.
  }
}

interface SelectTestsResult {
  mode: 'targeted' | 'full-suite';
  specFiles: string[];
  unresolvedTestIds: string[];
  fallbackReasons: string[];
  /** Tier-2 impact resolution, also unioned into specFiles. */
  scopeResolvedSpecFiles: string[];
  impactResolutionError: string | null;
  rationale: string[];
}

/**
 * Runs server/src/scripts/create-coverage-db.ts — ensures the coverage
 * database exists before anything below queries it. Normally a no-op: the
 * local docker-compose app server already auto-provisions this on every
 * boot (server.ts's own startup sequence), which is an implicit
 * prerequisite for local E2E work anyway. Only matters for a fresh
 * checkout that has never started that server — found as a real gap in
 * CI's tia-selection job (no server ever boots there either), fixed there
 * and mirrored here for the same reason. Best-effort, same as
 * runLoadCoverageMap below: a failed provisioning attempt must not block
 * the push.
 */
function runCreateCoverageDb(): void {
  try {
    execFileSync('npx', ['tsx', 'src/scripts/create-coverage-db.ts'], {
      cwd: resolve(REPO_ROOT, 'server'),
      env: { ...process.env, ...testStackDbEnv(), LOG_DESTINATION: 'stderr' },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  } catch (err) {
    console.error(
      `[pre-push-tia] WARN: provisioning the coverage database failed (${err instanceof Error ? err.message : String(err)}) — continuing.`,
    );
  }
}

/**
 * Runs server/src/scripts/load-coverage-map.ts (pr-tia-8) — re-populates
 * coverage_test_links from the committed qa/coverage-map.jsonl before
 * selection queries it. A fresh checkout's local coverageDb has nothing in
 * it; an established dev machine's already has real accumulated data, but
 * re-loading is a harmless, idempotent refresh either way (see
 * loadCoverageTestLinksForCommit's own "replace, not upsert" semantics).
 * Best-effort for INFRASTRUCTURE failures — a local database that is down must
 * not block a push, since selection just falls back to whatever the local DB
 * already had (possibly nothing, which degrades to the unmapped-changes safety
 * net).
 *
 * NOT best-effort for a corrupt committed map. That is a real defect in a
 * shared artifact, and silently continuing is exactly the swallow this ticket
 * removed one layer down: the developer would push having selected tests from
 * data they never noticed was unusable. The loader signals the difference with
 * a distinct exit code so the two can be told apart.
 */
/**
 * Exit code load-coverage-map.ts uses for a corrupt committed map, as opposed
 * to an infrastructure failure.
 *
 * Declared here rather than imported: this root script would otherwise pull a
 * module that imports a pg.Pool just to read one integer. The value is pinned
 * against its definition by check-coverage-map-exit-code-parity.sh.
 */
const EXIT_MAP_UNREADABLE = 2;

function runLoadCoverageMap(sha: string): void {
  try {
    execFileSync('npx', ['tsx', 'src/scripts/load-coverage-map.ts', `--sha=${sha}`], {
      cwd: resolve(REPO_ROOT, 'server'),
      env: { ...process.env, ...testStackDbEnv(), LOG_DESTINATION: 'stderr' },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === EXIT_MAP_UNREADABLE) {
      // Loud, and blocking: the committed map is corrupt or truncated for
      // everyone, not just this machine. The loader has already printed which
      // line and why.
      throw new Error(
        'The committed coverage map is present but unusable (see the error above). ' +
          'This is a defect in a shared artifact — re-run tia-record-mode.yml to ' +
          'regenerate it rather than pushing against unusable mapping data.',
      );
    }
    console.error(
      `[pre-push-tia] WARN: loading the committed coverage map failed (${err instanceof Error ? err.message : String(err)}) — continuing with whatever local data is already present.`,
    );
  }
}

/** Runs server/src/scripts/select-tests.ts and parses its stdout JSON contract. Throws on any non-selection failure (DB unreachable, git diff failure) — callers decide whether that should widen to full-suite or hard-fail. */
function runSelectTests(baseRef: string, headRef: string): SelectTestsResult {
  const stdout = execFileSync(
    'npx',
    ['tsx', 'src/scripts/select-tests.ts', `--base=${baseRef}`, `--head=${headRef}`],
    {
      cwd: resolve(REPO_ROOT, 'server'),
      encoding: 'utf8',
      env: { ...process.env, ...testStackDbEnv(), LOG_DESTINATION: 'stderr' },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  return JSON.parse(stdout) as SelectTestsResult;
}

/**
 * Hand-synced mirror of docker-compose.test.yml's `container_name` for the
 * server service. Renaming it there without updating this makes the staleness
 * check below a permanent no-op — it would take the 'unreadable' branch
 * forever and stay silent, which is indistinguishable from "no stack running".
 */
const TEST_SERVER_CONTAINER = 'minicrm-test-server';

/**
 * Reads GIT_COMMIT_SHA out of the running test-server container.
 *
 * `docker inspect`, deliberately, NOT `docker compose exec printenv`:
 * `printenv` exits non-zero for an EMPTY variable, so it cannot distinguish
 * "empty" from "command failed" — and per the type above, that distinction is
 * one this check reports on. `docker inspect` reads the creation-time config,
 * needs no `-f` file and no awareness of the `minicrm-test` compose project
 * name, and does not require the container to be responsive.
 */
function readContainerCommitSha(): ContainerCommitSha {
  try {
    // .State.Running is requested alongside the env so parseContainerCommitSha
    // can reject a stopped container, and the env is requested as JSON so a
    // value containing a newline cannot masquerade as its own entry — see that
    // function's docblock.
    const raw = execFileSync(
      'docker',
      ['inspect', TEST_SERVER_CONTAINER, '--format', '{{.State.Running}}\n{{json .Config.Env}}'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return parseContainerCommitSha(raw);
  } catch {
    // Docker absent, daemon down, or no such container.
    return { kind: 'unreadable' };
  }
}

/**
 * Warns when the running test stack was started against a different commit
 * than the one being pushed.
 *
 * The container reads GIT_COMMIT_SHA once, at `docker compose up` time, and
 * tags every coverage DUMP with it (coverageConfig.ts). Nothing re-reads it
 * afterwards, so a stack that outlives a branch switch keeps stamping dumps
 * with a stale SHA. This script does not restart the stack — doing so on every
 * push would mean an image rebuild and a re-seed, which is a large and
 * surprising side effect for a pre-push hook — so it reports instead.
 *
 * Deliberately a warning and not a hard failure. A stale dump SHA cannot fail
 * a test and cannot fail the attestation gate, which joins only on session
 * build_sha; its blast radius is a coverage map regenerated from those dumps
 * being keyed to the wrong commit, and that only happens through the separate,
 * manual dump:coverage-map procedure. Blocking every push over a cache key
 * would cost far more than it protects. Compare server.ts's own SMTP_FROM
 * advisory, which warns for a degraded-but-functional configuration.
 *
 * Note what this MEANS for the two SHAs after this change: on a stale stack,
 * session build_sha is now correct (threaded above) while dump commit_sha
 * stays stale, so the two can disagree where previously they were wrong
 * together. That divergence is exactly what this warning exists to surface.
 */
function warnIfTestStackShaIsStale(headSha: string): void {
  const container = readContainerCommitSha();

  // Verbatim the sequence in .claude/gates/e2e-run.md — `build` then `up`,
  // no --force-recreate. The build step is not optional: server/Dockerfile
  // copies source in rather than bind-mounting it, so recreating alone would
  // realign the SHA while still running stale server code. Emitting anything
  // other than the documented commands would leave two divergent procedures
  // in circulation.
  const realign =
    'export GIT_COMMIT_SHA=$(git rev-parse HEAD) && ' +
    'docker compose -f docker-compose.test.yml build server && ' +
    'docker compose -f docker-compose.test.yml up -d server';

  // Recreating the server wipes /app/coverage-dumps, which lives in the
  // container's own filesystem — and those dumps are the very artifacts the
  // stale-SHA warning is about. Say so, or the remedy silently destroys what
  // the warning was protecting (see e2e-run.md's own `docker cp` step).
  const dumpLossCaveat =
    'Note this discards any coverage dumps still in the container — copy them out first ' +
    'if a run you care about has already produced them.';

  if (container.kind === 'unreadable') {
    // Absent, stopped, or unreachable. Not a degraded state — it is the
    // normal one for a docs- or client-only push — so this stays silent
    // rather than prefacing every such push with a notice about a check that
    // had nothing to check. (The plan called for a skip line here; suppressed
    // deliberately after seeing how often this path is the common one.)
    return;
  }

  // console.error for WARN: lines, console.log for informational — the local
  // convention in this file (see runCreateCoverageDb/runLoadCoverageMap).

  if (container.kind === 'empty') {
    console.error(
      `[pre-push-tia] WARN: ${TEST_SERVER_CONTAINER} was started with an EMPTY GIT_COMMIT_SHA, ` +
        "so every coverage dump it produces is tagged 'unknown' and can never match a real " +
        `branch SHA. To fix: ${realign} (see .claude/gates/e2e-run.md). ${dumpLossCaveat}`,
    );
    return;
  }

  if (container.value === headSha) return;

  console.error(
    `[pre-push-tia] WARN: the running test stack was started against ${container.value}, but ` +
      `HEAD is ${headSha}. Coverage DUMPS this stack produces are tagged with the stale SHA, ` +
      'so a coverage map regenerated from them would be keyed to the wrong commit. Coverage ' +
      'SESSIONS and the attestation gate are unaffected — both use HEAD. ' +
      `To realign: ${realign} (see .claude/gates/e2e-run.md). ${dumpLossCaveat}`,
  );
}

/**
 * Builds the environment for a Playwright child process.
 *
 * GIT_COMMIT_SHA is the point of this helper. The QA harness
 * resolves each coverage session's buildSha from it
 * (coverage-session-control-client.ts), and this script already resolves the
 * very same SHA for the attestation gate's --sha (runAttestation below). Those
 * are the two ends of one comparison: the gate queries sessions by build_sha,
 * so if the harness is left to pick its own value the gate can query one SHA
 * while the run recorded another and fail with no-session-attribution on an
 * otherwise correct suite. Passing the resolved SHA explicitly is the local
 * analogue of what tia-record-mode.yml does for CI, where the same
 * steps.resolve-sha output feeds both the suite run and the gate.
 *
 * One helper rather than the same spread inlined at each of this file's three
 * Playwright invocations (runPlaywright, and both halves of
 * runFullSuiteFallbackAndAttest), following testStackDbEnv()'s own precedent.
 */
function playwrightEnv(headSha: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  // GIT_COMMIT_SHA is spread LAST so `extra` cannot override it — that value
  // is the one invariant this helper exists to enforce.
  return { ...process.env, ...testStackDbEnv(), ...extra, GIT_COMMIT_SHA: headSha };
}

/** The merged JUnit file the attestation gate reads. Relative to qa/. The two
 *  per-invocation paths live with the plan in qa/scripts/targeted-run-plan.ts. */
const MERGED_JUNIT = 'e2e/test-results/results.xml';

/**
 * Runs the TIA-selected spec files — as TWO invocations, non-serial then
 * serial, then merges their JUnit output for a single attestation.
 *
 * WHY TWO INVOCATIONS
 * --------------------------------
 * This path used to be one `--grep-invert serial` call with no paired serial
 * run. If TIA selected a spec whose tests are all `@serial` — visibility.spec.ts
 * (9 of 9), and now onboarding.spec.ts (8 of 8) — every test was filtered out,
 * zero tests ran for that file, and the push proceeded. The full-suite fallback
 * had this fixed earlier (see its docblock below) and the fix was
 * never generalized here; the docblock's claim that the targeted path "needs
 * neither this scoping nor this split" is right about the `--grep @functional`
 * SCOPING half and wrong about the serial/non-serial SPLIT half, whose purpose
 * is to ensure serial tests execute somewhere. The two concerns were conflated.
 *
 * WHY ONE ATTESTATION, NOT ONE PER INVOCATION
 * -------------------------------------------
 * The fallback attests after each of its two runs, and mirroring that here
 * would deadlock. verify-test-attestation reconciles run-vs-selection per FILE
 * (`missing-required-tests`), and `ranFiles` comes from coverage-session dumps
 * for the SHA — not from results.xml. A wholly-@serial selected spec contributes
 * no session during the non-serial invocation, so a first attestation would fail
 * for exactly the file this fix exists to run, and the serial invocation would
 * never happen. The fallback only escapes this because it never passes
 * --selection (full-suite short-circuits to {kind:'none'}); targeted mode does.
 * Attesting once, after both runs, asks the question reconciliation actually
 * means: did every selected file run somewhere in this push.
 *
 * WHY PER-INVOCATION OUTPUT PATHS
 * -------------------------------
 * Playwright's junit reporter writes one fixed path (playwright.config.ts's
 * outputFile), so a second invocation would overwrite the first's results.xml
 * rather than merge — the same hazard documented for the fallback below. Both
 * halves of CI's e2e-serial pattern are needed: PLAYWRIGHT_JUNIT_OUTPUT_FILE for
 * the report, and a distinct --output dir because every `playwright test` call
 * clears its outputDir at startup and would otherwise delete the first run's
 * artifacts (ci.yml's own comment on that loop).
 */
function runPlaywright(specFiles: readonly string[], headSha: string): void {
  // Checked here, and in runFullSuiteFallbackAndAttest, rather than once at
  // the top of main(): these are the only points at which a run actually
  // produces coverage dumps, so anywhere earlier would warn that "dumps this
  // stack produces are tagged stale" on paths that produce none (a selection
  // resolving to zero spec files, for instance).
  warnIfTestStackShaIsStale(headSha);

  const qaDir = resolve(REPO_ROOT, 'qa');
  const produced: string[] = [];
  let firstFailure: unknown;

  // Array args via execFileSync — never a shell string — same precedent
  // as every other subprocess call in this file (runLoadCoverageMap,
  // runSelectTests, runAttestation). A spec file path containing a shell
  // metacharacter (quote, backtick, $(), ;) must not be able to break out
  // of the intended single-argument boundary.
  // Which halves can actually match a test is decided UP FRONT, from the
  // selection's own titles — not by running both and forgiving a non-zero exit.
  // Playwright exits 1 with "No tests found" when a grep matches nothing, so
  // running the serial half against a selection with no @serial tests (the modal
  // case: only ~26 of ~130 functional specs have one) would fail the push even
  // though every selected test passed. Planning first keeps a non-zero exit
  // meaningful: a half that was expected to have work and still failed is a real
  // failure. See qa/scripts/targeted-run-plan.ts.
  const invocations = planTargetedInvocations(specFiles.map((file) => resolve(REPO_ROOT, file)));

  if (invocations.length === 0) {
    // The selection resolved to files that contain no tests at all. Running
    // nothing and reporting success is the exact defect this ticket closes, so
    // this is a failure, not a no-op.
    throw new Error(
      `selection resolved to ${specFiles.length} spec file(s) containing no tests — nothing would run`,
    );
  }

  // Delete last push's reports first. If an invocation dies before its reporter
  // writes, existsSync below would otherwise find the STALE file and merge it
  // into the results the gate attests — stale output deciding pass/fail, which
  // is exactly what this repo's results-file policy forbids.
  for (const invocation of invocations) {
    rmSync(resolve(qaDir, invocation.junit), { force: true });
  }

  for (const invocation of invocations) {
    const args = [
      'run',
      'test',
      '--',
      ...specFiles,
      ...invocation.grep,
      `--output=${invocation.output}`,
      ...(invocation.workers > 0 ? [`--workers=${invocation.workers}`] : []),
    ];
    console.log(`[pre-push-tia] Running selected spec file(s), ${invocation.label}.`);
    try {
      execFileSync('npm', args, {
        cwd: qaDir,
        stdio: 'inherit',
        env: playwrightEnv(headSha, { PLAYWRIGHT_JUNIT_OUTPUT_FILE: invocation.junit }),
      });
    } catch (err) {
      // Accumulate rather than rethrowing immediately, mirroring CI's e2e-serial
      // loop: the serial half must still run when the non-serial half fails, or
      // a failure in one masks whether the other would have passed. The merged
      // report is what attestOrThrow then reads, and the first failure is
      // rethrown after both halves have had their turn.
      firstFailure ??= err;
    }
    if (existsSync(resolve(qaDir, invocation.junit))) {
      produced.push(invocation.junit);
    }
  }

  if (produced.length > 0) {
    // --allow-empty-inputs is REQUIRED here, not optional, and both CI call
    // sites pass it for the same reason (ci.yml:1959, :2138). Playwright writes
    // `<testsuites tests="0">` with no children when a run matches no tests, and
    // with a non-serial/serial split that is the MODAL case in both directions:
    // a selection of all-@serial specs (visibility, onboarding) empties the
    // non-serial half, and a selection with no @serial tests empties the serial
    // half. Without the flag the merge throws and the push is blocked even
    // though every selected test passed — and attestOrThrow never runs, so the
    // zero-tests-executed reason would be unreachable on this path.
    //
    // --expected-files keeps the signal the flag gives up: an invocation whose
    // CONFIG failed to load writes no file at all, which is a real failure and
    // must not be absorbed as "legitimately empty".
    execFileSync(
      'npx',
      [
        'tsx',
        'scripts/merge-junit-results.ts',
        '--output',
        MERGED_JUNIT,
        '--allow-empty-inputs',
        '--expected-files',
        String(invocations.length),
        ...produced,
      ],
      { cwd: qaDir, stdio: 'inherit', env: process.env },
    );
  }

  if (firstFailure) throw firstFailure;
}

/**
 * Runs the full-suite safety-net fallback — invoked from BOTH full-suite
 * call sites in main() below, never from the targeted path (runPlaywright
 * above, which already receives a specific, curated specFiles list from
 * select-tests.ts and so needs no `--grep @functional` SCOPING).
 *
 * That parenthetical used to read "needs neither this scoping nor this split",
 * which conflated two separate concerns and was half wrong: the targeted path
 * genuinely does not need the scoping, but it very much needed the
 * serial/non-serial SPLIT, whose purpose is to ensure serial tests execute
 * somewhere rather than being filtered into nothing. runPlaywright now performs
 * that split itself — see its docblock for why it attests once at the end
 * rather than after each half as this function does.
 *
 * Two real defects fixed here, found via a real local push that timed out
 * repeatedly under this fallback:
 *
 * 1. The previous single `npm run test -- --grep-invert serial` call with
 *    no `--grep @functional` matched literally every spec Playwright can
 *    discover — 2014 tests including qa/e2e/framework/tests/'s own
 *    self-tests (heal-methods.spec.ts, rest-client.spec.ts, etc.), not the
 *    @functional suite this gate is actually meant to validate. Scoped to
 *    `@functional` now, matching .claude/gates/e2e-run.md's own documented
 *    procedure — the single source of truth this script was silently
 *    diverging from. This alone brought the run down from 2014 to 1030
 *    (non-serial) + 292 (serial) tests.
 * 2. `--grep-invert serial` is a TEXT filter against each test's own
 *    title/tags — it does nothing for a spec file whose tests aren't
 *    literally tagged "@serial" even when the file itself uses Playwright's
 *    `test.describe.serial(...)` (concurrency.spec.ts's F-CC suite is
 *    exactly this case: serial-within-file ordering by API, untagged by
 *    name). Now runs as two genuinely separate Playwright invocations —
 *    non-serial then serial — exactly like e2e-run.md's own two commands
 *    and like CI's own separate e2e-functional/e2e-serial jobs, so a
 *    describe.serial file's tests are never scheduled alongside an
 *    unrelated spec file on another worker.
 *
 * Even correctly scoped to 1030 non-serial tests, playwright.config.ts's
 * own 20-minute globalTimeout (calibrated for CI's sharded multi-project
 * matrix, whose shard and worker counts come from the capacity probe — see
 * that file's own comment) is unreachable for a single unsharded local
 * run: measured directly, only ~420-445 of 1030
 * tests completed in 20 minutes regardless of using 1 or 2 local workers
 * (a ~6% difference, not the ~2x more workers would predict) — the test server
 * is one Node process, so it bottlenecks throughput no matter how many
 * Playwright workers send it concurrent requests. There is no local
 * sharding equivalent to shrink this down to CI's per-shard slice, so
 * PW_GLOBAL_TIMEOUT_MS overrides the default here rather than accepting a
 * deadline the suite structurally cannot meet. Budgets below include real
 * headroom over the measured/estimated throughput, not just bare minimums.
 *
 * Each invocation gets its own attestOrThrow call immediately after,
 * rather than one call after both: Playwright's own junit reporter writes
 * to one fixed path (playwright.config.ts's own outputFile), so a second
 * invocation would silently overwrite the first run's results.xml rather
 * than merge with them. Attesting right after each run, before the next
 * one starts, is what CI's own separate e2e-functional/e2e-serial jobs
 * effectively do too (never merged, always two independent pass/fail
 * signals).
 *
 * --workers=1: chosen on the measured basis above, not on parity with CI —
 * CI runs MORE workers per shard than this (4 on today's runners), so
 * matching it was never the argument. The single-threaded test server is the
 * throughput ceiling, and 2 workers bought ~6% over 1, so the extra
 * concurrency against shared local state is not worth it. A pragmatic choice,
 * not a correctness requirement: 2 workers were never proven unsafe for this
 * scoped, non-serial set (unlike the true fix in defect 2 above).
 */
function runFullSuiteFallbackAndAttest(headSha: string, selection: SelectTestsResult | null): void {
  // See runPlaywright's own call: warned at the point dumps are produced.
  warnIfTestStackShaIsStale(headSha);

  const nonSerialEnv = playwrightEnv(headSha, {
    PW_GLOBAL_TIMEOUT_MS: String(60 * 60 * 1000),
  });
  console.log('[pre-push-tia] Running full suite, non-serial (safety net fallback).');
  execFileSync(
    'npm',
    [
      'run',
      'test',
      '--',
      '--grep',
      '@functional',
      '--grep-invert',
      NON_SERIAL_GREP_INVERT,
      '--workers=1',
    ],
    { cwd: resolve(REPO_ROOT, 'qa'), stdio: 'inherit', env: nonSerialEnv },
  );
  attestOrThrow(headSha, selection);

  const serialEnv = playwrightEnv(headSha, {
    PW_GLOBAL_TIMEOUT_MS: String(25 * 60 * 1000),
  });
  console.log('[pre-push-tia] Running full suite, serial (safety net fallback).');
  execFileSync('npm', ['run', 'test', '--', '--grep', SERIAL_GREP, '--workers=1'], {
    cwd: resolve(REPO_ROOT, 'qa'),
    stdio: 'inherit',
    env: serialEnv,
  });
  attestOrThrow(headSha, selection);
}

interface AttestationResult {
  passed: boolean;
  reasons: string[];
}

/**
 * Runs the shared verify-test-attestation.ts gate — same
 * script CI's own attestation step invokes — against the just-produced
 * results.xml and (for targeted mode) the selection this run was supposed
 * to satisfy. Returns the parsed result rather than throwing on a FAILED
 * attestation (a non-zero exit code there means "attestation failed", a
 * legitimate outcome this caller needs to inspect, not a script crash).
 *
 * changed what that gate treats as a skip failure, and this hook
 * is its other caller, so the effect here is worth stating explicitly.
 * Neither invocation below passes --project, so Playwright runs every
 * configured project and the results.xml carries one row per
 * (test, project). The gate now reports a test only when it was skipped in
 * EVERY project present, rather than in any one of them.
 *
 * That is a deliberate loosening, and it is the correct one for a
 * multi-project run: this suite guards viewport-specific tests in both
 * directions, so under the old rule a full local run could never pass the
 * gate at all — every desktop-only test skipped under mobile-web, and vice
 * versa. What it does NOT loosen: a test skipped everywhere still fails, a
 * test failing in any project still fails, and the SHA-binding and
 * freshness anti-cheat checks are untouched.
 */
function runAttestation(headSha: string, selection: SelectTestsResult | null): AttestationResult {
  const tmpDir = mkdtempSync(join(tmpdir(), 'tia-prepush-'));
  try {
    const args = [
      'tsx',
      'src/scripts/verify-test-attestation.ts',
      `--results=${resolve(REPO_ROOT, 'qa/e2e/test-results/results.xml')}`,
      `--sha=${headSha}`,
    ];
    if (selection && selection.mode === 'targeted') {
      const selectionPath = join(tmpDir, 'selection.json');
      writeFileSync(selectionPath, JSON.stringify(selection), 'utf8');
      args.push(`--selection=${selectionPath}`);
    }

    try {
      const stdout = execFileSync('npx', args, {
        cwd: resolve(REPO_ROOT, 'server'),
        encoding: 'utf8',
        env: { ...process.env, ...testStackDbEnv(), LOG_DESTINATION: 'stderr' },
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      return JSON.parse(stdout) as AttestationResult;
    } catch (err) {
      // verify-test-attestation.ts exits non-zero (via process.exitCode) on
      // a FAILED attestation, which execFileSync surfaces as a thrown error
      // — but it still wrote its JSON result to stdout first. Node attaches
      // captured stdout to the error object in this case.
      const stdout = (err as { stdout?: string }).stdout;
      if (stdout) {
        try {
          return JSON.parse(stdout) as AttestationResult;
        } catch {
          // fall through to the generic failure below
        }
      }
      return { passed: false, reasons: ['attestation-script-error'] };
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Runs attestation and throws (blocking the push) if it fails — the caller's own outer try/catch turns this into a non-zero hook exit. */
function attestOrThrow(headSha: string, selection: SelectTestsResult | null): void {
  console.log('[pre-push-tia] Verifying test-run attestation...');
  const attestation = runAttestation(headSha, selection);
  if (!attestation.passed) {
    throw new Error(
      `attestation failed: ${attestation.reasons.join(', ')} — see verify-test-attestation output above`,
    );
  }
  console.log('[pre-push-tia] Attestation passed.');
}

/**
 * Repo-root typecheck and dependency audit — the two CI jobs this hook could
 * previously let a developer discover from CI instead of locally.
 *
 * WHY THESE TWO, AND WHY HERE
 * ---------------------------
 * .claude/gates/pre-push.md has required both for a long time, but nothing
 * enforced them, and each has a recorded failure mode:
 *
 *   - Typecheck. The checklist's own line is "a branch with type errors fails
 *     CI even when every test passes locally" — this hook enforced the tests
 *     half of that sentence and not the types half. pre-commit's lint-staged
 *     runs ESLint on STAGED FILES only, which structurally cannot see a
 *     cross-file type break, and runs no tsc at all.
 *   - Audit. Advisories are published against versions already in the
 *     lockfile, so a tree that was clean yesterday fails today with no repo
 *     change. This is exactly that case: a red CI audit job first seen in CI
 *     because the branch touched no package.json.
 *
 * Both are seconds against this hook's 20-60 minute E2E leg, and both run
 * BEFORE it so a type error fails in about a minute rather than after an hour.
 *
 * Lint is deliberately NOT here. pre-commit's lint-staged already runs ESLint
 * (plus prettier, markdownlint, actionlint) over every staged file on the way
 * in, so the marginal catch of a second repo-wide pass does not pay for
 * itself in a hook that already runs twice-over work.
 *
 * Both are hard failures, not warnings — unlike runCreateCoverageDb and
 * runLoadCoverageMap above, whose best-effort treatment is for local
 * INFRASTRUCTURE being unavailable. A type error and a published advisory are
 * properties of the code being pushed, not of this machine, and they fail CI
 * for everyone.
 */
function runStaticGates(): void {
  // stdio inherit: tsc and npm audit already format their own diagnostics, and
  // a developer needs the actual error text, not a summary of it.
  console.log('[pre-push-tia] Typechecking (repo root)...');
  try {
    execFileSync('npm', ['run', 'typecheck'], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: process.env,
    });
  } catch {
    // The message, not the underlying "Command failed: npm run typecheck" —
    // tsc's own output is directly above and is what actually needs reading.
    throw new Error('typecheck failed — see the errors above');
  }

  // scripts/npm-audit-gate.sh, NOT a bare `npm audit --audit-level=high` here:
  // the same script .github/actions/npm-audit runs, so the local gate and both
  // CI callers are one rule rather than three implementations of it. An inline
  // copy is materially weaker, not merely duplicated — `npm audit` exits
  // non-zero both when it finds advisories and when it fails to run at all, so
  // a bare invocation reports green on a registry outage that produced no
  // verdict. The shared script fails closed on an unreadable report.
  console.log('[pre-push-tia] Auditing dependencies (--audit-level=high)...');
  try {
    execFileSync(resolve(REPO_ROOT, 'scripts', 'npm-audit-gate.sh'), [], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: process.env,
    });
  } catch {
    // The script has already printed the advisory table and the re-resolve
    // instructions; repeating them here would only bury its output.
    throw new Error('npm audit gate failed — see above');
  }
}

function main(): void {
  // Static gates run BEFORE the SKIP_TIA_PREPUSH early-return, deliberately.
  // That variable means "skip the TIA-selected E2E run" — the expensive leg a
  // developer legitimately skips when the gate was just run by hand on an
  // unchanged HEAD (.claude/gates/pre-push.md). Typecheck and audit are seconds,
  // are not what an E2E run covers, and are precisely what that bypass would
  // otherwise leave unguarded, so they are outside its scope.
  runStaticGates();

  if (process.env.SKIP_TIA_PREPUSH === '1') {
    logBypass('SKIP_TIA_PREPUSH=1');
    console.log(
      '[pre-push-tia] SKIP_TIA_PREPUSH=1 set — skipping TIA-selected test run. Bypass logged.',
    );
    return;
  }

  loadRootEnv();

  const headSha = resolveHeadSha();

  runCreateCoverageDb();
  runLoadCoverageMap(resolveMainSha());

  console.log('[pre-push-tia] Resolving TIA-selected test subset for this push...');

  let selection: SelectTestsResult;
  try {
    selection = runSelectTests('main', 'HEAD');
  } catch (err) {
    // Selection itself failing (e.g. coverage DB unreachable, corrupt/stale
    // map) must not silently skip tests — falls back to running everything,
    // the same safe default the safety net policy itself uses for a
    // low-confidence/unmapped diff.
    console.error(
      `[pre-push-tia] WARN: selection failed (${err instanceof Error ? err.message : String(err)}) — falling back to the full suite.`,
    );
    runFullSuiteFallbackAndAttest(headSha, null);
    return;
  }

  for (const line of selection.rationale) {
    console.log(`[pre-push-tia] ${line}`);
  }

  if (selection.mode === 'full-suite') {
    runFullSuiteFallbackAndAttest(headSha, selection);
    return;
  }

  if (selection.specFiles.length === 0) {
    // An empty selection has two very different causes, and treating them alike
    // let a push through on a suite that ran nothing:
    //
    //   - TIA ran, resolved cleanly, and the diff genuinely affects no tests
    //     (a docs-only change). Legitimate — return, as before.
    //   - Every selected test failed to resolve to a spec file, so the list is
    //     empty because resolution COLLAPSED, not because there is nothing to
    //     run. Indistinguishable from the benign case until now, and nothing
    //     downstream noticed: with no run there are no coverage sessions, so
    //     attestation is never even invoked.
    //
    // The second case falls back to the full suite, matching how runSelectTests'
    // own failure path is already handled above — "TIA could not answer, so do
    // not trust a narrow answer."
    if (selection.unresolvedTestIds.length > 0) {
      console.log(
        `[pre-push-tia] WARN: selection resolved to zero spec files, but ${selection.unresolvedTestIds.length} selected test(s) could not be mapped to one. Falling back to the full suite rather than treating this as "nothing to run".`,
      );
      runFullSuiteFallbackAndAttest(headSha, selection);
      return;
    }
    console.log(
      '[pre-push-tia] No affected tests and no baseline files resolved — nothing to run.',
    );
    return;
  }

  if (selection.unresolvedTestIds.length > 0) {
    console.log(
      `[pre-push-tia] WARN: ${selection.unresolvedTestIds.length} selected test(s) could not be resolved to a spec file — running the resolved subset only. Consider a full push-time run if this persists.`,
    );
  }

  console.log(`[pre-push-tia] Running ${selection.specFiles.length} selected spec file(s).`);
  runPlaywright(selection.specFiles, headSha);
  attestOrThrow(headSha, selection);
}

if (!existsSync(resolve(REPO_ROOT, 'qa', 'e2e'))) {
  console.error('[pre-push-tia] qa/e2e not found — skipping (not a full checkout?).');
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error(
    `[pre-push-tia] Test run failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}
