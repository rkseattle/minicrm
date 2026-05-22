/**
 * Leads behaviors for MiniCRM.
 *
 * Behaviors are named, reusable async functions that encapsulate multi-step
 * user journeys. They compose Page Objects internally — callers never touch
 * raw locators or Page Object methods directly.
 *
 * Behaviors do NOT contain assertions (no expect() calls). They return typed
 * result objects that test specs assert against.
 *
 * MINCRM-173, MINCRM-174, MINCRM-175, MINCRM-192, MINCRM-357
 */

import type { RestClient } from '@framework/clients/rest-client.js';
import type { PageFacade } from '@framework/fixtures/index.js';
import { LeadsPage } from '@pages/minicrm/LeadsPage.js';
import { LeadDetailPage } from '@pages/minicrm/LeadDetailPage.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by leads behaviors. */
export interface LeadsBehaviorContext {
  page: PageFacade;
}

// ---------------------------------------------------------------------------
// navigateToLeads()
// ---------------------------------------------------------------------------

/** Result returned by navigateToLeads. */
export interface NavigateToLeadsResult {
  /** True when the leads list page loaded (New Lead button is present). */
  loaded: boolean;
  /** The URL the browser settled on after navigation. */
  finalUrl: string;
}

/**
 * Navigates to the leads list page and waits for it to be ready.
 *
 * @param context - Playwright fixture context.
 * @returns NavigateToLeadsResult.
 */
export async function navigateToLeads(
  context: LeadsBehaviorContext,
): Promise<NavigateToLeadsResult> {
  const leadsPage = new LeadsPage(context);
  await leadsPage.navigate();
  const loaded = await leadsPage
    .formIsVisible()
    .then(() => true)
    .catch(() => false);
  const finalUrl = leadsPage.url();
  return { loaded, finalUrl };
}

// ---------------------------------------------------------------------------
// createLeadViaUI()
// ---------------------------------------------------------------------------

/** Fields accepted by createLeadViaUI. first_name and email are required. */
export interface CreateLeadUIFields {
  first_name: string;
  email: string;
  last_name?: string;
  phone?: string;
  company_name?: string;
}

/** Result returned by createLeadViaUI. */
export interface CreateLeadViaUIResult {
  /**
   * True when the form submitted successfully (form is no longer visible).
   */
  created: boolean;
  /**
   * True when a duplicate lead warning was surfaced instead of creating.
   */
  duplicateWarning: boolean;
  /** The URL the browser settled on after the operation. */
  finalUrl: string;
}

/**
 * Navigates to /leads, opens the inline create form, fills the supplied
 * fields, and submits.
 *
 * Returns a result object describing the outcome — the caller asserts against it.
 *
 * @param fields - Form field values to fill.
 * @param context - Playwright fixture context.
 * @returns CreateLeadViaUIResult.
 */
export async function createLeadViaUI(
  fields: CreateLeadUIFields,
  context: LeadsBehaviorContext,
): Promise<CreateLeadViaUIResult> {
  const leadsPage = new LeadsPage(context);
  await leadsPage.navigate();
  await leadsPage.clickNew();

  await leadsPage.fillFirstName(fields.first_name);
  await leadsPage.fillEmail(fields.email);

  if (fields.last_name !== undefined) {
    await leadsPage.fillLastName(fields.last_name);
  }
  if (fields.phone !== undefined) {
    await leadsPage.fillPhone(fields.phone);
  }
  if (fields.company_name !== undefined) {
    await leadsPage.fillCompanyName(fields.company_name);
  }

  await leadsPage.submitForm();

  // Short wait for network/React state to settle.
  await context.page.waitForLoadState('networkidle');

  const finalUrl = leadsPage.url();
  const duplicateWarning = await leadsPage.duplicateWarningIsVisible();
  const formStillVisible = await leadsPage.formIsVisible();
  const created = !formStillVisible && !duplicateWarning;

  return { created, duplicateWarning, finalUrl };
}

// ---------------------------------------------------------------------------
// createLeadViaUIThenCreateAnyway()
// ---------------------------------------------------------------------------

/** Result returned by createLeadViaUIThenCreateAnyway. */
export interface CreateLeadViaUIThenCreateAnywayResult {
  /** True when the form closed after clicking "Create anyway". */
  created: boolean;
  /** The URL the browser settled on. */
  finalUrl: string;
}

