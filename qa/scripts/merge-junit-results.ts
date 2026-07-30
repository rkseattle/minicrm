/**
 * Merges per-shard / per-conflict-group Playwright JUnit XML files into one
 * self-describing <testsuites> document. (MINCRM-689)
 *
 *   npx tsx qa/scripts/merge-junit-results.ts \
 *     --output qa/e2e/test-results/results.xml \
 *     --expected-files 5 \
 *     path/to/group-0.xml path/to/group-1.xml …
 *
 * Called from two steps in .github/workflows/ci.yml — the e2e-serial
 * conflict-group merge (`Merge conflict-group JUnit XML results`) and the
 * e2e-aggregate shard merge (`Merge JUnit XML results`). Each previously carried
 * its own byte-identical inline `node --input-type=module` heredoc, sharing the
 * same two defects:
 *
 *  1. TRUNCATION. Both matched suites with a bare non-greedy
 *     /<testsuite(?!s)[\s\S]*?<\/testsuite>/g over the raw document, so a
 *     captured-output payload containing the text `</testsuite>` closed the
 *     region early and silently dropped every later testcase in that file. The
 *     merge still reported success, so the run looked green. See junit-xml.ts
 *     for why this is a live hazard rather than a theoretical one.
 *
 *  2. NO ROOT ATTRIBUTES. Both emitted a bare `<testsuites>`, so every consumer
 *     reading tests/failures/skipped/errors off the root got 0. Verified against
 *     real CI output (run 30483113589): both merged artifacts have a
 *     zero-attribute root, which means parseJUnitResults reports totalTests: 0
 *     for real green runs today and the hasParseDisagreement backstop — guarded
 *     on `> 0` — is inert.
 *
 * MASK-THEN-SCAN, EMIT FROM THE ORIGINAL
 * --------------------------------------
 * Suite regions are located in a MASKED copy of each document (payload bytes
 * replaced 1:1 with a filler character) and then sliced out of the ORIGINAL,
 * unmasked text at the same offsets. Masking preserves byte length precisely so
 * those offsets stay valid.
 *
 * Emitting the original rather than the masked text is required, not cosmetic:
 * .github/scripts/parse-junit.py reads `(fail.text or fail.attrib['message'])`
 * — the <failure> BODY first, attribute only as fallback — to build the PR
 * comment's failure details. Emitting redacted bodies would turn every failure
 * block in that comment into an empty code fence.
 *
 * COMPLETENESS IS THE CALLER'S CONTRACT
 * ------------------------------------
 * This script sums what it is given, so it cannot detect a missing input FILE
 * on its own — a 4-of-5-group merge would self-report as internally consistent.
 * `--expected-files` exists so each caller can assert its own expectation
 * (the e2e-aggregate job's pre-existing EXPECTED_SHARDS check moves into it).
 */

import fs from 'node:fs';
import path, { resolve as resolvePath } from 'node:path';
import {
  extractNumericAttr,
  redactEmbeddedPayloads,
  suiteRegionPattern,
  testCasePattern,
} from './junit-xml.js';

/**
 * Filler byte for masked payloads. A space is chosen because it cannot be
 * mistaken for markup by any structural pattern here, and it keeps a masked
 * document readable when dumped during debugging.
 */
const MASK_FILLER = ' ';

/** Counts the merged document declares on its root, summed across suites. */
export interface JUnitTotals {
  tests: number;
  failures: number;
  skipped: number;
  errors: number;
}

export interface MergeResult {
  /** The merged XML document. */
  xml: string;
  /** Suite regions carried through, in input order. */
  suiteCount: number;
  totals: JUnitTotals;
  /** Input paths that yielded no suites at all, reported but not fatal. */
  emptyDocuments: string[];
}

/**
 * Replaces every reporter-captured payload with an equal-length run of
 * MASK_FILLER, so the returned string has the same length as the input and
 * every structural byte keeps its original index.
 *
 * This is the merger's half of the shared rule in junit-xml.ts. The
 * server-side `stripCapturedOutput` is the other half: same regions, different
 * output policy.
 */
export function maskEmbeddedPayloads(xml: string): string {
  return redactEmbeddedPayloads(xml, (payload) => MASK_FILLER.repeat(payload.length));
}

