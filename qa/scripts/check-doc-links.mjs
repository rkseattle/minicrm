#!/usr/bin/env node
// Resolves every relative Markdown link in tracked documentation and fails on any that
// misses. Link rot is invisible until a reader clicks, so nothing else catches it.
//
// Deliberately path-only. Anchor fragments are stripped rather than validated, because
// resolving them means parsing every target's headings and reimplementing GitHub's slug
// rules — a second guard's worth of surface for a weaker failure mode.
//
// Run: node qa/scripts/check-doc-links.mjs [--self-test]

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Scanning less than the ci.yml `docs`/`doc-links` filters trigger on would report OK
// on files never opened. Nothing pins these two lists together; keep them in step by hand.
const SCANNED_PREFIXES = [
  'docs/',
  '.claude/',
  'qa/',
  'server/',
  'client/',
  'shared/',
  'coverage-dashboard/',
  'db/',
  'README.md',
  'CLAUDE.md',
];

// tbls regenerates docs/schema/ wholesale; it is excluded from markdownlint and prettier
// for the same reason.
const SKIP_PREFIXES = ['docs/schema/'];

// One level of nesting in the label, so a badge link — [![alt](img)](dest) — yields
// its outer destination. A flat [^\]]* stops at the image's own bracket and silently
// drops dest, which is how README's LICENSE badge went unchecked.
const INLINE_LINK = /\[(?:[^[\]]|\[[^\]]*\])*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

// git ls-files rather than a directory walk: the working tree carries generated
// Markdown (qa/test-results/) that no author can fix, and gitignore already encodes
// exactly that distinction.
function trackedMarkdown() {
  const out = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '-z', '*.md'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out
    .split('\0')
    .filter(Boolean)
    .filter((p) => SCANNED_PREFIXES.some((prefix) => p.startsWith(prefix)))
    .filter((p) => !SKIP_PREFIXES.some((prefix) => p.startsWith(prefix)))
    .map((p) => join(REPO_ROOT, p));
}

function isExternal(href) {
  return (
    href.startsWith('http://') ||
    href.startsWith('https://') ||
    href.startsWith('mailto:') ||
    href.startsWith('#')
  );
}

/** Returns findings as {file, href, resolved} for every relative link that does not resolve. */
export function findBrokenLinks(files, root = REPO_ROOT) {
  const findings = [];
  for (const file of files) {
    const body = readFileSync(file, 'utf8');
    for (const match of body.matchAll(INLINE_LINK)) {
      const href = match[1];
      if (isExternal(href)) continue;
      // Anchor-only and query parts play no role in whether the file exists.
      const path = href.split('#')[0].split('?')[0];
      if (!path) continue;
      // Directory targets are accepted: GitHub renders them as a listing, and
      // CLAUDE.md links [ADRs](docs/adr/) that way deliberately.
      const resolved = resolve(dirname(file), path);
      try {
        statSync(resolved);
      } catch {
        findings.push({ file: relative(root, file), href, resolved: relative(root, resolved) });
      }
    }
  }
  return findings;
}

/**
 * Every .md in docs/dev/ must appear in docs/dev/index.md exactly once. The index is
 * hand-maintained, and markdownlint sees neither a page added without a row nor a row
 * duplicated by an edit.
 *
 * Enumerates tracked files, so a brand-new page is invisible until `git add`. CI always
 * sees tracked files; locally, stage the page before trusting a pass.
 *
 * Returns findings as {page, problem}.
 */
