/**
 * screenshot.ts — Capture README screenshots from a running MiniCRM instance.
 *
 * Requires the app to be running locally with demo data seeded:
 *   1. docker compose up -d   (or: npm run dev in separate terminals)
 *   2. npm run seed:demo   — also populates the hygiene queue and coaching insights,
 *      which are otherwise empty and capture as blank pages
 *   3. npm run screenshot
 *
 * Every AI feature flag must be on, plus `sequencing`, or those pages capture empty.
 *
 * Screenshots are saved to docs/screenshots/ and committed to the repo.
 * Regenerate after any significant UI change.
 *
 * Environment variables:
 *   E2E_BASE_URL       — app URL (default: http://localhost:5173)
 *   E2E_ADMIN_EMAIL    — admin email (default: admin@example.com)
 *   E2E_ADMIN_PASSWORD — required, no default
 */

import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// scripts/ sits one level below the repo root, so OUTPUT_DIR resolves to docs/screenshots/
const OUTPUT_DIR = path.join(process.cwd(), 'docs', 'screenshots');

const NAVIGATION_TIMEOUT_MS = 15_000;

/** Demo contact carrying both a note and a sequence enrollment, for the panel captures. */
const PANEL_CAPTURE_CONTACT = 'Alice Chen';

/** Search matches one name field at a time, so the full name finds nothing. */
const PANEL_CAPTURE_SEARCH = 'Chen';

const BASE_URL = process.env['E2E_BASE_URL'] ?? 'http://localhost:5173';
const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];

if (!ADMIN_PASSWORD) {
  console.error(
    '[screenshot] E2E_ADMIN_PASSWORD is not set. Export it before running:\n' +
      '  export E2E_ADMIN_PASSWORD=<your-password>',
  );
  process.exit(1);
}

