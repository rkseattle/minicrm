/**
 * Pins the on-screen control names the user guide instructs readers to click.
 *
 * The guide quotes UI strings verbatim — "click **Erase personal data**". Renaming one
 * in the locale file, or reintroducing a name the product never had, makes a published
 * instruction wrong with nothing to catch it: E2E asserts the DOM against the locale
 * file, so both sides agree while the doc drifts away from them.
 *
 * QUOTED_CONTROLS reads both sides, so a locale rename and a doc edit each fail it.
 * RETIRED_INSTRUCTIONS reads only the markdown — those are one-way pins on names the
 * product has never rendered, and a row comes out if the product ever adds one.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '../../..');

const EN_LOCALE = JSON.parse(
  readFileSync(join(REPO_ROOT, 'client/src/locales/en.json'), 'utf8'),
) as Record<string, unknown>;

/** Resolves a dotted key through however many levels of nesting en.json uses. */
function localeString(dottedKey: string): string {
  const value = dottedKey
    .split('.')
    .reduce<unknown>(
      (node, segment) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[segment]
          : undefined,
      EN_LOCALE,
    );
  if (typeof value !== 'string') {
    throw new Error(`en.json has no string at ${dottedKey}`);
  }
  return value;
}

function doc(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), 'utf8');
}

/**
 * Each entry is a control the named page tells the reader to click, and the locale
 * key that renders it. Add a row when a walkthrough starts quoting a new control.
 */
const QUOTED_CONTROLS: ReadonlyArray<{ page: string; localeKey: string }> = [
  { page: 'docs/user-guide/reports.md', localeKey: 'reports.activityVolume.dateRangeLabel' },
  { page: 'docs/user-guide/contacts.md', localeKey: 'gdpr.sectionTitle' },
  { page: 'docs/user-guide/contacts.md', localeKey: 'gdpr.eraseButton' },
  { page: 'docs/user-guide/contacts.md', localeKey: 'gdpr.exportButton' },
  { page: 'docs/user-guide/contacts.md', localeKey: 'contacts.mergeWithAnother' },
  { page: 'docs/user-guide/accounts.md', localeKey: 'accounts.linkedContactsHeading' },
  { page: 'docs/user-guide/accounts.md', localeKey: 'accounts.saveChanges' },
  { page: 'docs/user-guide/notes.md', localeKey: 'notes.addButton' },
  { page: 'docs/user-guide/notes.md', localeKey: 'notes.save' },
  { page: 'docs/user-guide/sequences.md', localeKey: 'sequences.enrollButton' },
  { page: 'docs/user-guide/sequences.md', localeKey: 'sequences.unenrollButton' },
  { page: 'docs/user-guide/deals.md', localeKey: 'deals.newDeal' },
  { page: 'docs/user-guide/deals.md', localeKey: 'deals.linkContact' },
  { page: 'docs/user-guide/deals.md', localeKey: 'pipeline.closeDeal.confirm' },
  { page: 'docs/user-guide/my-tasks.md', localeKey: 'myTasks.showCompleted' },
  { page: 'docs/user-guide/my-tasks.md', localeKey: 'myTasks.hideCompleted' },
  { page: 'docs/user-guide/my-tasks.md', localeKey: 'myTasks.markComplete' },
  { page: 'docs/user-guide/my-tasks.md', localeKey: 'myTasks.overdue' },
  { page: 'docs/user-guide/my-tasks.md', localeKey: 'myTasks.clearFilters' },
  { page: 'docs/user-guide/my-tasks.md', localeKey: 'myTasks.filterChipOverdue' },
  { page: 'docs/user-guide/my-tasks.md', localeKey: 'bulk.deleteButton' },
  { page: 'docs/user-guide/my-tasks.md', localeKey: 'nav.profileSettings' },
  {
    page: 'docs/user-guide/my-tasks.md',
    localeKey: 'profileSettings.notifications.sectionTitle',
  },
  { page: 'docs/user-guide/profile.md', localeKey: 'nav.profileSettings' },
  { page: 'docs/user-guide/profile.md', localeKey: 'profileSettings.languageLabel' },
  { page: 'docs/user-guide/profile.md', localeKey: 'profileSettings.systemDefault' },
  { page: 'docs/user-guide/profile.md', localeKey: 'mfa.sectionTitle' },
  { page: 'docs/user-guide/profile.md', localeKey: 'mfa.enableButton' },
  { page: 'docs/user-guide/profile.md', localeKey: 'mfa.disableButton' },
  { page: 'docs/user-guide/profile.md', localeKey: 'mfa.setupModal.verifyButton' },
  { page: 'docs/user-guide/profile.md', localeKey: 'mfa.recoveryCodesModal.copyButton' },
  { page: 'docs/user-guide/profile.md', localeKey: 'mfa.recoveryCodesModal.doneButton' },
  { page: 'docs/user-guide/profile.md', localeKey: 'mfa.loginModal.useRecoveryCode' },
  {
    page: 'docs/user-guide/profile.md',
    localeKey: 'profileSettings.notifications.sectionTitle',
  },
  { page: 'docs/user-guide/data-hygiene.md', localeKey: 'dataHygiene.mergeDialogTitle' },
  { page: 'docs/user-guide/data-hygiene.md', localeKey: 'dataHygiene.dismissDialogTitle' },
  { page: 'docs/user-guide/data-hygiene.md', localeKey: 'dataHygiene.dismissReasonLabel' },
  { page: 'docs/user-guide/data-hygiene.md', localeKey: 'dataHygiene.filter.all' },
  { page: 'docs/user-guide/data-hygiene.md', localeKey: 'dataHygiene.filter.contact' },
  { page: 'docs/user-guide/data-hygiene.md', localeKey: 'dataHygiene.filter.account' },
  { page: 'docs/user-guide/data-hygiene.md', localeKey: 'dataHygiene.filter.opportunity' },
  { page: 'docs/user-guide/data-hygiene.md', localeKey: 'dataHygiene.actionUpdate' },
  { page: 'docs/user-guide/data-hygiene.md', localeKey: 'dataHygiene.actionMerge' },
  { page: 'docs/user-guide/data-hygiene.md', localeKey: 'dataHygiene.actionArchive' },
  { page: 'docs/user-guide/data-hygiene.md', localeKey: 'dataHygiene.actionDismiss' },
  {
    page: 'docs/user-guide/data-hygiene.md',
    localeKey: 'dataHygiene.issue.contact_duplicate',
  },
];

