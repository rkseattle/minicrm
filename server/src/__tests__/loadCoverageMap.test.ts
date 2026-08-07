/**
 * Unit tests for load-coverage-map.ts's argument parsing. (MINCRM-696)
 *
 * Narrow by design: only `parseArgs` is covered here. The rest of the script is
 * a DB-backed loader whose one collaborator, loadCoverageTestLinksForCommit, is
 * already exercised by coverageMappingService.test.ts against the real test
 * database — re-testing it through this CLI wrapper would duplicate that
 * coverage without adding a property.
 *
 * What `parseArgs` DOES carry is a correctness property that nothing pinned
 * before: the `=`-preserving split. `--sha` is not always a 40-hex SHA —
 * pre-push-tia.ts's resolveMainSha falls back to the literal symbolic ref
 * `main`, and a git ref may legally contain '=' (`git check-ref-format
 * 'refs/heads/foo=bar'` exits 0). Truncating at the first '=' would key
 * coverage_test_links to a DIFFERENT commit, silently narrowing the selection
 * that mapping feeds — with no error anywhere.
 *
 * Importing this module pulls in coverageDb, a pg.Pool. That is safe for the
 * same reason it is safe in verifyTestAttestation.test.ts: `new pg.Pool()` is
 * lazy and opens no socket until query()/connect(), and the script's
 * direct-invocation guard keeps main() from firing under Vitest. (MINCRM-691
 * documents the same property at length for the sibling script.)
 */

import { vi } from 'vitest';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join as joinPath, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  parseArgs,
  loadCoverageMap,
  CoverageMapUnreadableError,
} from '../scripts/load-coverage-map.js';
import coverageDb from '../coverageDb.js';
import * as coverageMappingService from '../services/coverageMappingService.js';

describe('load-coverage-map parseArgs', () => {
  it('reads a plain commit SHA', () => {
    expect(parseArgs(['--sha=deadbeefcafe'])).toEqual({ sha: 'deadbeefcafe' });
  });

  it('reads a symbolic ref, which resolveMainSha falls back to', () => {
    expect(parseArgs(['--sha=main'])).toEqual({ sha: 'main' });
  });

  // The property this file exists for. A "simplification" to .split('=')[1]
  // passes every other test here and truncates this one to 'refs/heads/foo'.
  it('preserves an "=" inside the ref rather than truncating at it', () => {
    expect(parseArgs(['--sha=refs/heads/foo=bar'])).toEqual({ sha: 'refs/heads/foo=bar' });
  });

  it('preserves several "=" in one value', () => {
    expect(parseArgs(['--sha=a=b=c'])).toEqual({ sha: 'a=b=c' });
  });

  it('ignores unrelated flags', () => {
    expect(parseArgs(['--verbose', '--sha=abc123', '--other=x'])).toEqual({ sha: 'abc123' });
  });

  it('throws when --sha is absent', () => {
    expect(() => parseArgs([])).toThrow(/Usage: --sha=/);
  });

  it('throws when --sha is present but empty', () => {
    expect(() => parseArgs(['--sha='])).toThrow(/Usage: --sha=/);
  });
});

// ── streamed load: absent vs unreadable (MINCRM-703) ──