async function checkAppReachable(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    await fetch(BASE_URL, { signal: controller.signal });
    clearTimeout(timeout);
  } catch {
    console.error(
      `[screenshot] App not reachable at ${BASE_URL} — is it running?\n` +
        '  Start with: docker compose up -d   or   npm run dev',
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  await checkAppReachable();

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    // 1280 cuts an admin's last nav items off mid-word; 1440 fits the full row. The
    // deals board still scrolls sideways at any width — that is the board, not clipping.
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  const saved: string[] = [];

  try {
    // Login via the UI (same approach as globalSetup.ts).
    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/password/i).fill(ADMIN_PASSWORD as string);
    await page.getByRole('button', { name: /sign in|log in|login/i }).click();

    try {
      await page.waitForURL((url) => new URL(url).pathname !== '/login', {
        timeout: NAVIGATION_TIMEOUT_MS,
      });
    } catch {
      console.error(
        `[screenshot] Login failed — no redirect away from /login within ${NAVIGATION_TIMEOUT_MS / 1000} s.\n` +
          '  Check E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.',
      );
      await browser.close();
      process.exit(1);
    }

    /**
     * @param settle - Runs after navigation, before the shot. networkidle settles before
     *   a client-side transition commits and before a refetch paints, so any capture
     *   needing a committed view has to say how to recognise it.
     */
    async function capture(
      filename: string,
      entryRoute: string,
      settle?: () => Promise<unknown>,
    ): Promise<void> {
      await page.goto(`${BASE_URL}${entryRoute}`);
      await page.waitForLoadState('networkidle');
      if (settle) await settle();
      const filePath = path.join(OUTPUT_DIR, filename);
      await page.screenshot({ path: filePath, fullPage: false });
      saved.push(filePath);
    }

    // 01 — Dashboard
    await capture('01-dashboard.png', '/');

    // 02 — Contacts list
    await capture('02-contacts.png', '/contacts');

    // 03 — First contact detail (find link from list, do not hardcode UUID)
    await capture('03-contact-detail.png', '/contacts', async () => {
      await page.locator('a[data-testid^="contact-link-"]').first().click();
      await page.waitForURL((url) => /^\/contacts\/[^/]+$/.test(new URL(url).pathname), {
        timeout: NAVIGATION_TIMEOUT_MS,
      });
      await page.getByTestId('contact-name').waitFor({ state: 'visible' });
      await page.waitForLoadState('networkidle');
    });

    // 04 — Accounts list
    await capture('04-accounts.png', '/accounts');

    // 05 — Deals pipeline board
    await capture('05-deals-board.png', '/deals');

    // 06 — Deals list view. The toggle flips a mode persisted in sessionStorage, so
    // clicking it blind depends on which view the previous capture left behind.
    await page.evaluate(() => sessionStorage.setItem('deals.viewMode', 'board'));
    await capture('06-deals-list.png', '/deals', async () => {
      await page.getByTestId('deals-view-toggle').click();
      // The toggle refetches; without waiting on a row the shot is the loading state.
      await page.locator('tbody tr').first().waitFor({ state: 'visible' });
      await page.waitForLoadState('networkidle');
    });

    // 07 — Leads list
    await capture('07-leads.png', '/leads');

    // 08 — Activities page
    await capture('08-activities.png', '/activities');

    // 09 — /reports/win-loss only redirects here, so target the destination directly.
    await capture('09-win-loss-report.png', '/reports?view=win-loss');

    // 10 — The settings page defaults to the workspace tab without ?tab=.
    await capture('10-admin-settings.png', '/admin/settings?tab=branding');

    // 11 — My Tasks
    await capture('11-my-tasks.png', '/tasks');

    // 12 — Profile settings, with the user menu open. profile.md tells the reader to
    // click their name and then Profile Settings, so a closed menu would not show the
    // path the page describes.
    await capture('12-profile-settings.png', '/profile', async () => {
      await page.getByTestId('nav-user-menu-button').click();
      await page.getByTestId('nav-user-menu-profile').waitFor({ state: 'visible' });
    });

    // 13 — Data hygiene queue. Populated by npm run seed:demo, which runs the scan.
    await capture('13-data-hygiene.png', '/hygiene');

    // 14 — Rep coaching insights, likewise generated by the seed.
    await capture('14-coaching-insights.png', '/insights/coaching');

    // 15 — AI assistant
    await capture('15-ai-assistant.png', '/ai');

    // 16, 17 — Element shots: two guide pages document a panel, not a screen. Opened by
    // name because the first contact in the list has neither a note nor an enrollment.
    await page.goto(`${BASE_URL}/contacts`);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('contacts-search').fill(PANEL_CAPTURE_SEARCH);
    // The contact is visible before filtering too, so waiting on its link alone resolves
    // against the unfiltered list and races the 300 ms debounce that then unmounts it.
    await page.locator('a[data-testid^="contact-link-"]').first().waitFor({ state: 'visible' });
    // The filter must have narrowed the list before the click, or the debounce unmounts
    // the row mid-click. 25 is the unfiltered page size.
    await expect
      .poll(async () => page.locator('a[data-testid^="contact-link-"]').count(), {
        timeout: NAVIGATION_TIMEOUT_MS,
      })
      .toBeLessThan(25);
    await page.getByRole('link', { name: PANEL_CAPTURE_CONTACT }).click();
    await page.waitForURL((url) => /^\/contacts\/[^/]+$/.test(new URL(url).pathname), {
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    await page.getByTestId('contact-name').waitFor({ state: 'visible' });
    await page.waitForLoadState('networkidle');

    for (const [filename, locator] of [
      ['16-notes-panel.png', page.getByTestId('notes-section')],
      ['17-active-sequences.png', page.getByTestId('sequence-enrollments-section')],
    ] as const) {
      await locator.scrollIntoViewIfNeeded();
      await locator.waitFor({ state: 'visible' });
      const filePath = path.join(OUTPUT_DIR, filename);
      await locator.screenshot({ path: filePath });
      saved.push(filePath);
    }
  } catch (err) {
    await browser.close();
    console.error('[screenshot] Unexpected error:', err instanceof Error ? err.message : err);
    if (saved.length > 0) {
      console.log(`\n[screenshot] Partial run — ${saved.length} file(s) saved before failure:`);
      for (const f of saved) {
        console.log(`  ✓ ${path.relative(process.cwd(), f)}`);
      }
    }
    process.exit(1);
  }

  await browser.close();

  console.log('');
  for (const f of saved) {
    console.log(`✓ ${path.relative(process.cwd(), f)}`);
  }
  console.log(`\nScreenshot complete: ${saved.length} files saved to docs/screenshots/`);
}

main().catch((err) => {
  console.error('[screenshot] Fatal error:', err);
  process.exit(1);
});
