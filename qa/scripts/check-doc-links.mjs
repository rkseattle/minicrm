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

  if (failures.length > 0) {
    for (const f of failures) console.error(`SELF-TEST FAIL: ${f}`);
    process.exit(1);
  }
  console.log(
    `SELF-TEST PASS: 0 findings on 8 must-not-flag links, 4 on 4 broken links, ` +
      `${tracked.length} files discovered.`,
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
  const findings = findBrokenLinks(files);
  if (findings.length > 0) {
    console.error(`Broken relative Markdown links: ${findings.length}\n`);
    for (const f of findings) {
      console.error(`  ${f.file}: [${f.href}] does not resolve (${f.resolved})`);
    }
    console.error('\nFix the link or restore the target.');
    process.exit(1);
  }
  console.log(`OK: every relative Markdown link resolves (${files.length} files checked).`);
}

if (INVOKED_DIRECTLY) {
  main();
}
