#!/usr/bin/env node
/**
 * Fails when a literal path in ci.yml's paths-filter block matches no tracked file.
 *
 * A stale glob is silent: the job simply stops triggering, and nothing reports that its
 * guard no longer runs. That is the failure mode a file move creates, and the one a
 * green CI run looks exactly like.
 *
 * Only literal paths are checked — a glob containing * or ? is left alone, since
 * deciding what it "should" have matched needs picomatch semantics and a judgement
 * call. A literal path either exists or it does not.
 *
 * So a wildcard that has stopped matching anything is the residual gap: `qa/scripts/
 * **' + '/*.mjs` would go stale the day its last .mjs moves, and this stays quiet.
 *
 * Enumerates tracked files, so a newly added guard is invisible until `git add`. CI
 * always sees tracked files; locally, stage the file before trusting a failure.
 *
 * Run: node scripts/check-ci-filter-globs.mjs [--self-test]
 */

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = '.github/workflows/ci.yml';

/** A quoted entry under a `- ` list item, as the filters block writes them. */
const FILTER_ENTRY = /^\s*-\s*'([^']+)'\s*$/;
/** Anything picomatch would expand; only literals are checkable here. */
const HAS_WILDCARD = /[*?[\]{}]/;

/**
 * Literal paths listed in the workflow's filter entries.
 *
 * Scanned line-by-line rather than parsed: the filters live in a YAML scalar block
 * nested inside the workflow, so a real parse needs a YAML dependency this repo does
 * not carry at the root, for a check that is one regex.
 *
 * @param {string} text - Contents of the workflow file.
 * @returns {string[]} Literal paths, in file order, with duplicates preserved.
 */
export function literalFilterPaths(text) {
  const found = [];
  for (const line of text.split('\n')) {
    const match = FILTER_ENTRY.exec(line);
    if (!match) continue;
    const value = match[1];
    if (HAS_WILDCARD.test(value)) continue;
    if (!value.includes('/') && !value.includes('.')) continue;
    found.push(value);
  }
  return found;
}

/**
 * Literal filter paths that git does not know about.
 *
 * @param {string[]} paths - Literal paths from the workflow.
 * @param {Set<string>} tracked - Every tracked file path.
 * @returns {string[]} The unmatched subset.
 */
export function findStalePaths(paths, tracked) {
  return [...new Set(paths)].filter((p) => !tracked.has(p));
}

function trackedFiles() {
  const out = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return new Set(out.split('\0').filter(Boolean));
}

function selfTest() {
  const workflow = [
    '            docs:',
    "              - '**.md'",
    "              - 'docs/**'",
    '            guards:',
    "              - 'scripts/check-doc-links.mjs'",
    "              - 'scripts/gone.mjs'",
    "              - 'qa/scripts/**/*.sh'",
    '            other:',
    "              - 'README.md'",
    "              - 'name-without-separator'",
  ].join('\n');

  const literals = literalFilterPaths(workflow);
  const expected = ['scripts/check-doc-links.mjs', 'scripts/gone.mjs', 'README.md'];
  if (literals.join(',') !== expected.join(',')) {
    console.error(`SELF-TEST FAIL: extracted ${literals.join(',')}, want ${expected.join(',')}`);
    process.exit(1);
  }

  const tracked = new Set(['scripts/check-doc-links.mjs', 'README.md']);
  const stale = findStalePaths(literals, tracked);
  if (stale.length !== 1 || stale[0] !== 'scripts/gone.mjs') {
    console.error(`SELF-TEST FAIL: flagged ${stale.join(',') || 'nothing'}, want scripts/gone.mjs`);
    process.exit(1);
  }

  const clean = findStalePaths(['README.md'], tracked);
  if (clean.length !== 0) {
    console.error(`SELF-TEST FAIL: ${clean.length} findings on a path that exists.`);
    process.exit(1);
  }

  console.log(
    `SELF-TEST PASS: ${literals.length} literals extracted from ${literals.length + 3} entries, ` +
      '1 stale flagged, 0 on a tracked path.',
  );
}

function main() {
  if (process.argv[2] === '--self-test') {
    selfTest();
    return;
  }
  if (process.argv[2] !== undefined) {
    console.error('Usage: node scripts/check-ci-filter-globs.mjs [--self-test]');
    process.exit(2);
  }

  const literals = literalFilterPaths(readFileSync(resolve(REPO_ROOT, WORKFLOW), 'utf8'));
  const stale = findStalePaths(literals, trackedFiles());

  if (stale.length > 0) {
    console.error(`FAIL: ${WORKFLOW} lists ${stale.length} path(s) that no tracked file matches.`);
    for (const path of stale) console.error(`  ${path}`);
    console.error('A filter naming a path that moved stops triggering, silently.');
    process.exit(1);
  }
  console.log(`OK: all ${new Set(literals).size} literal filter paths in ${WORKFLOW} exist.`);
}

// Exact resolution, matching scripts/check-comments-only-diff.ts: a basename suffix
// match would also fire for a same-named file in another directory.
const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && currentFile === resolve(process.argv[1])) {
  main();
}
