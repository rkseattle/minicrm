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

    // findRenamedAwayUnits' hash-only pairing (see its own docblock) also
    // emits calculateTotal's own stale OLD identity as 'deleted' here,
    // since its old hash no longer matches its (now-edited) new hash and
    // there is no positional signal left to say "still the same function"
    // — an accepted, documented over-reporting tradeoff, not a bug. The
    // load-bearing assertion is that the genuine edit is correctly
    // reported 'in-line'.
    const inLineUnits = result.changedUnits.filter((u) => u.changeKind === 'in-line');
    expect(inLineUnits).toHaveLength(1);
    expect(inLineUnits[0]).toMatchObject({ filePath: 'a.ts' });
    expect(inLineUnits[0].unitKey).toMatch(/^calculateTotal#/);
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

    // The outer arrow and the innermost arrow both share the '<anonymous>'
    // name (see qualifiedNameOf) — 2 old and 2 new boundaries in that name
    // group — so classifyChange can no longer make the specific 'in-line'
    // claim it could when exactly one candidate shared a name: there is no
    // sound way to know which of the two OLD anonymous boundaries (if
    // either) the resolved NEW one corresponds to, so it correctly reports
    // 'ambiguous' rather than guessing. The load-bearing guarantee this
    // regression test exists for is narrower than "reports in-line": the
    // resolved boundary must be the INNERMOST arrow (whose body actually
    // changed), not outer() or the outer arrow (whose bodies are
    // byte-identical to their own old selves) — outer() is a distinct,
    // unambiguous 1-candidate name group, so if it were ever misresolved
    // as the changed unit, it would report 'refactor', not 'ambiguous'.
    const ambiguousUnits = result.changedUnits.filter((u) => u.changeKind === 'ambiguous');
    expect(ambiguousUnits).toHaveLength(1);
    expect(ambiguousUnits[0].unitKey).toMatch(/^<anonymous>#/);
    expect(result.changedUnits.some((u) => u.changeKind === 'refactor')).toBe(false);
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

    // findRenamedAwayUnits' hash-only pairing also emits foo's own stale
    // OLD identity as 'deleted' here (its old hash no longer matches its
    // edited new hash) — an accepted, documented over-reporting tradeoff.
    // The load-bearing assertion is that the genuine edit still surfaces
    // as 'in-line', not silently dropped.
    const inLineUnits = result.changedUnits.filter((u) => u.changeKind === 'in-line');
    expect(inLineUnits).toHaveLength(1);
    expect(inLineUnits[0].unitKey).toMatch(/^foo#/);
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

  it('emits a deleted unit for ONE anonymous callback removed while ANOTHER anonymous callback survives (regression)', async () => {
    repoRoot = await initRepo();
    // Two distinct GENUINELY anonymous callbacks — passed directly as call
    // arguments (no name-bearing const/let binding, so qualifiedNameOf's
    // fallback '<anonymous>' applies to both — a `const foo = () => {}`
    // arrow instead resolves to 'foo' via the VariableDeclaration branch,
    // which would defeat this test's own premise). Genuinely different
    // bodies (and therefore different unitKeys) under the same name. A
    // name-only presence check ("does '<anonymous>' still exist in the new
    // file?") would find the survivor and wrongly conclude NOTHING was
    // removed.
    await writeFile(
      join(repoRoot, 'a.ts'),
      'register(function () {\n  return 1;\n});\n\nregister(function () {\n  return 2;\n});\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    // Removes ONLY the first anonymous callback's own register() call
    // entirely — the second (also anonymous) callback survives untouched,
    // so newBoundaries still contains a '<anonymous>' entry.
    await writeFile(join(repoRoot, 'a.ts'), 'register(function () {\n  return 2;\n});\n');
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'remove first callback entirely']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);
    const result = await resolveChangedUnits(diffs, repoRoot, baseSha, headSha);

    const deletedUnits = result.changedUnits.filter((u) => u.changeKind === 'deleted');
    expect(deletedUnits).toHaveLength(1);
    expect(deletedUnits[0].unitKey).toMatch(/^<anonymous>#/);
    expect(deletedUnits[0].filePath).toBe('a.ts');
  });

  it('emits a deleted unit when a NAMED method is removed while a DIFFERENT method sharing the SAME name survives (regression)', async () => {
    repoRoot = await initRepo();
    // Two DIFFERENT classes' own `render` methods — a real (non-anonymous)
    // qualified-name collision. classifyChange/findRenamedAwayUnits resolve
    // boundaries by qualifiedNameOf's own name, which does not disambiguate
    // by enclosing scope — two unrelated methods can legitimately share the
    // exact same name. A plain "does 'render' still exist anywhere in the
    // new file" check would find ClassB's surviving render() and wrongly
    // conclude ClassA's render() was never removed, even though it was.
    await writeFile(
      join(repoRoot, 'a.ts'),
      'class ClassA {\n  render() {\n    return 1;\n  }\n}\n\nclass ClassB {\n  render() {\n    return 2;\n  }\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    // Removes ClassA (and its render() method) entirely — ClassB's own
    // render() survives untouched, so newBoundaries still contains a
    // 'render' entry, just a DIFFERENT one than ClassA's.
    await writeFile(
      join(repoRoot, 'a.ts'),
      'class ClassB {\n  render() {\n    return 2;\n  }\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'remove ClassA entirely']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);
    const result = await resolveChangedUnits(diffs, repoRoot, baseSha, headSha);

    const deletedUnits = result.changedUnits.filter((u) => u.changeKind === 'deleted');
    expect(deletedUnits).toHaveLength(1);
    expect(deletedUnits[0].unitKey).toMatch(/^render#/);
    expect(deletedUnits[0].filePath).toBe('a.ts');
  });

  it('still reports the edited survivor (as ambiguous, not silently dropped) when its same-named sibling elsewhere in the file is untouched', async () => {
    repoRoot = await initRepo();
    // Same setup as the collision test above, but this time nothing is
    // actually removed — ClassB's render() is completely untouched, only
    // ClassA's render() body changes. Because 'render' has 2 boundaries on
    // both the old and new side, classifyChange cannot soundly claim
    // 'in-line' (that requires knowing ClassA's edited boundary corresponds
    // to ITS OWN old self, which a 2+ same-name group can't establish) —
    // it correctly reports 'ambiguous' instead. findRenamedAwayUnits'
    // hash-only pairing (see its own docblock) separately matches ClassB's
    // untouched hash to itself and is left unable to match ClassA's own
    // now-different hash to anything, so it ALSO reports ClassA's old
    // identity as 'deleted' — the documented, accepted over-reporting
    // tradeoff of dropping position-based pairing entirely. The
    // load-bearing guarantee this test exists for is narrower: the genuine
    // edit must still surface as a changed unit (ambiguous), never
    // silently disappear entirely.
    await writeFile(
      join(repoRoot, 'a.ts'),
      'class ClassA {\n  render() {\n    return 1;\n  }\n}\n\nclass ClassB {\n  render() {\n    return 2;\n  }\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    // Edits ONLY ClassA's render() body — ClassB's render() is completely
    // untouched.
    await writeFile(
      join(repoRoot, 'a.ts'),
      'class ClassA {\n  render() {\n    return 99;\n  }\n}\n\nclass ClassB {\n  render() {\n    return 2;\n  }\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', "edit ClassA's render() only"]);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);
    const result = await resolveChangedUnits(diffs, repoRoot, baseSha, headSha);

    expect(result.changedUnits.some((u) => u.changeKind === 'ambiguous')).toBe(true);
  });

  it('classifies an edited sibling as ambiguous, never refactor, when its new body coincidentally matches an UNRELATED same-named sibling (regression — found via independent adversarial review)', async () => {
    repoRoot = await initRepo();
    // ClassA is declared FIRST and never changes. ClassB's render() is
    // edited to a body that happens to become BYTE-IDENTICAL to ClassA's
    // own always-untouched body. An earlier version of classifyChange
    // returned 'refactor' whenever ANY same-named old candidate's hash
    // matched — here that meant matching ClassB's genuinely-changed new
    // body against ClassA's unrelated old body and concluding "no real
    // change" (backwards: ClassB's own logic DID change; only ClassA's
    // logic didn't, and ClassA is a different function entirely). The
    // fix must report 'ambiguous' — there is no sound way to know from
    // hash alone which old sibling (if any) a 2+-candidate new boundary
    // corresponds to — and must never claim 'refactor' in this shape,
    // since 'refactor' requires comparing a boundary against ITS OWN old
    // self, which a 2+ candidate group cannot establish.
    await writeFile(
      join(repoRoot, 'a.ts'),
      'class ClassA {\n  render() {\n    return 1;\n  }\n}\n\nclass ClassB {\n  render() {\n    return 2;\n  }\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    await writeFile(
      join(repoRoot, 'a.ts'),
      'class ClassA {\n  render() {\n    return 1;\n  }\n}\n\nclass ClassB {\n  render() {\n    return 1;\n  }\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', "edit ClassB's render() to match ClassA's own body"]);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);
    const result = await resolveChangedUnits(diffs, repoRoot, baseSha, headSha);

    expect(result.changedUnits.some((u) => u.changeKind === 'refactor')).toBe(false);
    expect(result.changedUnits.some((u) => u.changeKind === 'ambiguous')).toBe(true);
  });

  it('reports the TRUE deletion (not a mispaired one) when a same-named sibling is removed while ANOTHER same-named sibling is simultaneously edited (regression — found via independent adversarial review)', async () => {
    repoRoot = await initRepo();
    // Three classes sharing the SAME method name — x1 is removed outright,
    // x2 is edited, x3 is untouched. Removing x1 shifts x2's own
    // structural path into x1's former slot. A naive path-based pairing
    // pass (with no group-size guard) would wrongly pair x1's OLD path to
    // x2's now-shifted NEW boundary, reporting the genuinely-edited x2 as
    // 'deleted' while x1's real removal silently vanishes.
    await writeFile(
      join(repoRoot, 'a.ts'),
      'class X1 {\n  render() {\n    return 1;\n  }\n}\n\nclass X2 {\n  render() {\n    return 2;\n  }\n}\n\nclass X3 {\n  render() {\n    return 3;\n  }\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    await writeFile(
      join(repoRoot, 'a.ts'),
      'class X2 {\n  render() {\n    return 99;\n  }\n}\n\nclass X3 {\n  render() {\n    return 3;\n  }\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'remove X1 entirely, edit X2 render']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);
    const result = await resolveChangedUnits(diffs, repoRoot, baseSha, headSha);

    // X1's true old identity (name 'render', body "return 1") MUST appear
    // among the deleted units — this is the load-bearing assertion. Extra
    // deleted entries beyond this (e.g. X2's own stale old identity, since
    // group-size mismatch intentionally skips path-pairing and falls back
    // to reporting every hash-unmatched old boundary) are an accepted,
    // documented over-reporting tradeoff, not a bug — see
    // findRenamedAwayUnits' own docblock.
    const { deriveStructuralUnitKey } =
      await import('../coverageAgent/pipeline/structuralKeyService.js');
    const x1OldSource = 'class X1 {\n  render() {\n    return 1;\n  }\n}\n';
    const x1Key = deriveStructuralUnitKey(
      'render',
      { start: { line: 2, column: 11 }, end: { line: 4, column: 3 } },
      x1OldSource,
    );

    const deletedKeys = result.changedUnits
      .filter((u) => u.changeKind === 'deleted')
      .map((u) => u.unitKey);
    expect(deletedKeys).toContain(x1Key);
  });

  it('classifies an edited same-named sibling as ambiguous when 2+ old boundaries share its name and none match its new hash (no path-based guess)', async () => {
    repoRoot = await initRepo();
    // Three classes share the method name 'render' — editing ONE of them
    // (ClassB) means the new boundary's hash cannot exactly match ClassA's
    // or ClassC's own untouched old hashes either, so there is no old
    // sibling this new boundary provably corresponds to. A prior
    // path-preferring version of classifyChange would have guessed based
    // on structural position; the hash-only rewrite must instead report
    // 'ambiguous' rather than picking a specific (and possibly wrong)
    // sibling.
    await writeFile(
      join(repoRoot, 'a.ts'),
      'class ClassA {\n  render() {\n    return 1;\n  }\n}\n\nclass ClassB {\n  render() {\n    return 2;\n  }\n}\n\nclass ClassC {\n  render() {\n    return 3;\n  }\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    await writeFile(
      join(repoRoot, 'a.ts'),
      'class ClassA {\n  render() {\n    return 1;\n  }\n}\n\nclass ClassB {\n  render() {\n    return 99;\n  }\n}\n\nclass ClassC {\n  render() {\n    return 3;\n  }\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', "edit ClassB's render() only"]);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);
    const result = await resolveChangedUnits(diffs, repoRoot, baseSha, headSha);

    const nonDeletedUnits = result.changedUnits.filter((u) => u.changeKind !== 'deleted');
    expect(nonDeletedUnits).toHaveLength(1);
    expect(nonDeletedUnits[0].changeKind).toBe('ambiguous');
  });

  it('reports the true deletion when a same-named function is removed and an UNRELATED same-named function is independently added elsewhere in the same diff (regression — found via a fourth independent adversarial review)', async () => {
    repoRoot = await initRepo();
    // 'foo' is deleted entirely; a completely unrelated 'foo' is added
    // elsewhere in the same file, in the same diff. This name group has
    // exactly ONE old boundary and exactly ONE new boundary — an earlier
    // version of findRenamedAwayUnits treated any 1-old/1-new name group
    // as unambiguous by construction and paired them unconditionally
    // regardless of hash, reasoning that "no sibling exists to confuse
    // either one with". That reasoning only rules out confusion with
    // another candidate present in the SAME diff — it does not rule out
    // the group's own counts merely coincidentally collapsing to 1-and-1
    // because an unrelated same-named old boundary was deleted while an
    // unrelated same-named new boundary was independently added. The old
    // 'foo's real deletion must still be reported — silently dropping it
    // would be a genuine miss (the mapping engine never learns to retire
    // its old unit_key), not just imprecise over-reporting.
    await writeFile(
      join(repoRoot, 'a.ts'),
      'export function foo() {\n  return "A";\n}\n\nexport function bar() {\n  return 1;\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    await writeFile(
      join(repoRoot, 'a.ts'),
      'export function bar() {\n  return 1;\n}\n\nexport function foo() {\n  return "B";\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'remove old foo, add unrelated new foo, move bar']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);
    const result = await resolveChangedUnits(diffs, repoRoot, baseSha, headSha);

    const { deriveStructuralUnitKey } =
      await import('../coverageAgent/pipeline/structuralKeyService.js');
    const oldFooSource = 'export function foo() {\n  return "A";\n}\n';
    const oldFooKey = deriveStructuralUnitKey(
      'foo',
      { start: { line: 1, column: 22 }, end: { line: 3, column: 1 } },
      oldFooSource,
    );

    const deletedKeys = result.changedUnits
      .filter((u) => u.changeKind === 'deleted')
      .map((u) => u.unitKey);
    expect(deletedKeys).toContain(oldFooKey);
  });

  it('classifies a brand-new same-named sibling as ambiguous, never in-line or refactor, when it is added alongside an untouched old namesake (regression — found via a fifth independent adversarial review)', async () => {
    repoRoot = await initRepo();
    // Old file has only ClassA.render(). New file adds an untouched-old
    // ClassA PLUS a brand-new ClassB.render() — a name group with exactly
    // ONE old-side candidate but TWO new-side boundaries. classifyChange
    // must not use old-side count alone to decide 'in-line'/'refactor':
    // resolving ClassB's own insertion previously reported 'in-line' (or
    // 'refactor', if ClassB's body coincidentally matched ClassA's), for a
    // function that never existed before at all.
    await writeFile(
      join(repoRoot, 'a.ts'),
      'class ClassA {\n  render() {\n    return 1;\n  }\n}\n\nclass Filler {\n  helper() {\n    return 0;\n  }\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    await writeFile(
      join(repoRoot, 'a.ts'),
      'class ClassA {\n  render() {\n    return 1;\n  }\n}\n\nclass ClassB {\n  render() {\n    return 999;\n  }\n}\n\nclass Filler {\n  helper() {\n    return 0;\n  }\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'add ClassB with its own render()']);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);
    const result = await resolveChangedUnits(diffs, repoRoot, baseSha, headSha);

    expect(result.changedUnits).toHaveLength(1);
    expect(result.changedUnits[0].changeKind).toBe('ambiguous');
  });

  it('documents the accepted limitation: a true deletion is NOT reported when an unrelated new sibling coincidentally has the deleted body (known tradeoff, not a bug)', async () => {
    repoRoot = await initRepo();
    // X1.render() (body "A") is deleted entirely; X2.render() (body "B")
    // survives untouched; a brand-new, unrelated X3.render() is added
    // whose body happens to be BYTE-IDENTICAL to X1's OLD body ("A").
    // Hash-only matching (see findRenamedAwayUnits' own docblock, "KNOWN,
    // ACCEPTED LIMITATION") cannot distinguish "X1 renamed/moved to become
    // X3" from "X1 deleted, X3 unrelated but coincidentally identical" —
    // there is no positional/containment signal this module can safely
    // use to tell them apart (any such signal reintroduces the exact
    // sibling-rotation unsoundness already rejected elsewhere in this
    // file). This test exists to document the accepted behavior — X1's
    // true deletion does NOT surface as a 'deleted' changeKind — so a
    // future reader doesn't mistake it for an unnoticed regression.
    await writeFile(
      join(repoRoot, 'a.ts'),
      'class X1 {\n  render() {\n    return "A";\n  }\n}\n\nclass X2 {\n  render() {\n    return "B";\n  }\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const baseSha = await gitRevParseHead(repoRoot);

    await writeFile(
      join(repoRoot, 'a.ts'),
      'class X2 {\n  render() {\n    return "B";\n  }\n}\n\nclass X3 {\n  render() {\n    return "A";\n  }\n}\n',
    );
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, [
      'commit',
      '-m',
      'remove X1, add unrelated X3 with a coincidentally-matching body',
    ]);
    const headSha = await gitRevParseHead(repoRoot);

    const diffs = await parseGitDiff(baseSha, headSha, repoRoot);
    const result = await resolveChangedUnits(diffs, repoRoot, baseSha, headSha);

    expect(result.changedUnits.some((u) => u.changeKind === 'deleted')).toBe(false);
    expect(result.changedUnits.every((u) => u.changeKind === 'ambiguous')).toBe(true);
  });
});