describe('user guide quotes control names that exist', () => {
  // Bold-delimited, because a bare name like "Unenroll" is a substring of the prose
  // around it and would pass on a page that no longer names the control at all.
  it.each(QUOTED_CONTROLS)('$page quotes $localeKey', ({ page, localeKey }) => {
    const rendered = localeString(localeKey);
    expect(
      doc(page),
      `${page} must quote "**${rendered}**" — the string ${localeKey} actually renders`,
    ).toContain(`**${rendered}**`);
  });

  /**
   * Control names the guide has used for screens that do not offer them. Each needle
   * is matched case-insensitively: a reader hunting for "Add Contact" is no better
   * off than one hunting for "Add contact".
   */
  const RETIRED_INSTRUCTIONS: ReadonlyArray<{ page: string; absent: RegExp; why: string }> = [
    {
      page: 'docs/user-guide/contacts.md',
      absent: /More actions/i,
      why: 'the contact page has no overflow menu; erasure is in the GDPR & Privacy section',
    },
    {
      page: 'docs/user-guide/notes.md',
      absent: /\*\*Internal\*\*/i,
      why: 'the visibility levels are private, team, and public',
    },
    {
      page: 'docs/user-guide/accounts.md',
      absent: /Add contact/i,
      why: 'the account page lists contacts read-only; they are linked from a form',
    },
    {
      // Not the words "New Deal" — that button is real, on the Deals page. The defect
      // was placing it in a Deals section of the account page, which does not exist.
      page: 'docs/user-guide/accounts.md',
      absent: /\*\*Deals\*\*\s+(section|area|list|panel|tab)|under \*\*Deals\*\*/i,
      why: 'the account page does not list deals',
    },
    {
      page: 'docs/user-guide/data-hygiene.md',
      absent: /confirm(ing|ation)?\s+(the\s+)?(archive|dialog)|archive[^.]{0,40}\bconfirm/i,
      why: 'Archive fires immediately; no locale rename would catch an invented confirm step',
    },
  ];

  /**
   * Selectable values, which the guide italicises where a control is bolded. Pinned
   * separately so the two markup conventions do not have to be reconciled.
   */
  const QUOTED_OPTIONS: ReadonlyArray<{ page: string; localeKey: string }> = [
    { page: 'docs/user-guide/reports.md', localeKey: 'reports.activityVolume.presetThisWeek' },
    { page: 'docs/user-guide/reports.md', localeKey: 'reports.activityVolume.presetCurrentMonth' },
    { page: 'docs/user-guide/reports.md', localeKey: 'reports.winLoss.presetCurrentQuarter' },
    { page: 'docs/user-guide/data-hygiene.md', localeKey: 'dataHygiene.emptyTitle' },
    { page: 'docs/user-guide/data-hygiene.md', localeKey: 'dataHygiene.loadError' },
    { page: 'docs/user-guide/data-hygiene.md', localeKey: 'dataHygiene.actionError' },
    { page: 'docs/user-guide/data-hygiene.md', localeKey: 'dataHygiene.notAvailable' },
    { page: 'docs/user-guide/my-tasks.md', localeKey: 'myTasks.emptyTitle' },
    { page: 'docs/user-guide/my-tasks.md', localeKey: 'myTasks.filteredEmptyTitle' },
    { page: 'docs/user-guide/my-tasks.md', localeKey: 'myTasks.emptyCompleted' },
  ];

  it.each(QUOTED_OPTIONS)('$page quotes the $localeKey option', ({ page, localeKey }) => {
    const rendered = localeString(localeKey);
    expect(
      doc(page),
      `${page} must quote "_${rendered}_" — the option ${localeKey} actually renders`,
    ).toContain(`_${rendered}_`);
  });

  it.each(RETIRED_INSTRUCTIONS)('$page does not instruct $absent', ({ page, absent, why }) => {
    expect(doc(page), `${page} matches ${String(absent)} — ${why}`).not.toMatch(absent);
  });

  // A page this file reads but ci.yml's user-guide-docs filter does not list is a page
  // whose doc-side edits never run this job — the guard would fail open on exactly the
  // edit it exists to catch, and check-ci-filter-globs.mjs cannot see the omission.
  it('every page read here triggers the job that runs it', () => {
    const workflow = doc('.github/workflows/ci.yml');
    const filterBlock = /user-guide-docs:\n((?:\s+- '[^']+'\n)+)/.exec(workflow);
    expect(filterBlock, 'ci.yml must declare a user-guide-docs filter output').not.toBeNull();
    const triggered = new Set(
      [...filterBlock![1].matchAll(/- '([^']+)'/g)].map((match) => match[1]),
    );

    const pagesRead = new Set(
      [...QUOTED_CONTROLS, ...QUOTED_OPTIONS, ...RETIRED_INSTRUCTIONS].map((entry) => entry.page),
    );
    for (const page of pagesRead) {
      expect(triggered, `ci.yml user-guide-docs must list ${page}`).toContain(page);
    }
  });
});