/**
 * Navigates to /leads, opens the create form, fills the fields, submits,
 * then clicks "Create anyway" past a duplicate warning.
 *
 * @param fields - Form field values to fill.
 * @param context - Playwright fixture context.
 * @returns CreateLeadViaUIThenCreateAnywayResult.
 */
export async function createLeadViaUIThenCreateAnyway(
  fields: CreateLeadUIFields,
  context: LeadsBehaviorContext,
): Promise<CreateLeadViaUIThenCreateAnywayResult> {
  const leadsPage = new LeadsPage(context);
  await leadsPage.navigate();
  await leadsPage.clickNew();

  await leadsPage.fillFirstName(fields.first_name);
  await leadsPage.fillEmail(fields.email);

  if (fields.last_name !== undefined) {
    await leadsPage.fillLastName(fields.last_name);
  }

  await leadsPage.submitForm();
  await leadsPage.clickCreateAnyway();

  await context.page.waitForLoadState('networkidle');

  const finalUrl = leadsPage.url();
  const formStillVisible = await leadsPage.formIsVisible();
  return { created: !formStillVisible, finalUrl };
}

// ---------------------------------------------------------------------------
// updateLeadStatus()
// ---------------------------------------------------------------------------

/** Result returned by updateLeadStatus. */
export interface UpdateLeadStatusResult {
  /** The badge text after updating (should equal the new status). */
  badgeText: string;
  /** The URL the browser settled on. */
  finalUrl: string;
}

/**
 * Navigates to /leads, clicks the status badge for the given lead, and
 * selects a new status from the inline selector.
 *
 * @param leadId - Lead UUID.
 * @param status - New status value (e.g. 'Contacted').
 * @param context - Playwright fixture context.
 * @returns UpdateLeadStatusResult.
 */
export async function updateLeadStatus(
  leadId: string,
  status: string,
  context: LeadsBehaviorContext,
): Promise<UpdateLeadStatusResult> {
  const leadsPage = new LeadsPage(context);
  await leadsPage.navigate();
  // Use max page size so the target lead is visible even when the DB has
  // accumulated rows from prior test runs.
  await leadsPage.setPageSizeToMax();

  await leadsPage.clickStatusBadge(leadId);
  await leadsPage.selectStatus(leadId, status);

  const badgeText = await leadsPage.waitForStatusBadgeText(leadId, status);
  const finalUrl = leadsPage.url();

  return { badgeText, finalUrl };
}

// ---------------------------------------------------------------------------
// showDisqualifiedLeads()
// ---------------------------------------------------------------------------

/** Result returned by showDisqualifiedLeads. */
export interface ShowDisqualifiedLeadsResult {
  /** True when the specified lead row is visible after toggling. */
  leadVisible: boolean;
  /** The URL the browser settled on. */
  finalUrl: string;
}

/**
 * Navigates to /leads and checks the "Show disqualified" toggle to reveal
 * disqualified leads. Checks visibility of the specified lead ID.
 *
 * @param leadId - Lead UUID to check visibility of.
 * @param context - Playwright fixture context.
 * @returns ShowDisqualifiedLeadsResult.
 */
export async function showDisqualifiedLeads(
  leadId: string,
  context: LeadsBehaviorContext,
): Promise<ShowDisqualifiedLeadsResult> {
  const leadsPage = new LeadsPage(context);
  await leadsPage.navigate();
  // Use max page size so the target lead is visible even when the DB has
  // accumulated rows from prior test runs.
  await leadsPage.setPageSizeToMax();

  await leadsPage.showDisqualified();

  const leadVisible = await leadsPage.leadRowIsVisible(leadId);
  const finalUrl = leadsPage.url();

  return { leadVisible, finalUrl };
}

// ---------------------------------------------------------------------------
// showConvertedLeads()
// ---------------------------------------------------------------------------

/** Result returned by showConvertedLeads. */
export interface ShowConvertedLeadsResult {
  /** True when the converted badge for the specified lead is visible after toggling. */
  convertedBadgeVisible: boolean;
  /** The URL the browser settled on. */
  finalUrl: string;
}

