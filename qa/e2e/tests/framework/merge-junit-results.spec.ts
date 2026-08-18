/**
 * Unit tests for merge-junit-results.ts and junit-xml.ts.
 *
 * The two defects under test both fail SILENTLY in CI — a truncated merge
 * reports success, and an attribute-less root reads as "0 tests" to every
 * consumer — so these tests are the only thing that verifies the fix. The CI
 * signals available on a PR run (the dorny GitHub Check, the parse-junit.py PR
 * comment) cannot discriminate: parse-junit.py sums PER-SUITE attributes, not
 * the root, so its row is already correct today and stays correct even with the
 * truncation bug active, because truncation removes testcases and their suite's
 * attributes together.
 *
 * Two tests carry more weight than the rest:
 *
 *  - `real CI artifact` uses a document captured from run 30483113589 rather
 *    than a synthetic fixture, because every structural assumption here (flat
 *    suites, no orphans, accurate per-suite counts) is a claim about what
 *    Playwright actually emits. Note what it does NOT cover: none of its CDATA
 *    blocks happen to contain `</testsuite>`, so the truncation hazard itself is
 *    exercised only by the synthetic TRUNCATING_* fixtures below. The real
 *    artifact pins the document SHAPE; the synthetic ones pin the defect.
 *  - `frozen oracle` pins the OLD regex so the AC 4 ("a regression
 *    test covers the truncation case; it fails against the current
 *    implementation") stays falsifiable after the inline heredocs are deleted.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MergeInputError,
  maskEmbeddedPayloads,
  mergeJUnitDocuments,
  parseArgs,
  run,
} from '../../../scripts/merge-junit-results.js';
import { redactEmbeddedPayloads } from '../../../scripts/junit-xml.js';
// junitXml.ts, NOT verify-test-attestation.ts: the latter imports coverageDb,
// which builds a pg.Pool and loads dotenv/config at module load — verified to
// open two live sockets and rewrite DB_NAME/AUTH_COOKIE_NAME from a
// cwd-relative .env inside the Playwright worker. junitXml.ts is the pure,
// DB-free half, split out for exactly this import.
import {
  hasParseDisagreement,
  parseJUnitResults,
  stripCapturedOutput,
} from '../../../../server/src/scripts/junitXml.js';

const REAL_ARTIFACT = path.join(__dirname, '__fixtures__', 'real-serial-merged-results.xml');

/**
 * A suite whose FIRST testcase carries a payload containing `</testsuite>`, so
 * a scanner that reads the raw text closes the region on the payload and drops
 * the second testcase entirely.
 *
 * The payload is shaped after the real thing: the captured artifact's only
 * CDATA blocks are AI-healer diagnostics that embed raw LLM responses, which is
 * how arbitrary text reaches this document in practice.
 */
