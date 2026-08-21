/**
 * NLI tool schema registry — single export consumed by the /api/v1/ai/sessions endpoint.
 *
 * buildToolSet(userRole, capabilities) returns the subset of tools that the
 * authenticated user is permitted to see based on their capability set.
 *
 * Design:
 *   - TOOL_CAPABILITY_MAP declares the minimum capability required for each tool.
 *     A tool is included when the user holds the required capability.
 *   - Admin-only tools (pipeline config, custom fields, automation, webhooks,
 *     email templates) require SettingsManage and remain invisible to reps.
 *   - Viewers receive read-only tools (search/get) but no create/update/delete tools.
 *   - buildToolSet is pure: it contains no DB access. The caller resolves
 *     capabilities once and passes the Set in.
 *
 */

import type Anthropic from '@anthropic-ai/sdk';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';
import { contactTools } from './contactTools.js';
import { accountTools } from './accountTools.js';
import { leadTools } from './leadTools.js';
import { dealTools } from './dealTools.js';
import { activityTools } from './activityTools.js';
import { noteTools } from './noteTools.js';
import { tagTools } from './tagTools.js';
import { reportTools } from './reportTools.js';
import { exportTools } from './exportTools.js';
import { adminTools } from './adminTools.js';
import { mutationConfirmationTools } from './mutationConfirmationTool.js';
import { dataHygieneTools } from './dataHygieneTools.js';

// ── Capability map ─────────────────────────────────────────────────────────────
//
// Maps each tool name to the single Capability the user must hold.
// Tools absent from this map are included unconditionally (no capability guard).
// Admin tools are guarded by SettingsManage; write tools by their domain capability.

export const TOOL_CAPABILITY_MAP: ReadonlyMap<string, Capability> = new Map([
  // ── Mutation confirmation ────────────────────────
  // Gated on contacts:view — the minimum capability held by any user with
  // API access. Write-capable roles (rep, manager, admin) always have contacts:view,
  // so they always receive this tool. Viewers have only read tools, so the AI
  // will never attempt to call it in a viewer session.
  ['requestMutationConfirmation', 'contacts:view' as Capability],

  // ── Contacts ──────────────────────────────────────────────────────────────
  ['searchContacts', 'contacts:view' as Capability],
  ['getContact', 'contacts:view' as Capability],
  ['createContact', 'contacts:create' as Capability],
  ['updateContact', 'contacts:edit' as Capability],
  ['deleteContact', 'contacts:delete' as Capability],
  ['getContactChampionBlockerStatus', 'contacts:view' as Capability],
  ['findWarmIntroPaths', 'contacts:view' as Capability],
  ['getFollowUpTiming', 'contacts:view' as Capability],

  // ── Accounts (no dedicated account capabilities — use contacts:* as proxy) ─
  ['searchAccounts', 'contacts:view' as Capability],
  ['getAccount', 'contacts:view' as Capability],
  ['getAccountChurnExpansionSignal', 'contacts:view' as Capability],
  ['getAtRiskAndExpansionAccounts', 'contacts:view' as Capability],
  ['createAccount', 'contacts:create' as Capability],
  ['updateAccount', 'contacts:edit' as Capability],
  ['deleteAccount', 'contacts:delete' as Capability],

  // ── Leads (no dedicated lead capabilities — use contacts:* as proxy) ──────
  ['searchLeads', 'contacts:view' as Capability],
  ['getLead', 'contacts:view' as Capability],
  ['createLead', 'contacts:create' as Capability],
  ['updateLead', 'contacts:edit' as Capability],
  ['deleteLead', 'contacts:delete' as Capability],
  ['convertLead', 'contacts:create' as Capability],

  // ── Deals ─────────────────────────────────────────────────────────────────
  ['searchDeals', 'deals:view' as Capability],
  ['getDeal', 'deals:view' as Capability],
  ['createDeal', 'deals:create' as Capability],
  ['updateDeal', 'deals:edit' as Capability],
  ['deleteDeal', 'deals:delete' as Capability],

  // ── Activities ────────────────────────────────────────────────────────────
  ['searchActivities', 'activities:view' as Capability],
  ['getActivity', 'activities:view' as Capability],
  ['createActivity', 'activities:create' as Capability],
  ['updateActivity', 'activities:edit' as Capability],
  ['deleteActivity', 'activities:delete' as Capability],
  ['getObjectionPrecedents', 'activities:view' as Capability],

  // ── Notes (access gated by entity ownership; at minimum need contacts:view) ─
  ['searchNotes', 'contacts:view' as Capability],
  ['getNote', 'contacts:view' as Capability],
  ['createNote', 'contacts:edit' as Capability],
  ['updateNote', 'contacts:edit' as Capability],
  ['deleteNote', 'contacts:edit' as Capability],

  // ── Tags (read is open to any authenticated user with contacts:view) ──────
  ['listTags', 'contacts:view' as Capability],
  ['attachTag', 'contacts:edit' as Capability],
  ['detachTag', 'contacts:edit' as Capability],
  ['renameTag', 'contacts:edit' as Capability],

  // ── Reports ───────────────────────────────────────────────────────────────
  ['generateReport', 'reports:view' as Capability],
  ['saveReport', 'reports:create' as Capability],
  ['getWinLossPatterns', 'reports:view' as Capability],

  // ── Export ────────────────────────────────────────────────────────────────
  ['exportEntities', 'data:export' as Capability],

  // ── Data hygiene (no dedicated capability — spans contacts/accounts/deals) ─
  ['getDataHygieneFindings', 'contacts:view' as Capability],

  // ── Admin: Config / Automation / Webhooks ─────────────────────────────────
  ['listPipelines', 'settings:manage' as Capability],
  ['getPipeline', 'settings:manage' as Capability],
  ['listStages', 'settings:manage' as Capability],
  ['listCustomFields', 'settings:manage' as Capability],
  ['listAutomationRules', 'settings:manage' as Capability],
  ['getAutomationRule', 'settings:manage' as Capability],
  ['listWebhooks', 'settings:manage' as Capability],
  ['listEmailTemplates', 'settings:manage' as Capability],
  ['getEmailTemplate', 'settings:manage' as Capability],
]);