/**
 * Navigates to /leads and checks the "Show converted" toggle to reveal
 * converted leads. Checks converted badge visibility of the specified lead.
 *
 * @param leadId - Lead UUID to check converted badge visibility of.
 * @param context - Playwright fixture context.
 * @returns ShowConvertedLeadsResult.
 */
export async function showConvertedLeads(
  leadId: string,
  context: LeadsBehaviorContext,
): Promise<ShowConvertedLeadsResult> {
  const leadsPage = new LeadsPage(context);
  await leadsPage.navigate();
  // Use max page size so the target lead is visible even when the DB has
  // accumulated rows from prior test runs.
  await leadsPage.setPageSizeToMax();

  await leadsPage.showConverted();

  const convertedBadgeVisible = await leadsPage.convertedBadgeIsVisible(leadId);
  const finalUrl = leadsPage.url();

  return { convertedBadgeVisible, finalUrl };
}

// ---------------------------------------------------------------------------
// convertLead()
// ---------------------------------------------------------------------------

/** Result returned by convertLead. */
export interface ConvertLeadResult {
  /**
   * True when the browser navigated to a /contacts/:id URL after conversion.
   */
  navigatedToContact: boolean;
  /**
   * Pre-filled first name value read from the conversion modal before confirming.
   */
  prefillFirstName: string;
  /**
   * Pre-filled email value read from the conversion modal before confirming.
   */
  prefillEmail: string;
  /**
   * Pre-filled account name value read from the conversion modal before confirming.
   */
  prefillAccountName: string;
  /** The URL the browser settled on after conversion. */
  finalUrl: string;
}

/**
 * Navigates to the lead detail page, clicks "Convert Lead", captures prefilled
 * values from the modal, confirms the conversion, and waits for navigation to
 * the resulting contact detail page.
 *
 * @param leadId - Lead UUID.
 * @param context - Playwright fixture context.
 * @returns ConvertLeadResult.
 */