describe('load-coverage-map file handling', () => {
  // A temp file, never the real qa/coverage-map.jsonl. These tests write,
  // overwrite and delete the map under test; pointing them at the committed
  // artifact would let an interrupted run leave a developer's tree holding a
  // 3-line stub in place of a map only a multi-hour record-mode run can
  // regenerate — and that stub would pass every validation here, because it is
  // structurally complete.
  let mapPath: string;
  // Tracked and cleaned in afterEach, not inline after the assertion: an inline
  // DELETE is skipped when the assertion above it fails, leaking rows into the
  // shared coverage database for every later test to trip over.
  const createdShas: string[] = [];

  /**
   * Writes a map file for the test.
   *
   * @param lines - Raw lines to join with newlines.
   */
  function writeMap(lines: string[]): void {
    writeFileSync(mapPath, lines.join('\n') + '\n', 'utf-8');
  }

  beforeEach(() => {
    mapPath = joinPath(mkdtempSync(joinPath(tmpdir(), 'coverage-map-')), 'coverage-map.jsonl');
  });

  afterEach(async () => {
    rmSync(dirname(mapPath), { recursive: true, force: true });
    if (createdShas.length > 0) {
      await coverageDb.query('DELETE FROM coverage_test_links WHERE commit_sha = ANY($1)', [
        createdShas.splice(0),
      ]);
    }
  });

  it('returns null when the map is absent, rather than failing', async () => {
    // The legitimate no-op: before the first record-mode run has committed a
    // map there is nothing to load, and the job must stay green.
    await expect(loadCoverageMap('deadbeef', mapPath)).resolves.toBeNull();
  });

  it('throws when a line is not valid JSON', async () => {
    // Previously a bare `catch {}` turned this into "no map found" and exit 0,
    // silently degrading TIA to the full-suite fallback.
    writeMap([JSON.stringify({ generatedAt: 'now', format: 2 }), 'not json at all']);

    await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(CoverageMapUnreadableError);
  });

  it('throws when an entry is missing a required field', async () => {
    writeMap([
      JSON.stringify({ generatedAt: 'now', format: 2 }),
      JSON.stringify({ nonsense: true }),
    ]);

    await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(
      /neither a test, a unit, nor a link/,
    );
  });

  it('throws when the first line is not a header', async () => {
    writeMap([JSON.stringify({ unitKey: 'u' })]);

    await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(/not a header/);
  });

  it('reports a missing header even when the file starts with a blank line', async () => {
    // Blank lines are skipped, so the header check counts content lines rather
    // than raw lines — otherwise this reports the far less useful "an entry is
    // missing a required field".
    writeMap(['', JSON.stringify({ unitKey: 'u' })]);

    await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(/not a header/);
  });

  it('throws when the entry-count trailer is absent', async () => {
    // A file truncated by a killed export has a valid header and valid entries
    // but no trailer. Loading it would silently narrow every later selection,
    // which is the exact class of failure this change removes.
    writeMap([
      JSON.stringify({ generatedAt: 'now', format: 2 }),
      ...dictLines(),
      JSON.stringify(entry()),
    ]);

    await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(/truncated/);
  });

  it('throws when the trailer count disagrees with the entries read', async () => {
    writeMap([
      JSON.stringify({ generatedAt: 'now', format: 2 }),
      ...dictLines(),
      JSON.stringify(entry()),
      JSON.stringify({ entryCount: 99 }),
    ]);

    await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(/entry-count mismatch/);
  });

  it('throws when content appears after the trailer', async () => {
    // Without this the trailer is not actually proof the writer finished: a
    // file appended to after export, or two interleaved writers, would load
    // whenever the counts happened to reconcile.
    writeMap([
      JSON.stringify({ generatedAt: 'now', format: 2 }),
      ...dictLines(),
      JSON.stringify(entry()),
      JSON.stringify({ entryCount: 1 }),
      JSON.stringify(entry()),
    ]);

    await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(/after the entry-count/);
  });

  it('still reports a corrupt map as unreadable when the rollback itself fails', async () => {
    // Without a .catch on rollback(), a failing ROLLBACK REPLACES the error
    // being propagated. Downstream classification is by error type, so the exit
    // code would drop from EXIT_MAP_UNREADABLE to 1 — and pre-push-tia.ts
    // branches on exactly that, reclassifying a corrupt shared artifact as a
    // local infrastructure blip and letting the push proceed. A dead connection
    // is itself a leading cause of reaching this path.
    const spy = vi.spyOn(coverageMappingService, 'beginCoverageMapLoad').mockResolvedValue({
      appendBatch: () => Promise.resolve(),
      commit: () => Promise.resolve(),
      rollback: () => Promise.reject(new Error('connection terminated unexpectedly')),
    });

    try {
      // LOAD_BATCH_SIZE + 1 links, so the session is genuinely opened by a
      // flush BEFORE the trailer mismatch rejects the file. With a single entry
      // nothing is ever flushed, rollback() is never called, and the test
      // passes whether or not the guard exists.
      const links = Array.from({ length: 5001 }, () => JSON.stringify(entry()));
      writeMap([
        JSON.stringify({ generatedAt: 'now', format: 2 }),
        ...dictLines(),
        ...links,
        JSON.stringify({ entryCount: 99 }),
      ]);

      await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(
        CoverageMapUnreadableError,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects a test dictionary line missing its testId', async () => {
    // A bare cast would let this through with testId undefined, which reaches
    // the INSERT as NULL and surfaces as a raw pg error — exit code 1 rather
    // than EXIT_MAP_UNREADABLE, which pre-push-tia.ts then reclassifies as a
    // local infrastructure blip and pushes anyway.
    writeMap([
      JSON.stringify({ generatedAt: 'now', format: 2 }),
      JSON.stringify({ t: 0 }),
      JSON.stringify({ u: 0, filePath: 'f', unitKey: 'u', branchId: null }),
      JSON.stringify(entry()),
      JSON.stringify({ entryCount: 1 }),
    ]);

    await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(CoverageMapUnreadableError);
    await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(/without a string testId/);
  });

  it('rejects a unit dictionary line missing its filePath', async () => {
    writeMap([
      JSON.stringify({ generatedAt: 'now', format: 2 }),
      JSON.stringify({ t: 0, testId: 't', testName: null, testFile: null }),
      JSON.stringify({ u: 0, unitKey: 'u' }),
      JSON.stringify(entry()),
      JSON.stringify({ entryCount: 1 }),
    ]);

    await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(
      /without a string filePath and unitKey/,
    );
  });

  it('rejects the legacy denormalized layout rather than misparsing it', async () => {
    // A version-1 header has no `format` key at all, so it defaults to 1. This
    // branch is the only thing stopping an old map from being read line-by-line
    // as though its entries were dictionaries.
    writeMap([
      JSON.stringify({ generatedAt: 'now' }),
      JSON.stringify({ unitKey: 'u', filePath: 'f', testId: 't', hitCount: 1 }),
    ]);

    await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(/format 1/);
  });

  it('rejects a format from the future', async () => {
    writeMap([JSON.stringify({ generatedAt: 'now', format: 99 })]);

    await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(/format 99/);
  });

  it('rejects a duplicate test definition rather than overwriting it', async () => {
    // Overwriting would silently re-point every LATER link at a different test:
    // a wrong result reported as a successful load, which is precisely what
    // this reader exists to make impossible.
    writeMap([
      JSON.stringify({ generatedAt: 'now', format: 2 }),
      JSON.stringify({ t: 0, testId: 'first', testName: null, testFile: null }),
      JSON.stringify({ t: 0, testId: 'second', testName: null, testFile: null }),
      JSON.stringify({ u: 0, filePath: 'f', unitKey: 'u', branchId: null }),
      JSON.stringify(entry()),
      JSON.stringify({ entryCount: 1 }),
    ]);

    await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(/redefines test 0/);
  });

  it('rejects a duplicate unit definition rather than overwriting it', async () => {
    writeMap([
      JSON.stringify({ generatedAt: 'now', format: 2 }),
      JSON.stringify({ t: 0, testId: 't', testName: null, testFile: null }),
      JSON.stringify({ u: 0, filePath: 'a.ts', unitKey: 'u', branchId: null }),
      JSON.stringify({ u: 0, filePath: 'b.ts', unitKey: 'u', branchId: null }),
      JSON.stringify(entry()),
      JSON.stringify({ entryCount: 1 }),
    ]);

    await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(/redefines unit 0/);
  });

  it('rejects the same testId defined under two reference numbers', async () => {
    // Guarding the numeric id alone misses this: both entries survive, then
    // collide on the ON CONFLICT identity at insert, and stream order decides
    // which metadata wins. The load would report success with arbitrary
    // contents.
    writeMap([
      JSON.stringify({ generatedAt: 'now', format: 2 }),
      JSON.stringify({ t: 0, testId: 'same', testName: 'first', testFile: null }),
      JSON.stringify({ t: 1, testId: 'same', testName: 'second', testFile: null }),
      JSON.stringify({ u: 0, filePath: 'f', unitKey: 'u', branchId: null }),
      JSON.stringify(entry()),
      JSON.stringify({ entryCount: 1 }),
    ]);

    await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(/already defines it/);
  });

  it('rejects the same unit identity defined under two reference numbers', async () => {
    writeMap([
      JSON.stringify({ generatedAt: 'now', format: 2 }),
      JSON.stringify({ t: 0, testId: 't', testName: null, testFile: null }),
      JSON.stringify({ u: 0, filePath: 'f.ts', unitKey: 'u', branchId: null }),
      JSON.stringify({ u: 1, filePath: 'f.ts', unitKey: 'u', branchId: null }),
      JSON.stringify(entry()),
      JSON.stringify({ entryCount: 1 }),
    ]);

    await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(
      /same filePath\/unitKey\/branchId/,
    );
  });

  it('allows the same unitKey in different files, and different branches', async () => {
    // The identity is the TRIPLE. Two files can legitimately share a structural
    // unitKey, and two branches of one function are distinct units — rejecting
    // either would break valid maps.
    writeMap([
      JSON.stringify({ generatedAt: 'now', format: 2 }),
      JSON.stringify({ t: 0, testId: 't', testName: null, testFile: null }),
      JSON.stringify({ u: 0, filePath: 'a.ts', unitKey: 'shared', branchId: null }),
      JSON.stringify({ u: 1, filePath: 'b.ts', unitKey: 'shared', branchId: null }),
      JSON.stringify({ u: 2, filePath: 'a.ts', unitKey: 'shared', branchId: '0:1' }),
      JSON.stringify(entry()),
      JSON.stringify({ entryCount: 1 }),
    ]);

    const sha = `load-map-test-${randomUUID()}`;
    createdShas.push(sha);
    await expect(loadCoverageMap(sha, mapPath)).resolves.toBe(1);
  });

  it('rejects a link that is not a triple', async () => {
    writeMap([
      JSON.stringify({ generatedAt: 'now', format: 2 }),
      ...dictLines(),
      JSON.stringify({ l: [0, 0] }),
      JSON.stringify({ entryCount: 1 }),
    ]);

    await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(/not a \[testRef/);
  });

  it('rejects a link with a non-numeric member', async () => {
    writeMap([
      JSON.stringify({ generatedAt: 'now', format: 2 }),
      ...dictLines(),
      JSON.stringify({ l: [0, 0, 'lots'] }),
      JSON.stringify({ entryCount: 1 }),
    ]);

    await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(/non-numeric member/);
  });

  it('rejects a link naming a test no earlier line defines', async () => {
    // Forward references are a real error, not a declaration: the reader
    // resolves as it streams, which is what keeps its memory bounded.
    writeMap([
      JSON.stringify({ generatedAt: 'now', format: 2 }),
      ...dictLines(),
      JSON.stringify({ l: [7, 0, 1] }),
      JSON.stringify({ entryCount: 1 }),
    ]);

    await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(
      /references test 7, which no earlier line defines/,
    );
  });

  it('rejects a link naming a unit no earlier line defines', async () => {
    writeMap([
      JSON.stringify({ generatedAt: 'now', format: 2 }),
      ...dictLines(),
      JSON.stringify({ l: [0, 7, 1] }),
      JSON.stringify({ entryCount: 1 }),
    ]);

    await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(
      /references unit 7, which no earlier line defines/,
    );
  });

  it('recognizes a re-serialized trailer, not just the exact byte prefix', async () => {
    // The runbook tells operators to inspect the trailer by hand; a
    // pretty-printed round trip must not be read as a malformed entry.
    const sha = `load-map-test-${randomUUID()}`;
    createdShas.push(sha);
    writeMap([
      JSON.stringify({ generatedAt: 'now', format: 2 }),
      ...dictLines(),
      JSON.stringify(entry()),
      '{ "entryCount": 1 }',
    ]);

    await expect(loadCoverageMap(sha, mapPath)).resolves.toBe(1);
  });

  it('loads a complete file and reports the entry count', async () => {
    const sha = `load-map-test-${randomUUID()}`;
    createdShas.push(sha);
    writeMap([
      JSON.stringify({ generatedAt: 'now', format: 2 }),
      ...dictLines(),
      JSON.stringify(entry()),
      JSON.stringify({ entryCount: 1 }),
    ]);

    await expect(loadCoverageMap(sha, mapPath)).resolves.toBe(1);
  });
});

/**
 * Builds a minimal valid link line.
 *
 * @returns A link line referencing dictionary entries 0 and 0.
 */
function entry(): Record<string, unknown> {
  return { l: [0, 0, 1] };
}

/** The dictionary lines a link line needs before it can resolve. */
function dictLines(): string[] {
  return [
    JSON.stringify({ t: 0, testId: 'load-map-test::t', testName: null, testFile: null }),
    JSON.stringify({
      u: 0,
      filePath: 'load-map-test/f.ts',
      unitKey: 'load-map-test#u',
      branchId: null,
    }),
  ];
}
