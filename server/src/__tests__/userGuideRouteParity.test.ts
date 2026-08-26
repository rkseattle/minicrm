/**
 * Pins every user-facing route to the guide page that documents it.
 *
 * A page shipping with no documentation is invisible: nothing in CI reads the router, so
 * a new destination merges with the user guide silently describing an older product. The
 * reverse rots too — a guide page outliving the route it documents sends readers to a URL
 * that no longer resolves.
 *
 * The subject is App.tsx's authenticated route table, not NAV_LINKS. Three user-facing
 * pages — /activities, /insights/coaching, /hygiene — are reached from links rather than
 * the nav, so a guard keyed on the nav would pass the day one of them shipped
 * undocumented, which is the drift it would exist to catch.
 *
 * The mapping is many-to-one by nature: a page documents a route, it does not correspond
 * to one. Detail routes are covered by their list page, redirects by their target's, and
 * two insights pages by a section inside a related guide.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  APP_ROUTES,
  expectGuardIsTriggered,
  protectedRoutePaths,
  WORKFLOW,
} from './ciFilterWiring.js';

const REPO_ROOT = join(__dirname, '../../..');

const GUIDE_DIR = 'docs/user-guide';

/**
 * Every authenticated non-admin route, and the guide page documenting it.
 *
 * Grouped by why the mapping is not one-to-one.
 */
const ROUTE_GUIDE_PAGES: Readonly<Record<string, string>> = {
  '/': 'dashboard.md',
  '/contacts': 'contacts.md',
  '/leads': 'leads.md',
  '/accounts': 'accounts.md',
  '/deals': 'deals.md',
  '/tasks': 'my-tasks.md',
  '/activities': 'activities.md',
  '/reports': 'reports.md',
  '/profile': 'profile.md',
  '/ai': 'ai-assistant.md',
  '/hygiene': 'data-hygiene.md',
  '/insights/coaching': 'coaching-insights.md',

  // Detail routes — documented as part of the list page they open from.
  '/contacts/:id': 'contacts.md',
  '/leads/:id': 'leads.md',
  '/accounts/:id': 'accounts.md',
  '/deals/:id': 'deals.md',
  '/activities/:id/brief': 'activities.md',

  // Redirects — documented by the page they land on.
  '/pipeline': 'deals.md',
  '/reports/win-loss': 'reports.md',
  '/reports/activity-volume': 'reports.md',
  '/reports/stage-trend': 'reports.md',

  // Standalone pages documented as a section of a related guide rather than their own.
  '/insights/win-loss': 'reports.md',
  '/insights/churn-expansion': 'accounts.md',
};

/** Guide pages for admin routes, which live outside the block this guard parses. */
const ADMIN_ROUTE_PAGES: readonly string[] = ['sequences.md'];

/** Pages for features embedded in other screens, reachable by no route of their own. */
const EMBEDDED_FEATURE_PAGES: readonly string[] = ['notes.md'];

/**
 * The guide's table of contents, not a documented screen.
 *
 * Its completeness is pinned elsewhere: check-doc-links.mjs's findIndexGaps requires
 * every page in this directory to be listed here exactly once, and the `docs` filter
 * triggers it on any new page.
 */
const GUIDE_INDEX = 'index.md';

/**
 * Tracked guide pages, relative to the guide directory.
 *
 * Untracked means invisible to CI, which only ever sees tracked files. git's `*` crosses
 * `/`, so a nested page arrives as `nested/x.md` and is reported by its path rather than
 * colliding with a top-level page of the same basename.
 */
let cachedGuidePages: string[] | undefined;

function guidePages(): string[] {
  if (cachedGuidePages) return cachedGuidePages;
  cachedGuidePages = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '-z', `${GUIDE_DIR}/*.md`], {
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
    .map((path) => path.slice(GUIDE_DIR.length + 1));
  return cachedGuidePages;
}

