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
    // Body-only range (the `{ ... }` block, matching istanbul's own `loc` —
    // NOT the full `export function sibling() { ... }` declaration) —
    // deriveStructuralUnitKey must be hashing only the body, exactly as the
    // mapping engine's own qualifiedUnitKey does (see
    // coverageSymbolicationService.ts, which passes `mapping.loc`, never
    // `mapping.decl`), so a pure rename with no logic change hashes
    // identically before and after.
    const expectedKey = deriveStructuralUnitKey(
      'sibling',
      { start: { line: 5, column: 26 }, end: { line: 7, column: 1 } },
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

  it('attributes a change inside a same-line nested callback to the INNERMOST function, not the outer one (regression)', async () => {
    repoRoot = await initRepo();
    await writeFile(
      join(repoRoot, 'a.ts'),
      'export function outer() {\n  const result = items.map((x) => x.foo(() => 1));\n  return result;\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    // Only the innermost arrow's own literal changes (1 -> 2); the outer
    // arrow's and outer()'s own bodies are otherwise byte-identical.
    await writeFile(
      join(repoRoot, 'a.ts'),
      'export function outer() {\n  const result = items.map((x) => x.foo(() => 2));\n  return result;\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'edit innermost callback']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);
    const result = await resolveChangedUnits(diffs, repoRoot, baseSha, headSha);

    // If the resolver mis-attributed this to outer() (or the outer arrow),
    // it would report changeKind 'refactor' (outer()'s and the outer
    // arrow's own body hashes are UNCHANGED — only the innermost arrow's
    // literal differs) instead of 'in-line', since classifyChange returns
    // 'refactor' precisely when the reported unit's own hash didn't
    // change. Reporting 'in-line' here is only correct if the INNERMOST
    // arrow (whose body genuinely changed) was the one actually resolved.
    expect(result.changedUnits).toHaveLength(1);
    expect(result.changedUnits[0].changeKind).toBe('in-line');
    expect(result.changedUnits[0].unitKey).toMatch(/^<anonymous>#/);
  });

  it('emits both a deleted unit for the OLD name and a new unit for the NEW name when a function is renamed within a file (regression)', async () => {
    repoRoot = await initRepo();
    await writeFile(join(repoRoot, 'a.ts'), 'export function oldName() {\n  return 42;\n}\n');
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    // Same body, different name — a same-file rename with no logic change.
    await writeFile(join(repoRoot, 'a.ts'), 'export function newName() {\n  return 42;\n}\n');
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'rename oldName to newName']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);
    const result = await resolveChangedUnits(diffs, repoRoot, baseSha, headSha);

    const deletedUnits = result.changedUnits.filter((u) => u.changeKind === 'deleted');
    const newUnits = result.changedUnits.filter((u) => u.changeKind === 'new');

    expect(deletedUnits).toHaveLength(1);
    expect(deletedUnits[0].unitKey).toMatch(/^oldName#/);
    expect(newUnits).toHaveLength(1);
    expect(newUnits[0].unitKey).toMatch(/^newName#/);
    // Same body in both revisions — the two units' hash suffixes must match,
    // proving this was recognized as a rename (body match), not treated as
    // an unrelated add+delete pair.
    expect(deletedUnits[0].unitKey.split('#')[1]).toBe(newUnits[0].unitKey.split('#')[1]);
  });

  it('resolves a function changed ONLY by deleting lines to a changed unit, not silently omitted (regression)', async () => {
    repoRoot = await initRepo();
    await writeFile(
      join(repoRoot, 'a.ts'),
      'export function foo() {\n  const a = 1;\n  const b = 2;\n  return a;\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    // Deletes the middle line only — the entire diff is one pure-deletion
    // hunk with no surviving positive-line-count hunk anywhere in the file.
    // Before the fix, diffParser discarded this hunk entirely, so
    // resolveChangedUnits reported NEITHER a changed unit NOR an
    // unresolved-change entry for foo() — its covering tests would have
    // silently dropped out of selection with no safety-net signal at all.
    await writeFile(
      join(repoRoot, 'a.ts'),
      'export function foo() {\n  const a = 1;\n  return a;\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'delete middle line only']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);
    const result = await resolveChangedUnits(diffs, repoRoot, baseSha, headSha);

    expect(result.changedUnits).toHaveLength(1);
    expect(result.changedUnits[0].unitKey).toMatch(/^foo#/);
    expect(result.changedUnits[0].changeKind).toBe('in-line');
    expect(result.unresolvedFileChanges).toEqual([]);
  });

  it('emits a deleted unit for a function REMOVED OUTRIGHT (not renamed) from an otherwise-retained file (regression)', async () => {
    repoRoot = await initRepo();
    await writeFile(
      join(repoRoot, 'a.ts'),
      'export function keep() {\n  return 1;\n}\n\nexport function removeMe() {\n  return 2;\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    // removeMe() is deleted entirely — no function anywhere in the new file
    // shares its name OR its body hash, so this is a genuine removal, not a
    // rename. The pure-deletion hunk that results has a zero-width anchor
    // resolved only against the NEW AST (see resolveEnclosingUnitsForRanges),
    // where removeMe() has no boundary at all — before the fix, this meant
    // its removal was NEVER surfaced anywhere (no 'deleted' unit, no
    // unresolved-change entry), silently dropping its covering tests.
    await writeFile(join(repoRoot, 'a.ts'), 'export function keep() {\n  return 1;\n}\n');
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'remove removeMe() entirely']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);
    const result = await resolveChangedUnits(diffs, repoRoot, baseSha, headSha);

    const deletedUnits = result.changedUnits.filter((u) => u.changeKind === 'deleted');
    expect(deletedUnits).toHaveLength(1);
    expect(deletedUnits[0].unitKey).toMatch(/^removeMe#/);
    expect(deletedUnits[0].filePath).toBe('a.ts');
  });
});