// ── Feature flag map ───────────────────────────────────────────────────────────
//
// Maps a tool name to the feature flag that must be enabled for the calling user
// before the tool may execute. Mirrors the flag each tool's equivalent HTTP
// endpoint is gated by — an NLI tool must not expose data or actions the same
// user couldn't reach via the UI when the flag is off. Tools absent from this
// map are not gated by any feature flag (only by TOOL_CAPABILITY_MAP, if present).
export const TOOL_FEATURE_FLAG_MAP: ReadonlyMap<string, string> = new Map([
  ['getWinLossPatterns', 'ai_win_loss_insights'],
  ['getContactChampionBlockerStatus', 'ai_champion_blocker_detection'],
  ['getAccountChurnExpansionSignal', 'ai_churn_expansion_detection'],
  ['getAtRiskAndExpansionAccounts', 'ai_churn_expansion_detection'],
  ['getObjectionPrecedents', 'ai_objection_pattern_matching'],
  ['findWarmIntroPaths', 'ai_warm_intro_path'],
  ['getFollowUpTiming', 'ai_followup_timing_suggestions'],
  ['getDataHygieneFindings', 'ai_data_hygiene_assistant'],
]);

// ── Built-in role capability fallback ─────────────────────────────────────────
//
// Static snapshot of the capability matrix seeded by migrations 106, 109, and 114.
// Used by resolveNliCapabilities() as a last-resort fallback when userCapabilities()
// returns an empty set — e.g., when the custom_roles or role_capabilities tables are
// missing the built-in rows due to a failed or rolled-back migration.
//
// Keep this in sync with the seed data in db/migrations/106, 108, 109, and 114.