export function findIndexGaps(root = REPO_ROOT) {
  const indexPath = join(root, 'docs', 'dev', 'index.md');
  let index;
  try {
    index = readFileSync(indexPath, 'utf8');
  } catch {
    return [{ page: 'index.md', problem: 'docs/dev/index.md is missing' }];
  }

  // Reuse the link parser rather than substring-matching: an anchored or titled link is
  // a listing, and two links on one line are two listings. Targets stay relative to the
  // index, so a nested page listed as `nested/deep.md` matches on that path.
  const listed = new Map();
  for (const match of index.matchAll(INLINE_LINK)) {
    const target = match[1].split('#')[0].split('?')[0];
    if (!target || target.startsWith('.') || !target.endsWith('.md')) continue;
    listed.set(target, (listed.get(target) ?? 0) + 1);
  }

  const pages = execFileSync('git', ['-C', root, 'ls-files', '-z', 'docs/dev/*.md'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean)
    // Relative to docs/dev/, matching how the index links them. git's `*` crosses '/',
    // so a nested page arrives here as `nested/deep.md` rather than colliding on its
    // basename with a top-level page of the same name.
    .map((p) => p.replace(/^docs\/dev\//, ''))
    .filter((name) => name !== 'index.md');

  const findings = [];
  for (const page of pages) {
    const count = listed.get(page) ?? 0;
    if (count === 0) {
      findings.push({ page, problem: 'not listed in docs/dev/index.md' });
    } else if (count > 1) {
      findings.push({ page, problem: `listed ${count} times in docs/dev/index.md` });
    }
  }
  return findings;
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'doclinks-'));
  const write = (rel, content) => {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    return abs;
  };

  // Must NOT flag: resolving relative link, parent-hop, anchor suffix, external URLs,
  // bare anchor, image, titled link.
  const clean = write(
    'guide/ok.md',
    [
      '[sibling](other.md)',
      '[parent](../top.md)',
      '[anchored](other.md#some-heading)',
      '[external](https://example.com/x.md)',
      '[mail](mailto:a@b.c)',
      '[self](#section)',
      '![img](../img/pic.png)',
      '[titled](other.md "Title")',
    ].join('\n\n'),
  );
  write('guide/other.md', '# other');
  write('top.md', '# top');
  write('img/pic.png', 'x');

  // Must flag: four distinct misses, including a badge link whose outer destination is
  // the broken one — the nesting case a flat label regex silently drops.
  const broken = write(
    'guide/bad.md',
    [
      '[gone](missing.md)',
      '[wrongdir](contacts.md#a)',
      '[badparent](../nope/x.md)',
      '[![alt](../img/pic.png)](also-missing.md)',
    ].join('\n\n'),
  );

  const cleanFindings = findBrokenLinks([clean], dir);
  const brokenFindings = findBrokenLinks([broken], dir);
  rmSync(dir, { recursive: true, force: true });

  const failures = [];
  if (cleanFindings.length !== 0) {
    failures.push(`expected 0 findings on the clean fixture, got ${cleanFindings.length}`);
  }
  if (brokenFindings.length !== 4) {
    failures.push(
      `expected exactly 4 findings on the broken fixture, got ${brokenFindings.length}`,
    );
  }

  // trackedMarkdown() decides which files are opened at all, so an empty result is the
  // silent failure this guard exists to avoid. Assert a floor rather than trusting it.
  const tracked = trackedMarkdown();
  if (tracked.length < 10) {
    failures.push(`trackedMarkdown() returned ${tracked.length} files; expected at least 10`);
  }

  // findIndexGaps has its own fixture tree: a bare filename match would pass the plain
  // rows and fail the anchored and titled ones, so both shapes are must-not-flag cases.
  const idxDir = mkdtempSync(join(tmpdir(), 'docidx-'));
  mkdirSync(join(idxDir, 'docs', 'dev'), { recursive: true });
  const writeDev = (name, body) => writeFileSync(join(idxDir, 'docs', 'dev', name), body);
  for (const name of ['alpha.md', 'beta.md', 'gamma.md', 'delta.md']) writeDev(name, '# x');
  // A nested page whose basename collides with a top-level one. git's `*` pathspec
  // crosses '/', so comparing basenames would both mask this page and reject its row.
  mkdirSync(join(idxDir, 'docs', 'dev', 'nested'), { recursive: true });
  writeFileSync(join(idxDir, 'docs', 'dev', 'nested', 'alpha.md'), '# nested');
  execFileSync('git', ['-C', idxDir, 'init', '-q']);
  execFileSync('git', ['-C', idxDir, 'add', '-A']);

  writeDev(
    'index.md',
    [
      '| [A](alpha.md) |',
      '| [B](beta.md#s) |',
      '| [G](gamma.md "T") |',
      '| [D](delta.md) |',
      '| [N](nested/alpha.md) |',
    ].join('\n'),
  );
  execFileSync('git', ['-C', idxDir, 'add', '-A']);
  const cleanIdx = findIndexGaps(idxDir);
  if (cleanIdx.length !== 0) {
    failures.push(
      `expected 0 index findings on plain/anchored/titled/nested rows, got ${cleanIdx.length}: ` +
        cleanIdx.map((f) => `${f.page} ${f.problem}`).join('; '),
    );
  }

  // Must flag: one page missing a row, and one listed twice on a single line.
  writeDev('index.md', ['| [A](alpha.md) |', '| [B](beta.md) and [B2](beta.md) |'].join('\n'));
  execFileSync('git', ['-C', idxDir, 'add', '-A']);
  const badIdx = findIndexGaps(idxDir);
  const missing = badIdx.filter((f) => f.problem.startsWith('not listed')).length;
  const dupes = badIdx.filter((f) => f.problem.includes('listed 2 times')).length;
  if (missing !== 3 || dupes !== 1) {
    failures.push(
      `expected exactly 3 missing and 1 duplicate index finding, got ${missing} and ${dupes}`,
    );
  }
  rmSync(idxDir, { recursive: true, force: true });

  if (failures.length > 0) {
    for (const f of failures) console.error(`SELF-TEST FAIL: ${f}`);
    process.exit(1);
  }
  console.log(
    `SELF-TEST PASS: 0 findings on 8 must-not-flag links, 4 on 4 broken links, ` +
      `${tracked.length} files discovered, index gaps asserted.`,
  );
}

// Mirrors check-settings-mutations.mjs: module scope must stay side-effect free so a
// future importer cannot inherit a repo scan or a process.exit.
const INVOKED_DIRECTLY = Boolean(
  process.argv[1] && process.argv[1].endsWith('check-doc-links.mjs'),
);

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }
  const files = trackedMarkdown();
  if (files.length === 0) {
    console.error('No Markdown files discovered — SCANNED_PREFIXES or git ls-files is broken.');
    process.exit(1);
  }
  // Both checks report before either exits: an index gap must not mask link rot, or
  // fixing one row sends the author back for a second run to find the rest.
  const indexGaps = findIndexGaps();
  const findings = findBrokenLinks(files);

  if (indexGaps.length > 0) {
    console.error(`docs/dev/index.md is out of step with the directory: ${indexGaps.length}\n`);
    for (const gap of indexGaps) {
      console.error(`  ${gap.page}: ${gap.problem}`);
    }
    console.error('');
  }

  if (findings.length > 0) {
    console.error(`Broken relative Markdown links: ${findings.length}\n`);
    for (const f of findings) {
      console.error(`  ${f.file}: [${f.href}] does not resolve (${f.resolved})`);
    }
    console.error('\nFix the link or restore the target.');
  }

  if (indexGaps.length > 0 || findings.length > 0) {
    process.exit(1);
  }
  console.log(
    `OK: every relative Markdown link resolves (${files.length} files checked), ` +
      `and docs/dev/index.md lists every page exactly once.`,
  );
}

if (INVOKED_DIRECTLY) {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--self-test');
  if (unknown.length > 0) {
    // A typo'd flag must not silently run the real check and print OK.
    console.error(`Unknown argument: ${unknown[0]}`);
    console.error('Usage: node qa/scripts/check-doc-links.mjs [--self-test]');
    process.exit(2);
  }
  main();
}
