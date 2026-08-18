/**
 * Asserts a diff changed comments and nothing else.
 *
 * A line-oriented diff scan cannot do this. In db/migrations a `COMMENT ON` string
 * lives inside a multi-line template literal whose continuation lines look exactly
 * like block-comment continuations, so a line scan reads a catalog edit — live
 * database metadata — as a comment edit and waves it through.
 *
 * So both sides of every changed file are parsed, comment tokens are dropped, and
 * the remaining token streams are compared. Any difference is a non-comment change
 * however it renders in the diff. Whitespace between tokens is ignored; a token's
 * own text is not, so a renamed identifier or an edited string literal is caught.
 *
 * Usage:  tsx scripts/check-comments-only-diff.ts <base-ref>
 *         tsx scripts/check-comments-only-diff.ts --self-test
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { parse } from '@typescript-eslint/typescript-estree';

const SOURCE_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

/**
 * The file's tokens with comments removed, as a single comparable string. Returns
 * null when the source does not parse, which the caller treats as "cannot certify"
 * rather than "no change".
 */
export function codeSignature(file: string, source: string): string | null {
  try {
    const ast = parse(source, { tokens: true, comment: true, jsx: file.endsWith('x') });
    // Comments are excluded structurally, not by a flag: the parser reports them on
    // `ast.comments` and never inside `ast.tokens`, so building the signature from
    // tokens alone is what makes this comment-blind. `comment: true` is set so that
    // property is explicit at the call site rather than an unstated assumption.
    //
    // Type and value both matter: an edited string literal keeps its token type, so a
    // types-only signature would misreport it as a comment-only change.
    return (ast.tokens ?? []).map((token) => `${token.type} ${token.value}`).join('\n');
  } catch {
    return null;
  }
}

export interface Finding {
  file: string;
  reason: string;
}

export function compareFiles(
  file: string,
  before: string | null,
  after: string | null,
): Finding | null {
  // Added or deleted files are not comment-only edits by definition.
  if (before === null || after === null) {
    return { file, reason: before === null ? 'file added' : 'file deleted' };
  }
  const beforeSignature = codeSignature(file, before);
  const afterSignature = codeSignature(file, after);
  if (beforeSignature === null || afterSignature === null) {
    return { file, reason: 'could not parse one side; cannot certify comments-only' };
  }
  if (beforeSignature !== afterSignature) {
    return { file, reason: 'non-comment tokens changed' };
  }
  return null;
}

