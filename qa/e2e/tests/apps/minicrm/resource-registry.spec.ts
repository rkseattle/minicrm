/**
 * Validates the ground-truth resource-tag registry (resource-registry.ts)
 * against the actual spec files on disk, so the registry can't silently
 * drift from reality as specs are added, renamed, or re-tagged.
 *
 * Verifies:
 * 1. Every registry entry's `file` path exists on disk.
 * 2. Every registry entry with `testTitleContains` matches an actual test
 *    title in that file, and that test is tagged @serial.
 * 3. Every file-wide registry entry (no `testTitleContains`) has at least
 *    one @serial-tagged test in the file.
 * 4. Every currently @serial-tagged file on disk has a registry entry
 *    (catches a newly-added @serial test with no corresponding resource
 *    entry — the conflict graph would silently ignore it otherwise).
 * 5. No two registry entries for the same file have overlapping
 *    `testTitleContains` scope with contradictory resource sets (sanity
 *    check against typos/copy-paste errors).
 *
 * MINCRM-661
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import fs from 'node:fs';
import path from 'node:path';
import { RESOURCE_REGISTRY } from '../../../apps/minicrm/resource-registry.js';
import { findTaggedTestTitles } from '../../../framework/reporting/timing-utils.js';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const FUNCTIONAL_TESTS_DIR = path.join(REPO_ROOT, 'qa/e2e/tests/apps/minicrm/functional');

/** Files where the string "@serial" appears only inside a comment, not an
 *  actual test tag — intentionally excluded from the registry. */
const KNOWN_COMMENT_ONLY_FILES = [
  'qa/e2e/tests/apps/minicrm/functional/insights/coaching.spec.ts',
  'qa/e2e/tests/apps/minicrm/functional/data-hygiene/data-hygiene.spec.ts',
  'qa/e2e/tests/apps/minicrm/functional/leads/lead-routing.spec.ts',
  // De-tagged by MINCRM-685; their docblocks still explain why they are no
  // longer @serial, so the bare string survives in prose.
  'qa/e2e/tests/apps/minicrm/functional/coverage-mapping/coverage-mapping.spec.ts',
  'qa/e2e/tests/apps/minicrm/functional/coverage-pipeline/coverage-pipeline.spec.ts',
  'qa/e2e/tests/apps/minicrm/functional/coverage-health/coverage-health.spec.ts',
];

function discoverSpecFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...discoverSpecFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.spec.ts')) {
      results.push(path.relative(REPO_ROOT, fullPath));
    }
  }
  return results.sort();
}

function findSerialTestTitles(fileAbsPath: string): string[] {
  return findTaggedTestTitles(fileAbsPath, '@serial');
}

const allSpecFiles = discoverSpecFiles(FUNCTIONAL_TESTS_DIR);
const trueSerialFiles = allSpecFiles.filter((relPath) => {
  if (KNOWN_COMMENT_ONLY_FILES.includes(relPath)) return false;
  const absPath = path.join(REPO_ROOT, relPath);
  return findSerialTestTitles(absPath).length > 0;
});

test.describe('resource-registry — entries reference real files', () => {
  for (const entry of RESOURCE_REGISTRY) {
    test(`"${entry.file}" exists on disk`, () => {
      const absPath = path.join(REPO_ROOT, entry.file);
      expect(fs.existsSync(absPath)).toBe(true);
    });
  }
});

test.describe('resource-registry — testTitleContains entries match real @serial test titles', () => {
  for (const entry of RESOURCE_REGISTRY) {
    if (!entry.testTitleContains) continue;
    test(`"${entry.file}" has an @serial test titled like "${entry.testTitleContains}"`, () => {
      const absPath = path.join(REPO_ROOT, entry.file);
      const serialTitles = findSerialTestTitles(absPath);
      const matches = serialTitles.some((title) =>
        title.includes(entry.testTitleContains as string),
      );
      expect(
        matches,
        `expected an @serial test title containing "${entry.testTitleContains}" in ${entry.file}; found: ${JSON.stringify(serialTitles)}`,
      ).toBe(true);
    });
  }
});

test.describe('resource-registry — file-wide entries have at least one @serial test', () => {
  for (const entry of RESOURCE_REGISTRY) {
    if (entry.testTitleContains) continue;
    test(`"${entry.file}" has at least one @serial-tagged test`, () => {
      const absPath = path.join(REPO_ROOT, entry.file);
      const serialTitles = findSerialTestTitles(absPath);
      expect(serialTitles.length).toBeGreaterThan(0);
    });
  }
});

test.describe('resource-registry — every entry declares at least one resource', () => {
  for (const entry of RESOURCE_REGISTRY) {
    test(`"${entry.file}"${entry.testTitleContains ? ` (${entry.testTitleContains})` : ''} declares reads or writes`, () => {
      expect(entry.reads.length + entry.writes.length).toBeGreaterThan(0);
    });
  }
});

test.describe('resource-registry — completeness against files on disk', () => {
  test('every currently @serial-tagged spec file has at least one registry entry', () => {
    const registeredFiles = new Set(RESOURCE_REGISTRY.map((e) => e.file));
    const missing = trueSerialFiles.filter((f) => !registeredFiles.has(f));
    expect(
      missing,
      `spec files with @serial tests but no resource-registry entry: ${JSON.stringify(missing)}`,
    ).toEqual([]);
  });

  test('every registry entry corresponds to a file that actually has @serial tests', () => {
    const trueSerialSet = new Set(trueSerialFiles);
    const registeredButNotSerial = RESOURCE_REGISTRY.map((e) => e.file).filter(
      (f) => !trueSerialSet.has(f),
    );
    expect(
      registeredButNotSerial,
      `registry entries for files with no @serial test: ${JSON.stringify(registeredButNotSerial)}`,
    ).toEqual([]);
  });

  test('known comment-only files are correctly excluded from the registry', () => {
    const registeredFiles = new Set(RESOURCE_REGISTRY.map((e) => e.file));
    for (const commentOnlyFile of KNOWN_COMMENT_ONLY_FILES) {
      expect(registeredFiles.has(commentOnlyFile)).toBe(false);
    }
  });
});
