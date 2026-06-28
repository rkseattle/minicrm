/**
 * NLI tool schema registry — single export consumed by the /api/ai/sessions endpoint.
 *
 * buildToolSet(userRole) returns the full tool array for admins and the
 * non-admin subset for reps. Tool definitions are pure schema; all dispatch
 * lives in toolExecutor.ts. (MINCRM-422)
 */

import type Anthropic from '@anthropic-ai/sdk';
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

/** Tools available to every authenticated user regardless of role. */
const REP_TOOLS: Anthropic.Messages.Tool[] = [
  ...contactTools,
  ...accountTools,
  ...leadTools,
  ...dealTools,
  ...activityTools,
  ...noteTools,
  ...tagTools,
  ...reportTools,
  ...exportTools,
];

/**
 * Returns the appropriate tool set for the given user role.
 *
 * Admin-only tools (pipeline config, custom field definitions, automation
 * rules, webhooks, email templates) are filtered out for non-admin roles so
 * Claude never sees — and cannot attempt to call — tools the user has no
 * access to.
 */
export function buildToolSet(userRole: string): Anthropic.Messages.Tool[] {
  if (userRole === 'admin') {
    return [...REP_TOOLS, ...adminTools];
  }
  return REP_TOOLS;
}

/** Names of tools that are restricted to the admin role. */
export const ADMIN_ONLY_TOOL_NAMES = new Set<string>(adminTools.map((t) => t.name));
