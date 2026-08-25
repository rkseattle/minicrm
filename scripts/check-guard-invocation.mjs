#!/usr/bin/env node
/**
 * Fails when a check-* guard script is invoked by no CI job.
 *
 * A guard nobody runs is worse than none, because it is trusted: check-e2e-beforeall.sh
 * sat unwired long enough to go silently blind to the shape it existed to catch, and the
 * only record of that was a sentence in a developer doc claiming it "runs in no CI job
 * today" — prose, which rots and blocks nothing.
 *
 * Deliberately a LITERAL PATH check over the `run:` surface. It asks whether some step
 * names the script, never whether that step is correct — check-ci-filter-globs.mjs covers
 * stale filter paths, and each guard's own assertions cover what it checks.
 *
 * Three bounds, each deliberate and each a hole if it stops holding: only ci.yml is read
 * (no other workflow invokes a guard today); a step must name the path, so converting one
 * to `npm run lint:framework-purity` would read as uninvoked (qa/package.json wraps four
 * guards that way, all also invoked by path today); discovery keys on the check-* name and
 * the extensions below, so a guard named verify-* or written as .py is invisible; and a
 * --self-test-only invocation counts as invoked, which is why check-comments-only-diff.ts
 * passes — it takes a base ref and has no standalone mode.
 *
 * Run: node scripts/check-guard-invocation.mjs [--self-test]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = '.github/workflows/ci.yml';

/** Directories holding guards that a CI job is expected to run. */
const GUARD_DIRS = ['scripts', 'qa/scripts'];

/** Guard file types discovered. */
const GUARD_EXTENSIONS = ['sh', 'mjs', 'ts'];

/**
 * Directories whose guards need a filter entry of their own.
 *
 * `qa/scripts` is absent deliberately: the `qa` output already matches it and gates the
 * job this output feeds, so a narrower duplicate could never be the deciding trigger.
 */
const FILTERED_GUARD_DIRS = ['scripts'];

/**
 * Guards no CI job runs on purpose. Give each entry an inline comment saying why.
 *
 * Empty today, and an entry is a strong claim: that a guard's value is entirely local,
 * against the alternative that it silently stops guarding with nothing to say so.
 */
const NOT_RUN_IN_CI = new Set();

/**
 * Guard scripts tracked in the guard directories.
 *
 * Enumerates tracked files, so a new guard is invisible until `git add`. CI always sees
 * tracked files; locally, stage the script before trusting a pass.
 *
 * @param {string} root - Repository root.
 * @returns {string[]} Repo-relative paths, sorted.
 */
export function guardScripts(root = REPO_ROOT) {
  // Recursive, so a guard in a subdirectory is discovered rather than silently exempt.
  // The `qa` filter already globs qa/scripts/** and would trigger on such a file, so
  // a non-crossing scan here would leave exactly that guard unwatched.
  const patterns = GUARD_DIRS.flatMap((dir) =>
    GUARD_EXTENSIONS.map((extension) => `:(glob)${dir}/**/check-*.${extension}`),
  );
  const out = execFileSync('git', ['-C', root, 'ls-files', '-z', ...patterns], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean).sort();
}

/**
 * The command text of every `run:` step, joined.
 *
 * Bounded to the invocation surface, not the whole file. A guard's own paths-filter entry
 * and the comment above it name its path, so searching the raw text lets a guard vouch
 * for itself — and a commented-out step keeps the name in the file, which is precisely
 * the shape that goes unnoticed.
 *
 * Block scalars (`run: |`) carry the command on following lines, so those are taken until
 * the indentation returns to the step's own level.
 *
 * @param {string} workflow - Contents of the workflow file.
 * @returns {string} Every run command, newline-joined.
 */
export function runCommands(workflow) {
  const lines = workflow.split('\n');
  const commands = [];
  /** Any block-scalar header: `|`, `>`, with optional chomping and indentation digits. */
  const BLOCK_SCALAR = /^[|>][+-]?\d*$/;

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*-?\s*)run:\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    const [, prefix, inline] = match;
    // The block ends where indentation returns to the `run` KEY's column. Measuring from
    // the line's leading whitespace instead puts the bound left of the dash in a compact
    // `- run:` step, so sibling keys like `shell:` are swallowed as command text — and a
    // `working-directory:` naming a guard would then vouch for it.
    const keyColumn = prefix.length;
    if (inline && !BLOCK_SCALAR.test(inline)) {
      commands.push(stripShellComment(inline));
      continue;
    }
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next];
      if (line.trim() === '') continue;
      const lineIndent = /^\s*/.exec(line)[0].length;
      if (lineIndent < keyColumn || (lineIndent === keyColumn && /^\s*[\w-]+:/.test(line))) break;
      commands.push(stripShellComment(line));
      index = next;
    }
  }
  return commands.join('\n');
}

/**
 * A run line with any trailing shell comment removed.
 *
 * A commented-out invocation inside a `run: |` body still names the script, so counting
 * it would let a guard be disabled in place while this reports it as invoked — the same
 * silence that bounding the scan to `run:` exists to close.
 *
 * Truncates at the first whitespace-preceded `#` without tracking quotes, so a real
 * invocation after a quoted hash is dropped. That direction is a false positive, which
 * fails loudly rather than vouching for an unwired guard.
 *
 * @param {string} line - One line of a run command.
 * @returns {string} The line up to its first `#`.
 */
