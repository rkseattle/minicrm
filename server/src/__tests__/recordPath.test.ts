/**
 * Pins every record-link type to a route the router actually declares.
 *
 * buildRecordPath is the only place a client route for a record is constructed,
 * but on its own that just centralizes the guess — a prefix naming no route is
 * as dead centralized as it was scattered, and more convincing. This reads
 * App.tsx and fails when a mapped path matches no declared route, which is the
 * assertion that would have caught the reassignment email pointing at
 * /activities/:id.
 *
 * Route parsing follows userGuideRouteParity.test.ts, including its pinned
 * count: a JSX refactor that moves the block bounds makes the parse return
 * nothing, and every assertion below would pass vacuously against an empty set.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RECORD_LINK_TYPES,
  isRecordLinkType,
  recordPath,
  recordPathOrNull,
} from '@minicrm/shared/types/recordPath.js';
import { expectGuardIsTriggered, WORKFLOW } from './ciFilterWiring.js';

const REPO_ROOT = join(__dirname, '../../..');
const APP_ROUTES = 'client/src/App.tsx';
const SHARED_MODULE = 'shared/types/recordPath.ts';

/** Opens the authenticated block; the admin opener below it closes the scan. */
const PROTECTED_OPENER = '<Route element={<ProtectedRoute />}>';
const ADMIN_OPENER = '<Route element={<AdminRoute />}>';

/** Authenticated non-admin routes declared today; see userGuideRouteParity for why. */
const EXPECTED_ROUTE_COUNT = 23;

const SAMPLE_ID = '11111111-2222-3333-4444-555555555555';

/**
 * Route paths declared in App.tsx's authenticated, non-admin block.
 *
 * Matches `path=` rather than `<Route path=`: Prettier wraps long elements so the
 * attribute lands on its own line, and several redirect routes are written that way.
 */
function protectedRoutePaths(): string[] {
  const source = readFileSync(join(REPO_ROOT, APP_ROUTES), 'utf8');
  const start = source.indexOf(PROTECTED_OPENER);
  const end = source.indexOf(ADMIN_OPENER);
  expect(start, `${APP_ROUTES} no longer contains ${PROTECTED_OPENER}`).toBeGreaterThan(-1);
  expect(end, `${APP_ROUTES} no longer contains ${ADMIN_OPENER}`).toBeGreaterThan(start);
  return [...source.slice(start, end).matchAll(/\bpath="([^"]+)"/g)].map((match) => match[1]);
}

/** Rewrites a concrete path back to its route shape, so an id matches `:id`. */
function toRouteShape(path: string): string {
  return path.replace(SAMPLE_ID, ':id');
}

describe('record links resolve to declared routes', () => {
  // A parse yielding nothing satisfies every assertion below. Pinning the count turns a
  // JSX refactor into one failure here rather than silence, and catches a bound that ran
  // into the admin block as well as one that stopped short.
  it(`${APP_ROUTES} still declares the expected number of authenticated routes`, () => {
    const parsed = protectedRoutePaths();
    expect(
      parsed.length,
      `Parsed ${parsed.length} routes from ${APP_ROUTES}'s authenticated block, expected ` +
        `${EXPECTED_ROUTE_COUNT}. Update EXPECTED_ROUTE_COUNT if a route was added ` +
        'deliberately, or fix the block bounds if the JSX moved.',
    ).toBe(EXPECTED_ROUTE_COUNT);
  });

  it('every record-link type maps to a route the router declares', () => {
    const declared = new Set(protectedRoutePaths());
    for (const type of RECORD_LINK_TYPES) {
      const path = recordPath(type, SAMPLE_ID);
      expect(
        declared,
        `${SHARED_MODULE} maps ${type} to ${path}, which ${APP_ROUTES} does not declare. ` +
          'Point it at a route that exists, or add the route.',
      ).toContain(toRouteShape(path));
    }
  });

  it('returns null when there is no record to link to', () => {
    for (const type of RECORD_LINK_TYPES) {
      expect(recordPathOrNull(type, null)).toBeNull();
      expect(recordPathOrNull(type, undefined)).toBeNull();
      expect(recordPathOrNull(type, '')).toBeNull();
    }
    expect(recordPathOrNull(null, SAMPLE_ID)).toBeNull();
  });

  it('appends the id for record routes and omits it for collection routes', () => {
    expect(recordPath('contact', SAMPLE_ID)).toBe(`/contacts/${SAMPLE_ID}`);
    expect(recordPath('account', SAMPLE_ID)).toBe(`/accounts/${SAMPLE_ID}`);
    expect(recordPath('deal', SAMPLE_ID)).toBe(`/deals/${SAMPLE_ID}`);
    expect(recordPath('lead', SAMPLE_ID)).toBe(`/leads/${SAMPLE_ID}`);
    // The catch-all would silently redirect an /activities/:id link to the dashboard.
    expect(recordPath('activity', SAMPLE_ID)).toBe('/activities');
  });

  // Without this, adding /activities/:id later leaves COLLECTION_ONLY stale and every
  // activity assignment keeps landing on the unfiltered list — a regression the
  // assertion above would actively vouch for.
  it('no collection-only type has gained a detail route', () => {
    const declared = new Set(protectedRoutePaths());
    for (const type of RECORD_LINK_TYPES) {
      const path = recordPath(type, SAMPLE_ID);
      if (path.includes(SAMPLE_ID)) continue;
      expect(
        declared,
        `${APP_ROUTES} now declares ${path}/:id, so ${type} has a detail route. ` +
          `set takesId for ${type} in ${SHARED_MODULE} so links point at the record.`,
      ).not.toContain(`${path}/:id`);
    }
  });

  it('rejects a type with no client route', () => {
    // notificationService reads linked_record_type from a text column, so the
    // guard is what keeps an unmapped value out of a rendered link.
    expect(isRecordLinkType('opportunity')).toBe(false);
    expect(isRecordLinkType(null)).toBe(false);
    expect(isRecordLinkType('deal')).toBe(true);
  });

  it('the files read here trigger the job that runs this guard', () => {
    expectGuardIsTriggered({
      output: 'record-paths',
      job: 'server-tests',
      filesRead: [APP_ROUTES, SHARED_MODULE, WORKFLOW],
    });
  });
});