describe('every user-facing route has a user-guide page', () => {
  // Parsed per test rather than in the describe body: a bound assertion thrown during
  // collection surfaces as a suite-level error, and its message never reaches the JUnit
  // file this repo reads for pass/fail.
  const routes = (): string[] => protectedRoutePaths();

  // A parse yielding nothing passes every assertion below. Pinning the count turns a JSX
  // refactor into one failure here rather than silence, and catches a bound that ran into
  // the admin block (which would raise the count) as well as one that stopped short.
  it(`${APP_ROUTES} still declares the expected number of authenticated routes`, () => {
    const parsed = routes();
    expect(
      parsed.length,
      `Parsed ${parsed.length} routes from ${APP_ROUTES}'s authenticated block, expected ` +
        `${Object.keys(ROUTE_GUIDE_PAGES).length}. Add the new route to ROUTE_GUIDE_PAGES ` +
        'with the page documenting it, or fix the block bounds if the JSX moved.',
    ).toBe(Object.keys(ROUTE_GUIDE_PAGES).length);
  });

  it('every authenticated route maps to a guide page that exists', () => {
    const pages = new Set(guidePages());
    for (const route of routes()) {
      const page = ROUTE_GUIDE_PAGES[route];
      expect(
        page,
        `${APP_ROUTES} declares ${route}, which no ROUTE_GUIDE_PAGES entry documents. ` +
          `Add the route with the ${GUIDE_DIR} page covering it, writing that page first ` +
          'if none does.',
      ).toBeDefined();
      expect(
        pages,
        `ROUTE_GUIDE_PAGES maps ${route} to ${GUIDE_DIR}/${page}, which does not exist`,
      ).toContain(page);
    }
  });

  it('every mapped route is still declared in the router', () => {
    const declared = new Set(routes());
    for (const route of Object.keys(ROUTE_GUIDE_PAGES)) {
      expect(
        declared,
        `ROUTE_GUIDE_PAGES maps ${route}, which ${APP_ROUTES} no longer declares. Remove ` +
          'the entry, and the guide page too if nothing else documents that screen.',
      ).toContain(route);
    }
  });

  // Without this a page can be deleted, or added undocumented, with nothing failing:
  // the route direction only ever sees pages some route names.
  it('every guide page is accounted for', () => {
    const documented = new Set(Object.values(ROUTE_GUIDE_PAGES));
    for (const page of guidePages()) {
      if (page === GUIDE_INDEX) continue;
      const classified =
        documented.has(page) ||
        ADMIN_ROUTE_PAGES.includes(page) ||
        EMBEDDED_FEATURE_PAGES.includes(page);
      expect(
        classified,
        `${GUIDE_DIR}/${page} is documented by no route. Map it in ROUTE_GUIDE_PAGES, or ` +
          'list it in ADMIN_ROUTE_PAGES or EMBEDDED_FEATURE_PAGES with the reason it has ' +
          'no route of its own.',
      ).toBe(true);
    }
  });

  // Classifying a page under the wrong reason records something false, and the sets are
  // the only place that reason is written down.
  it('the exempt lists name real pages that no route documents', () => {
    const pages = new Set(guidePages());
    // A page in both lists records two contradictory reasons for the same exemption.
    for (const page of ADMIN_ROUTE_PAGES) {
      expect(
        EMBEDDED_FEATURE_PAGES,
        `${GUIDE_DIR}/${page} is listed as both an admin-route and an embedded-feature page`,
      ).not.toContain(page);
    }
    const documented = new Set(Object.values(ROUTE_GUIDE_PAGES));
    for (const page of [...ADMIN_ROUTE_PAGES, ...EMBEDDED_FEATURE_PAGES]) {
      expect(pages, `${GUIDE_DIR}/${page} is listed as exempt but does not exist`).toContain(page);
      expect(
        documented,
        `${GUIDE_DIR}/${page} is listed as exempt but ROUTE_GUIDE_PAGES also maps a route ` +
          'to it. Remove it from the exempt list.',
      ).not.toContain(page);
    }
  });

  it('the files read here trigger the job that runs this guard', () => {
    expectGuardIsTriggered({
      output: 'user-guide-routes',
      job: 'server-tests',
      filesRead: [APP_ROUTES, WORKFLOW, ...guidePages().map((page) => `${GUIDE_DIR}/${page}`)],
    });
  });
});
