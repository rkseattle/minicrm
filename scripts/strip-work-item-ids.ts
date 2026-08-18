/**
 * Removes work-item IDs from source comments, and verifies none remain.
 *
 * Comment tokens are located with the TypeScript-ESLint parser rather than by line
 * matching. That is not a style preference: in db/migrations a `COMMENT ON` string
 * sits inside a multi-line template literal whose continuation lines are
 * indistinguishable from JS comments by eye or by regex. Those strings are written
 * into the Postgres catalog and are live database metadata, out of scope here. An
 * AST comment-token walk cannot reach them at all, which makes "no catalog comment
 * modified" structurally true instead of merely intended.
 *
 * Modes:
 *   --report   CSV of every remaining ID, classified pure | judgment. Drives the
 *              hand-editing pass; pure ones are what --write handles.
 *   --write    Strips only unambiguous parentheticals, then normalizes the husks
 *              stripping leaves behind (empty comments, bare `*` lines).
 *   --verify   Exit 1 if any comment token still carries an ID. Runs in CI, and is
 *              the only guard covering db/migrations, which ESLint ignores.
 *
 * Exemptions match the ESLint rule and must stay in step with it: `@openapi` blocks
 * exempt whole-comment (the tag governs everything under it), while `-ok:` markers
 * exempt only themselves, so an unrelated ID sharing their comment is still found.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { parse } from '@typescript-eslint/typescript-estree';
import {
  isExemptComment,
  reportableWorkItemIds,
} from '../eslint-plugins/work-item-id-patterns.mjs';

/**
 * A parenthetical holding nothing but IDs and separators — `(MINCRM-NNN)`,
 * `(MINCRM-NNN, MINCRM-MMM)`, `(MINCRM-NNN/MMM)`, `(see MINCRM-NNN)`. Anything with prose
 * inside the parens is left for the judgment pass, because removing the ID there
 * changes the sentence.
 */
const PURE_PARENTHETICAL =
  /[ \t]*\((?:see\s+)?(?:MINCRM|LAR|MININT)-\d+(?:\s*[,/&]\s*(?:(?:MINCRM|LAR|MININT)-)?\d+)*\)/g;

/** One or more IDs joined by separators — `MINCRM-NNN`, `MINCRM-NNN, MINCRM-NNN`, `MINCRM-NNN..3`. */
const ID_RUN = String.raw`(?:MINCRM|LAR|MININT)-\d+(?!-ok)(?:\s*(?:,|\.\.|\/|&|and)\s*(?:(?:MINCRM|LAR|MININT)-)?\d+(?!-ok))*`;

/**
 * A label prefix: the comment opens with IDs and a separator, and the real
 * description follows — `// MINCRM-NNN: /pipeline merged into /deals`. Dropping the
 * prefix leaves the description, which is the part that explains anything.
 */
const LEADING_LABEL = new RegExp(
  String.raw`(^|\n)([ \t]*(?:\/\/|\/\*+|\*|\{\/\*)[ \t]*)${ID_RUN}[ \t]*[:—-][ \t]*`,
  'g',
);

/**
 * A trailing citation: IDs hanging off the end of a sentence after a dash or comma,
 * or occupying a line by themselves — `* Tests for CustomFieldsSection — MINCRM-NNN`.
 */
const TRAILING_CITATION = new RegExp(
  String.raw`[ \t]*[—,-][ \t]*${ID_RUN}(?=[ \t]*(?:\*\/|\*\}|\n|$))`,
  'g',
);

const SOURCE_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

export interface CommentHit {
  file: string;
  line: number;
  kind: 'pure' | 'judgment';
  id: string;
  text: string;
}

/**
 * Whole-comment exemption. Only `@openapi` qualifies: the tag governs every line
 * beneath it, so the block is contract text end to end. The `-ok:` markers are
 * exempted per occurrence instead — see `workItemIds` — so an unrelated ID sharing
 * a comment with a marker is still reported.
 */
export function isExempt(commentValue: string): boolean {
  return isExemptComment(commentValue);
}

/** Reportable IDs in a comment: every match that is not itself an `-ok` marker. */
export function workItemIds(commentValue: string): string[] {
  return reportableWorkItemIds(commentValue);
}

