/**
 * Pins the admin guide's feature-flag reference to the flag registry.
 *
 * The guide's reference table is what an administrator reads to learn which flags exist
 * and what they default to. Nothing regenerates it, so a flag added to the registry, or
 * a flag deleted from it, leaves the table describing a product that no longer matches —
 * the same drift that left five removed coverage_* flags documented after their rows
 * were gone.
 *
 * Both directions fail: a registry key with no row, and a row naming no registry key.
 *
 * Scope is the key set and the category groupings. The Default and Roles columns are
 * pinned only where an in-repo oracle exists — SEEDED_ROLE_OVERRIDES, which by design
 * holds just the denial maps. The rest of those columns comes from migration seeds, and
 * a squashed baseline re-seeds the same rows, so counting them yields statements rather
 * than flags; parsing that would pin the guide to a worse oracle than the guide.
 *
 * The comparison is bounded to the reference section's own lines. Two unrelated tables
 * elsewhere in the guide use the same `| \`key\` |` row shape — note visibility
 * (org/team/private) and the automation trigger and action catalogs — so a whole-file
 * match yields 51 keys against a 41-key registry, reporting phantom failures while
 * still passing if the entire reference table were deleted.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FEATURE_FLAG_KEYS,
  FEATURE_FLAG_CATEGORIES,
  SEEDED_ROLE_OVERRIDES,
} from '@minicrm/shared/schemas/featureFlagSchema.js';
import { expectGuardIsTriggered, WORKFLOW } from './ciFilterWiring.js';

const REPO_ROOT = join(__dirname, '../../..');

const ADMIN_GUIDE = 'docs/admin-guide.md';
const FLAG_SCHEMA = 'shared/schemas/featureFlagSchema.ts';
/** How the registry is resolved here; a directory alias would read the tsc side-emit. */
const VITEST_CONFIG = 'server/vitest.config.ts';

/** The heading that opens the reference section; the region runs to the next `###`. */
const REFERENCE_HEADING = '### Reference: every feature flag';

/** Rows from the note-visibility and automation tables — canaries for a slipped bound. */
const FOREIGN_TABLE_KEYS = ['org', 'team', 'private', 'contact_created', 'send_webhook'];

function doc(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), 'utf8');
}

/**
 * The reference section's lines, exclusive of the headings that bound it.
 *
 * Bounding on the next `###` rather than a line count means inserting a section above
 * the tables truncates the region to nothing, which the non-empty assertions below turn
 * into a failure naming the heading.
 */
function referenceRegion(markdown: string): string[] {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.trim() === REFERENCE_HEADING);
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^###\s/.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

/** Flag keys from `| \`key\` | ... |` rows. Column padding varies with the widest row. */
function documentedFlagKeys(region: string[]): Set<string> {
  const keys = new Set<string>();
  for (const line of region) {
    const match = /^\|\s*`([a-z][a-z0-9_]*)`\s*\|/.exec(line);
    if (match) keys.add(match[1]);
  }
  return keys;
}

/** Category names from the `####` sub-headings that group the tables. */
function documentedCategories(region: string[]): Set<string> {
  const categories = new Set<string>();
  for (const line of region) {
    const match = /^####\s+(.+?)\s*$/.exec(line);
    if (match) categories.add(match[1]);
  }
  return categories;
}

