/**
 * Argument parsing for the two shard-generation scripts. (MINCRM-696)
 *
 * Both take a `--selected-files=<path>` whose value is a filesystem path, and
 * both previously read it with `.split('=')[1]` — which truncates at the first
 * '=', a character POSIX paths admit freely. A truncated path is unreadable, and
 * both scripts then warn and fall back to the full suite: the SAFE direction,
 * but not what the operator asked for. The job silently runs every spec instead
 * of the TIA-selected subset it was told to shard, which looks like a slow run
 * rather than a bug.
 *
 * These pin the `=`-preserving form so a "simplification" back to `[1]` fails
 * here rather than degrading a CI job months later. The numeric flags are
 * covered alongside because the same restructuring exposed them, and their
 * validation is what keeps a bad shard index from producing an empty config.
 *
 * Both parsers were changed to take argv and RETURN errors, rather than reading
 * process.argv and calling process.exit inline — the inline form is untestable
 * by construction, which is precisely why this idiom went unpinned for so long.
 */

import { test, expect } from '@playwright/test';
import { parseGenShardsArgs } from '../../scripts/gen-shards.js';
import { parseGenShardConfigArgs } from '../../scripts/gen-shard-config.js';

/** argv as Node presents it — [execPath, scriptPath, ...flags]. */
function argv(...flags: string[]): string[] {
  return ['/usr/bin/node', '/repo/qa/e2e/scripts/script.ts', ...flags];
}

test.describe('gen-shards parseGenShardsArgs', () => {
  test('preserves an "=" in the selected-files path', () => {
    const { selectedFilesPath, error } = parseGenShardsArgs(
      argv('--selected-files=/tmp/build=1/selected.json'),
    );

    expect(error).toBeNull();
    expect(selectedFilesPath).toBe('/tmp/build=1/selected.json');
  });

  test('preserves several "=" in one path', () => {
    expect(parseGenShardsArgs(argv('--selected-files=/a=b=c/x.json')).selectedFilesPath).toBe(
      '/a=b=c/x.json',
    );
  });

  test('leaves selected-files undefined when the flag is absent', () => {
    expect(parseGenShardsArgs(argv()).selectedFilesPath).toBeUndefined();
  });

  test('defaults workers to 4 and reports no error', () => {
    const { workers, error } = parseGenShardsArgs(argv());

    expect(workers).toBe(4);
    expect(error).toBeNull();
  });

  test('reads a valid workers value', () => {
    expect(parseGenShardsArgs(argv('--workers=8')).workers).toBe(8);
  });

  test('reports an error for a non-positive or non-numeric workers value', () => {
    expect(parseGenShardsArgs(argv('--workers=0')).error).toContain('positive integer');
    expect(parseGenShardsArgs(argv('--workers=abc')).error).toContain('positive integer');
  });

  // parseInt's partial parse, the defect MINCRM-696 is titled for. parseInt('8x')
  // → 8 and parseInt('2.9') → 2 both pass a range check, so a typo'd worker count
  // silently shards differently than asked rather than erroring.
  for (const value of ['8x', '2.9', '-2', ' 4', '']) {
    test(`rejects the non-integer workers value "${value}" rather than coercing it`, () => {
      expect(parseGenShardsArgs(argv(`--workers=${value}`)).error).toContain('positive integer');
    });
  }
});

test.describe('gen-shard-config parseGenShardConfigArgs', () => {
  const VALID = ['--shard-index=0', '--total-shards=4'];

  test('preserves an "=" in the selected-files path', () => {
    const parsed = parseGenShardConfigArgs(
      argv(...VALID, '--selected-files=/tmp/build=1/selected.json'),
    );

    expect(parsed.error).toBeNull();
    expect(parsed).toMatchObject({ selectedFilesPath: '/tmp/build=1/selected.json' });
  });

  test('parses a valid shard index and total', () => {
    expect(parseGenShardConfigArgs(argv(...VALID))).toMatchObject({
      shardIndex: 0,
      totalShards: 4,
      error: null,
    });
  });

  test('reports usage when a required flag is absent', () => {
    expect(parseGenShardConfigArgs(argv('--shard-index=0')).error).toContain('Usage:');
    expect(parseGenShardConfigArgs(argv('--total-shards=4')).error).toContain('Usage:');
  });

  // The bound that matters: an index equal to the total addresses a shard that
  // does not exist, which would generate a config matching no specs at all.
  // (A NEGATIVE index is rejected earlier, by the integer check — see the
  // non-integer cases below, where '-1' fails /^\d+$/ before reaching here.)
  test('rejects a shard index equal to totalShards', () => {
    expect(parseGenShardConfigArgs(argv('--shard-index=4', '--total-shards=4')).error).toContain(
      'shardIndex must be',
    );
  });

  test('rejects a totalShards of zero', () => {
    expect(parseGenShardConfigArgs(argv('--shard-index=0', '--total-shards=0')).error).toContain(
      'shardIndex must be',
    );
  });

  test('rejects a non-numeric shard index', () => {
    expect(parseGenShardConfigArgs(argv('--shard-index=x', '--total-shards=4')).error).toContain(
      'non-negative integers',
    );
  });

  // The highest-consequence case in this file. parseInt('2x') → 2 passes every
  // range check and produces a REAL config for shard 2 — so the specs in the
  // shard actually asked for never run, and nothing reports it. CI invokes this
  // script in a loop, one call per shard index. (MINCRM-696)
  const NON_INTEGER_CASES: ReadonlyArray<[label: string, index: string, total: string]> = [
    ['a partially-numeric index', '2x', '4'],
    ['a fractional index', '1.9', '4'],
    ['a partially-numeric total', '0', '4x'],
    ['a fractional total', '0', '4.9'],
    ['a negative index', '-1', '4'],
  ];

  for (const [label, index, total] of NON_INTEGER_CASES) {
    test(`rejects ${label} rather than coercing it`, () => {
      expect(
        parseGenShardConfigArgs(argv(`--shard-index=${index}`, `--total-shards=${total}`)).error,
      ).toContain('non-negative integers');
    });
  }
});
