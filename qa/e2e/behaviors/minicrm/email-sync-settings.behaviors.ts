/**
 * Admin Email Sync panel behaviors for MiniCRM.
 *
 * Behaviors are named, reusable async functions that encapsulate multi-step
 * user journeys. They compose Page Objects internally — callers never touch
 * raw locators or Page Object methods directly.
 *
 * Behaviors do NOT contain assertions (no expect() calls). They return typed
 * result objects that test specs assert against.
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import type { RestClient } from '@framework/clients/rest-client.js';
import {
  emailSyncBackfillDaysSchema,
  emailSyncExcludedDomainsResponseSchema,
} from '@minicrm/shared/schemas/settingsSchema.js';
import { EmailSyncSettingsPage } from '@pages/minicrm/EmailSyncSettingsPage.js';
import { navigateToAdminSettingsIntegrations } from './settings.behaviors.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by Email Sync panel behaviors. */
export interface EmailSyncSettingsBehaviorContext {
  page: PageFacade;
}

const DOMAINS_PATH = '/api/v1/settings/email-sync-excluded-domains';
const DAYS_PATH = '/api/v1/settings/email-sync-backfill-days';
/** How long a rejected submit is watched for a request it should not make. */
const NO_REQUEST_WINDOW_MS = 1_000;
/** How long the banner probe waits; the form is already rendered when it runs. */
const BANNER_PROBE_TIMEOUT_MS = 1_000;
/** How long the panel's three reads may take before its form appears. */
const PANEL_READY_TIMEOUT_MS = 15_000;

/** What the panel's save reports: the server's status, and whether "Saved." appeared. */
export interface EmailSyncSaveResult {
  status: number;
  confirmed: boolean;
}

// ---------------------------------------------------------------------------
// Behaviors
// ---------------------------------------------------------------------------

/**
 * Opens Admin Settings > Integrations and waits for the Email Sync panel's form, which
 * renders only once both settings and the flag list have loaded.
 */
export async function openEmailSyncSettings(ctx: EmailSyncSettingsBehaviorContext): Promise<void> {
  await navigateToAdminSettingsIntegrations(ctx);
  const panel = new EmailSyncSettingsPage(ctx);
  // The form waits on two settings reads and the flag list; give resolution that budget.
  await panel.panelLocator(PANEL_READY_TIMEOUT_MS);
  await panel.domainsInputLocator(PANEL_READY_TIMEOUT_MS);
}

/**
 * Reports whether the panel is shown disabled: the off-org-wide banner is up and the
 * fields cannot be edited.
 */
export async function isEmailSyncPanelDisabled(
  ctx: EmailSyncSettingsBehaviorContext,
): Promise<boolean> {
  const panel = new EmailSyncSettingsPage(ctx);
  const fieldsDisabled = await (await panel.domainsInputLocator()).isDisabled();
  const bannerAbsent = await panel.disabledBannerIsAbsent(BANNER_PROBE_TIMEOUT_MS);
  return fieldsDisabled && !bannerAbsent;
}

/** Reads the excluded domains as the panel shows them, one per line. */
export async function readPanelExcludedDomains(
  ctx: EmailSyncSettingsBehaviorContext,
): Promise<string> {
  return (await new EmailSyncSettingsPage(ctx).domainsInputLocator()).inputValue();
}

/**
 * Replaces the org excluded domains through the panel and waits for the server's answer.
 *
 * @param text - What to type, one domain per line.
 */
export async function saveOrgExcludedDomains(
  ctx: EmailSyncSettingsBehaviorContext,
  text: string,
): Promise<EmailSyncSaveResult> {
  const panel = new EmailSyncSettingsPage(ctx);
  await (await panel.domainsInputLocator()).fill(text);
  const save = await panel.domainsSaveLocator();
  const [response] = await Promise.all([
    ctx.page.waitForResponse(
      (resp) => resp.url().includes(DOMAINS_PATH) && resp.request().method() === 'PATCH',
    ),
    save.click(),
  ]);
  // Only a successful save shows the confirmation; a missing one then fails loudly here.
  const confirmed = response.ok() && (await (await panel.domainsSavedLocator()).isVisible());
  return { status: response.status(), confirmed };
}

/** What a rejected submit reports: the panel's message, and whether a request went out. */
export interface RejectedSubmitResult {
  message: string;
  requested: boolean;
}

/**
 * Submits domains the panel should reject before sending them. Waits on the error itself,
 * since no response is expected, and reports any PATCH seen meanwhile.
 */
export async function submitRejectedExcludedDomains(
  ctx: EmailSyncSettingsBehaviorContext,
  text: string,
): Promise<RejectedSubmitResult> {
  const panel = new EmailSyncSettingsPage(ctx);
  await (await panel.domainsInputLocator()).fill(text);
  const requested = ctx.page
    .waitForEvent('request', {
      predicate: (request) => request.url().includes(DOMAINS_PATH) && request.method() === 'PATCH',
      timeout: NO_REQUEST_WINDOW_MS,
    })
    .then(
      () => true,
      () => false,
    );
  await (await panel.domainsSaveLocator()).click();
  const message = (await (await panel.domainsErrorLocator()).textContent()) ?? '';
  return { message, requested: await requested };
}

/**
 * Sets the backfill window through the panel and waits for the server's answer.
 */
export async function saveBackfillWindow(
  ctx: EmailSyncSettingsBehaviorContext,
  days: number,
): Promise<number> {
  const panel = new EmailSyncSettingsPage(ctx);
  await (await panel.daysInputLocator()).fill(String(days));
  const save = await panel.daysSaveLocator();
  const [response] = await Promise.all([
    ctx.page.waitForResponse(
      (resp) => resp.url().includes(DAYS_PATH) && resp.request().method() === 'PATCH',
    ),
    save.click(),
  ]);
  return response.status();
}

/** Reads both org settings back through the API, as an admin, validated against their schemas. */
export async function readOrgEmailSyncSettings(
  restClient: RestClient,
): Promise<{ domains: string[]; days: number }> {
  const [domains, days] = await Promise.all([
    restClient.get<{ domains: string[] }>(DOMAINS_PATH, {
      schema: emailSyncExcludedDomainsResponseSchema,
    }),
    restClient.get<{ days: number }>(DAYS_PATH, { schema: emailSyncBackfillDaysSchema }),
  ]);
  return { domains: domains.body.domains, days: days.body.days };
}

/**
 * Sets the org-wide excluded domains through the API, as an admin.
 *
 * Writes a shared setting: a spec calling this is @serial and restores defaults after.
 *
 * @param restClient - Authenticated as an admin.
 * @param domains - Domains no mailbox in the org syncs.
 * @returns The list as the server normalized and stored it.
 */
export async function setOrgExcludedDomainsViaApi(
  restClient: RestClient,
  domains: string[],
): Promise<string[]> {
  const res = await restClient.patch<{ domains: string[] }>(
    DOMAINS_PATH,
    { domains },
    { schema: emailSyncExcludedDomainsResponseSchema },
  );
  return res.body.domains;
}
