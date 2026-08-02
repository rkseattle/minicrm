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
  test('rejects a shard index outside 0..(totalShards-1)', () => {
    expect(parseGenShardConfigArgs(argv('--shard-index=4', '--total-shards=4')).error).toContain(
      'shardIndex must be',
    );
    expect(parseGenShardConfigArgs(argv('--shard-index=-1', '--total-shards=4')).error).toContain(
      'shardIndex must be',
    );
  });

  test('rejects a non-numeric shard index', () => {
    expect(parseGenShardConfigArgs(argv('--shard-index=x', '--total-shards=4')).error).toContain(
      'shardIndex must be',
    );
  });
});
