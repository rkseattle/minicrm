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

  afterEach(() => {
    rmSync(dirname(mapPath), { recursive: true, force: true });
  });

  it('returns null when the map is absent, rather than failing', async () => {
    // The legitimate no-op: before the first record-mode run has committed a
    // map there is nothing to load, and the job must stay green.
    await expect(loadCoverageMap('deadbeef', mapPath)).resolves.toBeNull();
  });

  it('throws when a line is not valid JSON', async () => {
    // Previously a bare `catch {}` turned this into "no map found" and exit 0,
    // silently degrading TIA to the full-suite fallback.
    writeMap([JSON.stringify({ generatedAt: 'now' }), 'not json at all']);

    await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(CoverageMapUnreadableError);
  });

  it('throws when an entry is missing a required field', async () => {
    writeMap([
      JSON.stringify({ generatedAt: 'now' }),
      JSON.stringify({ unitKey: 'u', filePath: 'f' }),
    ]);

    await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(/missing a required field/);
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
    writeMap([JSON.stringify({ generatedAt: 'now' }), JSON.stringify(entry('t'))]);

    await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(/truncated/);
  });

  it('throws when the trailer count disagrees with the entries read', async () => {
    writeMap([
      JSON.stringify({ generatedAt: 'now' }),
      JSON.stringify(entry('t')),
      JSON.stringify({ entryCount: 99 }),
    ]);

    await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(/entry-count mismatch/);
  });

  it('throws when content appears after the trailer', async () => {
    // Without this the trailer is not actually proof the writer finished: a
    // file appended to after export, or two interleaved writers, would load
    // whenever the counts happened to reconcile.
    writeMap([
      JSON.stringify({ generatedAt: 'now' }),
      JSON.stringify(entry('t1')),
      JSON.stringify({ entryCount: 1 }),
      JSON.stringify(entry('t2')),
    ]);

    await expect(loadCoverageMap('deadbeef', mapPath)).rejects.toThrow(/after the entry-count/);
  });

  it('recognizes a re-serialized trailer, not just the exact byte prefix', async () => {
    // The runbook tells operators to inspect the trailer by hand; a
    // pretty-printed round trip must not be read as a malformed entry.
    const sha = `load-map-test-${randomUUID()}`;
    writeMap([
      JSON.stringify({ generatedAt: 'now' }),
      JSON.stringify(entry('load-map-test::t')),
      '{ "entryCount": 1 }',
    ]);

    await expect(loadCoverageMap(sha, mapPath)).resolves.toBe(1);

    await coverageDb.query('DELETE FROM coverage_test_links WHERE commit_sha = $1', [sha]);
  });

  it('loads a complete file and reports the entry count', async () => {
    const sha = `load-map-test-${randomUUID()}`;
    writeMap([
      JSON.stringify({ generatedAt: 'now' }),
      JSON.stringify(entry('load-map-test::t')),
      JSON.stringify({ entryCount: 1 }),
    ]);

    await expect(loadCoverageMap(sha, mapPath)).resolves.toBe(1);

    await coverageDb.query('DELETE FROM coverage_test_links WHERE commit_sha = $1', [sha]);
  });
});

/**
 * Builds a minimal valid entry.
 *
 * @param testId - Test identifier.
 * @returns An export entry.
 */
function entry(testId: string): Record<string, unknown> {
  return {
    unitKey: 'load-map-test#u',
    branchId: null,
    filePath: 'load-map-test/f.ts',
    testId,
    testName: null,
    testFile: null,
    hitCount: 1,
  };
}
