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

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const BYPASS_LOG_PATH = resolve(REPO_ROOT, '.git', 'tia-prepush-bypass.log');

// Same "never overwrite an already-set var" pattern as scripts/e2e-setup.ts —
// so a caller's own explicit env (e.g. CI, or a developer's shell export)
// always wins over the .env file's defaults.
function loadEnvFile(path: string): void {
  try {
    const contents = readFileSync(path, 'utf8');
    for (const line of contents.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx);
      const value = trimmed.slice(eqIdx + 1);
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // Optional — CI supplies vars via the environment directly.
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
 * inspection alone. Root loaded first so an identically-named var in
 * qa/e2e/.env (there are none today, but the ordering is the safe
 * default) can't silently shadow it.
 *
 * Root .env is loaded for its secrets, NOT its database coordinates: it names the DEV
 * database (DB_NAME=minicrm, COVERAGE_DB_NAME=minicrm_coverage) on port 5432. Every
 * subprocess below is given testStackDbEnv() explicitly so those values can never
 * reach a child. (MINCRM-684)
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
const TEST_DB_PORT = '5433';
const DEV_DB_PORT = '5432';

/**
 * Resolves once at first use, following scripts/e2e-setup.ts's resolve-then-reject
 * shape rather than blindly overriding: an operator running the test stack on a
 * non-default port can still export DB_PORT, but the dev port is refused outright
 * because every child below reads or writes test data.
 */
function resolveTestStackDbEnv(): Record<string, string> {
  const dbPort = process.env.DB_PORT ?? TEST_DB_PORT;

  if (dbPort === DEV_DB_PORT) {
    console.error(
      `[pre-push:tia] REFUSING TO RUN: DB_PORT=${DEV_DB_PORT} is the dev database.\n` +
        '  This hook runs E2E suites and rewrites coverage/TIA data. The test stack\n' +
        `  listens on ${TEST_DB_PORT}: docker compose -f docker-compose.test.yml up -d`,
    );
    process.exit(1);
  }

  return {
    DB_HOST: process.env.DB_HOST ?? 'localhost',
    DB_PORT: dbPort,
    DB_NAME: 'minicrm_e2e',
    COVERAGE_DB_NAME: 'minicrm_coverage_e2e',
  };
}

/**
 * Lazily memoized: module-scope evaluation would run BEFORE main()'s loadRootEnv() call
 * and so never observe DB_PORT/DB_HOST from the .env files, silently resolving defaults
 * instead of the developer's configuration.
 */
let cachedTestStackDbEnv: Record<string, string> | undefined;
function testStackDbEnv(): Record<string, string> {
  cachedTestStackDbEnv ??= resolveTestStackDbEnv();
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

function runPlaywright(specFiles: readonly string[]): void {
  // Array args via execFileSync — never a shell string — same precedent
  // as every other subprocess call in this file (runLoadCoverageMap,
  // runSelectTests, runAttestation). A spec file path containing a shell
  // metacharacter (quote, backtick, $(), ;) must not be able to break out
  // of the intended single-argument boundary.
  const args = ['run', 'test', '--', ...specFiles, '--grep-invert', 'serial'];
  execFileSync('npm', args, {
    cwd: resolve(REPO_ROOT, 'qa'),
    stdio: 'inherit',
    env: { ...process.env, ...TEST_STACK_DB_ENV },
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
  const nonSerialEnv = {
    ...process.env,
    ...testStackDbEnv(),
    PW_GLOBAL_TIMEOUT_MS: String(60 * 60 * 1000),
  };
  console.log('[pre-push-tia] Running full suite, non-serial (safety net fallback).');
  execFileSync(
    'npm',
    ['run', 'test', '--', '--grep', '@functional', '--grep-invert', 'serial', '--workers=1'],
    { cwd: resolve(REPO_ROOT, 'qa'), stdio: 'inherit', env: nonSerialEnv },
  );
  attestOrThrow(headSha, selection);

  const serialEnv = {
    ...process.env,
    ...testStackDbEnv(),
    PW_GLOBAL_TIMEOUT_MS: String(25 * 60 * 1000),
  };
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
  runPlaywright(selection.specFiles);
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
