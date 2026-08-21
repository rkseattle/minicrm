#!/usr/bin/env node
/**
 * Fails when a MiniCRM API path appears without its `/api/v1` prefix in a comment or a
 * test title.
 *
 * Resource routes all mount under `/api/v1` (`server/src/app.ts`). A pre-v1 path in a
 * docblock or a `describe()` title is not merely untidy: it is the shape a reader copies,
 * and the unversioned form either 404s or survives only on a backward-compat redirect
 * that is documented for removal.
 *
 * Comments and test titles are checked because those are the two places a path is prose
 * rather than behaviour. Request URLs in executable code are left alone — changing one
 * changes what a test exercises, which is not a documentation fix.
 *
 * That is a real blind spot, not just a scoping choice: an unversioned path in a string
 * the code compares against is a bug this guard cannot see. `apiUrlFilter` in the perf
 * suite was one — a substring filter that silently matched nothing.
 *
 * Scheme-qualified URLs are stripped before matching, so a link to someone else's API is
 * not a finding. A host-relative path still is, including one aimed at localhost.
 *
 * Interior lines of a block comment that do not open with `*` are also unseen — mostly
 * JSX `{/* ... *\/}` blocks. None hides a path today.
 *
 * Run: node scripts/check-api-path-versioning.mjs [--self-test]
 */

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCANNED_PREFIXES = ['server/src/', 'client/src/', 'shared/', 'qa/e2e/'];

/** Suppresses one line, so a single fixture does not blind the rest of a file. */
const LINE_EXEMPTION = /api-path-ok\b/;

/** A version segment applied twice — what a mechanical rewrite does to a correct path. */
const DOUBLED_VERSION = /^\/api\/v\d+\/v\d+/;

/** Unversioned paths that are correct: infra endpoints and the Connect RPC prefix. */
const EXEMPT_PATH = /^\/api\/(?:v1|v2|health)(?:\/|$)|^\/api\/minicrm\./;

const COMMENT_LINE = /^\s*(\*|\/\/|\/\*)/;
/** Scheme-qualified URLs. A host-relative /api/... path still needs the version. */
const ABSOLUTE_URL = /\bhttps?:\/\/[^\s)'"`]+/g;

