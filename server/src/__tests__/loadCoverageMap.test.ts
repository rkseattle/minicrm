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

import { parseArgs } from '../scripts/load-coverage-map.js';

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