/**
 * Thrown for input this script refuses to merge, as distinct from input it
 * merges with a warning. Carries no exit code of its own — `main` maps it.
 */
export class MergeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MergeInputError';
  }
}

/**
 * Thrown when one of this script's own invariants is violated — distinct from
 * MergeInputError so a caller can tell "your files are wrong" from "this script
 * is broken", which are differently actionable.
 */
export class MergeInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MergeInvariantError';
  }
}

/** A single suite region, sliced verbatim from its source document. */
interface SuiteRegion {
  /** The full <testsuite …>…</testsuite> text, from the ORIGINAL document. */
  text: string;
  /** Opening-tag attribute text, read from the masked copy (structure only). */
  attrs: string;
}

/**
 * Locates every <testsuite> region in one document and returns each sliced from
 * the original text.
 *
 * Also asserts the document has no <testcase> outside a suite. Real reporter
 * output never does — `onEnd` pushes only `_buildTestSuite()` results as direct
 * children of <testsuites>, and both captured CI artifacts confirm zero
 * orphans. An orphan therefore means the reporter's output shape changed, which
 * must fail loudly rather than be silently dropped from the merge or silently
 * accommodated by inventing a synthetic wrapper for it.
 */
function extractSuiteRegions(xml: string, sourcePath: string): SuiteRegion[] {
  const masked = maskEmbeddedPayloads(xml);
  // A mask that changed length would invalidate every offset below, so this is
  // asserted rather than assumed — it is the invariant the whole approach rests
  // on.
  if (masked.length !== xml.length) {
    throw new MergeInvariantError(
      `Masking changed document length for ${sourcePath} (${xml.length} → ${masked.length}), so slice offsets into the original would be wrong. This is a bug in maskEmbeddedPayloads, not a problem with the input.`,
    );
  }

  const regions: SuiteRegion[] = [];
  const suitePattern = suiteRegionPattern();
  let match: RegExpExecArray | null;
  while ((match = suitePattern.exec(masked)) !== null) {
    regions.push({
      // Slice from the ORIGINAL so captured output and failure bodies survive
      // byte-for-byte; the masked copy is only a map of where things are.
      text: xml.slice(match.index, match.index + match[0].length),
      attrs: match[1],
    });
  }

  assertNoOrphanTestCases(masked, sourcePath);
  return regions;
}

/**
 * Fails when a <testcase> sits outside every <testsuite> region.
 *
 * The message deliberately reports only what was observed. Two different causes
 * produce this shape and they need different fixes, so naming one would
 * misdirect: either the reporter's output structure changed (real orphans), or a
 * payload this module failed to redact split a suite region and left a trailing
 * fragment. Dropping the row silently is not an option — for an all-pass gate a
 * dropped row is a hidden failure — so this fails loudly and names the file and
 * the row.
 */
function assertNoOrphanTestCases(maskedXml: string, sourcePath: string): void {
  const withoutSuites = maskedXml.replace(suiteRegionPattern(), '');
  const orphan = testCasePattern().exec(withoutSuites);
  if (orphan !== null) {
    const name = formatTestCaseName(orphan[1]);
    throw new MergeInputError(
      `${sourcePath} has a <testcase>${name} that is not inside any <testsuite>, so this merger cannot attribute it to a suite and refuses to drop it. Either the JUnit reporter's output structure has changed, or a captured payload in this file was not redacted and split its enclosing <testsuite> region.`,
    );
  }
}

/** Best-effort ` name="…"` fragment for an error message; empty when absent. */
function formatTestCaseName(attrs: string): string {
  const match = /\bname="([^"]*)"/.exec(attrs);
  return match ? ` name="${match[1]}"` : '';
}

/** Sums the four count attributes across suite opening tags. */
function sumTotals(regions: readonly SuiteRegion[]): JUnitTotals {
  return regions.reduce<JUnitTotals>(
    (totals, region) => ({
      tests: totals.tests + extractNumericAttr(region.attrs, 'tests'),
      failures: totals.failures + extractNumericAttr(region.attrs, 'failures'),
      skipped: totals.skipped + extractNumericAttr(region.attrs, 'skipped'),
      errors: totals.errors + extractNumericAttr(region.attrs, 'errors'),
    }),
    { tests: 0, failures: 0, skipped: 0, errors: 0 },
  );
}

