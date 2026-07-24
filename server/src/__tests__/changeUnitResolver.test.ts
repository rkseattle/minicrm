/**
 * Tests for changeUnitResolver. (MINCRM-623)
 *
 * Exercised against a REAL git repository (mkdtemp + git init/commit) so
 * old-revision content is read via genuine `git show`, matching this
 * suite's sibling diffParser.test.ts and coverageReconciliationService's
 * own precedent.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseGitDiff } from '../coverageAgent/testSelection/diffParser.js';
import { resolveChangedUnits } from '../coverageAgent/testSelection/changeUnitResolver.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

async function gitRevParseHead(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd });
  return stdout.trim();
}

async function initRepo(): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), 'change-unit-resolver-test-'));
  await git(repoRoot, ['init', '--initial-branch=main']);
  await git(repoRoot, ['config', 'user.email', 'test@example.com']);
  await git(repoRoot, ['config', 'user.name', 'Test']);
  return repoRoot;
}

describe('resolveChangedUnits', () => {
  let repoRoot: string;

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('classifies an edited function body as in-line', async () => {
    repoRoot = await initRepo();
    await writeFile(join(repoRoot, 'a.ts'), 'export function calculateTotal() {\n  return 1;\n}\n');
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    await writeFile(join(repoRoot, 'a.ts'), 'export function calculateTotal() {\n  return 2;\n}\n');
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'edit']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);
    const result = await resolveChangedUnits(diffs, repoRoot, baseSha, headSha);

    expect(result.changedUnits).toHaveLength(1);
    expect(result.changedUnits[0]).toMatchObject({
      filePath: 'a.ts',
      changeKind: 'in-line',
    });
    expect(result.changedUnits[0].unitKey).toMatch(/^calculateTotal#/);
    expect(result.unresolvedFileChanges).toEqual([]);
  });

  it('classifies a brand-new function as new', async () => {
    repoRoot = await initRepo();
    await writeFile(join(repoRoot, 'a.ts'), 'export function existing() {\n  return 1;\n}\n');
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    await writeFile(
      join(repoRoot, 'a.ts'),
      'export function existing() {\n  return 1;\n}\n\nexport function brandNew() {\n  return 2;\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'add function']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);
    const result = await resolveChangedUnits(diffs, repoRoot, baseSha, headSha);

    expect(result.changedUnits).toHaveLength(1);
    expect(result.changedUnits[0]).toMatchObject({ changeKind: 'new' });
    expect(result.changedUnits[0].unitKey).toMatch(/^brandNew#/);
  });

  it('classifies every function in a deleted file as deleted', async () => {
    repoRoot = await initRepo();
    await writeFile(join(repoRoot, 'a.ts'), 'export function gone() {\n  return 1;\n}\n');
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    await execFileAsync('git', ['rm', 'a.ts'], { cwd: repoRoot });
    await git(repoRoot, ['commit', '-m', 'delete']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);
    const result = await resolveChangedUnits(diffs, repoRoot, baseSha, headSha);

    expect(result.changedUnits).toHaveLength(1);
    expect(result.changedUnits[0]).toMatchObject({
      filePath: 'a.ts',
      changeKind: 'deleted',
    });
    expect(result.changedUnits[0].unitKey).toMatch(/^gone#/);
  });

  it('produces a unitKey identical to a from-scratch derivation of the same function (mapping-API compatible)', async () => {
    repoRoot = await initRepo();
    await writeFile(join(repoRoot, 'a.ts'), 'export function base() {\n  return 1;\n}\n');
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    await writeFile(
      join(repoRoot, 'a.ts'),
      'export function base() {\n  return 1;\n}\n\nexport function sibling() {\n  return 2;\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'add sibling']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);
    const result = await resolveChangedUnits(diffs, repoRoot, baseSha, headSha);

    const { deriveStructuralUnitKey } =
      await import('../coverageAgent/pipeline/structuralKeyService.js');
    const sourceText =
      'export function base() {\n  return 1;\n}\n\nexport function sibling() {\n  return 2;\n}\n';
    const expectedKey = deriveStructuralUnitKey(
      'sibling',
      { start: { line: 5, column: 0 }, end: { line: 7, column: 1 } },
      sourceText,
    );

    expect(result.changedUnits).toHaveLength(1);
    expect(result.changedUnits[0].unitKey).toBe(expectedKey);
  });

  it('routes config/migration files to nonSourceFileChanges instead of resolving units', async () => {
    repoRoot = await initRepo();
    await git(repoRoot, ['commit', '--allow-empty', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    await writeFile(join(repoRoot, 'config.yaml'), 'key: value\n');
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'add config']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);
    const result = await resolveChangedUnits(diffs, repoRoot, baseSha, headSha);

    expect(result.changedUnits).toEqual([]);
    expect(result.nonSourceFileChanges).toHaveLength(1);
    expect(result.nonSourceFileChanges[0].filePath).toBe('config.yaml');
  });

  it('flags a top-level (module-scope) change as unresolved rather than silently dropping it', async () => {
    repoRoot = await initRepo();
    await writeFile(join(repoRoot, 'a.ts'), 'export const x = 1;\n');
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    await writeFile(join(repoRoot, 'a.ts'), 'export const x = 2;\n');
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'edit const']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);
    const result = await resolveChangedUnits(diffs, repoRoot, baseSha, headSha);

    expect(result.changedUnits).toEqual([]);
    expect(result.unresolvedFileChanges).toHaveLength(1);
    expect(result.unresolvedFileChanges[0].filePath).toBe('a.ts');
  });
});