/** A `//` or `/* ... *\/` comment following code on the same line. */
const TRAILING_COMMENT = /\/\/.*$|\/\*[\s\S]*?\*\//g;
// `.each` interposes an argument list before the title, so allow one bracketed group.
const TEST_TITLE = /(?:describe|it|test)(?:\.\w+)?(?:\([^)]*\))?\(\s*['"`]([^'"`]*)['"`]/g;
// Not preceded by `@` and not ending in a source extension: `@/api/foo.ts` is the
// client's import alias, not a URL, and versioning it breaks the path.
// Captures one following segment only when it is a version, so `/api/v1/v1` is visible
// as a whole while an ordinary `/api/v1/contacts` still reads as its prefix.
const API_PATH = /(?<![@\w])\/api\/[a-z][a-z0-9.-]*(?:\/v\d+)?/g;
const MODULE_PATH = /\.(ts|tsx|js|mjs|cjs)$/;

/**
 * Unversioned API paths in one file's comments and test titles.
 *
 * @param {string} text - File contents.
 * @returns {Array<{line: number, path: string, context: string}>} One entry per hit.
 */
export function findUnversionedPaths(text) {
  const findings = [];
  const lines = text.split('\n');

  lines.forEach((line, index) => {
    const commented = COMMENT_LINE.test(line)
      ? line
      : (line.match(TRAILING_COMMENT) ?? []).join(' ');
    if (!commented) return;
    if (LINE_EXEMPTION.test(commented)) return;
    for (const match of commented.replace(ABSOLUTE_URL, ' ').matchAll(API_PATH)) {
      if (DOUBLED_VERSION.test(match[0])) {
        findings.push({ line: index + 1, path: match[0], context: 'comment' });
        continue;
      }
      if (EXEMPT_PATH.test(match[0]) || MODULE_PATH.test(match[0])) continue;
      findings.push({ line: index + 1, path: match[0], context: 'comment' });
    }
  });

  for (const match of text.matchAll(TEST_TITLE)) {
    const line = text.slice(0, match.index).split('\n').length;
    for (const found of match[1].matchAll(API_PATH)) {
      if (DOUBLED_VERSION.test(found[0])) {
        findings.push({ line, path: found[0], context: 'test title' });
        continue;
      }
      if (EXEMPT_PATH.test(found[0]) || MODULE_PATH.test(found[0])) continue;
      findings.push({ line, path: found[0], context: 'test title' });
    }
  }

  return findings;
}

function scannedFiles() {
  const out = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return (
    out
      .split('\0')
      .filter(Boolean)
      .filter((p) => /\.(ts|tsx)$/.test(p))
      .filter((p) => SCANNED_PREFIXES.some((prefix) => p.startsWith(prefix)))
      // framework/ must stay free of app-domain strings, so its /api/items-style
      // placeholders are deliberately generic — versioning them would inject exactly what
      // check-framework-purity.sh forbids.
      .filter((p) => !p.startsWith('qa/e2e/framework/'))
  );
}

function selfTest() {
  const cases = [
    ['/** GET /api/contacts returns a list. */', 1, 'unversioned path in a docblock'],
    ["describe('POST /api/accounts', () => {", 1, 'unversioned path in a describe title'],
    ["it('rejects GET /api/deals/:id', () => {", 1, 'unversioned path in an it title'],
    ['/** GET /api/v1/contacts returns a list. */', 0, 'a versioned path'],
    ['// The /api/health endpoint is unversioned by design.', 0, 'the health endpoint'],
    ['// Connect mounts at /api/minicrm.audit.v1.AuditService.', 0, 'the Connect prefix'],
    ["const url = '/api/contacts';", 0, 'a request URL in executable code'],
    ['/** GET /api/v2/messages — third-party. */', 0, 'a v2 path'],
    ['// see https://docs.example.com/api/contacts for theirs', 0, 'a third-party URL'],
    ['// See @/api/coverageSessions.ts for the type.', 0, 'a client import alias'],
    ['// The module lives at api/contacts.ts.', 0, 'a bare module path'],
    ['app.get("/api/v1/x"); // and /api/tags', 1, 'a trailing line comment'],
    ['const s = 1; /* see /api/contacts */', 1, 'a trailing block comment'],
    ["it.each([1])('GET /api/deals %s', () => {})", 1, 'an it.each title'],
    ['// /api/healthz is not the health endpoint.', 1, 'a path that only prefixes health'],
    ['// Mounted at /api/v1/v1 in app.ts.', 1, 'a doubled version segment'],
  ];

  let failures = 0;
  for (const [code, want, label] of cases) {
    const got = findUnversionedPaths(code).length;
    if (got !== want) {
      console.error(`SELF-TEST FAIL: ${label} → ${got} findings, want ${want}.`);
      failures += 1;
    }
  }

  const both = findUnversionedPaths("/** GET /api/leads */\ndescribe('GET /api/tags', () => {");
  if (both.length !== 2) {
    console.error(`SELF-TEST FAIL: comment + title → ${both.length} findings, want 2.`);
    failures += 1;
  }

  if (failures > 0) process.exit(1);
  console.log(
    `SELF-TEST PASS: ${cases.filter((c) => c[1] > 0).length + 1} must-flag and ` +
      `${cases.filter((c) => c[1] === 0).length} must-not-flag cases.`,
  );
}

function main() {
  if (process.argv[2] === '--self-test') {
    selfTest();
    return;
  }
  if (process.argv[2] !== undefined) {
    console.error('Usage: node scripts/check-api-path-versioning.mjs [--self-test]');
    process.exit(2);
  }

  const files = scannedFiles();
  const findings = [];
  for (const file of files) {
    for (const found of findUnversionedPaths(readFileSync(resolve(REPO_ROOT, file), 'utf8'))) {
      findings.push({ file, ...found });
    }
  }

  if (findings.length > 0) {
    console.error(`FAIL: ${findings.length} unversioned MiniCRM API path(s).`);
    for (const f of findings) {
      console.error(`  ${f.file}:${f.line} (${f.context}) — ${f.path}`);
    }
    console.error('Resource routes mount under /api/v1. Add the prefix, or if the path is');
    console.error('genuinely not a MiniCRM route, put `api-path-ok` on the same line with');
    console.error('the reason.');
    process.exit(1);
  }
  console.log(`OK: no unversioned API paths in comments or test titles (${files.length} files).`);
}

// Exact resolution, matching scripts/check-comments-only-diff.ts: a basename suffix
// match would also fire for a same-named file in another directory.
const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && currentFile === resolve(process.argv[1])) {
  main();
}