/**
 * Merges the given JUnit documents into one.
 *
 * Only the four counts named by MINCRM-689's acceptance criteria are emitted on
 * the root. `time`, `id` and `name` are deliberately omitted: the reporter's
 * root `time` is wall-clock (`result.duration / 1e3`) while each suite's `time`
 * is its summed test durations, so a summed root `time` would exceed wall clock
 * whenever a group runs multiple workers — a new, knowably-wrong number fed to
 * dorny/test-reporter, whose handling of it cannot be verified from this repo.
 * Today the attribute is absent; keeping it absent is strictly closer to
 * current behavior.
 */
export function mergeJUnitDocuments(
  documents: ReadonlyArray<{ path: string; xml: string }>,
  options: { allowEmptyInputs?: boolean } = {},
): MergeResult {
  if (documents.length === 0) {
    throw new MergeInputError('No input documents given — nothing to merge.');
  }

  const regions: SuiteRegion[] = [];
  const emptyDocuments: string[] = [];
  for (const document of documents) {
    const documentRegions = extractSuiteRegions(document.xml, document.path);
    if (documentRegions.length === 0) {
      emptyDocuments.push(document.path);
      continue;
    }
    regions.push(...documentRegions);
  }

  // An empty input file is silent partial data, so it is fatal unless the caller
  // opts out: neither --expected-files (the file is present) nor
  // hasParseDisagreement (the root sum stays consistent with the surviving rows)
  // can detect it downstream.
  if (emptyDocuments.length > 0 && !options.allowEmptyInputs) {
    throw new MergeInputError(
      `No <testsuite> elements in ${emptyDocuments.length} of ${documents.length} input file(s): ${emptyDocuments.join(', ')}. A group that crashed after creating its JUnit file looks exactly like this. Pass --allow-empty-inputs if a zero-test input is legitimate for this caller.`,
    );
  }

  if (regions.length === 0) {
    // Reachable only with --allow-empty-inputs: every file was permitted to be
    // empty and all of them were. Emitting `<testsuites tests="0" …>` and
    // exiting 0 would be the exact silent-green outcome this ticket closes, so
    // this stays fatal regardless of the opt-out.
    throw new MergeInputError(
      `No <testsuite> elements found in any of the ${documents.length} input file(s): ${documents
        .map((document) => document.path)
        .join(', ')}. Every group/shard produced an empty or unparseable JUnit document.`,
    );
  }

  const totals = sumTotals(regions);
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${totals.tests}" failures="${totals.failures}" skipped="${totals.skipped}" errors="${totals.errors}">`,
    ...regions.map((region) => region.text),
    '</testsuites>',
  ].join('\n');

  return { xml, suiteCount: regions.length, totals, emptyDocuments };
}

export interface CliArgs {
  output: string;
  inputs: string[];
  /** When set, fewer input files than this is a hard failure. */
  expectedFiles: number | null;
  /**
   * When true, an input file containing no <testsuite> is warned about and
   * skipped instead of failing the merge.
   *
   * Defaults to FALSE — fatal — so a caller has to think about it: an empty file
   * is silent partial data that nothing downstream can detect
   * (`--expected-files` sees a present file, and hasParseDisagreement sees a
   * root sum consistent with whatever rows survived).
   *
   * BOTH current CI call sites pass it, for the same reason: Playwright emits a
   * zero-`<testsuite>` document whenever a group or shard matches no tests or its
   * globalSetup throws, and refusing to merge over that would discard every
   * other group's or shard's rows AND write no output file at all — blanking the
   * GitHub Check, the uploaded artifact and the PR-comment row. A failed
   * group/shard is already reported by its own job's exit code, so this merger
   * is not the detector; its job is to preserve whatever did run. An all-empty
   * merge stays fatal regardless of this flag.
   */
  allowEmptyInputs: boolean;
}

/**
 * Parses `--output <path>`, `--expected-files <n>` and positional input paths.
 * Space-separated flags match qa/scripts/merge-healing-artifacts.ts, the
 * established shape for CI-invoked merge scripts in this workspace.
 */
