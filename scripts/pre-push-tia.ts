/**
 * pre-push-tia.ts — Local pre-push hook body: run the TIA-selected subset
 * plus the always-run baseline before allowing a push. (MINCRM-641)
 *
 * Invoked by .husky/pre-push. Resolves the local diff (current branch vs.
 * main) to affected tests via server/src/scripts/select-tests.ts — the
 * SAME script MINCRM-633's CI select-mode job calls, so local and CI
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
 *     own self-tests until this was fixed — MINCRM-636/637).
 *
 * After the run, server/src/scripts/verify-test-attestation.ts (MINCRM-642)
 * — the SAME shared gate CI's own attestation step uses — verifies
 * results.xml is all-passing AND (for targeted mode) that every selected
 * spec file is attributed as having actually run, via session attribution
 * bound to the local HEAD SHA. A failed attestation blocks the push exactly
 * like a failed test run would — this is what makes "the selected subset
 * ran" a provable claim instead of merely an attempted one.
 *
 * Escape hatch: SKIP_TIA_PREPUSH=1 git push bypasses this hook entirely.
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
// root scripts/ does not have. See that module's docblock. (MINCRM-698)
import {
  resolveTestStackDbEnv,
  parseEnvFileContents,
  pickDbCoordinates,
  DevDatabaseRefusedError,
  DEV_DB_PORT,
  TEST_DB_PORT,
  type TestStackDbEnv,
} from '../qa/scripts/test-stack-db-env.js';

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
 * this hook chose to load cannot trigger it. (MINCRM-698)
 */
const EXPORTED_DB_PORT = process.env.DB_PORT;
const EXPORTED_DB_HOST = process.env.DB_HOST;
const EXPORTED_DB_USER = process.env.DB_USER;
const EXPORTED_DB_PASSWORD = process.env.DB_PASSWORD;

/**
 * Reads DB_HOST/DB_PORT straight out of qa/e2e/.env, bypassing process.env.
 *
 * Necessary because by the time anything resolves coordinates, loadRootEnv() has
 * flattened root .env and qa/e2e/.env into one namespace where root's DEV values
 * win. Going back to the file is what lets a developer's non-default test-stack
 * host/port — the documented way to run the stack somewhere other than
 * localhost:5433 — still take effect, without root .env's dev port ever being
 * mistaken for one. Missing file or missing keys yield {}, so the resolver falls
 * through to its defaults. (MINCRM-698)
 */
function readE2eEnvFileCoordinates(): { DB_PORT?: string; DB_HOST?: string } {
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
// passing while this loop drifted away from it. (MINCRM-698)
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
 * E2E_DATABASE_URL, etc. all live only in qa/e2e/.env, never root .env —
 * confirmed by grepping both files). Without this, a full-suite fallback
 * run from this hook silently no-ops (globalSetup skips the admin login
 * and writes an empty storageState, then Playwright reports zero tests
 * collected) instead of actually gating the push — found while verifying
 * this push's own attestation fix actually ran real tests, not by
 * inspection alone.
 *
 * Root .env is loaded for its secrets, NOT its database coordinates: it names the DEV
 * database (DB_NAME=minicrm, COVERAGE_DB_NAME=minicrm_coverage) on port 5432. Every
 * subprocess below is given testStackDbEnv() explicitly so those values can never
 * reach a child. (MINCRM-684)
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
 * "some file mentioned it". Fix the reader, not the loader. (MINCRM-698)
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
 * dump:coverage-map invocation passes the same value. (MINCRM-684)
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
 * (MINCRM-698)
 */
