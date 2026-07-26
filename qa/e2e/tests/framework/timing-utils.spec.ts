/**
 * Unit tests for framework/reporting/timing-utils.ts's pure logic —
 * specifically readSelectedFiles (pr-tia-8), the parser gen-shards.ts and
 * gen-shard-config.ts rely on for their --selected-files input. No live
 * server needed — same "framework logic under Playwright's test runner,
 * mocked/local-only" pattern as coverage-session-control-client.spec.ts.
 */

import { test, expect } from '@framework/fixtures';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSelectedFiles } from '@framework/reporting/timing-utils';

function withTempFile(content: string | undefined, run: (filePath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'timing-utils-test-'));
  const filePath = join(dir, 'selection.json');
  try {
    if (content !== undefined) {
      writeFileSync(filePath, content, 'utf-8');
    }
    run(filePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test.describe('readSelectedFiles', () => {
  test('returns null when filePath is undefined', () => {
    expect(readSelectedFiles(undefined)).toBeNull();
  });

  test('returns null when the file does not exist', () => {
    withTempFile(undefined, (filePath) => {
      expect(readSelectedFiles(filePath)).toBeNull();
    });
  });

  test('parses a bare string[] array shape', () => {
    withTempFile(
      JSON.stringify(['qa/e2e/tests/apps/minicrm/functional/auth/auth.spec.ts']),
      (filePath) => {
        expect(readSelectedFiles(filePath)).toEqual([
          'qa/e2e/tests/apps/minicrm/functional/auth/auth.spec.ts',
        ]);
      },
    );
  });

  test("parses the { specFiles: string[] } object shape (select-tests.ts's own SelectTestsResult)", () => {
    withTempFile(
      JSON.stringify({
        mode: 'targeted',
        specFiles: ['qa/e2e/tests/apps/minicrm/functional/deals/deal-creation.spec.ts'],
        unresolvedTestIds: [],
        fallbackReasons: [],
        rationale: [],
        baseSha: 'abc',
        headSha: 'def',
      }),
      (filePath) => {
        expect(readSelectedFiles(filePath)).toEqual([
          'qa/e2e/tests/apps/minicrm/functional/deals/deal-creation.spec.ts',
        ]);
      },
    );
  });

  test('returns null for malformed JSON rather than throwing', () => {
    withTempFile('{ not valid json', (filePath) => {
      expect(readSelectedFiles(filePath)).toBeNull();
    });
  });

  test('returns null for well-formed JSON that matches neither accepted shape', () => {
    withTempFile(JSON.stringify({ foo: 'bar' }), (filePath) => {
      expect(readSelectedFiles(filePath)).toBeNull();
    });
  });

  test('returns null when the array contains non-string entries', () => {
    withTempFile(JSON.stringify([1, 2, 3]), (filePath) => {
      expect(readSelectedFiles(filePath)).toBeNull();
    });
  });

  test('returns null when specFiles contains non-string entries', () => {
    withTempFile(JSON.stringify({ specFiles: [1, 2, 3] }), (filePath) => {
      expect(readSelectedFiles(filePath)).toBeNull();
    });
  });

  test('returns an empty array (not null) for an empty specFiles list — a real, deliberate "nothing selected" result', () => {
    withTempFile(JSON.stringify({ specFiles: [] }), (filePath) => {
      expect(readSelectedFiles(filePath)).toEqual([]);
    });
  });
});