describe('admin guide documents every feature flag', () => {
  const region = referenceRegion(doc(ADMIN_GUIDE));

  // Asserts parsed rows, not line count: a region truncated to a blank line by an
  // inserted heading is non-empty, and would report as 41 undocumented flags instead of
  // the one structural cause.
  it(`${ADMIN_GUIDE} still has a bounded ${REFERENCE_HEADING} section`, () => {
    expect(
      documentedFlagKeys(region).size,
      `${ADMIN_GUIDE} has no "${REFERENCE_HEADING}" section, or a heading was inserted ` +
        'between it and the tables, truncating the region every assertion below reads.',
    ).toBeGreaterThan(0);
  });

  it('every registry flag has a row in the reference table', () => {
    const documented = documentedFlagKeys(region);
    for (const key of FEATURE_FLAG_KEYS) {
      expect(
        documented,
        `${key} is in FEATURE_FLAG_KEYS but has no row under "${REFERENCE_HEADING}" in ` +
          `${ADMIN_GUIDE}. Add it to the table for its category, with its seeded default ` +
          'and the roles its overrides name.',
      ).toContain(key);
    }
  });

  it('every documented flag is still in the registry', () => {
    const registered = new Set<string>(FEATURE_FLAG_KEYS);
    for (const key of documentedFlagKeys(region)) {
      expect(
        registered,
        `${ADMIN_GUIDE} documents ${key}, which is not in FEATURE_FLAG_KEYS (${FLAG_SCHEMA}). ` +
          'Remove the row, or restore the flag.',
      ).toContain(key);
    }
  });

  // Sorted-set comparison, never array equality: the registry is in UI-render order and
  // the guide groups alphabetically, so the two orders differ by design.
  it('the reference section groups flags under exactly the registry categories', () => {
    expect(
      [...documentedCategories(region)].sort(),
      `The "####" groupings under "${REFERENCE_HEADING}" in ${ADMIN_GUIDE} must match ` +
        `FEATURE_FLAG_CATEGORIES in ${FLAG_SCHEMA}, in either order.`,
    ).toEqual([...FEATURE_FLAG_CATEGORIES].sort());
  });

  // The only flag whose overrides exclude a role. The guide asserts in prose that it is
  // the only one, so a second denial map added without a doc edit makes that false.
  //
  // Checks the role is excluded, not merely mentioned: a row reading "admin, manager, rep"
  // names the denied role while asserting the opposite of the code, and "reporting"
  // contains "rep", so a bare substring test passes on both.
  it('every seeded role denial is called out in the row for its flag', () => {
    for (const [key, overrides] of Object.entries(SEEDED_ROLE_OVERRIDES)) {
      const denied = Object.entries(overrides ?? {})
        .filter(([, allowed]) => allowed === false)
        .map(([role]) => role);
      if (denied.length === 0) continue;

      const row = region.find((line) => line.startsWith(`| \`${key}\``));
      expect(row, `${ADMIN_GUIDE} has no reference row for ${key}`).toBeDefined();
      const rolesCell = row!.split('|')[3]?.trim() ?? '';

      for (const role of denied) {
        expect(
          new RegExp(`\\bnever ${role}\\b`).test(rolesCell),
          `${ADMIN_GUIDE}'s Roles cell for ${key} reads "${rolesCell}", which does not ` +
            `exclude "${role}". Its seeded overrides deny that role, so the row must say ` +
            `so — the form the guide uses is "(never ${role})".`,
        ).toBe(true);
        // A granted-role list naming the denied role states the opposite of the code.
        const granted = rolesCell
          .replace(/\([^)]*\)/g, '')
          .split(',')
          .map((entry) => entry.trim());
        expect(
          granted,
          `${ADMIN_GUIDE}'s Roles cell for ${key} lists "${role}" as granted, but its ` +
            'seeded overrides deny that role.',
        ).not.toContain(role);
      }
    }
  });

  it('the region bound excludes the other tables that share the row shape', () => {
    const documented = documentedFlagKeys(region);
    for (const foreign of FOREIGN_TABLE_KEYS) {
      expect(
        documented,
        `${foreign} is a row in an unrelated ${ADMIN_GUIDE} table and must not be read ` +
          'as a feature flag — the reference-section bound has stopped holding.',
      ).not.toContain(foreign);
    }
  });

  it('the files read here trigger the job that runs this guard', () => {
    expectGuardIsTriggered({
      output: 'feature-flag-docs',
      job: 'server-tests',
      filesRead: [ADMIN_GUIDE, FLAG_SCHEMA, WORKFLOW, VITEST_CONFIG],
    });
  });
});
