/**
 * Unit tests for NLI tool capability filtering. (MINCRM-434)
 *
 * Verifies that buildToolSet returns the correct tool subsets for different
 * capability sets and role strings.
 *
 * These are pure unit tests — no DB access, no fixtures.
 */

import { describe, it, expect } from 'vitest';
import {
  buildToolSet,
  TOOL_CAPABILITY_MAP,
  ADMIN_ONLY_TOOL_NAMES,
  ALL_TOOLS,
} from '../ai/tools/index.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';

// Helper: collect tool names from a tool array.
function toolNames(tools: { name: string }[]): Set<string> {
  return new Set(tools.map((t) => t.name));
}

// Capability sets matching the built-in roles.

const ADMIN_CAPS = new Set<Capability>([
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
]);

const REP_CAPS = new Set<Capability>([
  Capability.ContactsView,
  Capability.ContactsCreate,
  Capability.ContactsEdit,
  Capability.ContactsDelete,
  Capability.ContactsExport,
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
  Capability.ReportsExport,
  Capability.DataExport,
  Capability.BulkOperations,
]);

const VIEWER_CAPS = new Set<Capability>([
  Capability.ContactsView,
  Capability.ContactsExport,
  Capability.DealsView,
  Capability.ActivitiesView,
  Capability.PipelinesView,
  Capability.ReportsView,
]);

const EMPTY_CAPS = new Set<Capability>();

describe('buildToolSet', () => {
  describe('admin role', () => {
    it('includes all admin-only tools', () => {
      const tools = buildToolSet('admin', ADMIN_CAPS);
      const names = toolNames(tools);
      for (const adminTool of ADMIN_ONLY_TOOL_NAMES) {
        expect(names.has(adminTool), `admin tool '${adminTool}' should be present`).toBe(true);
      }
    });

    it('includes all write tools', () => {
      const tools = buildToolSet('admin', ADMIN_CAPS);
      const names = toolNames(tools);
      const writeTool = [
        'createContact',
        'updateContact',
        'deleteContact',
        'createDeal',
        'updateDeal',
        'deleteDeal',
        'createActivity',
        'updateActivity',
        'deleteActivity',
        'createLead',
        'updateLead',
        'deleteLead',
      ];
      for (const tool of writeTool) {
        expect(names.has(tool), `write tool '${tool}' should be present for admin`).toBe(true);
      }
    });
  });

  describe('rep role', () => {
    it('excludes admin-only tools', () => {
      const tools = buildToolSet('rep', REP_CAPS);
      const names = toolNames(tools);
      for (const adminTool of ADMIN_ONLY_TOOL_NAMES) {
        expect(names.has(adminTool), `admin tool '${adminTool}' should be absent for rep`).toBe(
          false,
        );
      }
    });

    it('includes read and write tools for entities the rep can access', () => {
      const tools = buildToolSet('rep', REP_CAPS);
      const names = toolNames(tools);
      expect(names.has('searchContacts')).toBe(true);
      expect(names.has('createContact')).toBe(true);
      expect(names.has('updateContact')).toBe(true);
      expect(names.has('deleteContact')).toBe(true);
      expect(names.has('searchDeals')).toBe(true);
      expect(names.has('createDeal')).toBe(true);
      expect(names.has('generateReport')).toBe(true);
      expect(names.has('exportEntities')).toBe(true);
    });
  });

  describe('viewer role', () => {
    it('excludes admin-only tools', () => {
      const tools = buildToolSet('viewer', VIEWER_CAPS);
      const names = toolNames(tools);
      for (const adminTool of ADMIN_ONLY_TOOL_NAMES) {
        expect(names.has(adminTool), `admin tool '${adminTool}' should be absent for viewer`).toBe(
          false,
        );
      }
    });

    it('includes read-only tools', () => {
      const tools = buildToolSet('viewer', VIEWER_CAPS);
      const names = toolNames(tools);
      expect(names.has('searchContacts')).toBe(true);
      expect(names.has('getContact')).toBe(true);
      expect(names.has('searchDeals')).toBe(true);
      expect(names.has('getDeal')).toBe(true);
      expect(names.has('generateReport')).toBe(true);
    });

    it('excludes create/update/delete tools', () => {
      const tools = buildToolSet('viewer', VIEWER_CAPS);
      const names = toolNames(tools);
      expect(names.has('createContact')).toBe(false);
      expect(names.has('updateContact')).toBe(false);
      expect(names.has('deleteContact')).toBe(false);
      expect(names.has('createDeal')).toBe(false);
      expect(names.has('updateDeal')).toBe(false);
      expect(names.has('deleteDeal')).toBe(false);
      expect(names.has('createActivity')).toBe(false);
      expect(names.has('createNote')).toBe(false);
      expect(names.has('attachTag')).toBe(false);
      expect(names.has('detachTag')).toBe(false);
      expect(names.has('convertLead')).toBe(false);
    });

    it('excludes export tools when viewer lacks data:export', () => {
      // Viewers do not have DataExport capability by default.
      const tools = buildToolSet('viewer', VIEWER_CAPS);
      const names = toolNames(tools);
      expect(names.has('exportEntities')).toBe(false);
    });
  });

  describe('no capabilities', () => {
    it('returns no gated tools when capability set is empty', () => {
      const tools = buildToolSet('rep', EMPTY_CAPS);
      const names = toolNames(tools);
      // All tools in TOOL_CAPABILITY_MAP should be absent.
      for (const [toolName] of TOOL_CAPABILITY_MAP) {
        expect(
          names.has(toolName),
          `gated tool '${toolName}' should be absent with empty caps`,
        ).toBe(false);
      }
    });
  });

  describe('capability map completeness', () => {
    it('every admin-only tool name appears in TOOL_CAPABILITY_MAP', () => {
      for (const toolName of ADMIN_ONLY_TOOL_NAMES) {
        expect(
          TOOL_CAPABILITY_MAP.has(toolName),
          `admin tool '${toolName}' is missing from TOOL_CAPABILITY_MAP`,
        ).toBe(true);
      }
    });

    it('every tool in ALL_TOOLS appears in TOOL_CAPABILITY_MAP (no unconstrained tools)', () => {
      // Ensures that a new tool added to a tool file but omitted from the map
      // does not silently become world-readable to any authenticated user.
      for (const tool of ALL_TOOLS) {
        expect(
          TOOL_CAPABILITY_MAP.has(tool.name),
          `tool '${tool.name}' is present in ALL_TOOLS but missing from TOOL_CAPABILITY_MAP`,
        ).toBe(true);
      }
    });
  });
});
