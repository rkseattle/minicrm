/**
 * Email message behaviors for MiniCRM.
 *
 * REST API helpers for the synced-mail read and filing endpoints, the Emails section on
 * record detail pages, and a browser-side run of the email body sanitizer. Behaviors do
 * NOT contain assertions (no expect() calls) — they return typed results, or the status
 * of a refusal, for the spec to assert against.
 */

import { RestClientError, type RestClient } from '@framework/clients/rest-client.js';
import type { PageFacade } from '@framework/fixtures/index.js';
import { EmailsSectionPage } from '@pages/minicrm/EmailsSectionPage.js';
import {
  FIRST_INTERACTION_TIMEOUT_MS,
  gotoAndSettle,
  awaitApiResponse,
} from '@apps/minicrm/helpers.js';
import {
  emailThreadPageSchema,
  type EmailLinkRecordType,
  type EmailThreadPage,
} from '@minicrm/shared/schemas/emailMessageSchema.js';

// ---------------------------------------------------------------------------
// Behaviors
// ---------------------------------------------------------------------------

/**
 * Reads the caller's own mail that no record claims yet.
 *
 * @param restClient - The authenticated client whose mailboxes are read.
 * @returns One page of unmatched threads.
 */
export async function listUnmatchedMail(restClient: RestClient): Promise<EmailThreadPage> {
  const res = await restClient.get<EmailThreadPage>('/api/v1/email-messages/unmatched', {
    schema: emailThreadPageSchema,
  });
  return res.body;
}

/**
 * Attempts to read the unmatched inbox, reporting the refusal rather than throwing.
 *
 * The endpoint sits behind three gates — authentication, the `email_sync` flag, and the
 * ConnectedAccountsManage capability — and a spec asserting on a gate needs the status
 * code, which the client otherwise raises as an error.
 *
 * @param restClient - The authenticated client to attempt the read as.
 * @returns The HTTP status, whether the request succeeded or was refused.
 */
export async function statusOfUnmatchedMailRequest(restClient: RestClient): Promise<number> {
  try {
    const res = await restClient.get<EmailThreadPage>('/api/v1/email-messages/unmatched', {
      schema: emailThreadPageSchema,
    });
    return res.status;
  } catch (err) {
    if (err instanceof RestClientError) {
      return err.status;
    }
    throw err;
  }
}

/**
 * Reads the mail linked to one record.
 *
 * @param restClient - The authenticated client whose mailboxes are read.
 * @param recordType - The record type to read the timeline of.
 * @param recordId - That record's id.
 * @returns One page of threads linked to the record.
 */
export async function listMailForRecord(
  restClient: RestClient,
  recordType: EmailLinkRecordType,
  recordId: string,
): Promise<EmailThreadPage> {
  const res = await restClient.get<EmailThreadPage>(
    `/api/v1/email-messages?record_type=${recordType}&record_id=${recordId}`,
    { schema: emailThreadPageSchema },
  );
  return res.body;
}

// ---------------------------------------------------------------------------
// Emails section on record detail pages
// ---------------------------------------------------------------------------

/** Fixtures required by the Emails section behaviors. */
export interface EmailsSectionBehaviorContext {
  page: PageFacade;
}

/** What the detail page's own email requests answered. */
export interface RecordEmailRequestStatuses {
  /** Status of the page's `GET /api/v1/email-messages?record_type=&record_id=`. */
  threadsStatus: number;
  /** Status of the page's `GET /api/v1/connected-accounts`. */
  mailboxesStatus: number;
}

/** How long a doesNotExist probe waits once the page has proved it rendered. */
const SECTION_ABSENCE_PROBE_MS = 2_000;

const DETAIL_PATH_SEGMENT: Record<EmailLinkRecordType, string> = {
  contact: 'contacts',
  lead: 'leads',
  account: 'accounts',
  deal: 'deals',
};

/** Reads the text of every element the button's aria-describedby names, as a reader hears it. */
const READ_ACCESSIBLE_DESCRIPTION = new Function(
  'element',
  `
  const ids = (element.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean);
  return ids.map((id) => (document.getElementById(id) || {}).textContent || '').join(' ').trim();
`,
  // Safe: the body above takes one element and returns a string.
) as (element: unknown) => string;

/**
 * Opens a record's detail page and reports what its two email requests answered.
 *
 * Both listeners are armed before navigation, so a fast response cannot be missed. Use
 * this only where the section is expected to query — with email sync off it never does.
 *
 * @param context - Playwright fixture context.
 * @param recordType - The record type whose detail page to open.
 * @param recordId - That record's id.
 * @returns The HTTP status of each request the section sent.
 */
export async function navigateToRecordAndAwaitEmailRequests(
  context: EmailsSectionBehaviorContext,
  recordType: EmailLinkRecordType,
  recordId: string,
): Promise<RecordEmailRequestStatuses> {
  const { page } = context;
  const threads = awaitApiResponse(
    page,
    'GET',
    (url) =>
      url.href.includes('/api/v1/email-messages?') && url.href.includes(`record_id=${recordId}`),
    FIRST_INTERACTION_TIMEOUT_MS,
  );
  const mailboxes = awaitApiResponse(
    page,
    'GET',
    '/api/v1/connected-accounts',
    FIRST_INTERACTION_TIMEOUT_MS,
  );

  await gotoAndSettle(page, `/${DETAIL_PATH_SEGMENT[recordType]}/${recordId}`);
  const [threadsResponse, mailboxesResponse] = await Promise.all([threads, mailboxes]);
  return { threadsStatus: threadsResponse.status(), mailboxesStatus: mailboxesResponse.status() };
}

