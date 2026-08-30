/**
 * Tests for diffParser.
 *
 * Exercised against a REAL git repository (mkdtemp + git init/commit) rather
 * than mocked `git diff` output — matching coverageReconciliationService's
 * own precedent (see that test file's docblock): this module's entire job
 * is correctly parsing git's own diff format, so mocking `git` would defeat
 * the point of testing it.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  parseGitDiff,
  GitDiffError,
  assertSafeGitRef,
  UnsafeGitRefError,
} from '../coverageAgent/testSelection/diffParser.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

async function gitRevParseHead(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd });
  return stdout.trim();
}

async function initRepo(): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), 'diff-parser-test-'));
  await git(repoRoot, ['init', '--initial-branch=main']);
  await git(repoRoot, ['config', 'user.email', 'test@example.com']);
  await git(repoRoot, ['config', 'user.name', 'Test']);
  return repoRoot;
}

describe('parseGitDiff', () => {
  let repoRoot: string;

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('reports an added file with its changed ranges', async () => {
    repoRoot = await initRepo();
    await writeFile(join(repoRoot, 'a.ts'), 'export const x = 1;\n');
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    await writeFile(join(repoRoot, 'b.ts'), 'export function foo() {\n  return 2;\n}\n');
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'add b.ts']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);

    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ filePath: 'b.ts', status: 'added', isNonSourceFile: false });
    expect(diffs[0].changedRanges).toEqual([{ startLine: 1, endLine: 4 }]);
  });

  // A binary diff carries no `+++ b/` or `--- a/` line — git prints
  // "Binary files ... differ" instead — so a parser reading only those yields an empty
  // path. Downstream that is indistinguishable from a path no manifest glob covers, and
  // selection silently widens to the full E2E suite.
  const PNG_BYTES = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489',
    'hex',
  );

  it('reports an added binary file by path', async () => {
    repoRoot = await initRepo();
    await writeFile(join(repoRoot, 'a.ts'), 'export const x = 1;\n');
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    await writeFile(join(repoRoot, 'shot.png'), PNG_BYTES);
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'add shot.png']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].filePath).toBe('shot.png');
    expect(diffs[0].status).toBe('added');
  });

  it('reports a modified binary file by path', async () => {
    repoRoot = await initRepo();
    await writeFile(join(repoRoot, 'shot.png'), PNG_BYTES);
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    await writeFile(join(repoRoot, 'shot.png'), Buffer.concat([PNG_BYTES, Buffer.from([0, 1, 2])]));
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'change shot.png']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].filePath).toBe('shot.png');
    expect(diffs[0].status).toBe('modified');
  });

  it('reports a binary file whose path git C-quotes', async () => {
    repoRoot = await initRepo();
    await writeFile(join(repoRoot, 'a.ts'), 'export const x = 1;\n');
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    // git quotes a path holding non-ASCII bytes: `diff --git "a/wéird.png" "b/..."`.
    // The unquoted header pattern misses it, and a binary section has no +++/--- to
    // fall back to — so this is the one shape that reaches the parser with no path.
    await writeFile(join(repoRoot, 'wéird shot.png'), PNG_BYTES);
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'add quoted binary']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].filePath).toBe('wéird shot.png');
  });

  it('decodes a C-quoted path on a rename, not just on the header', async () => {
    repoRoot = await initRepo();
    await writeFile(join(repoRoot, 'plain.ts'), 'export const y = 1;\n');
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    // `rename to` carries its own quoted value and wins over the header, so decoding
    // only the header leaves the path escaped — and an escaped path matches no
    // manifest glob, silently dropping the file from selection.
    await git(repoRoot, ['mv', 'plain.ts', 'rénamed file.ts']);
    await git(repoRoot, ['commit', '-m', 'rename with a non-ascii name']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].filePath).toBe('rénamed file.ts');
    expect(diffs[0].oldFilePath).toBe('plain.ts');
  });

  it('reports a deleted binary file by path', async () => {
    repoRoot = await initRepo();
    await writeFile(join(repoRoot, 'shot.png'), PNG_BYTES);
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    await execFileAsync('git', ['rm', 'shot.png'], { cwd: repoRoot });
    await git(repoRoot, ['commit', '-m', 'delete shot.png']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].filePath).toBe('shot.png');
    expect(diffs[0].status).toBe('deleted');
  });

  it('reports a deleted file with no changed ranges', async () => {
    repoRoot = await initRepo();
    await writeFile(join(repoRoot, 'a.ts'), 'export const x = 1;\n');
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    await execFileAsync('git', ['rm', 'a.ts'], { cwd: repoRoot });
    await git(repoRoot, ['commit', '-m', 'delete a.ts']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);

    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ filePath: 'a.ts', status: 'deleted' });
    expect(diffs[0].changedRanges).toEqual([]);
  });

  it('reports a modified file with only the actually-changed line range (--unified=0)', async () => {
    repoRoot = await initRepo();
    await writeFile(
      join(repoRoot, 'a.ts'),
      'export function one() {\n  return 1;\n}\n\nexport function two() {\n  return 2;\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    await writeFile(
      join(repoRoot, 'a.ts'),
      'export function one() {\n  return 1;\n}\n\nexport function two() {\n  return 99;\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'edit two()']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('modified');
    expect(diffs[0].changedRanges).toEqual([{ startLine: 6, endLine: 7 }]);
  });

  it('emits a zero-width anchor range for a pure-deletion hunk (+c,0), not an empty range (regression)', async () => {
    repoRoot = await initRepo();
    await writeFile(
      join(repoRoot, 'a.ts'),
      'export function foo() {\n  const a = 1;\n  const b = 2;\n  return a;\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    // Deletes ONLY the middle line — the resulting diff is a single pure
    // deletion hunk (`@@ -3 +2,0 @@`) with no other surviving hunk anywhere
    // in the file, so this is the exact case that previously vanished
    // entirely (see changeUnitResolver.test.ts's own regression test for
    // the end-to-end assertion).
    await writeFile(
      join(repoRoot, 'a.ts'),
      'export function foo() {\n  const a = 1;\n  return a;\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'delete middle line only']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('modified');
    // Zero-width: startLine === endLine === 2 (git's own new-side anchor
    // for where the deleted line used to sit) — NOT an empty array.
    expect(diffs[0].changedRanges).toEqual([{ startLine: 2, endLine: 2 }]);
  });

  it('clamps a +0,0 pure-deletion hunk (deletion at the very start of the file) to line 1, not line 0 (regression)', async () => {
    repoRoot = await initRepo();
    await writeFile(
      join(repoRoot, 'a.ts'),
      'export function removed() {\n  return 0;\n}\n\nexport function kept() {\n  return 1;\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    // Deletes the FIRST function in the file entirely — git reports this as
    // `@@ -1,4 +0,0 @@`: the new-side anchor is 0, since there is no new-side
    // line 0 (1-based) for "the deletion happened before the file's own
    // first surviving line" to point at. Left un-clamped, line 0 can never
    // resolve to any enclosing function (every real line is >= 1), so this
    // would incorrectly fall into changeUnitResolver's "no enclosing
    // function found" unresolved bucket instead of anchoring to kept().
    await writeFile(join(repoRoot, 'a.ts'), 'export function kept() {\n  return 1;\n}\n');
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'delete first function entirely']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].changedRanges).toEqual([{ startLine: 1, endLine: 1 }]);
  });

  it('reports a renamed file with its old and new paths', async () => {
    repoRoot = await initRepo();
    await writeFile(
      join(repoRoot, 'a.ts'),
      'export function longEnoughToBeDetectedAsARename() {\n  return 1;\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    await git(repoRoot, ['mv', 'a.ts', 'renamed.ts']);
    await git(repoRoot, ['commit', '-m', 'rename a.ts']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);

    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({
      filePath: 'renamed.ts',
      oldFilePath: 'a.ts',
      status: 'renamed',
    });
  });

  it('classifies migration and config files as non-source', async () => {
    repoRoot = await initRepo();
    await git(repoRoot, ['commit', '--allow-empty', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    await mkdir(join(repoRoot, 'db/migrations'), { recursive: true });
    await writeFile(join(repoRoot, 'db/migrations/001_init.js'), 'exports.up = () => {};\n');
    await writeFile(join(repoRoot, 'config.yaml'), 'key: value\n');
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'add migration and config']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);

    expect(diffs).toHaveLength(2);
    expect(diffs.every((d) => d.isNonSourceFile)).toBe(true);
  });

  it('returns an empty array when there are no changes', async () => {
    repoRoot = await initRepo();
    await git(repoRoot, ['commit', '--allow-empty', '-m', 'base']);
    const sha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(sha, sha, repoRoot);

    expect(diffs).toEqual([]);
  });

  it('throws GitDiffError for an invalid ref', async () => {
    repoRoot = await initRepo();
    await git(repoRoot, ['commit', '--allow-empty', '-m', 'base']);

    await expect(parseGitDiff('not-a-real-ref', 'HEAD', repoRoot)).rejects.toThrow(GitDiffError);
  });

  it('refuses a ref beginning with "-" (baseRef) before ever shelling out to git', async () => {
    repoRoot = await initRepo();
    await git(repoRoot, ['commit', '--allow-empty', '-m', 'base']);

    await expect(parseGitDiff('--output=/tmp/x', 'HEAD', repoRoot)).rejects.toThrow(
      UnsafeGitRefError,
    );
  });

  it('refuses a ref beginning with "-" (headRef)', async () => {
    repoRoot = await initRepo();
    await git(repoRoot, ['commit', '--allow-empty', '-m', 'base']);
    const sha = await gitRevParseHead(repoRoot);

    await expect(parseGitDiff(sha, '--exec=x', repoRoot)).rejects.toThrow(UnsafeGitRefError);
  });
});

describe('assertSafeGitRef', () => {
  it('accepts ordinary refs (branch names, SHAs, remote-qualified branches)', () => {
    expect(() => assertSafeGitRef('main')).not.toThrow();
    expect(() => assertSafeGitRef('origin/main')).not.toThrow();
    expect(() => assertSafeGitRef('a1b2c3d4e5f6')).not.toThrow();
  });

  it('rejects a ref beginning with "-"', () => {
    expect(() => assertSafeGitRef('-x')).toThrow(UnsafeGitRefError);
    expect(() => assertSafeGitRef('--force')).toThrow(UnsafeGitRefError);
  });
});
