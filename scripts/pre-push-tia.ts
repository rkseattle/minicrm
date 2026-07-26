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
 * Escape hatch: SKIP_TIA_PREPUSH=1 git push bypasses this hook entirely.
 * Every bypass is appended to a local, gitignored audit log
 * (.git/tia-prepush-bypass.log) with a timestamp and the branch being
 * pushed — visible locally, never uploaded, never blocking (a missing log
 * write is not fatal).
 *
 * Non-goals: this hook does not gate CORRECTNESS of what ran (that's
 * MINCRM-642's attestation gate) — it only gates whether tests ran at all
 * before the push proceeds.
 */

import { execFileSync, execSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const BYPASS_LOG_PATH = resolve(REPO_ROOT, '.git', 'tia-prepush-bypass.log');

// Same "never overwrite an already-set var" pattern as scripts/e2e-setup.ts —
// so a caller's own explicit env (e.g. CI, or a developer's shell export)
// always wins over the .env file's defaults.
function loadRootEnv(): void {
  try {
    const rootEnv = readFileSync(resolve(REPO_ROOT, '.env'), 'utf8');
    for (const line of rootEnv.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx);
      const value = trimmed.slice(eqIdx + 1);
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // Root .env is optional — CI supplies vars via the environment directly.
  }
}

function currentBranchName(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
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
  const args = specFiles.length > 0 ? specFiles.map((f) => `"${f}"`).join(' ') : '';
  execSync(`npm run test -- ${args} --grep-invert serial`, {
    cwd: resolve(REPO_ROOT, 'qa'),
    stdio: 'inherit',
    env: process.env,
  });
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
    return;
  }

  for (const line of selection.rationale) {
    console.log(`[pre-push-tia] ${line}`);
  }

  if (selection.mode === 'full-suite') {
    console.log('[pre-push-tia] Running full suite (safety net fallback).');
    runPlaywright([]);
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
