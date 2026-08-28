#!/usr/bin/env node
/**
 * Fails when a tracked path falls under no impact-manifest entry.
 *
 * A path the manifest says nothing about resolves to no scopes, so TIA selects
 * nothing for it — and "selected nothing" is indistinguishable from "correctly
 * selected nothing". That is the failure tier 2 exists to remove, and a new
 * top-level path class reintroduces it silently.
 *
 * Enumerates TRACKED files rather than changed ones. Two reasons: the job that
 * runs this checks out at the default depth with no merge base to diff against,
 * and a whole-tree check is strictly stronger — it fails on an unmapped class
 * whether or not this PR touched it.
 *
 * Also reports `impacts` annotations whose glob matches no tracked path. A
 * stale declaration after a file move degrades to selecting nothing, with the
 * spec still passing.
 *
 * Run: npx tsx scripts/check-tia-manifest-coverage.mjs [--self-test]
 */

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every tracked path, the corpus the manifest must account for. */
function trackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);
}

/** Paths the manifest neither covers nor declares uncovered. */
function findUnmappedPaths(paths, isUnmapped) {
  return paths.filter((path) => isUnmapped(path));
}

/** Loads the manifest and resolver, which are TypeScript and so need tsx. */
async function loadTiaModules() {
  const { isUnmapped, declaredScopes, ALL_FUNCTIONAL_SCOPE } =
    await import('../server/src/coverageAgent/testSelection/impactManifest.ts');
  const { findStaleImpactsGlobs, resolveScopeToSpecFiles } =
    await import('../server/src/coverageAgent/testSelection/impactResolver.ts');
  return {
    isUnmapped,
    declaredScopes,
    ALL_FUNCTIONAL_SCOPE,
    findStaleImpactsGlobs,
    resolveScopeToSpecFiles,
  };
}

async function selfTest() {
  const failures = [];

  // Drives the REAL predicate. A stand-in would only test Array.filter: with a
  // fake, this passed while isUnmapped returned false for everything — the
  // silent-empty-selection failure the guard exists to report.
  const { isUnmapped } = await loadTiaModules();

  const corpus = [
    'server/src/services/dealService.ts',
    'client/src/pages/DealsPage.tsx',
    'docs/dev/coverage.md',
    'terraform/main.tf',
    'newtool/index.ts',
  ];

  const found = findUnmappedPaths(corpus, isUnmapped);
  if (found.length !== 2) {
    failures.push(`expected exactly 2 unmapped paths, got ${found.length}`);
  }
  for (const expected of ['terraform/main.tf', 'newtool/index.ts']) {
    if (!found.includes(expected)) failures.push(`${expected} was not flagged`);
  }

  // Must-NOT-flag, asserted separately from the count so a predicate flagging
  // everything fails here even if the count happened to match.
  for (const clean of [
    'server/src/services/dealService.ts',
    'client/src/pages/DealsPage.tsx',
    'docs/dev/coverage.md',
  ]) {
    const findings = findUnmappedPaths([clean], isUnmapped);
    if (findings.length !== 0) {
      failures.push(`expected 0 findings on ${clean}, got ${findings.length}`);
    }
  }

  // A directory merely sharing a prefix with a covered one is not covered.
  const nearMiss = findUnmappedPaths(['server-other/thing.ts'], isUnmapped);
  if (nearMiss.length !== 1) {
    failures.push(`a prefix near-miss was treated as covered (${nearMiss.length} findings)`);
  }

  // The corpus itself is what makes this guard non-vacuous, so assert a floor
  // rather than trusting git to have returned something.
  const tracked = trackedFiles();
  if (tracked.length < 100) {
    failures.push(`trackedFiles() returned ${tracked.length} paths; expected at least 100`);
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`SELF-TEST FAIL: ${failure}`);
    process.exit(1);
  }
  console.log(
    `SELF-TEST PASS: 2 unmapped flagged from ${corpus.length} paths, ` +
      `3 must-not-flag cases clean, ${tracked.length} tracked paths discovered.`,
  );
}

async function main() {
  // Validated before dispatch: checking after would let `--self-test --bogus`
  // report a pass, which is the silent-success shape this guard rejects.
  const unknown = process.argv.slice(2).filter((arg) => arg !== '--self-test');
  if (unknown.length > 0) {
    console.error(`Unknown argument: ${unknown[0]}`);
    console.error('Usage: npx tsx scripts/check-tia-manifest-coverage.mjs [--self-test]');
    process.exit(2);
  }
  if (process.argv.includes('--self-test')) {
    await selfTest();
    return;
  }

  const {
    isUnmapped,
    declaredScopes,
    ALL_FUNCTIONAL_SCOPE,
    findStaleImpactsGlobs,
    resolveScopeToSpecFiles,
  } = await loadTiaModules();
  const tracked = trackedFiles();

  // Both checks reported before exiting: they are independent and cheap, and
  // failing on the first would cost a second CI round-trip to see the other.
  const unmapped = findUnmappedPaths(tracked, isUnmapped);
  const stale = findStaleImpactsGlobs(REPO_ROOT, tracked);

  if (unmapped.length > 0) {
    console.error(`FAIL: ${unmapped.length} tracked path(s) fall under no manifest entry.\n`);
    for (const path of unmapped) console.error(`  ${path}`);
    console.error(
      '\nAdd a covered glob in impactManifest.ts, or declare the class uncovered with the\n' +
        'reason it impacts no test. An unmapped path selects nothing, silently.\n',
    );
  }

  if (stale.length > 0) {
    console.error(
      `FAIL: ${stale.length} impacts annotation(s) name a path that no file matches.\n`,
    );
    for (const { specFile, glob } of stale) console.error(`  ${specFile}: ${glob}`);
    console.error('\nA stale annotation selects nothing while its spec still passes.\n');
  }

  // Every declared scope must still name at least one spec file. The resolver
  // throws on this during selection, but that throw is caught so a stale entry
  // cannot block every push — which leaves this the only place it fails a build.
  // A directory rename would otherwise disable its scope with everything green.
  const emptyScopes = Array.from(declaredScopes())
    .filter((scope) => scope !== ALL_FUNCTIONAL_SCOPE)
    .filter((scope) => resolveScopeToSpecFiles(REPO_ROOT, scope).length === 0);

  if (emptyScopes.length > 0) {
    console.error(`FAIL: ${emptyScopes.length} declared scope(s) resolve to no spec file.\n`);
    for (const scope of emptyScopes) console.error(`  ${scope}`);
    console.error('\nA scope naming a directory that moved selects nothing, silently.\n');
  }

  if (unmapped.length > 0 || stale.length > 0 || emptyScopes.length > 0) {
    process.exit(1);
  }

  console.log(
    `OK: all ${tracked.length} tracked paths are mapped or declared uncovered, every ` +
      'declared scope resolves to a spec file, and every impacts annotation names a real path.',
  );
}

// Exact resolution, matching check-ci-filter-globs.mjs: a basename suffix match
// would also fire for a same-named file in another directory.
const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && currentFile === resolve(process.argv[1])) {
  await main();
}