export function listSourceFiles(): string[] {
  const tracked = execFileSync('git', ['ls-files'], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  return tracked.split('\n').filter((file) => SOURCE_EXTENSIONS.test(file));
}

/** Every non-exempt comment token in `source` that still carries an ID. */
export function findHits(file: string, source: string): CommentHit[] {
  let ast;
  try {
    ast = parse(source, { comment: true, loc: true, jsx: file.endsWith('x') });
  } catch {
    // Unparseable is not the same as clean. Reported as a hit so --verify fails
    // loudly rather than certifying a file it could not read.
    return [{ file, line: 1, kind: 'judgment', id: 'PARSE_FAILURE', text: 'file did not parse' }];
  }

  const hits: CommentHit[] = [];
  for (const comment of ast.comments ?? []) {
    if (isExempt(comment.value)) continue;
    const found = workItemIds(comment.value);
    if (found.length === 0) continue;

    const stripped = comment.value
      .replace(PURE_PARENTHETICAL, '')
      .replace(LEADING_LABEL, '$1$2')
      .replace(TRAILING_CITATION, '');
    hits.push({
      file,
      line: comment.loc.start.line,
      kind: workItemIds(stripped).length > 0 ? 'judgment' : 'pure',
      id: found[0],
      text: comment.value.replace(/\s+/g, ' ').trim().slice(0, 120),
    });
  }
  return hits;
}

/**
 * Strips pure parentheticals from non-exempt comment tokens.
 *
 * Edits are spliced into the character ranges the parser reports for comments, and
 * nowhere else. That is what keeps the promise the module docblock makes: a
 * `COMMENT ON` string inside a `pgm.sql` template literal is a string token, never a
 * comment token, so it cannot be reached here. The same protects issue keys stored
 * as data (`issueKey: 'MINCRM-NNN'`) and the exempt comments `isExempt` identifies.
 *
 * An earlier line-based implementation did reach all three and corrupted them.
 *
 * Also normalizes what stripping leaves behind — a comment reduced to a bare `//`,
 * or a block-comment line reduced to a lone `*`. Prettier removes neither.
 */
export function stripFile(file: string, source: string): string {
  let ast;
  try {
    ast = parse(source, { comment: true, loc: true, range: true, jsx: file.endsWith('x') });
  } catch {
    return source;
  }

  const edits: Array<{ start: number; end: number; text: string; original: string }> = [];
  for (const comment of ast.comments ?? []) {
    if (isExempt(comment.value)) continue;
    if (workItemIds(comment.value).length === 0) continue;

    let [start, end] = comment.range;
    const original = source.slice(start, end);
    let stripped = original
      .replace(PURE_PARENTHETICAL, '')
      .replace(LEADING_LABEL, '$1$2')
      .replace(TRAILING_CITATION, '');
    if (stripped === original) continue;

    // A parenthetical that opened a sentence takes its own trailing punctuation with
    // it, so `// (MINCRM-NNN). Deliberately not exposed…` does not strip down to
    // `//. Deliberately not exposed…`. Only punctuation directly after a comment
    // marker qualifies — mid-sentence punctuation belongs to the surrounding prose.
    stripped = stripped.replace(/(^|\n)(\s*(?:\/\/|\*))\s*[.,;:]\s+/g, '$1$2 ');

    // A line comment left with nothing to say goes entirely, along with the
    // whitespace before it. Own-line cases would otherwise leave a blank line and
    // trailing ones (`const a = 1; // (MINCRM-NNN)`) a dangling `//`, which the
    // line-level husk filter cannot drop because the line still holds code.
    if (comment.type === 'Line' && /^\s*$/.test(stripped.replace(/^\/\//, ''))) {
      while (start > 0 && /[ \t]/.test(source[start - 1])) start -= 1;
      // Own-line comment: take the preceding newline too, so no blank line is left.
      if (
        start > 0 &&
        source[start - 1] === '\n' &&
        !/\S/.test(source.slice(0, start).split('\n').pop() ?? '')
      ) {
        start -= 1;
      }
      stripped = '';
    }
    edits.push({ start, end, text: stripped, original });
  }

  if (edits.length === 0) return source;

  // Husk cleanup is confined to lines the strip actually changed — compared
  // line-by-line within each edited comment, not to every line the comment spans.
  // Spanning the whole comment deleted deliberate ` *` paragraph separators in
  // multi-line docblocks: 1,569 of them across the tree, merging paragraphs into a
  // wall of text. A bare `*` or empty `//` that the strip did not create is
  // someone's spacing and is left alone.
  // Mark husk lines with a sentinel inside the replacement text rather than by
  // line number. An earlier version collected source line numbers and applied them
  // to the edited output, where deletions had already shifted every index — which
  // deleted a function declaration eight lines further down. The sentinel travels
  // with its own line, so no index can drift.
  const HUSK = '\u0000HUSK\u0000';
  const marked = edits.map((edit) => {
    const beforeLines = edit.original.split('\n');
    const afterLines = edit.text.split('\n');
    const rewritten = afterLines.map((after, offset) => {
      const before = beforeLines[offset];
      if (before === undefined || before === after) return after;
      return isHusk(after) && !isHusk(before) ? HUSK : after;
    });
    return { ...edit, text: rewritten.join('\n') };
  });

  let out = source;
  // Apply back-to-front so earlier offsets stay valid.
  for (const edit of [...marked].reverse()) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }

  return out
    .split('\n')
    .filter((line) => line !== HUSK)
    .join('\n');
}

/** A comment line left carrying nothing: `//` alone, or a lone block-comment `*`. */
function isHusk(line: string): boolean {
  return /^\s*\/\/\s*$/.test(line) || /^\s*\*\s*$/.test(line);
}

/**
 * Exercises `stripFile` — the destructive mode — against the cases it has already
 * got wrong once. Asserts exact outputs, not exit status: this codemod rewrites
 * ~1,200 files, and its failure mode is quietly editing something it promised not
 * to. Every must-NOT-modify case below is a real defect this script once shipped.
 */
function selfTest(): void {
  const cases: Array<{ name: string; file: string; input: string; expected: string }> = [
    // Must not modify — each corrupted real content in an earlier implementation.
    {
      name: 'catalog COMMENT ON in a pgm.sql template literal',
      file: 'm.js',
      input: "pgm.sql(`COMMENT ON TABLE t IS\n  'Log of moves (MINCRM-528). One per move.'`);",
      expected: "pgm.sql(`COMMENT ON TABLE t IS\n  'Log of moves (MINCRM-528). One per move.'`);",
    },
    {
      name: 'issue key stored as data in a string literal',
      file: 'a.ts',
      input: "const issueKey = 'MINCRM-609';",
      expected: "const issueKey = 'MINCRM-609';",
    },
    {
      name: '@openapi block is contract text',
      file: 'a.ts',
      input: '/**\n * @openapi\n * summary: thing (MINCRM-562)\n */\nconst a = 1;',
      expected: '/**\n * @openapi\n * summary: thing (MINCRM-562)\n */\nconst a = 1;',
    },
    {
      name: 'deliberate docblock paragraph separator survives',
      file: 'a.ts',
      input: '/**\n * First para. (MINCRM-133)\n *\n * Second para.\n */\nconst a = 1;',
      expected: '/**\n * First para.\n *\n * Second para.\n */\nconst a = 1;',
    },
    {
      name: 'judgment case left for the hand pass — ID inside the sentence',
      file: 'a.ts',
      input: '// Implements MINCRM-284 in full.\nconst a = 1;',
      expected: '// Implements MINCRM-284 in full.\nconst a = 1;',
    },
    // Must modify.
    {
      name: 'trailing parenthetical stripped, rationale kept',
      file: 'a.ts',
      input: '// Kept under MAX_SAFE_INTEGER so pg can bind it (MINCRM-658)\nconst a = 1;',
      expected: '// Kept under MAX_SAFE_INTEGER so pg can bind it\nconst a = 1;',
    },
    {
      name: 'multi-ID parenthetical',
      file: 'a.ts',
      input: '// Reason here (MINCRM-1, MINCRM-2)\nconst a = 1;',
      expected: '// Reason here\nconst a = 1;',
    },
    {
      name: 'own-line husk removed with its newline',
      file: 'a.ts',
      input: 'const a = 1;\n// (MINCRM-1)\nconst b = 2;',
      expected: 'const a = 1;\nconst b = 2;',
    },
    {
      name: 'trailing husk removed without touching the code line',
      file: 'a.ts',
      input: 'const a = 1; // (MINCRM-1)',
      expected: 'const a = 1;',
    },
    {
      name: 'husk removal does not shift and delete a later line',
      file: 'a.ts',
      input: `// first (${'MINCRM'}-1)\n// second (${'MINCRM'}-2)\n/**\n * doc\n * (${'MINCRM'}-3)\n */\nexport function keepMe(\n  id: string,\n) {}`,
      expected:
        '// first\n// second\n/**\n * doc\n */\nexport function keepMe(\n  id: string,\n) {}',
    },
    {
      name: 'leading label prefix dropped, description kept',
      file: 'a.tsx',
      input: '{/* MINCRM-51: /pipeline merged into /deals */}\nconst a = 1;',
      expected: '{/* /pipeline merged into /deals */}\nconst a = 1;',
    },
    {
      name: 'leading label with an em dash',
      file: 'a.ts',
      input: '// MINCRM-158, MINCRM-159 — bulk actions\nconst a = 1;',
      expected: '// bulk actions\nconst a = 1;',
    },
    {
      name: 'trailing citation dropped, sentence kept',
      file: 'a.ts',
      input: '/**\n * Tests for CustomFieldsSection — MINCRM-276\n */\nconst a = 1;',
      expected: '/**\n * Tests for CustomFieldsSection\n */\nconst a = 1;',
    },
    {
      name: 'an -ok marker is never treated as a label prefix',
      file: 'a.ts',
      input: '// MINCRM-686-ok: cleared in beforeEach\nconst a = 1;',
      expected: '// MINCRM-686-ok: cleared in beforeEach\nconst a = 1;',
    },
    {
      name: 'sentence-leading parenthetical takes its trailing period',
      file: 'a.ts',
      input:
        '// Coverage tooling admin access\n// (MINCRM-637). Deliberately not exposed in the picker.\nconst a = 1;',
      expected:
        '// Coverage tooling admin access\n// Deliberately not exposed in the picker.\nconst a = 1;',
    },
    {
      name: 'mid-sentence punctuation is left alone',
      file: 'a.ts',
      input: '// Backs the query API (MINCRM-629), which the dashboard reads.\nconst a = 1;',
      expected: '// Backs the query API, which the dashboard reads.\nconst a = 1;',
    },
    {
      name: 'unrelated ID sharing an -ok comment is stripped, marker kept',
      file: 'a.ts',
      input: '// MINCRM-686-ok: cleared in beforeEach (MINCRM-500)\nconst a = 1;',
      expected: '// MINCRM-686-ok: cleared in beforeEach\nconst a = 1;',
    },
  ];

  let failures = 0;
  for (const testCase of cases) {
    const actual = stripFile(testCase.file, testCase.input);
    if (actual !== testCase.expected) {
      failures += 1;
      process.stderr.write(
        `FAIL ${testCase.name}\n  expected ${JSON.stringify(testCase.expected)}\n` +
          `  actual   ${JSON.stringify(actual)}\n`,
      );
    }
  }

  // findHits must agree with stripFile about what is in scope.
  const classification: Array<[string, string, 'pure' | 'judgment' | 'none']> = [
    ['a.ts', '// reason (MINCRM-1)\nconst a = 1;', 'pure'],
    ['a.ts', '// MINCRM-1: leading form\nconst a = 1;', 'judgment'],
    ['a.ts', '/**\n * @openapi\n * x (MINCRM-1)\n */\nconst a = 1;', 'none'],
    ['a.ts', '// MINCRM-686-ok: fine\nconst a = 1;', 'none'],
    ['a.ts', "const k = 'MINCRM-609';", 'none'],
  ];
  for (const [file, source, expected] of classification) {
    const hits = findHits(file, source);
    const actual = hits.length === 0 ? 'none' : hits[0].kind;
    if (actual !== expected) {
      failures += 1;
      process.stderr.write(
        `FAIL classification of ${JSON.stringify(source)}: expected ${expected}, got ${actual}\n`,
      );
    }
  }

  const mustModify = cases.filter((testCase) => testCase.input !== testCase.expected).length;
  process.stdout.write(
    `self-test: ${cases.length} strip cases (${mustModify} must-modify), ` +
      `${classification.length} classification cases, ${failures} failure(s)\n`,
  );
  if (failures > 0) process.exitCode = 1;
}

function main(): void {
  const mode = process.argv[2] ?? '--report';
  if (mode === '--self-test') return selfTest();

  // Optional path prefixes after the mode scope the run to one workspace, so the
  // removal can land as per-workspace commits. With none given every tracked source
  // file is considered, which is what --verify must always do.
  const prefixes = process.argv.slice(3);
  const files = listSourceFiles().filter(
    (file) => prefixes.length === 0 || prefixes.some((prefix) => file.startsWith(prefix)),
  );

  if (mode === '--write') {
    let changed = 0;
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (findHits(file, source).every((hit) => hit.kind !== 'pure')) continue;
      const next = stripFile(file, source);
      if (next !== source) {
        writeFileSync(file, next);
        changed += 1;
      }
    }
    process.stdout.write(`rewrote ${changed} files\n`);
    return;
  }

  const hits = files.flatMap((file) => findHits(file, readFileSync(file, 'utf8')));

  if (mode === '--verify') {
    if (hits.length === 0) {
      process.stdout.write('no work-item IDs in source comments\n');
      return;
    }
    process.stderr.write(
      `${hits.length} work-item ID(s) remain in source comments:\n` +
        hits
          .slice(0, 50)
          .map((hit) => `  ${hit.file}:${hit.line}  ${hit.id}`)
          .join('\n') +
        (hits.length > 50 ? `\n  …and ${hits.length - 50} more\n` : '\n'),
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write('file,line,kind,id,text\n');
  for (const hit of hits) {
    process.stdout.write(
      `${hit.file},${hit.line},${hit.kind},${hit.id},"${hit.text.replace(/"/g, '""')}"\n`,
    );
  }
}

// Only run when invoked directly, so the unit tests can import the helpers above.
// Exact resolution, matching server/src/scripts/load-coverage-map.ts: a basename
// suffix match would also fire for a same-named file in another directory.
const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && currentFile === resolvePath(process.argv[1])) {
  main();
}