export async function convertLead(
  leadId: string,
  context: LeadsBehaviorContext,
): Promise<ConvertLeadResult> {
  const detailPage = new LeadDetailPage(context);
  await detailPage.navigate(leadId);

  await detailPage.clickConvert();

  // Capture prefilled modal values before confirming.
  const prefillFirstName = await detailPage.conversionContactFirstName();
  const prefillEmail = await detailPage.conversionContactEmail();
  const prefillAccountName = await detailPage.conversionAccountName();

  await detailPage.confirmConvert();

  // Wait for navigation to the new contact detail page.
  await context.page.waitForURL(/\/contacts\//, { timeout: 15_000 }).catch(() => null);
  await context.page.waitForLoadState('networkidle');

  const finalUrl = detailPage.url();
  const navigatedToContact = new URL(finalUrl).pathname.startsWith('/contacts/');

  return { navigatedToContact, prefillFirstName, prefillEmail, prefillAccountName, finalUrl };
}

// ---------------------------------------------------------------------------
// deleteLead()
// ---------------------------------------------------------------------------

/** Result returned by deleteLead. */
export interface DeleteLeadResult {
  /** True when the browser navigated back to /leads after deletion. */
  deleted: boolean;
  /** The URL the browser settled on after deletion. */
  finalUrl: string;
}

/**
 * Navigates to the lead detail page, clicks "Delete", confirms the modal,
 * and waits for navigation back to /leads.
 *
 * @param leadId - Lead UUID.
 * @param context - Playwright fixture context.
 * @returns DeleteLeadResult.
 */
export async function deleteLead(
  leadId: string,
  context: LeadsBehaviorContext,
): Promise<DeleteLeadResult> {
  const detailPage = new LeadDetailPage(context);
  await detailPage.navigate(leadId);

  await detailPage.clickDelete();
  await detailPage.confirmDelete();

  await context.page.waitForURL('**/leads', { timeout: 10_000 }).catch(() => null);
  await context.page.waitForLoadState('networkidle');

  const finalUrl = detailPage.url();
  const deleted = new URL(finalUrl).pathname === '/leads';

  return { deleted, finalUrl };
}

// ---------------------------------------------------------------------------
// leadRowIsHidden()
// ---------------------------------------------------------------------------

/** Result returned by leadRowIsHidden. */
export interface LeadRowIsHiddenResult {
  /** True when the lead row is NOT visible in the list. */
  hidden: boolean;
  /** The URL the browser settled on. */
  finalUrl: string;
}

/**
 * Navigates to /leads and checks that the given lead row is not visible
 * (e.g. disqualified leads hidden by default).
 *
 * @param leadId - Lead UUID.
 * @param context - Playwright fixture context.
 * @returns LeadRowIsHiddenResult.
 */
export async function leadRowIsHidden(
  leadId: string,
  context: LeadsBehaviorContext,
): Promise<LeadRowIsHiddenResult> {
  const leadsPage = new LeadsPage(context);
  await leadsPage.navigate();

  const visible = await leadsPage.leadRowIsVisible(leadId);
  const finalUrl = leadsPage.url();

  return { hidden: !visible, finalUrl };
}

// ---------------------------------------------------------------------------
// API data-fetch helpers (MINCRM-357)
// ---------------------------------------------------------------------------

/** Shape returned by GET /api/v1/leads/:id. */
export interface LeadRow {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string;
  status: string;
  converted_at: string | null;
  converted_contact_id: string | null;
  converted_account_id: string | null;
  converted_deal_id: string | null;
  /** Optimistic lock version (MINCRM-349). */
  version: number;
}

/** Shape of a paginated lead list row. */
export interface LeadListRow {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string;
  status: string;
  company_name: string | null;
}

/**
 * Fetches a single lead by ID from the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param leadId - Lead UUID.
 * @returns The lead record.
 */
export async function getLeadById(restClient: RestClient, leadId: string): Promise<LeadRow> {
  const res = await restClient.get<{ lead: LeadRow }>(`/api/v1/leads/${leadId}`);
  return res.body.lead;
}

/**
 * Creates a lead via the API and returns the lead row.
 *
 * @param restClient - Authenticated RestClient.
 * @param params - Lead fields.
 * @returns The created lead record.
 */
export async function createLeadViaApi(
  restClient: RestClient,
  params: { first_name: string; email: string; last_name?: string; company_name?: string },
): Promise<LeadRow> {
  const res = await restClient.post<{ lead: LeadRow }>('/api/v1/leads', params);
  return res.body.lead;
}

/** Shape of the lead conversion response. */
export interface LeadConversionResult {
  contact_id: string;
  account_id: string;
  deal_id: string;
}

/**
 * Converts a lead atomically via the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param leadId - Lead UUID.
 * @param params - Conversion parameters.
 * @returns The conversion result containing the IDs of created entities.
 */
export async function convertLeadViaApi(
  restClient: RestClient,
  leadId: string,
  params: {
    contact: { first_name: string; email: string; last_name?: string };
    account: { mode: 'create'; name: string };
    deal: { name: string };
  },
): Promise<LeadConversionResult> {
  const res = await restClient.post<{ conversion: LeadConversionResult }>(
    `/api/v1/leads/${leadId}/convert`,
    params,
  );
  return res.body.conversion;
}

/**
 * Fetches all leads optionally including disqualified / converted entries.
 *
 * @param restClient - Authenticated RestClient.
 * @param options - Filters.
 * @returns Paginated result.
 */
export async function getLeads(
  restClient: RestClient,
  options: { includeDisqualified?: boolean; includeConverted?: boolean } = {},
): Promise<{ data: LeadListRow[]; total: number }> {
  const params = new URLSearchParams();
  if (options.includeDisqualified) params.set('includeDisqualified', 'true');
  if (options.includeConverted) params.set('includeConverted', 'true');
  // Use max page size (100) so newly created leads are found even when the DB has
  // accumulated rows from previous test runs that weren't cleaned up.
  params.set('limit', '100');
  const res = await restClient.get<{ data: LeadListRow[]; total: number }>(
    `/api/v1/leads?${params.toString()}`,
  );
  return { data: res.body.data, total: res.body.total };
}

/**
 * Disqualifies a lead via the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param leadId - Lead UUID.
 * @param version - Current optimistic-lock version.
 * @param reason - Disqualification reason.
 */
export async function disqualifyLead(
  restClient: RestClient,
  leadId: string,
  version: number,
  reason: string,
): Promise<void> {
  await restClient.patch(`/api/v1/leads/${leadId}`, {
    status: 'Disqualified',
    disqualification_reason: reason,
    version,
  });
}
