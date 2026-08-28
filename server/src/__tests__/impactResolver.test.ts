/**
 * Tests for impactResolver.
 *
 * Extraction runs against fixture sources under __fixtures__/impact-specs/,
 * suffixed .txt so neither vitest nor Playwright's own globs try to run them.
 * Resolution runs against the real spec tree, compared to a fresh walk rather
 * than a hardcoded count, so an unrelated new spec cannot break these.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractImpactsGlobs,
  findStaleImpactsGlobs,
  resolveImpactedSpecs,
} from '../coverageAgent/testSelection/impactResolver.js';

const FUNCTIONAL_SPEC_DIR = 'qa/e2e/tests/apps/minicrm/functional';

function repoRoot(): string {
  let candidate = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(resolve(candidate, '.git'))) {
    const parent = dirname(candidate);
    if (parent === candidate) throw new Error('no ancestor directory contains .git');
    candidate = parent;
  }
  return candidate;
}

function fixture(name: string): string {
  return readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__/impact-specs', name),
    'utf8',
  );
}

/** A fresh walk of the spec tree, so assertions compare against reality rather than a number that rots. */
function walkSpecFiles(): string[] {
  const root = resolve(repoRoot(), FUNCTIONAL_SPEC_DIR);
  const found: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.spec.ts')) found.push(full);
    }
  }
  walk(root);
  return found;
}

describe('extractImpactsGlobs', () => {
  it('reads an annotation from a flat test call', () => {
    expect(extractImpactsGlobs(fixture('flat-test.spec.ts.txt'), 'flat.spec.ts')).toEqual([
      'db/migrations/**',
    ]);
  });

  it('reads an annotation given as a bare object on a describe block', () => {
    expect(extractImpactsGlobs(fixture('describe-block.spec.ts.txt'), 'describe.spec.ts')).toEqual([
      'shared/schemas/**',
    ]);
  });

  it('reads several impacts and ignores other annotation types', () => {
    expect(extractImpactsGlobs(fixture('multiple.spec.ts.txt'), 'multiple.spec.ts')).toEqual([
      'db/migrations/**',
      'qa/migrations/**',
    ]);
  });

  it('returns nothing for a spec with no options object', () => {
    expect(extractImpactsGlobs(fixture('no-options.spec.ts.txt'), 'none.spec.ts')).toEqual([]);
  });

  it('returns nothing for a spec carrying tag but no annotation', () => {
    expect(extractImpactsGlobs(fixture('tag-only.spec.ts.txt'), 'tag.spec.ts')).toEqual([]);
  });

  // A details object built anywhere in the file still counts: its author wrote a
  // declaration, and silently dropping it would under-select with no signal.
  it('reads an annotation from an options object held in a variable', () => {
    expect(extractImpactsGlobs(fixture('via-variable.spec.ts.txt'), 'var.spec.ts')).toEqual([
      'db/migrations/**',
    ]);
  });
});

describe('resolveImpactedSpecs', () => {
  it('reports full-suite for a path whose scope is functional:*', () => {
    const result = resolveImpactedSpecs(['server/src/app.ts'], repoRoot());
    expect(result.fullSuite).toBe(true);
    expect(result.specFiles).toEqual([]);
  });

  it('resolves a locale change to the i18n specs by directory convention', () => {
    const result = resolveImpactedSpecs(['client/src/locales/en.json'], repoRoot());
    expect(result.fullSuite).toBe(false);
    const expected = walkSpecFiles()
      .filter((file) => file.includes(`${FUNCTIONAL_SPEC_DIR}/i18n/`))
      .map((file) => file.slice(repoRoot().length + 1));
    expect(result.specFiles.sort()).toEqual(expected.sort());
    expect(result.specFiles.length).toBeGreaterThan(0);
  });

  it('resolves nothing for a path the manifest declares uncovered', () => {
    const result = resolveImpactedSpecs(['docs/dev/coverage.md'], repoRoot());
    expect(result.fullSuite).toBe(false);
    expect(result.specFiles).toEqual([]);
    expect(result.matchedScopes).toEqual([]);
  });

  it('deduplicates a spec reachable from two changed paths', () => {
    const result = resolveImpactedSpecs(
      ['client/src/locales/en.json', 'client/src/locales/fr.json'],
      repoRoot(),
    );
    expect(new Set(result.specFiles).size).toBe(result.specFiles.length);
  });
});

// Built on a temporary tree rather than the real one: with no stale annotation in
// the repo, an assertion over the real tree passes even if the matcher is deleted.
describe('findStaleImpactsGlobs', () => {
  let tree: string;

  beforeEach(() => {
    tree = mkdtempSync(join(tmpdir(), 'impact-stale-'));
    const specDir = resolve(tree, FUNCTIONAL_SPEC_DIR, 'demo');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(resolve(specDir, 'stale.spec.ts'), fixture('stale-glob.spec.ts.txt'), 'utf8');
    writeFileSync(resolve(specDir, 'live.spec.ts'), fixture('flat-test.spec.ts.txt'), 'utf8');
  });

  afterEach(() => {
    rmSync(tree, { recursive: true, force: true });
  });

  it('reports a glob matching no tracked path', () => {
    const stale = findStaleImpactsGlobs(tree, ['db/migrations/001_init.js']);
    expect(stale).toEqual([
      {
        specFile: `${FUNCTIONAL_SPEC_DIR}/demo/stale.spec.ts`,
        glob: 'gone/moved-away/**',
      },
    ]);
  });

  it('reports nothing when every glob matches something', () => {
    const stale = findStaleImpactsGlobs(tree, [
      'db/migrations/001_init.js',
      'gone/moved-away/file.ts',
    ]);
    expect(stale).toEqual([]);
  });

  it('finds no stale annotation in the real repo', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: repoRoot(), encoding: 'utf8' })
      .trim()
      .split('\n');
    expect(findStaleImpactsGlobs(repoRoot(), tracked)).toEqual([]);
  });
});
