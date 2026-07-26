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
 *     file, or a stale/missing map) — falls back to running everything,
 *     exactly as CI's own full-suite fallback would.
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
 */
function loadRootEnv(): void {
  loadEnvFile(resolve(REPO_ROOT, '.env'));
  loadEnvFile(resolve(REPO_ROOT, 'qa', 'e2e', '.env'));
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
      env: { ...process.env, LOG_DESTINATION: 'stderr' },
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
      env: { ...process.env, LOG_DESTINATION: 'stderr' },
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
      env: { ...process.env, LOG_DESTINATION: 'stderr' },
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
    env: process.env,
  });
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
        env: { ...process.env, LOG_DESTINATION: 'stderr' },
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
    runPlaywright([]);
    attestOrThrow(headSha, null);
    return;
  }

  for (const line of selection.rationale) {
    console.log(`[pre-push-tia] ${line}`);
  }

  if (selection.mode === 'full-suite') {
    console.log('[pre-push-tia] Running full suite (safety net fallback).');
    runPlaywright([]);
    attestOrThrow(headSha, selection);
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