function fileAt(ref: string, file: string): string | null {
  try {
    return execFileSync('git', ['show', `${ref}:${file}`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

/** Current on-disk contents, or null when the file no longer exists. */
function readWorktreeFile(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function selfTest(): void {
  const cases: Array<{
    name: string;
    file: string;
    before: string | null;
    after: string | null;
    flag: boolean;
  }> = [
    // Must NOT flag — the whole point of the guard.
    {
      name: 'comment reworded',
      file: 'a.ts',
      before: '// old wording\nconst a = 1;',
      after: '// new wording\nconst a = 1;',
      flag: false,
    },
    {
      name: 'comment deleted',
      file: 'a.ts',
      before: '// gone\nconst a = 1;',
      after: 'const a = 1;',
      flag: false,
    },
    {
      name: 'ID stripped from a docblock',
      file: 'a.ts',
      before: '/** does a thing (MINCRM-1) */\nconst a = 1;',
      after: '/** does a thing */\nconst a = 1;',
      flag: false,
    },
    {
      name: 'code reindented only',
      file: 'a.ts',
      before: 'const a = {b: 1};',
      after: 'const a = {\n  b: 1,\n};',
      flag: true, // a trailing comma is a real token change, so this must flag
    },
    // Must flag.
    {
      name: 'string literal edited',
      file: 'a.ts',
      before: "const a = 'x';",
      after: "const a = 'y';",
      flag: true,
    },
    {
      name: 'identifier renamed',
      file: 'a.ts',
      before: 'const a = 1;',
      after: 'const b = 1;',
      flag: true,
    },
    // The case a line-oriented guard gets wrong: a catalog comment inside a
    // multi-line template literal, whose continuation lines look like comments.
    {
      name: 'catalog COMMENT ON edited',
      file: 'm.js',
      before:
        "exports.up = (pgm) => {\n  pgm.sql(`COMMENT ON TABLE t IS\n    'Append-only log of transitions. One row per entry.'`);\n};",
      after:
        "exports.up = (pgm) => {\n  pgm.sql(`COMMENT ON TABLE t IS\n    'Append-only log. One row per entry.'`);\n};",
      flag: true,
    },
    {
      name: 'JS comment beside a catalog comment',
      file: 'm.js',
      before:
        "// sets the description (MINCRM-1)\nexports.up = (pgm) => {\n  pgm.sql(`COMMENT ON TABLE t IS 'keep me'`);\n};",
      after:
        "// sets the description\nexports.up = (pgm) => {\n  pgm.sql(`COMMENT ON TABLE t IS 'keep me'`);\n};",
      flag: false,
    },
    // An unparseable side must flag rather than pass: "cannot certify" is not the
    // same as "nothing changed", and silence is this guard's only failure mode.
    {
      name: 'unparseable after-side',
      file: 'a.ts',
      before: '// fine\nconst a = 1;',
      after: 'const a = (((;',
      flag: true,
    },
    {
      name: 'unparseable before-side',
      file: 'a.ts',
      before: 'const a = (((;',
      after: '// fine\nconst a = 1;',
      flag: true,
    },
    // Adding or deleting a source file is never a comment-only edit, even when the
    // file contains only comments.
    { name: 'file added', file: 'a.ts', before: null, after: '// new\n', flag: true },
    { name: 'file deleted', file: 'a.ts', before: '// old\n', after: null, flag: true },
  ];

  let failures = 0;
  for (const testCase of cases) {
    const finding = compareFiles(testCase.file, testCase.before, testCase.after);
    const flagged = finding !== null;
    if (flagged !== testCase.flag) {
      failures += 1;
      process.stderr.write(
        `FAIL ${testCase.name}: expected ${testCase.flag ? 'flag' : 'no flag'}, got ${
          flagged ? 'flag' : 'no flag'
        }\n`,
      );
    }
  }

  const expected = cases.filter((testCase) => testCase.flag).length;
  process.stdout.write(
    `self-test: ${cases.length} cases, ${expected} must-flag, ${failures} failure(s)\n`,
  );
  if (failures > 0) process.exitCode = 1;
}

function main(): void {
  const arg = process.argv[2];
  if (arg === '--self-test') return selfTest();

  const baseRef = arg ?? 'main';

  // `--worktree` compares the uncommitted tree against the base, which is when a
  // comment pass most needs checking: before the commit exists. Otherwise compare
  // two committed refs, which is what CI and a PR review want.
  const againstWorktree = process.argv.includes('--worktree');
  const range = againstWorktree ? [baseRef] : [`${baseRef}...HEAD`];
  const changed = execFileSync('git', ['diff', '--name-only', ...range], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter((file) => SOURCE_EXTENSIONS.test(file));

  const findings = changed
    .map((file) =>
      compareFiles(
        file,
        fileAt(baseRef, file),
        againstWorktree ? readWorktreeFile(file) : fileAt('HEAD', file),
      ),
    )
    .filter((finding): finding is Finding => finding !== null);

  if (findings.length === 0) {
    process.stdout.write(`comments-only: ${changed.length} source file(s) verified\n`);
    return;
  }
  process.stderr.write(
    `non-comment changes in ${findings.length} file(s):\n` +
      findings.map((finding) => `  ${finding.file}: ${finding.reason}`).join('\n') +
      '\n',
  );
  process.exitCode = 1;
}

// Exact resolution, matching server/src/scripts/load-coverage-map.ts: a basename
// suffix match would also fire for a same-named file in another directory.
const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && currentFile === resolvePath(process.argv[1])) {
  main();
}
