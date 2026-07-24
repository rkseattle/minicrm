/**
 * Tests for diffParser. (MINCRM-623)
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
import { parseGitDiff, GitDiffError } from '../coverageAgent/testSelection/diffParser.js';

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
});