function stripShellComment(line) {
  const hash = /(^|\s)#/.exec(line);
  return hash ? line.slice(0, hash.index) : line;
}

/**
 * Guards no `run:` step invokes.
 *
 * The path must start at a word boundary: `scripts/check-x.sh` is a suffix of
 * `qa/scripts/check-x.sh`, so a step running the qa one would otherwise vouch for an
 * uninvoked root-level guard of the same name.
 *
 * @param {string[]} scripts - Repo-relative guard paths.
 * @param {string} workflow - Contents of the workflow file.
 * @param {Set<string>} [exempt] - Guards no job runs on purpose.
 * @returns {string[]} The uninvoked subset, excluding documented exemptions.
 */
export function findUninvokedGuards(scripts, workflow, exempt = NOT_RUN_IN_CI) {
  const invocations = runCommands(workflow);
  return scripts.filter((script) => {
    if (exempt.has(script)) return false;
    const escaped = script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !new RegExp(`(^|[^\\w/-])${escaped}`, 'm').test(invocations);
  });
}

/**
 * Problems with this guard's own wiring.
 *
 * Its filter output can be declared and never consulted, and its globs can drift from
 * GUARD_DIRS — either leaves the guard silent on the paths it names, which nothing else
 * reports. So it checks its own two halves rather than describing them in a comment.
 *
 * @param {string} workflow - Contents of the workflow file.
 * @returns {string[]} Human-readable problems, empty when the wiring holds.
 */