const TRUNCATING_SYSTEM_ERR = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
<testsuite name="a.spec.ts" timestamp="2026-07-29T19:49:08.453Z" hostname="desktop" tests="2" failures="0" skipped="0" time="7.8" errors="0">
<testcase name="heals a locator" classname="apps/minicrm/functional/a.spec.ts" time="4.0">
<system-err>
<![CDATA[AiHealer: response appears truncated (does not end with '}'); raw: \`\`\`json
{"selector": "</testsuite>", "confidence": 0.4}
]]>
</system-err>
</testcase>
<testcase name="survives the first testcase" classname="apps/minicrm/functional/a.spec.ts" time="3.8">
</testcase>
</testsuite>
</testsuites>`;

/** Same hazard, but inside a <failure> body rather than <system-err>. */
const TRUNCATING_FAILURE = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
<testsuite name="b.spec.ts" timestamp="2026-07-29T19:49:08.453Z" hostname="desktop" tests="2" failures="1" skipped="0" time="2.0" errors="0">
<testcase name="asserts on markup" classname="apps/minicrm/functional/b.spec.ts" time="1.0">
<failure message="expected markup to match" type="AssertionError">
<![CDATA[Expected: "</testsuite>"
Received: "<testsuite>"
   at b.spec.ts:42]]>
</failure>
</testcase>
<testcase name="survives the failing testcase" classname="apps/minicrm/functional/b.spec.ts" time="1.0">
</testcase>
</testsuite>
</testsuites>`;

function makeSuite(
  name: string,
  hostname: string,
  counts: { tests: number; failures: number; skipped: number; errors: number },
  body: string,
): string {
  return `<testsuite name="${name}" timestamp="2026-07-29T19:49:08.453Z" hostname="${hostname}" tests="${counts.tests}" failures="${counts.failures}" skipped="${counts.skipped}" time="1.0" errors="${counts.errors}">
${body}
</testsuite>`;
}

function wrap(...suites: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n${suites.join('\n')}\n</testsuites>`;
}

function doc(pathName: string, xml: string): { path: string; xml: string } {
  return { path: pathName, xml };
}

/** The defective extraction both ci.yml heredocs used, frozen verbatim. */
function legacyExtractSuites(xml: string): string[] {
  return xml.match(/<testsuite(?!s)[\s\S]*?<\/testsuite>/g) ?? [];
}

test.describe('merge-junit-results — AC 1: truncation on embedded payloads', () => {
  test('preserves every testcase when <system-err> CDATA contains </testsuite>', () => {
    const result = mergeJUnitDocuments([doc('group-0.xml', TRUNCATING_SYSTEM_ERR)]);

    expect(result.suiteCount).toBe(1);
    expect(result.xml).toContain('survives the first testcase');
    expect(parseJUnitResults(result.xml).testCases).toHaveLength(2);
  });

  test('preserves every testcase when a <failure> body contains </testsuite>', () => {
    const result = mergeJUnitDocuments([doc('group-1.xml', TRUNCATING_FAILURE)]);

    expect(result.suiteCount).toBe(1);
    expect(result.xml).toContain('survives the failing testcase');
    expect(parseJUnitResults(result.xml).testCases).toHaveLength(2);
  });

  test('frozen oracle: the old regex DROPS a testcase on the same input (AC 4)', () => {
    // Pins the AC 4. The inline heredocs this replaces are deleted in
    // the following commits, so without this the "fails against the current
    // implementation" requirement becomes unfalsifiable. Frozen on purpose —
    // this is not live code and must not be refactored to call the new module.
    const legacyRegions = legacyExtractSuites(TRUNCATING_SYSTEM_ERR);
    const legacyMerged = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n${legacyRegions.join('\n')}\n</testsuites>`;

    expect(legacyRegions).toHaveLength(1);
    // The damage is worse than "one testcase short". The captured region closes
    // on the payload's `</testsuite>`, which lands INSIDE the first <testcase>,
    // so that testcase loses its own closing tag and the merged document parses
    // to zero rows — the second testcase is gone and the first is unreadable.
    expect(legacyMerged).not.toContain('survives the first testcase');
    expect(parseJUnitResults(legacyMerged).testCases).toHaveLength(0);

    // Same input, same assertions, through the merger: nothing dropped.
    const fixed = mergeJUnitDocuments([doc('group-0.xml', TRUNCATING_SYSTEM_ERR)]);
    expect(fixed.xml).toContain('survives the first testcase');
    expect(parseJUnitResults(fixed.xml).testCases).toHaveLength(2);
  });
});

test.describe('merge-junit-results — AC 2: root attributes', () => {
  test('sums tests/failures/skipped/errors across documents', () => {
    const first = wrap(
      makeSuite(
        'a.spec.ts',
        'desktop',
        { tests: 3, failures: 1, skipped: 1, errors: 0 },
        '<testcase name="t1" classname="a.spec.ts" time="1.0"></testcase>',
      ),
    );
    const second = wrap(
      makeSuite(
        'b.spec.ts',
        'desktop',
        { tests: 2, failures: 0, skipped: 0, errors: 1 },
        '<testcase name="t2" classname="b.spec.ts" time="1.0"></testcase>',
      ),
    );

    const result = mergeJUnitDocuments([doc('g0.xml', first), doc('g1.xml', second)]);

    expect(result.totals).toEqual({ tests: 5, failures: 1, skipped: 1, errors: 1 });
    expect(result.xml).toContain('<testsuites tests="5" failures="1" skipped="1" errors="1">');
  });

  test('omits time/id/name from the root', () => {
    const result = mergeJUnitDocuments([doc('g0.xml', TRUNCATING_SYSTEM_ERR)]);
    const rootTag = /<testsuites\b[^>]*>/.exec(result.xml)?.[0] ?? '';

    expect(rootTag).not.toContain('time=');
    expect(rootTag).not.toContain('id=');
    expect(rootTag).not.toContain('name=');
  });

  test('treats malformed count attributes as contributing zero', () => {
    // Malformed count attributes must contribute 0 rather than a partially
    // parsed number. `parseInt` would accept a valid prefix and silently turn
    // "3abc" into 3, "2.9" into 2 and "1e3" into 1 — a plausible-looking root
    // that is quietly wrong, which is the failure class this module removes.
    // Contributing 0 instead makes `tests` disagree with the recovered row count
    // so hasParseDisagreement reports the document as unreliable. These cases
    // found the prefix-parsing bug they now pin.
    for (const bad of ['-3', 'abc', '', '1e3', '3abc', '2.9', ' 4']) {
      const xml = wrap(
        `<testsuite name="a.spec.ts" hostname="desktop" tests="${bad}" failures="${bad}" skipped="${bad}" errors="${bad}">\n<testcase name="t" classname="a.spec.ts" time="1.0"></testcase>\n</testsuite>`,
      );

      const result = mergeJUnitDocuments([doc('g0.xml', xml)]);

      expect(result.totals, `tests="${bad}" must contribute 0`).toEqual({
        tests: 0,
        failures: 0,
        skipped: 0,
        errors: 0,
      });
    }
  });

  test('treats a suite missing count attributes as contributing zero', () => {
    const xml = wrap(
      '<testsuite name="a.spec.ts" hostname="desktop">\n<testcase name="t" classname="a.spec.ts" time="1.0"></testcase>\n</testsuite>',
    );

    const result = mergeJUnitDocuments([doc('g0.xml', xml)]);

    expect(result.totals).toEqual({ tests: 0, failures: 0, skipped: 0, errors: 0 });
  });
});

test.describe('merge-junit-results — real CI artifact (AC 3)', () => {
  const realXml = (): string => fs.readFileSync(REAL_ARTIFACT, 'utf-8');

  test('the captured artifact reproduces defect 2 before merging', () => {
    // The artifact IS the current implementation's output, from a green run.
    // Its root carries no attributes, so the parser reports zero tests for a
    // document that actually holds 146.
    const parsed = parseJUnitResults(realXml());

    expect(parsed.totalTests).toBe(0);
    expect(parsed.testCases.length).toBeGreaterThan(0);
  });

  test('re-merging it yields a root whose counts match its rows', () => {
    const result = mergeJUnitDocuments([doc('real.xml', realXml())]);
    const parsed = parseJUnitResults(result.xml);

    expect(result.suiteCount).toBe(25);
    expect(parsed.totalTests).toBe(146);
    expect(parsed.testCases).toHaveLength(146);
    expect(parsed.totalSkipped).toBe(2);
    expect(hasParseDisagreement(parsed)).toBe(false);
  });

  test('preserves captured output and failure bodies byte-for-byte', () => {
    const original = realXml();
    const result = mergeJUnitDocuments([doc('real.xml', original)]);

    // The parse-junit.py contract: it reads <failure> bodies to build the PR
    // comment, so payloads must survive the merge unmodified.
    const cdataBlocks = original.match(/<!\[CDATA\[[\s\S]*?\]\]>/g) ?? [];
    expect(cdataBlocks.length).toBeGreaterThan(0);
    for (const block of cdataBlocks) {
      expect(result.xml).toContain(block);
    }
  });
});

test.describe('junit-xml — masking invariants', () => {
  test('masking preserves total document length', () => {
    for (const xml of [
      TRUNCATING_SYSTEM_ERR,
      TRUNCATING_FAILURE,
      fs.readFileSync(REAL_ARTIFACT, 'utf-8'),
    ]) {
      expect(maskEmbeddedPayloads(xml)).toHaveLength(xml.length);
    }
  });

  test('masking leaves no markup characters inside a payload', () => {
    const masked = maskEmbeddedPayloads(TRUNCATING_SYSTEM_ERR);

    // The payload's own `</testsuite>` text must be gone from the masked copy,
    // while the suite's real closing tag survives.
    expect(masked).not.toContain('"</testsuite>", "confidence"');
    expect(masked).toContain('</testsuite>');
    expect(masked).toContain('<testcase name="survives the first testcase"');
  });

  test('parity: this module and the server-side stripper redact the same regions', () => {
    // Decision-2 drift guard, and the ONLY thing pinning it. The merger's rule
    // lives in qa/ because this workspace must not import server/'s DB-bound
    // modules at runtime, so the CDATA rule genuinely exists twice. This test
    // is what keeps the two from diverging: it runs the real server-side
    // `stripCapturedOutput` against this module's strip policy over the same
    // inputs and requires byte-identical output.
    //
    // They agree exactly only once <system-out>/<system-err> tag removal is
    // accounted for: the server stripper deletes those elements outright
    // (nothing downstream reads them) while this module preserves all four
    // element tags so a length-preserving mask remains possible. Normalizing
    // the emptied wrappers away on this side makes the comparison total rather
    // than partial — every payload region, not just a sampled one.
    for (const xml of [
      TRUNCATING_SYSTEM_ERR,
      TRUNCATING_FAILURE,
      fs.readFileSync(REAL_ARTIFACT, 'utf-8'),
    ]) {
      const serverStripped = stripCapturedOutput(xml);
      const qaStripped = redactEmbeddedPayloads(xml, () => '').replace(
        /<(system-out|system-err)\b[^>]*><\/\1>/g,
        '',
      );

      expect(qaStripped).toBe(serverStripped);
    }
  });
});

test.describe('merge-junit-results — input contracts', () => {
  test('throws when given no documents', () => {
    expect(() => mergeJUnitDocuments([])).toThrow(MergeInputError);
  });

  test('fails on an empty document by default', () => {
    // Default-fatal: an empty input is silent partial data that neither
    // --expected-files nor hasParseDisagreement can detect downstream. A group
    // that crashed after creating its JUnit file looks exactly like this.
    const empty = '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n</testsuites>';
    const populated = wrap(
      makeSuite(
        'a.spec.ts',
        'desktop',
        { tests: 1, failures: 0, skipped: 0, errors: 0 },
        '<testcase name="t" classname="a.spec.ts" time="1.0"></testcase>',
      ),
    );

    expect(() => mergeJUnitDocuments([doc('empty.xml', empty), doc('ok.xml', populated)])).toThrow(
      MergeInputError,
    );
  });

  test('skips an empty document when the caller opts in', () => {
    const empty = '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n</testsuites>';
    const populated = wrap(
      makeSuite(
        'a.spec.ts',
        'desktop',
        { tests: 1, failures: 0, skipped: 0, errors: 0 },
        '<testcase name="t" classname="a.spec.ts" time="1.0"></testcase>',
      ),
    );

    const result = mergeJUnitDocuments([doc('empty.xml', empty), doc('ok.xml', populated)], {
      allowEmptyInputs: true,
    });

    expect(result.emptyDocuments).toEqual(['empty.xml']);
    expect(result.suiteCount).toBe(1);
    expect(result.totals.tests).toBe(1);
  });

  test('fails even with the opt-in when every document is empty', () => {
    const empty = '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n</testsuites>';

    expect(() =>
      mergeJUnitDocuments([doc('a.xml', empty), doc('b.xml', empty)], { allowEmptyInputs: true }),
    ).toThrow(MergeInputError);
  });

  test('rejects a document with a testcase outside any testsuite', () => {
    const orphaned = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
<testcase name="orphan" classname="a.spec.ts" time="1.0"></testcase>
</testsuites>`;

    expect(() => mergeJUnitDocuments([doc('orphan.xml', orphaned)])).toThrow(MergeInputError);
  });

  test('does not let a self-closing <testsuite/> swallow the next suite', () => {
    // Regression guard for a re-expression of this ticket's own defect 2. When a
    // self-closing suite is not recognized as a region, the NEXT match's
    // non-greedy body starts at the self-closing tag and runs to the populated
    // suite's </testsuite> — collapsing both into one region carrying the empty
    // suite's attributes. The root then declared tests="0" for a document holding
    // 2 tests and 1 failure, and hasParseDisagreement could not catch it because
    // that check is guarded on totalTests > 0.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
<testsuite name="empty-spec" hostname="mobile-web" tests="0" failures="0" skipped="0" errors="0"/>
${makeSuite('b.spec.ts', 'desktop', { tests: 2, failures: 1, skipped: 0, errors: 0 }, '<testcase name="t1" classname="b.spec.ts" time="1.0"><failure message="boom"/></testcase>\n<testcase name="t2" classname="b.spec.ts" time="1.0"></testcase>')}
</testsuites>`;

    const result = mergeJUnitDocuments([doc('g0.xml', xml)]);

    expect(result.suiteCount).toBe(2);
    expect(result.totals).toEqual({ tests: 2, failures: 1, skipped: 0, errors: 0 });
    // The empty suite still reaches the output rather than being absorbed.
    expect(result.xml).toContain('empty-spec');
  });

  test('keeps sibling suites from different projects separate', () => {
    const xml = wrap(
      makeSuite(
        'a.spec.ts',
        'desktop',
        { tests: 1, failures: 0, skipped: 0, errors: 0 },
        '<testcase name="t" classname="a.spec.ts" time="1.0"></testcase>',
      ),
      makeSuite(
        'a.spec.ts',
        'mobile-web',
        { tests: 1, failures: 0, skipped: 0, errors: 0 },
        '<testcase name="t" classname="a.spec.ts" time="1.0"></testcase>',
      ),
    );

    const result = mergeJUnitDocuments([doc('g0.xml', xml)]);
    const parsed = parseJUnitResults(result.xml);

    expect(result.suiteCount).toBe(2);
    expect(parsed.testCases.map((c) => c.project).sort()).toEqual(['desktop', 'mobile-web']);
  });
});

test.describe('merge-junit-results — run() end to end', () => {
  // run() is the only entry point CI ever calls, and it owns the file I/O plus
  // the --expected-files shortfall guard that replaces e2e-aggregate's existing
  // EXPECTED_SHARDS hard-fail. Migrating a completeness protection onto an
  // untested path would be the same class of risk this ticket closes, so it is
  // exercised here rather than only through mergeJUnitDocuments.
  let workDir = '';

  test.beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-junit-run-'));
  });

  test.afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  function writeInput(name: string, xml: string): string {
    const inputPath = path.join(workDir, name);
    fs.writeFileSync(inputPath, xml, 'utf-8');
    return inputPath;
  }

  test('writes the merged document, creating a missing output directory', () => {
    const input = writeInput('group-0.xml', TRUNCATING_SYSTEM_ERR);
    // Nested path that does not exist yet — CI writes into test-results/, which
    // may not have been created when every group failed early.
    const output = path.join(workDir, 'nested', 'deeper', 'results.xml');

    run(['node', 'merge-junit-results.ts', '--output', output, input]);

    const written = fs.readFileSync(output, 'utf-8');
    expect(written).toContain('<testsuites tests="2" failures="0" skipped="0" errors="0">');
    expect(written).toContain('survives the first testcase');
  });

  test('exits non-zero via MergeInputError when fewer files than --expected-files', () => {
    const input = writeInput('group-0.xml', TRUNCATING_SYSTEM_ERR);
    const output = path.join(workDir, 'results.xml');

    expect(() =>
      run(['node', 'merge-junit-results.ts', '--output', output, '--expected-files', '3', input]),
    ).toThrow(MergeInputError);
    expect(fs.existsSync(output)).toBe(false);
  });

  test('accepts a file count equal to --expected-files', () => {
    const first = writeInput('group-0.xml', TRUNCATING_SYSTEM_ERR);
    const second = writeInput('group-1.xml', TRUNCATING_FAILURE);
    const output = path.join(workDir, 'results.xml');

    run([
      'node',
      'merge-junit-results.ts',
      '--output',
      output,
      '--expected-files',
      '2',
      first,
      second,
    ]);

    expect(fs.readFileSync(output, 'utf-8')).toContain('<testsuites tests="4"');
  });

  test('throws and writes nothing when no input paths are given', () => {
    const output = path.join(workDir, 'results.xml');

    expect(() => run(['node', 'merge-junit-results.ts', '--output', output])).toThrow(
      MergeInputError,
    );
    expect(fs.existsSync(output)).toBe(false);
  });

  test('throws and writes nothing when every input document is empty', () => {
    const empty = writeInput('empty.xml', '<?xml version="1.0"?>\n<testsuites>\n</testsuites>');
    const output = path.join(workDir, 'results.xml');

    // The silent-partial-data case: files present, all empty. --expected-files
    // cannot catch it, so mergeJUnitDocuments must refuse rather than emit a
    // zero-count document that reads as a clean run.
    expect(() => run(['node', 'merge-junit-results.ts', '--output', output, empty])).toThrow(
      MergeInputError,
    );
    expect(fs.existsSync(output)).toBe(false);
  });

  test('reports an unreadable input as MergeInputError, not a raw ENOENT', () => {
    const output = path.join(workDir, 'results.xml');
    const missing = path.join(workDir, 'does-not-exist.xml');

    // The likeliest real input error at both call sites (a `find` result racing
    // artifact download); it must join this module's error taxonomy so the
    // top-level handler prefixes it rather than dumping a bare stack trace.
    expect(() => run(['node', 'merge-junit-results.ts', '--output', output, missing])).toThrow(
      MergeInputError,
    );
  });

  test('--allow-empty-inputs lets a zero-suite file through', () => {
    const empty = writeInput('empty.xml', '<?xml version="1.0"?>\n<testsuites>\n</testsuites>');
    const populated = writeInput('group-1.xml', TRUNCATING_FAILURE);
    const output = path.join(workDir, 'results.xml');

    run([
      'node',
      'merge-junit-results.ts',
      '--output',
      output,
      '--allow-empty-inputs',
      empty,
      populated,
    ]);

    expect(fs.readFileSync(output, 'utf-8')).toContain('<testsuites tests="2"');
  });

  test('writes a parseable non-zero document for the mixed empty+populated case (AC 3)', () => {
    // This is the shape the e2e-serial call site actually hits in production:
    // Playwright emits a zero-<testsuite> document whenever a group matches no
    // tests or its globalSetup throws, so a real run mixes empty and populated
    // group files. The surviving rows must reach the merged file — failing here
    // instead would blank the GitHub Check, the artifact and the PR-comment row.
    const emptyLikePlaywright = writeInput(
      'group-0.xml',
      '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites id="" name="" tests="0" failures="0" skipped="0" errors="0" time="0.1">\n</testsuites>',
    );
    const populated = writeInput('group-1.xml', fs.readFileSync(REAL_ARTIFACT, 'utf-8'));
    const output = path.join(workDir, 'results.xml');

    run([
      'node',
      'merge-junit-results.ts',
      '--output',
      output,
      '--expected-files',
      '2',
      '--allow-empty-inputs',
      emptyLikePlaywright,
      populated,
    ]);

    const parsed = parseJUnitResults(fs.readFileSync(output, 'utf-8'));
    expect(parsed.totalTests).toBe(146);
    expect(parsed.testCases).toHaveLength(146);
    expect(hasParseDisagreement(parsed)).toBe(false);
  });
});

test.describe('merge-junit-results — parseArgs', () => {
  test('parses output, expected-files and positional inputs', () => {
    const args = parseArgs([
      'node',
      'merge-junit-results.ts',
      '--output',
      'out.xml',
      '--expected-files',
      '3',
      'a.xml',
      'b.xml',
    ]);

    expect(args).toEqual({
      output: 'out.xml',
      expectedFiles: 3,
      inputs: ['a.xml', 'b.xml'],
      allowEmptyInputs: false,
    });
  });

  test('defaults expected-files to null when absent', () => {
    const args = parseArgs(['node', 'merge-junit-results.ts', '--output', 'out.xml', 'a.xml']);

    expect(args.expectedFiles).toBeNull();
  });

  test('throws without --output', () => {
    expect(() => parseArgs(['node', 'merge-junit-results.ts', 'a.xml'])).toThrow(MergeInputError);
  });

  test('throws on an unknown flag', () => {
    expect(() =>
      parseArgs(['node', 'merge-junit-results.ts', '--output', 'o.xml', '--nope', 'a.xml']),
    ).toThrow(MergeInputError);
  });

  test('refuses another flag as a flag value', () => {
    // Without this guard, output becomes the literal "--expected-files", "3"
    // becomes an input path, and the completeness guard silently disappears.
    expect(() =>
      parseArgs(['node', 'merge-junit-results.ts', '--output', '--expected-files', '3', 'a.xml']),
    ).toThrow(MergeInputError);
  });

  test('rejects a non-integer, negative or junk --expected-files', () => {
    for (const bad of ['-3', '3abc', '2.9', 'abc', '']) {
      expect(() =>
        parseArgs([
          'node',
          'merge-junit-results.ts',
          '--output',
          'o.xml',
          '--expected-files',
          bad,
          'a.xml',
        ]),
      ).toThrow(MergeInputError);
    }
  });

  test('parses --allow-empty-inputs as a boolean flag', () => {
    const args = parseArgs([
      'node',
      'merge-junit-results.ts',
      '--output',
      'o.xml',
      '--allow-empty-inputs',
      'a.xml',
    ]);

    expect(args.allowEmptyInputs).toBe(true);
    expect(args.inputs).toEqual(['a.xml']);
  });

  test('defaults allowEmptyInputs to false', () => {
    const args = parseArgs(['node', 'merge-junit-results.ts', '--output', 'o.xml', 'a.xml']);

    expect(args.allowEmptyInputs).toBe(false);
  });
});
