/**
 * Unit tests for coverageSymbolicationService. (MINCRM-615)
 *
 * The V8 path is exercised against a real temp source file and the real
 * node:inspector Profiler API (no mocking v8-to-istanbul itself) so the
 * test proves the actual conversion algorithm resolves offsets back to
 * real source, mirroring NodeV8CoverageAgent.test.ts's own no-mocking
 * approach for the same reason.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Session } from 'inspector';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  symbolicateCoverageDump,
  UnsupportedCoverageFormatError,
} from '../coverageAgent/pipeline/coverageSymbolicationService.js';

let sourceRoot: string;

beforeEach(async () => {
  sourceRoot = await mkdtemp(join(tmpdir(), 'minicrm-symbolication-test-'));
});

afterEach(async () => {
  await rm(sourceRoot, { recursive: true, force: true });
});

describe('coverageSymbolicationService', () => {
  describe('v8-script-coverage (backend)', () => {
    it('resolves a real V8 script coverage payload to source-anchored units', async () => {
      const fixturePath = join(sourceRoot, 'fixture.js');
      await writeFile(
        fixturePath,
        [
          'function branchy(flag) {',
          '  if (flag) {',
          '    return "yes";',
          '  }',
          '  return "no";',
          '}',
          'module.exports = { branchy };',
          `require(${JSON.stringify(fixturePath)}).branchy(true);`,
        ].join('\n'),
        'utf8',
      );

      const session = new Session();
      session.connect();
      await post(session, 'Profiler.enable');
      await post(session, 'Profiler.startPreciseCoverage', { callCount: true, detailed: true });
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- exercising real V8 coverage requires a real require() call to instrument
      require(fixturePath);
      const { result } = await post<{ result: unknown }>(session, 'Profiler.takePreciseCoverage');
      await post(session, 'Profiler.stopPreciseCoverage');
      session.disconnect();

      const scripts = (result as Array<{ url: string }>).filter((script) =>
        script.url.includes('fixture.js'),
      );

      const symbolicated = await symbolicateCoverageDump('node-v8', 'v8-script-coverage', scripts, {
        sourceRoot,
      });

      expect(symbolicated.agent).toBe('node-v8');
      expect(symbolicated.units.length).toBeGreaterThan(0);
      expect(symbolicated.units.every((unit) => unit.filePath === 'fixture.js')).toBe(true);
      expect(symbolicated.units.every((unit) => unit.resolved)).toBe(true);
    });

    it('flags a script whose url has no resolvable file as unresolved rather than dropping it', async () => {
      const symbolicated = await symbolicateCoverageDump(
        'node-v8',
        'v8-script-coverage',
        [{ scriptId: '1', url: 'node:internal/bootstrap', functions: [] }],
        { sourceRoot },
      );

      expect(symbolicated.units).toHaveLength(1);
      expect(symbolicated.units[0].resolved).toBe(false);
      expect(symbolicated.units[0].unresolvedReason).toMatch(/does not resolve to a file/);
    });
  });

  describe('istanbul (frontend)', () => {
    it('resolves an already-sourcemapped Istanbul coverage map into branch-granularity units', async () => {
      const istanbulPayload = {
        '/src/Widget.tsx': {
          path: '/src/Widget.tsx',
          statementMap: {},
          fnMap: {
            '0': {
              name: 'render',
              decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
              loc: { start: { line: 1, column: 0 }, end: { line: 10, column: 1 } },
              line: 1,
            },
          },
          branchMap: {
            '0': {
              loc: { start: { line: 3, column: 0 }, end: { line: 5, column: 1 } },
              type: 'if',
              locations: [
                { start: { line: 3, column: 0 }, end: { line: 4, column: 0 } },
                { start: { line: 4, column: 0 }, end: { line: 5, column: 1 } },
              ],
              line: 3,
            },
          },
          s: {},
          f: { '0': 5 },
          b: { '0': [3, 2] },
        },
      };

      const symbolicated = await symbolicateCoverageDump(
        'browser-istanbul',
        'istanbul',
        istanbulPayload,
        { sourceRoot },
      );

      expect(symbolicated.agent).toBe('browser-istanbul');
      expect(symbolicated.units).toHaveLength(2);
      expect(symbolicated.units[0]).toMatchObject({
        filePath: '/src/Widget.tsx',
        unitKey: 'render@1',
        branchId: '0:0',
        granularity: 'branch',
        hitCount: 3,
        resolved: true,
      });
      expect(symbolicated.units[1]).toMatchObject({
        branchId: '0:1',
        hitCount: 2,
      });
    });

    it('falls back to function-granularity units when a file has no branches', async () => {
      const istanbulPayload = {
        '/src/utils.ts': {
          path: '/src/utils.ts',
          statementMap: {},
          fnMap: {
            '0': {
              name: 'add',
              decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 5 } },
              loc: { start: { line: 1, column: 0 }, end: { line: 3, column: 1 } },
              line: 1,
            },
          },
          branchMap: {},
          s: {},
          f: { '0': 7 },
          b: {},
        },
      };

      const symbolicated = await symbolicateCoverageDump(
        'browser-istanbul',
        'istanbul',
        istanbulPayload,
        { sourceRoot },
      );

      expect(symbolicated.units).toHaveLength(1);
      expect(symbolicated.units[0]).toMatchObject({
        filePath: '/src/utils.ts',
        unitKey: 'add@1',
        branchId: null,
        granularity: 'function',
        hitCount: 7,
        resolved: true,
      });
    });

    it('derives a structural (name#hash) key instead of name@line when the source file is readable, stable across an unrelated line shift', async () => {
      const sourcePath = join(sourceRoot, 'utils.ts');
      const originalSource = ['function add(a, b) {', '  return a + b;', '}'].join('\n');
      await writeFile(sourcePath, originalSource, 'utf8');

      const buildPayload = (declLine: number, endLine: number) => ({
        [sourcePath]: {
          path: sourcePath,
          statementMap: {},
          fnMap: {
            '0': {
              name: 'add',
              decl: { start: { line: declLine, column: 0 }, end: { line: declLine, column: 5 } },
              loc: { start: { line: declLine, column: 0 }, end: { line: endLine, column: 1 } },
              line: declLine,
            },
          },
          branchMap: {},
          s: {},
          f: { '0': 4 },
          b: {},
        },
      });

      const original = await symbolicateCoverageDump(
        'browser-istanbul',
        'istanbul',
        buildPayload(1, 3),
        { sourceRoot },
      );
      expect(original.units[0].unitKey).toMatch(/^add#[0-9a-f]{16}$/);

      // Same function body, but padded with two leading blank lines — as if
      // an unrelated edit earlier in the file pushed this function down.
      // decl/loc line numbers shift accordingly (as istanbul's own mapping
      // would report for the shifted function), but the structural key must
      // stay identical since the function's own body text did not change.
      const shiftedSource = ['', '', ...originalSource.split('\n')].join('\n');
      await writeFile(sourcePath, shiftedSource, 'utf8');

      const shifted = await symbolicateCoverageDump(
        'browser-istanbul',
        'istanbul',
        buildPayload(3, 5),
        { sourceRoot },
      );

      expect(shifted.units[0].unitKey).toBe(original.units[0].unitKey);
    });

    it('produces a different structural key when the function body actually changes', async () => {
      const sourcePath = join(sourceRoot, 'utils2.ts');
      const fnMapForLineCount = (lineCount: number) => ({
        [sourcePath]: {
          path: sourcePath,
          statementMap: {},
          fnMap: {
            '0': {
              name: 'add',
              decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 5 } },
              loc: { start: { line: 1, column: 0 }, end: { line: lineCount, column: 1 } },
              line: 1,
            },
          },
          branchMap: {},
          s: {},
          f: { '0': 1 },
          b: {},
        },
      });

      await writeFile(
        sourcePath,
        ['function add(a, b) {', '  return a + b;', '}'].join('\n'),
        'utf8',
      );
      const before = await symbolicateCoverageDump(
        'browser-istanbul',
        'istanbul',
        fnMapForLineCount(3),
        {
          sourceRoot,
        },
      );

      await writeFile(
        sourcePath,
        ['function add(a, b) {', '  return a - b;', '}'].join('\n'),
        'utf8',
      );
      const after = await symbolicateCoverageDump(
        'browser-istanbul',
        'istanbul',
        fnMapForLineCount(3),
        {
          sourceRoot,
        },
      );

      expect(after.units[0].unitKey).not.toBe(before.units[0].unitKey);
    });

    it('clamps a negative hit count to 0 rather than passing it through to a hit_count >= 0 DB constraint (MINCRM-636/637)', async () => {
      // Regression test: a real local run produced hitCount: -534773760 on
      // a hot node_modules/bcryptjs branch (V8's own raw counter, not
      // accumulation — first_seen_at equalled last_seen_at on the failing
      // row) and crashed the entire dump's ingestion with an unhandled 500,
      // discarding every other unit's valid coverage in the same request
      // (found via a real local coverage-map generation run).
      const istanbulPayload = {
        '/src/HotLoop.ts': {
          path: '/src/HotLoop.ts',
          statementMap: {},
          fnMap: {},
          branchMap: {
            '0': {
              loc: { start: { line: 1, column: 0 }, end: { line: 3, column: 1 } },
              type: 'if',
              locations: [
                { start: { line: 1, column: 0 }, end: { line: 2, column: 0 } },
                { start: { line: 2, column: 0 }, end: { line: 3, column: 1 } },
              ],
              line: 1,
            },
          },
          s: {},
          f: {},
          b: { '0': [-534773760, 4] },
        },
      };

      const symbolicated = await symbolicateCoverageDump(
        'browser-istanbul',
        'istanbul',
        istanbulPayload,
        { sourceRoot },
      );

      expect(symbolicated.units).toHaveLength(2);
      expect(symbolicated.units[0]).toMatchObject({ branchId: '0:0', hitCount: 0 });
      expect(symbolicated.units[1]).toMatchObject({ branchId: '0:1', hitCount: 4 });
    });

    it('clamps a non-integer hit count to 0 the same way', async () => {
      const istanbulPayload = {
        '/src/utils.ts': {
          path: '/src/utils.ts',
          statementMap: {},
          fnMap: {
            '0': {
              name: 'add',
              decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 5 } },
              loc: { start: { line: 1, column: 0 }, end: { line: 3, column: 1 } },
              line: 1,
            },
          },
          branchMap: {},
          s: {},
          f: { '0': NaN },
          b: {},
        },
      };

      const symbolicated = await symbolicateCoverageDump(
        'browser-istanbul',
        'istanbul',
        istanbulPayload,
        { sourceRoot },
      );

      expect(symbolicated.units).toHaveLength(1);
      expect(symbolicated.units[0].hitCount).toBe(0);
    });

    it('skips a null/malformed file coverage entry rather than crashing the whole dump (MINCRM-636/637)', async () => {
      // Regression test: a real local run hit "TypeError: Cannot convert
      // undefined or null to object" inside Object.entries(data.fnMap),
      // meaning v8-to-istanbul's own toIstanbul() output contained at least
      // one null/malformed per-file entry — this crashed the whole dump's
      // ingestion rather than flagging just that one file (found via a real
      // local coverage-map generation run).
      const istanbulPayload = {
        '/src/Good.ts': {
          path: '/src/Good.ts',
          statementMap: {},
          fnMap: {
            '0': {
              name: 'good',
              decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 5 } },
              loc: { start: { line: 1, column: 0 }, end: { line: 3, column: 1 } },
              line: 1,
            },
          },
          branchMap: {},
          s: {},
          f: { '0': 2 },
          b: {},
        },
        '/src/Malformed.ts': null,
      };

      const symbolicated = await symbolicateCoverageDump(
        'browser-istanbul',
        'istanbul',
        istanbulPayload,
        { sourceRoot },
      );

      expect(symbolicated.units).toHaveLength(1);
      expect(symbolicated.units[0]).toMatchObject({
        filePath: '/src/Good.ts',
        unitKey: 'good@1',
        hitCount: 2,
      });
    });
  });

  it('throws UnsupportedCoverageFormatError for an unknown agent/format pair', async () => {
    await expect(
      symbolicateCoverageDump('node-v8', 'istanbul', {}, { sourceRoot }),
    ).rejects.toThrow(UnsupportedCoverageFormatError);
  });
});

function post<T = unknown>(
  session: Session,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    session.post(method, params, (err, result) => {
      if (err) reject(err);
      else resolve(result as T);
    });
  });
}