function resolveTestStackDbEnvOrExit(): TestStackDbEnv {
  // qa/e2e/.env is re-read directly rather than consulted through process.env:
  // by now root .env has already been flattened in and would shadow it, which is
  // the whole defect. Reading the file names its values as coming from the TEST
  // stack's own config, so a developer's non-default host/port there still
  // reaches every child. (MINCRM-698)
  const e2eEnvFile = readE2eEnvFileCoordinates();
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
 * coverage_test_links from the committed qa/coverage-map.json before
 * selection queries it. A fresh checkout's local coverageDb has nothing in
 * it; an established dev machine's already has real accumulated data, but
 * re-loading is a harmless, idempotent refresh either way (see
 * loadCoverageTestLinksForCommit's own "replace, not upsert" semantics).
 * Best-effort: a failed load must not block the push — it just means
 * selection falls back to whatever the local DB already had (possibly
 * nothing, which itself degrades to the unmapped-changes safety net).
 */
function runLoadCoverageMap(sha: string): void {
  try {
    execFileSync('npx', ['tsx', 'src/scripts/load-coverage-map.ts', `--sha=${sha}`], {
      cwd: resolve(REPO_ROOT, 'server'),
      env: { ...process.env, ...testStackDbEnv(), LOG_DESTINATION: 'stderr' },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  } catch (err) {
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
 * than the one being pushed. (MINCRM-688)
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
 * GIT_COMMIT_SHA is the point of this helper (MINCRM-688). The QA harness
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

function runPlaywright(specFiles: readonly string[], headSha: string): void {
  // Checked here, and in runFullSuiteFallbackAndAttest, rather than once at
  // the top of main(): these are the only points at which a run actually
  // produces coverage dumps, so anywhere earlier would warn that "dumps this
  // stack produces are tagged stale" on paths that produce none (a selection
  // resolving to zero spec files, for instance).
  warnIfTestStackShaIsStale(headSha);

  // Array args via execFileSync — never a shell string — same precedent
  // as every other subprocess call in this file (runLoadCoverageMap,
  // runSelectTests, runAttestation). A spec file path containing a shell
  // metacharacter (quote, backtick, $(), ;) must not be able to break out
  // of the intended single-argument boundary.
  const args = ['run', 'test', '--', ...specFiles, '--grep-invert', 'serial'];
  execFileSync('npm', args, {
    cwd: resolve(REPO_ROOT, 'qa'),
    stdio: 'inherit',
    env: playwrightEnv(headSha),
  });
}

/**
 * Runs the full-suite safety-net fallback — invoked from BOTH full-suite
 * call sites in main() below, never from the targeted path (runPlaywright
 * above, which already receives a specific, curated specFiles list from
 * select-tests.ts and needs neither this scoping nor this split).
 *
 * Two real defects fixed here, found via a real local push that timed out
 * repeatedly under this fallback (MINCRM-636/637):
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
 * own 20-minute globalTimeout (calibrated for CI's 4-shard x 2-worker x
 * 2-project matrix — see that file's own comment) is unreachable for a
 * single unsharded local run: measured directly, only ~420-445 of 1030
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
 * --workers=1: e2e-run.md's own current documented value, not capacity.ts's
 * CI-oriented, sharding-aware plan (see that file's own WORKERS_CAP
 * docblock) — chosen for simplicity given 2 workers bought negligible real
 * throughput here, not because 2 workers were proven unsafe for this
 * specific scoped, non-serial set (unlike the true fix in defect 2 above,
 * this is a pragmatic choice, not a correctness requirement).
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
    ['run', 'test', '--', '--grep', '@functional', '--grep-invert', 'serial', '--workers=1'],
    { cwd: resolve(REPO_ROOT, 'qa'), stdio: 'inherit', env: nonSerialEnv },
  );
  attestOrThrow(headSha, selection);

  const serialEnv = playwrightEnv(headSha, {
    PW_GLOBAL_TIMEOUT_MS: String(25 * 60 * 1000),
  });
  console.log('[pre-push-tia] Running full suite, serial (safety net fallback).');
  execFileSync(
    'npm',
    ['run', 'test', '--', '--grep', '@functional.*@serial|@serial.*@functional', '--workers=1'],
    { cwd: resolve(REPO_ROOT, 'qa'), stdio: 'inherit', env: serialEnv },
  );
  attestOrThrow(headSha, selection);
}

interface AttestationResult {
  passed: boolean;
  reasons: string[];
}

/**
 * Runs the shared verify-test-attestation.ts gate (MINCRM-642) — same
 * script CI's own attestation step invokes — against the just-produced
 * results.xml and (for targeted mode) the selection this run was supposed
 * to satisfy. Returns the parsed result rather than throwing on a FAILED
 * attestation (a non-zero exit code there means "attestation failed", a
 * legitimate outcome this caller needs to inspect, not a script crash).
 *
 * MINCRM-687 changed what that gate treats as a skip failure, and this hook
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

function main(): void {
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