/**
 * Waits for the Emails section's empty state to render.
 *
 * DOM catch-up only: the caller has already seen the list request answer.
 *
 * @param context - Playwright fixture context.
 */
export async function waitForEmailsEmptyState(
  context: EmailsSectionBehaviorContext,
): Promise<void> {
  const emptyState = await new EmailsSectionPage(context).emptyStateLocator(
    FIRST_INTERACTION_TIMEOUT_MS,
  );
  await emptyState.waitFor({ state: 'visible', timeout: FIRST_INTERACTION_TIMEOUT_MS });
}

/**
 * Reports whether the Emails section is absent from the page.
 *
 * Call only after a positive signal that the sidebar has rendered, such as the notes
 * section: absence before then proves nothing.
 *
 * @param context - Playwright fixture context.
 * @returns True when no Emails section is in the DOM.
 */
export async function isEmailsSectionAbsent(
  context: EmailsSectionBehaviorContext,
): Promise<boolean> {
  return new EmailsSectionPage(context).sectionIsAbsent(SECTION_ABSENCE_PROBE_MS);
}

/**
 * Reports whether the Emails section's Compose button is disabled.
 *
 * @param context - Playwright fixture context.
 * @returns True when Compose cannot be pressed.
 */
export async function isEmailComposeDisabled(
  context: EmailsSectionBehaviorContext,
): Promise<boolean> {
  const compose = await new EmailsSectionPage(context).composeButtonLocator(
    FIRST_INTERACTION_TIMEOUT_MS,
  );
  return compose.isDisabled();
}

/**
 * Reads the Compose button's accessible description, resolved through aria-describedby.
 *
 * @param context - Playwright fixture context.
 * @returns The described text, or an empty string when the button names no description.
 */
export async function readEmailComposeDescription(
  context: EmailsSectionBehaviorContext,
): Promise<string> {
  const compose = await new EmailsSectionPage(context).composeButtonLocator(
    FIRST_INTERACTION_TIMEOUT_MS,
  );
  return compose.evaluate(READ_ACCESSIBLE_DESCRIPTION);
}

// ---------------------------------------------------------------------------
// Email body sanitizer, run in the browser
// ---------------------------------------------------------------------------

/** One hostile style and the markup the sanitizer kept for it. */
export interface SanitizedHostileStyle {
  style: string;
  /** The sanitized body as the browser re-serializes it after parsing. */
  html: string;
}

/** One disallowed-function style and the style attribute the sanitizer kept, if any. */
export interface SanitizedFunctionStyle {
  style: string;
  keptStyle: string | null;
}

/** Every corpus entry, sanitized by the real browser. */
export interface SanitizedStyleCorpus {
  hostile: SanitizedHostileStyle[];
  disallowedFunction: SanitizedFunctionStyle[];
}

/** Runs a classic script's source in the page, as a script tag would. */
const INSTALL_SCRIPT = new Function(
  'source',
  `
  const script = document.createElement('script');
  script.textContent = source;
  document.head.appendChild(script);
`,
  // Safe: the body above takes one string and returns nothing.
) as (source: string) => void;

/**
 * Sanitizes every corpus entry inside the page, parsing each result the way the unit
 * test does: into a detached host element, so assertions read a browser-built DOM.
 */
const SANITIZE_CORPUS = new Function(
  'globalName',
  `
  const probe = window[globalName];
  const render = (style) => {
    const host = document.createElement('div');
    host.innerHTML = probe.sanitizeEmailHtml('<p style="' + style + '">x</p>', { allowImages: false });
    return host;
  };
  return {
    hostile: probe.HOSTILE_EMAIL_STYLES.map((style) => ({ style, html: render(style).innerHTML })),
    disallowedFunction: probe.DISALLOWED_FUNCTION_STYLES.map((style) => {
      const paragraph = render(style).querySelector('p');
      return { style, keptStyle: paragraph ? paragraph.getAttribute('style') : null };
    }),
  };
`,
  // Safe: the body above returns exactly the SanitizedStyleCorpus shape.
) as (globalName: string) => SanitizedStyleCorpus;

/**
 * Loads a bundled sanitizer into a blank page and runs its style corpus through it.
 *
 * @param context - Playwright fixture context.
 * @param bundleSource - An IIFE exposing the sanitizer and corpus on `window[globalName]`.
 * @param globalName - The window property the bundle assigns.
 * @returns Each corpus entry with what the sanitizer kept.
 */
export async function sanitizeStyleCorpusInBrowser(
  context: EmailsSectionBehaviorContext,
  bundleSource: string,
  globalName: string,
): Promise<SanitizedStyleCorpus> {
  const { page } = context;
  await page.goto('about:blank');
  await page.evaluate(INSTALL_SCRIPT, bundleSource);
  return page.evaluate(SANITIZE_CORPUS, globalName);
}