/** Minimum capabilities guaranteed to each built-in role string (static fallback). */
export const BUILTIN_ROLE_CAPABILITIES: Readonly<Record<string, readonly Capability[]>> = {
  admin: [
    Capability.ContactsView,
    Capability.ContactsCreate,
    Capability.ContactsEdit,
    Capability.ContactsDelete,
    Capability.ContactsExport,
    Capability.DealsView,
    Capability.DealsCreate,
    Capability.DealsEdit,
    Capability.DealsDelete,
    Capability.DealsReassign,
    Capability.ActivitiesView,
    Capability.ActivitiesCreate,
    Capability.ActivitiesEdit,
    Capability.ActivitiesDelete,
    Capability.PipelinesView,
    Capability.PipelinesManage,
    Capability.ReportsView,
    Capability.ReportsCreate,
    Capability.ReportsExport,
    Capability.BulkOperations,
    Capability.DataImport,
    Capability.DataExport,
    Capability.UsersView,
    Capability.UsersCreate,
    Capability.UsersEdit,
    Capability.UsersDelete,
    Capability.TeamsManage,
    Capability.IntegrationsManage,
    Capability.SettingsManage,
    Capability.FeatureFlagsManage,
    Capability.AuditLogView,
  ],
  manager: [
    Capability.ContactsView,
    Capability.ContactsCreate, // migration 108
    Capability.ContactsEdit,
    Capability.ContactsExport,
    Capability.ContactsDelete,
    Capability.DealsView,
    Capability.DealsCreate, // migration 108
    Capability.DealsEdit,
    Capability.DealsReassign,
    Capability.DealsDelete,
    Capability.ActivitiesView,
    Capability.ActivitiesCreate, // migration 108
    Capability.ActivitiesEdit,
    Capability.ActivitiesDelete,
    Capability.PipelinesView,
    Capability.ReportsView,
    Capability.ReportsCreate,
    Capability.ReportsExport,
    Capability.BulkOperations,
    Capability.DataExport,
  ],
  rep: [
    Capability.ContactsView,
    Capability.ContactsCreate,
    Capability.ContactsEdit,
    Capability.ContactsDelete,
    Capability.DealsView,
    Capability.DealsCreate,
    Capability.DealsEdit,
    Capability.DealsDelete,
    Capability.ActivitiesView,
    Capability.ActivitiesCreate,
    Capability.ActivitiesEdit,
    Capability.ActivitiesDelete,
    Capability.PipelinesView,
    Capability.ReportsView,
  ],
  viewer: [
    Capability.ContactsView,
    Capability.DealsView,
    Capability.ActivitiesView,
    Capability.PipelinesView,
    Capability.ReportsView,
  ],
  // service_account has only api:access, which gates no NLI tools — the
  // fallback correctly yields an empty tool set for this role.
  service_account: [Capability.ApiAccess],
};

/** Names of tools that require the admin role (defence-in-depth). */
export const ADMIN_ONLY_TOOL_NAMES = new Set<string>(adminTools.map((t) => t.name));

/** All tool definitions in a flat array ordered for iteration. Exported for testing. */
export const ALL_TOOLS: Anthropic.Messages.Tool[] = [
  // requestMutationConfirmation is listed first so Claude encounters its instructions
  // before any write tool definition. It has no capability gate — viewers have no write
  // tools so Claude will never attempt to use it for read-only sessions.
  ...mutationConfirmationTools,
  ...contactTools,
  ...accountTools,
  ...leadTools,
  ...dealTools,
  ...activityTools,
  ...noteTools,
  ...tagTools,
  ...reportTools,
  ...exportTools,
  ...adminTools,
  ...dataHygieneTools,
];

/**
 * Returns the subset of tool definitions that the authenticated user may call.
 *
 * A tool is included when the user holds its required capability from
 * TOOL_CAPABILITY_MAP. Tools without a capability entry are always included.
 * Admin-only tools additionally require the 'admin' role string.
 *
 * @param userRole      - The user's legacy role string ('admin' | 'rep' | 'viewer' | ...)
 * @param capabilities  - The user's resolved capability set (from userCapabilities())
 */
export function buildToolSet(
  userRole: string,
  capabilities: ReadonlySet<Capability>,
): Anthropic.Messages.Tool[] {
  return ALL_TOOLS.filter((tool) => {
    // Admin-only tools: require admin role regardless of capabilities.
    if (ADMIN_ONLY_TOOL_NAMES.has(tool.name) && userRole !== 'admin') {
      return false;
    }

    // Capability-gated tools: require the mapped capability.
    const requiredCapability = TOOL_CAPABILITY_MAP.get(tool.name);
    if (requiredCapability !== undefined && !capabilities.has(requiredCapability)) {
      return false;
    }

    return true;
  });
}