export function findWiringProblems(workflow) {
  const problems = [];

  const block = /\n( +)guard-invocation:\n((?:\1 {2}(?:- '[^']+'|#[^\n]*)\n|\n)+)/.exec(workflow);
  if (!block) {
    problems.push(`${WORKFLOW} declares no guard-invocation filter output`);
  } else {
    const listed = new Set([...block[2].matchAll(/- '([^']+)'/g)].map((match) => match[1]));
    for (const dir of FILTERED_GUARD_DIRS) {
      for (const extension of GUARD_EXTENSIONS) {
        const glob = `${dir}/**/check-*.${extension}`;
        if (!listed.has(glob)) {
          problems.push(`${WORKFLOW} guard-invocation must list '${glob}', a discovery pattern`);
        }
      }
    }
  }

  if (!workflow.includes("needs.changes.outputs.guard-invocation == 'true'")) {
    problems.push(
      `${WORKFLOW} declares guard-invocation but no job's if: consults it, so adding an ` +
        'unwired guard triggers nothing',
    );
  }
  return problems;
}

function selfTest() {
  const workflow = [
    '            # Single-purpose output for qa/scripts/check-named-only.sh.',
    '            named-only:',
    "              - 'qa/scripts/check-named-only.sh'",
    '      - name: Check a thing',
    '        run: bash qa/scripts/check-present.sh',
    '      - name: Check another',
    '        run: node scripts/check-also-present.mjs --self-test',
    '      - name: A block scalar step',
    '        run: |',
    '          node scripts/check-block-scalar.mjs',
    '      - name: A folded scalar with a chomping indicator',
    '        run: >-',
    '          bash qa/scripts/check-folded-scalar.sh',
    '      - name: A step whose invocation was commented out in place',
    '        run: |',
    '          echo "temporarily disabled"',
    '          # bash qa/scripts/check-shell-commented.sh',
    '      # - name: Commented out',
    '      #   run: bash qa/scripts/check-commented-out.sh',
    '      - run: |',
    '          bash qa/scripts/check-compact-form.sh',
    '        working-directory: qa/scripts/check-working-dir.sh',
  ].join('\n');

  const failures = [];

  // Must NOT flag: an inline step, one carrying a trailing flag, a block scalar, and a
  // folded scalar with a chomping indicator. Must flag: absent entirely, named only by a
  // filter entry, named only by a commented-out YAML step, and commented out in place
  // inside a run body — the last three are why the scan is bounded and comments stripped.
  const findings = findUninvokedGuards(
    [
      'qa/scripts/check-present.sh',
      'scripts/check-also-present.mjs',
      'scripts/check-block-scalar.mjs',
      'qa/scripts/check-folded-scalar.sh',
      'qa/scripts/check-missing.sh',
      'qa/scripts/check-named-only.sh',
      'qa/scripts/check-commented-out.sh',
      'qa/scripts/check-shell-commented.sh',
      'qa/scripts/check-compact-form.sh',
      'qa/scripts/check-working-dir.sh',
    ],
    workflow,
  );
  const expected = [
    'qa/scripts/check-missing.sh',
    'qa/scripts/check-named-only.sh',
    'qa/scripts/check-commented-out.sh',
    'qa/scripts/check-shell-commented.sh',
    // Named by a sibling step key, not by a command: the compact `- run:` form's bound
    // must stop at the run key's column or this reads as invoked.
    'qa/scripts/check-working-dir.sh',
  ];
  if (findings.length !== expected.length) {
    failures.push(`expected exactly ${expected.length} uninvoked guards, got ${findings.length}`);
  }
  for (const script of expected) {
    if (!findings.includes(script)) failures.push(`${script} was not flagged`);
  }

  // A same-basename guard in the other directory must not be vouched for by this one.
  const basenameOnly = findUninvokedGuards(['scripts/check-present.sh'], workflow);
  if (basenameOnly.length !== 1) {
    failures.push('a guard sharing a basename with an invoked one was treated as invoked');
  }

  const clean = findUninvokedGuards(['qa/scripts/check-present.sh'], workflow);
  if (clean.length !== 0) {
    failures.push(`expected 0 findings on an invoked guard, got ${clean.length}`);
  }

  // The wiring check must fail on a workflow missing either half, and pass on the real
  // one — otherwise this guard's own trigger can be removed with nothing reporting it.
  // Each half asserted on a fixture supplying the other, so a regression in one is not
  // masked by the other being absent too.
  const declaredOnly = [
    '',
    '            guard-invocation:',
    "              - 'scripts/**/check-*.sh'",
    "              - 'scripts/**/check-*.mjs'",
    "              - 'scripts/**/check-*.ts'",
    '',
  ].join('\n');
  const consumedOnly = "    if: needs.changes.outputs.guard-invocation == 'true'";
  if (!findWiringProblems(`${declaredOnly}\n`).some((p) => p.includes("no job's if:"))) {
    failures.push('findWiringProblems missed a declared-but-never-consulted output');
  }
  if (!findWiringProblems(consumedOnly).some((p) => p.includes('declares no guard-invocation'))) {
    failures.push('findWiringProblems missed a consumed-but-undeclared output');
  }
  if (findWiringProblems(`${declaredOnly}\n${consumedOnly}\n`).length !== 0) {
    failures.push('findWiringProblems flagged a workflow with both halves present');
  }
  const realWiring = findWiringProblems(readFileSync(resolve(REPO_ROOT, WORKFLOW), 'utf8'));
  if (realWiring.length !== 0) {
    failures.push(`findWiringProblems on the real workflow: ${realWiring.join('; ')}`);
  }

  // The exemption path is unexercised in production (the set is empty), so it is asserted
  // here rather than trusted the first time someone adds an entry.
  const exempted = findUninvokedGuards(
    ['qa/scripts/check-missing.sh'],
    workflow,
    new Set(['qa/scripts/check-missing.sh']),
  );
  if (exempted.length !== 0) {
    failures.push('an exempt guard was still flagged as uninvoked');
  }

  // guardScripts() decides what is examined at all, so an empty result is the silent
  // failure this guard exists to avoid. Assert a floor rather than trusting it.
  const discovered = guardScripts();
  if (discovered.length < 10) {
    failures.push(`guardScripts() returned ${discovered.length} scripts; expected at least 10`);
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`SELF-TEST FAIL: ${failure}`);
    process.exit(1);
  }
  console.log(
    `SELF-TEST PASS: ${expected.length} uninvoked guards flagged (including comment- and ` +
      `filter-only mentions), 4 invoked ones and 1 basename collision handled, ` +
      `${discovered.length} guards discovered.`,
  );
}

function main() {
  // Validated before dispatch: checking after would let `--self-test --bogus` report a
  // pass, which is the silent-success shape this guard exists to reject.
  const unknown = process.argv.slice(2).filter((arg) => arg !== '--self-test');
  if (unknown.length > 0) {
    console.error(`Unknown argument: ${unknown[0]}`);
    console.error('Usage: node scripts/check-guard-invocation.mjs [--self-test]');
    process.exit(2);
  }
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }

  const scripts = guardScripts();
  if (scripts.length === 0) {
    console.error('No guard scripts discovered — GUARD_DIRS or git ls-files is broken.');
    process.exit(1);
  }

  const workflow = readFileSync(resolve(REPO_ROOT, WORKFLOW), 'utf8');

  const wiringProblems = findWiringProblems(workflow);
  if (wiringProblems.length > 0) {
    console.error("FAIL: this guard's own wiring is broken.\n");
    for (const problem of wiringProblems) console.error(`  ${problem}`);
    process.exit(1);
  }

  const uninvoked = findUninvokedGuards(scripts, workflow);
  if (uninvoked.length > 0) {
    console.error(`FAIL: ${uninvoked.length} guard script(s) are run by no CI job.\n`);
    for (const script of uninvoked) console.error(`  ${script}`);
    console.error(
      `\nAdd a step invoking it to ${WORKFLOW}, or record it in NOT_RUN_IN_CI with the\n` +
        'reason its value is entirely local. A guard nobody runs still reads as coverage.',
    );
    process.exit(1);
  }
  console.log(
    `OK: all ${scripts.length} guard scripts are invoked by ${WORKFLOW}, and this guard's ` +
      'own filter output is declared and consulted.',
  );
}

// Exact resolution, matching scripts/check-doc-links.mjs: a basename suffix match would
// also fire for a same-named file in another directory.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
