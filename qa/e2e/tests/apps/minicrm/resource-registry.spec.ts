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
import {
  RESOURCE_REGISTRY,
  ENSURE_SYSTEM_DEFAULTS_KEYS,
} from '../../../apps/minicrm/resource-registry.js';
import { findTaggedTestTitles } from '../../../framework/reporting/timing-utils.js';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const FUNCTIONAL_TESTS_DIR = path.join(REPO_ROOT, 'qa/e2e/tests/apps/minicrm/functional');

/** Files where the string "@serial" appears only inside a comment, not an
 *  actual test tag — intentionally excluded from the registry.
 *
 *  NOT a completeness requirement, and not the mechanism that excludes such
 *  files: findTaggedTestTitles matches only `test('...')` titles, so prose
 *  never registers as a tag in the first place. This list exists solely for the
 *  negative assertion below (a comment-only file must not have a registry
 *  entry). Adding a file here changes nothing about whether it is treated as
 *  @serial — several comment-only files are deliberately absent. */
const KNOWN_COMMENT_ONLY_FILES = [
  'qa/e2e/tests/apps/minicrm/functional/insights/coaching.spec.ts',
  // data-hygiene.spec.ts was here until MINCRM-705. Its comment claimed no
  // @serial was needed, reasoning about data_hygiene_scoring_config while
  // overlooking the setAiEnabled() call that writes the ai_configuration_enabled
  // singleton. F-HYGIENE3 is now genuinely tagged and registered.
  'qa/e2e/tests/apps/minicrm/functional/leads/lead-routing.spec.ts',
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
  // Deduplicated by file: a file may legitimately hold several entries (a
  // file-wide one plus title-scoped ones), and this assertion is about the file,
  // not the entry — iterating entries would declare duplicate test titles, which
  // Playwright rejects outright. (MINCRM-705)
  for (const file of [...new Set(RESOURCE_REGISTRY.map((e) => e.file))]) {
    test(`"${file}" exists on disk`, () => {
      const absPath = path.join(REPO_ROOT, file);
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
  // Deduplicated for the same reason as the "exists on disk" block above.
  const fileWideFiles = [
    ...new Set(RESOURCE_REGISTRY.filter((e) => !e.testTitleContains).map((e) => e.file)),
  ];
  for (const file of fileWideFiles) {
    test(`"${file}" has at least one @serial-tagged test`, () => {
      const absPath = path.join(REPO_ROOT, file);
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

// ---------------------------------------------------------------------------
// pipeline_stages_reviewed modeling (MINCRM-705)
//
// These pin the REGISTRY ENTRIES, not the graph builder. Asserting that two
// files land in different conflict groups would be trivially true once they
// share a key — it would test buildConflictGraph, which conflict-graph.spec.ts
// already covers, and would still pass if the entries themselves were wrong.
// ---------------------------------------------------------------------------
test.describe('resource-registry — pipeline_stages_reviewed (MINCRM-705)', () => {
  // The composite key each ensureSystemDefaults() caller declares. It expands to
  // the helper's ten real rows at collapse time (see expandCompositeKeys), so the
  // assertions below check what entries DECLARE, and the key-coverage test above
  // checks that what it expands to is complete.
  const KEY = 'settings.ensure_system_defaults';
  const p = (rel: string) => `qa/e2e/tests/apps/minicrm/functional/${rel}`;

  /**
   * Every spec that calls ensureSystemDefaults(), which DELETEs the
   * pipeline_stages_reviewed row. Each must declare the key, or the conflict
   * graph cannot separate it from onboarding.spec.ts and the two can be
   * co-scheduled while racing that row.
   *
   * DERIVED from the spec tree, not hand-listed. A hand-typed array here would
   * be invisible to a tenth spec that starts calling ensureSystemDefaults() —
   * the same silent-staleness failure mode that made the old
   * check-settings-mutations.sh miss onboarding.spec.ts, and which this ticket
   * replaced with derivation. Comment-only matches are excluded so
   * visual-regression.spec.ts (which mentions the helper while deliberately
   * NOT calling it) does not register as a caller.
   */
  const ENSURE_SYSTEM_DEFAULTS_CALLERS = discoverSpecFiles(FUNCTIONAL_TESTS_DIR).filter((rel) => {
    const source = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => {
        const idx = line.indexOf('//');
        return idx === -1 ? line : line.slice(0, idx);
      })
      .join('\n');
    return /\bensureSystemDefaults\s*\(/.test(withoutComments);
  });

  test('ENSURE_SYSTEM_DEFAULTS_KEYS covers every row the helper actually writes', () => {
    // The composite key is only as good as this list. A write added to
    // ensureSystemDefaults() without a matching key here silently under-models
    // the conflict for all nine callers at once — which is what happened when
    // only pipeline_stages_reviewed was modeled: two pairs of specs ended up
    // co-scheduled at workers=2 with a live cross-file race.
    //
    // Derived from the helper's own source rather than hand-listed, for the same
    // reason the caller list is derived.
    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'qa/e2e/behaviors/minicrm/settings.behaviors.ts'),
      'utf8',
    );
    const afterSignature = source.slice(
      source.indexOf('export async function ensureSystemDefaults'),
    );
    const helperBody = afterSignature.slice(0, afterSignature.indexOf('\n}'));
    const endpoints = [...helperBody.matchAll(/\/api\/v1\/settings\/([a-z-]+)/g)].map((m) => m[1]);

    /** endpoint slug -> the ResourceKey modeling that row. */
    const KEY_FOR_ENDPOINT: Record<string, string> = {
      'default-language': 'settings.default_language',
      'nav-layout': 'settings.nav_layout',
      'email-notifications': 'settings.email_notifications_enabled',
      'tags-restrict-creation': 'settings.tags_restrict_creation',
      currencies: 'settings.currencies',
      branding: 'settings.branding',
      'pipeline-stages-reviewed': 'settings.pipeline_stages_reviewed',
      sso: 'settings.sso',
      'mfa-required': 'settings.mfa_required',
      visibility: 'settings.visibility_policy',
    };

    const unmapped = [...new Set(endpoints)].filter((e) => !KEY_FOR_ENDPOINT[e as string]);
    expect(
      unmapped,
      `ensureSystemDefaults() writes endpoint(s) with no ResourceKey mapping: ${JSON.stringify(unmapped)}. Add the key to ResourceKey, to ENSURE_SYSTEM_DEFAULTS_KEYS, and to this map.`,
    ).toEqual([]);

    const expected = [...new Set(endpoints.map((e) => KEY_FOR_ENDPOINT[e as string]))].sort();
    expect([...ENSURE_SYSTEM_DEFAULTS_KEYS].sort()).toEqual(expected);
  });

  test('the derived ensureSystemDefaults caller list is not empty', () => {
    // A derivation that silently returns nothing would make every assertion
    // below vacuously pass — the exact shape of guard failure this ticket exists
    // to prevent.
    expect(ENSURE_SYSTEM_DEFAULTS_CALLERS.length).toBeGreaterThan(0);
  });

  for (const file of ENSURE_SYSTEM_DEFAULTS_CALLERS) {
    test(`${file.split('/').pop()} declares ${KEY} as a write`, () => {
      const writes = RESOURCE_REGISTRY.filter((e) => e.file === file).flatMap((e) => e.writes);
      expect(writes, `${file} calls ensureSystemDefaults() but does not declare ${KEY}`).toContain(
        KEY,
      );
    });
  }

  /**
   * Files whose ensureSystemDefaults() call is at FILE level (so every test
   * writes the row) need a file-wide entry — one with no testTitleContains.
   * Without it hasFileWideRegistryEntry() returns false in
   * gen-conflict-group-configs.ts and the file stays eligible for
   * MAX_GROUP_WORKERS, able to race itself on the row.
   *
   * notifications.spec.ts is deliberately NOT here: its ensureSystemDefaults
   * calls live inside the F10-AS describe.serial block's own hooks, so only
   * those tests write the row and the title-scoped entry is correct.
   */
  const FILE_LEVEL_HOOK_CALLERS = [
    p('reports/reports-nav.spec.ts'),
    p('onboarding/onboarding.spec.ts'),
  ];

  for (const file of FILE_LEVEL_HOOK_CALLERS) {
    test(`${file.split('/').pop()} has a file-wide entry covering ${KEY}`, () => {
      const fileWide = RESOURCE_REGISTRY.filter((e) => e.file === file && !e.testTitleContains);
      expect(
        fileWide.some((e) => e.writes.includes(KEY)),
        `${file} calls ensureSystemDefaults() from file-level hooks, so it needs a file-wide entry declaring ${KEY}`,
      ).toBe(true);
    });
  }

  test('notifications.spec.ts keeps its title-scoped entry, not a file-wide one', () => {
    const file = p('notifications/notifications.spec.ts');
    const fileWide = RESOURCE_REGISTRY.filter((e) => e.file === file && !e.testTitleContains);
    expect(
      fileWide,
      'notifications.spec.ts calls ensureSystemDefaults only inside the F10-AS block; a file-wide entry would move the whole file to workers:1 on a false premise',
    ).toEqual([]);
  });

  test('onboarding.spec.ts models the seeded admin row it alone sets false', () => {
    const file = p('onboarding/onboarding.spec.ts');
    const writes = RESOURCE_REGISTRY.filter((e) => e.file === file).flatMap((e) => e.writes);
    expect(writes).toContain('users.admin_onboarding_completed');
  });
});
