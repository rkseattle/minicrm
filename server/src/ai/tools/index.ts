/**
 * NLI tool schema registry — single export consumed by the /api/ai/sessions endpoint.
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
 * (MINCRM-422, MINCRM-434)
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';
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

// ── Capability map ─────────────────────────────────────────────────────────────
//
// Maps each tool name to the single Capability the user must hold.
// Tools absent from this map are included unconditionally (no capability guard).
// Admin tools are guarded by SettingsManage; write tools by their domain capability.

export const TOOL_CAPABILITY_MAP: ReadonlyMap<string, Capability> = new Map([
  // ── Contacts ──────────────────────────────────────────────────────────────
  ['searchContacts', 'contacts:view' as Capability],
  ['getContact', 'contacts:view' as Capability],
  ['createContact', 'contacts:create' as Capability],
  ['updateContact', 'contacts:edit' as Capability],
  ['deleteContact', 'contacts:delete' as Capability],

  // ── Accounts (no dedicated account capabilities — use contacts:* as proxy) ─
  ['searchAccounts', 'contacts:view' as Capability],
  ['getAccount', 'contacts:view' as Capability],
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

  // ── Reports ───────────────────────────────────────────────────────────────
  ['generateReport', 'reports:view' as Capability],

  // ── Export ────────────────────────────────────────────────────────────────
  ['exportEntities', 'data:export' as Capability],

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

/** Names of tools that require the admin role (defence-in-depth). */
export const ADMIN_ONLY_TOOL_NAMES = new Set<string>(adminTools.map((t) => t.name));

/** All tool definitions in a flat array ordered for iteration. Exported for testing. */
export const ALL_TOOLS: Anthropic.Messages.Tool[] = [
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