export function parseArgs(argv: readonly string[]): CliArgs {
  let output = '';
  let expectedFiles: number | null = null;
  let allowEmptyInputs = false;
  const inputs: string[] = [];

  /**
   * Reads a flag's value, refusing another flag as the value. Without this,
   * `--output --expected-files 3 a.xml` sets output to the literal string
   * "--expected-files", treats "3" as an input path, and SILENTLY DROPS the
   * completeness guard — producing exactly the partial-green-masks-failures
   * outcome this module exists to prevent.
   */
  const takeValue = (flag: string, next: string | undefined): string => {
    if (next === undefined || next.startsWith('--')) {
      throw new MergeInputError(`${flag} requires a value.`);
    }
    return next;
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--output') {
      output = takeValue('--output', argv[++i]);
    } else if (arg === '--expected-files') {
      const raw = takeValue('--expected-files', argv[++i]);
      // Strict: reject trailing junk ("3abc" → 3), fractions ("2.9" → 2) and
      // negatives ("-3", which would make the `inputs.length < expectedFiles`
      // check below unsatisfiable and disable the guard entirely).
      if (!/^\d+$/.test(raw)) {
        throw new MergeInputError(
          `--expected-files requires a non-negative integer, got "${raw}".`,
        );
      }
      expectedFiles = Number(raw);
    } else if (arg === '--allow-empty-inputs') {
      allowEmptyInputs = true;
    } else if (arg !== undefined && arg.startsWith('--')) {
      throw new MergeInputError(`Unknown flag: ${arg}`);
    } else if (arg !== undefined) {
      inputs.push(arg);
    }
  }

  if (!output) {
    throw new MergeInputError(
      'Usage: merge-junit-results.ts --output <file> [--expected-files <n>] [--allow-empty-inputs] <input.xml…>',
    );
  }
  return { output, inputs, expectedFiles, allowEmptyInputs };
}

export function run(argv: readonly string[]): void {
  const { output, inputs, expectedFiles, allowEmptyInputs } = parseArgs(argv);

  if (inputs.length === 0) {
    throw new MergeInputError(
      'No input JUnit XML files given — every group/shard failed before Playwright ran.',
    );
  }
  if (expectedFiles !== null && inputs.length < expectedFiles) {
    throw new MergeInputError(
      `Only ${inputs.length}/${expectedFiles} input JUnit XML files found. Some groups/shards failed before Playwright ran and produced no output. Failing to prevent a partial green result from masking real failures.\nFiles found: ${inputs.join(', ')}`,
    );
  }

  // Wrapped so an unreadable input joins this module's error taxonomy instead of
  // escaping as a bare ENOENT stack trace. This is the likeliest real input
  // error at both call sites — a `find` result racing artifact download — and
  // it was the one case that bypassed the MergeInputError/MergeInvariantError
  // split and the top-level `[merge-junit-results]` prefix.
  const documents = inputs.map((inputPath) => {
    try {
      return { path: inputPath, xml: fs.readFileSync(inputPath, 'utf-8') };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new MergeInputError(`Cannot read input JUnit XML file ${inputPath}: ${reason}`);
    }
  });

  const result = mergeJUnitDocuments(documents, { allowEmptyInputs });

  for (const emptyPath of result.emptyDocuments) {
    console.warn(`[merge-junit-results] No <testsuite> elements in ${emptyPath} — skipped.`);
  }

  const outputDir = path.dirname(output);
  if (outputDir) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(output, result.xml, 'utf-8');

  const { tests, failures, skipped, errors } = result.totals;
  console.log(
    `[merge-junit-results] Merged ${documents.length} file(s), ${result.suiteCount} testsuite(s) → ${output} ` +
      `(tests=${tests} failures=${failures} skipped=${skipped} errors=${errors})`,
  );
}

// Only run when invoked directly, not when imported by tests.
//
// Compares fully resolved paths against __filename rather than using
// `import.meta.url`: this workspace's package.json has no `"type": "module"`, so
// `import.meta` makes the file unloadable here — it fails with "Failed to load
// the ES module … set \"type\": \"module\"" and takes the whole framework suite
// down with it (observed). Comparing resolved paths is exact, where a basename
// or `endsWith` test would also fire for any same-named file elsewhere in the
// repo importing this as a library.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolvePath(invokedPath) === resolvePath(__filename)) {
  try {
    run(process.argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[merge-junit-results] ${message}`);
    process.exit(1);
  }
}
