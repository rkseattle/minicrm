/**
 * NLI tool executor — dispatches Claude tool_use calls to the correct CRM service.
 *
 * All service imports live here. The executor is the only module in the AI
 * subsystem that has domain knowledge about specific services.
 *
 * Security:
 *   - Admin-only tools throw 403 if called by a non-admin (defence-in-depth
 *     beyond buildToolSet filtering).
 *   - Export RBAC is enforced by passing requestingUser to scoped services.
 *
 * Optimistic locking:
 *   Update operations that require a version number fetch the current record
 *   first to obtain the version, then immediately apply the update. This is
 *   safe in the NLI context because the AI cannot hold stale version numbers
 *   across turns — each update starts fresh.
 *
 * (MINCRM-422)
 */

import logger from '../logger.js';
import type { AuditActor } from '../services/auditService.js';
import { ADMIN_ONLY_TOOL_NAMES, TOOL_FEATURE_FLAG_MAP } from './tools/index.js';
import { isFlagEnabledForUser } from '../services/featureFlagService.js';
import type { AiPendingAction } from '@minicrm/shared/schemas/aiSessionSchema.js';
import { STAGE_TREND_DAYS_OPTIONS } from '../services/reportService.js';
import type { NoteEntityType } from '@minicrm/shared/schemas/noteSchema.js';
import type { ActivityType, ActivityStatus } from '@minicrm/shared/schemas/activitySchema.js';
import type { LeadSource, LeadStatus } from '@minicrm/shared/schemas/leadSchema.js';
import type { AccountType } from '@minicrm/shared/schemas/accountSchema.js';
import type { SupportedCurrency } from '@minicrm/shared/schemas/settingsSchema.js';
import type { ContactSortColumn } from '../services/contactService.js';
import type { AccountSortColumn } from '../services/accountService.js';
import type { LeadSortColumn } from '../services/leadsService.js';
import type { DealSortColumn } from '../services/dealService.js';

// ── Contact ────────────────────────────────────────────────────────────────────
import {
  listContacts,
  findContactById,
  createContact,
  updateContact,
  deleteContact,
  exportContactsForCsv,
} from '../services/contactService.js';

// ── Account ────────────────────────────────────────────────────────────────────
import {
  listAccounts,
  findAccountById,
  createAccount,
  updateAccount,
  deleteAccount,
  exportAccountsForCsv,
} from '../services/accountService.js';

// ── Lead ───────────────────────────────────────────────────────────────────────
import {
  listLeads,
  findLeadById,
  createLead,
  updateLead,
  deleteLead,
  convertLead,
} from '../services/leadsService.js';

// ── Deal ───────────────────────────────────────────────────────────────────────
import {
  listDeals,
  findDealById,
  createDeal,
  updateDeal,
  deleteDeal,
  exportDealsForCsv,
} from '../services/dealService.js';

// ── Activity ───────────────────────────────────────────────────────────────────
import {
  listActivities,
  findActivityById,
  createActivity,
  updateActivity,
  deleteActivity,
} from '../services/activityService.js';

// ── Note ───────────────────────────────────────────────────────────────────────
import {
  searchNotesCrossEntity,
  getNoteById,
  createNote,
  updateNote,
  deleteNote,
} from '../services/noteService.js';

// ── Tag ────────────────────────────────────────────────────────────────────────
import {
  listTags,
  attachTag,
  detachTag,
  renameTagByName,
  type AttachableEntity,
} from '../services/tagService.js';

// ── Report ─────────────────────────────────────────────────────────────────────
import {
  getWinLossReport,
  getActivityVolumeReport,
  getStageTrendReport,
  getLeadsSummaryReport,
} from '../services/reportService.js';
import { saveNliReport } from '../services/customReportService.js';
import { getWinLossInsights } from '../services/winLossAnalysisService.js';
import { getContactChampionBlockerStatus } from '../services/championBlockerService.js';
import {
  getAccountChurnExpansionSignal,
  listChurnExpansionSignals,
} from '../services/churnExpansionService.js';
import { findObjectionPrecedents } from '../services/objectionMatchingService.js';
import type { ObjectionCategory } from '@minicrm/shared/schemas/objectionSchema.js';

// ── Pipeline / Stage ───────────────────────────────────────────────────────────
import { listPipelines, findPipelineById } from '../services/pipelineService.js';
import { listPipelineStages } from '../services/pipelineStageService.js';

// ── Custom Fields ──────────────────────────────────────────────────────────────
import { listDefinitions as listCustomFieldDefinitions } from '../services/customFieldService.js';

// ── Automation ─────────────────────────────────────────────────────────────────
import { listAutomationRules, findAutomationRuleById } from '../services/automationService.js';

// ── Webhooks ───────────────────────────────────────────────────────────────────
import { listWebhookSubscriptions } from '../services/webhookService.js';

// ── Email Templates ────────────────────────────────────────────────────────────
import { listEmailTemplates, findEmailTemplateById } from '../services/emailTemplateService.js';

// ──────────────────────────────────────────────────────────────────────────────

export interface ToolCallContext {
  actor: AuditActor;
  userId: string;
  userRole: string;
}

/**
 * Dispatches a single Claude tool_use call to the appropriate service function.
 *
 * Returns a JSON-serialisable result object. Throws on authorisation failures
 * or unknown tool names. Service-layer errors (not-found, conflict, etc.) are
 * caught and returned as structured error objects so Claude can relay them to
 * the user rather than crashing the conversation loop.
 */
export async function executeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  ctx: ToolCallContext,
): Promise<unknown> {
  // Defence-in-depth: admin tool names are filtered from buildToolSet for non-admins,
  // but we enforce the check here too in case the tool set is bypassed.
  if (ADMIN_ONLY_TOOL_NAMES.has(toolName) && ctx.userRole !== 'admin') {
    logger.warn(
      { toolName, userId: ctx.userId, userRole: ctx.userRole },
      'NLI permission denied: admin-only tool called by non-admin (MINCRM-434)',
    );
    throw Object.assign(new Error(`Tool '${toolName}' requires admin role`), { statusCode: 403 });
  }

  // A tool tied to a feature-flagged AI capability must not be reachable via NLI
  // when that flag is off for the user — the equivalent HTTP endpoint enforces the
  // same flag via requireFeatureEnabled(), and buildToolSet does not filter by flag.
  const requiredFlag = TOOL_FEATURE_FLAG_MAP.get(toolName);
  if (requiredFlag) {
    const enabled = await isFlagEnabledForUser(requiredFlag, ctx.userId, ctx.userRole);
    if (!enabled) {
      logger.warn(
        { toolName, userId: ctx.userId, requiredFlag },
        'NLI permission denied: feature flag disabled for tool',
      );
      throw Object.assign(
        new Error(`Tool '${toolName}' requires the '${requiredFlag}' feature to be enabled`),
        {
          statusCode: 403,
        },
      );
    }
  }

  const requestingUser = { id: ctx.userId, role: ctx.userRole };

  try {
    switch (toolName) {
      // ── Mutation confirmation ────────────────────────────────────────────────
      case 'requestMutationConfirmation': {
        // This tool does not call any service. It builds and returns an AiPendingAction
        // so the session service can store it on the assistant message for client rendering.
        // The actual write tool is called only after the user confirms. (MINCRM-425, MINCRM-426)

        // Runtime validation: the Anthropic tool schema enforces types for well-behaved
        // models but a drifted or adversarial model could send unexpected shapes.
        // Validate the fields critical for safe rendering before building the action object.
        const rawOperation = toolInput.operation;
        const VALID_OPERATIONS = new Set(['create', 'update', 'delete']);
        if (typeof rawOperation !== 'string' || !VALID_OPERATIONS.has(rawOperation)) {
          logger.warn(
            { toolInput },
            'NLI: requestMutationConfirmation received invalid operation — rejecting',
          );
          return {
            error: `Invalid operation: ${String(rawOperation)}. Must be one of: create, update, delete.`,
          };
        }
        if (
          toolInput.fields !== null &&
          toolInput.fields !== undefined &&
          typeof toolInput.fields !== 'object'
        ) {
          logger.warn(
            { toolInput },
            'NLI: requestMutationConfirmation received non-object fields — rejecting',
          );
          return { error: 'Invalid fields: must be an object.' };
        }
        // Treat null fields as empty object to prevent Object.entries(null) crash on client.
        if (toolInput.fields === null) {
          toolInput.fields = {};
        }

        const isBulk = toolInput.is_bulk as boolean; // validated: Anthropic schema enforces boolean type
        if (isBulk && (toolInput.bulk_count === null || toolInput.bulk_count === undefined)) {
          logger.warn(
            { toolInput },
            'NLI: requestMutationConfirmation called with is_bulk=true but no bulk_count',
          );
          return { error: 'bulk_count is required when is_bulk is true.' };
        }

        // isBulkDelete is only valid when isBulk=true AND operation='delete'.
        // Enforce both conditions server-side to prevent the bulk-delete double-confirm gate
        // from rendering for create/update bulk operations. (MINCRM-426)
        const isBulkDelete =
          isBulk && rawOperation === 'delete'
            ? (toolInput.is_bulk_delete as boolean | undefined) // Anthropic schema enforces boolean
            : undefined;

        const pendingAction: AiPendingAction = {
          operation: toolInput.operation as AiPendingAction['operation'], // validated: VALID_OPERATIONS check above
          entityType: toolInput.entity_type as string, // validated: Anthropic schema enforces string
          entityId: toolInput.entity_id as string | undefined,
          entityName: toolInput.entity_name as string | undefined,
          fields: toolInput.fields as Record<string, unknown>, // validated: null guarded above, object check above
          isBulk,
          bulkCount: isBulk ? (toolInput.bulk_count as number | undefined) : undefined, // Anthropic schema enforces integer
          bulkSample: isBulk ? (toolInput.bulk_sample as string[] | undefined) : undefined, // Anthropic schema enforces array
          isBulkDelete,
          summary: toolInput.summary as string, // Anthropic schema enforces string
        };
        logger.info(
          {
            operation: pendingAction.operation,
            entityType: pendingAction.entityType,
            isBulk: pendingAction.isBulk,
            isBulkDelete: pendingAction.isBulkDelete,
          },
          'NLI mutation confirmation requested (MINCRM-425)',
        );
        return pendingAction;
      }

      // ── Contacts ────────────────────────────────────────────────────────────
      case 'searchContacts': {
        return await listContacts({
          search: toolInput.query as string | undefined,
          ownerId: toolInput.owner_id as string | undefined,
          accountId: toolInput.account_id as string | undefined,
          tagIds: toolInput.tags as string[] | undefined,
          page: asPage(toolInput.page),
          limit: clampLimit(toolInput.limit as number | undefined),
          sort: toolInput.sort_by as ContactSortColumn | undefined,
          dir: asDir(toolInput.sort_dir),
          requestingUser,
        });
      }

      case 'getContact': {
        const row = await findContactById(toolInput.id as string);
        return row ?? notFound('Contact', toolInput.id as string);
      }

      case 'createContact': {
        return await createContact(
          {
            first_name: toolInput.first_name as string,
            // last_name and email are NOT NULL on contacts row but the tool schema makes
            // them optional so AI can omit them; fall back to '' which the service sends
            // to the DB — the DB constraint will reject truly invalid payloads.
            last_name: ((toolInput.last_name as string | undefined) ?? '') as string,
            email: ((toolInput.email as string | undefined) ?? '') as string,
            phone: toolInput.phone as string | undefined,
            title: toolInput.title as string | undefined,
            account_id: (toolInput.account_id as string | undefined) ?? null,
            owner_id: (toolInput.owner_id as string | undefined) ?? ctx.userId,
          },
          ctx.actor,
        );
      }

      case 'updateContact': {
        const id = toolInput.id as string;
        const current = await findContactById(id);
        if (!current) return notFound('Contact', id);
        return await updateContact(
          id,
          {
            first_name: toolInput.first_name as string | undefined,
            last_name: (toolInput.last_name as string | undefined) ?? undefined,
            email: toolInput.email as string | undefined,
            phone: (toolInput.phone as string | undefined) ?? undefined,
            title: (toolInput.title as string | undefined) ?? undefined,
            account_id: (toolInput.account_id as string | undefined) ?? undefined,
            owner_id: toolInput.owner_id as string | undefined,
            version: current.version,
          },
          ctx.actor,
          current,
          requestingUser,
        );
      }

      case 'deleteContact': {
        await deleteContact(toolInput.id as string, ctx.actor);
        return { deleted: true, id: toolInput.id };
      }

      case 'getContactChampionBlockerStatus': {
        const id = toolInput.id as string;
        const contact = await findContactById(id);
        if (!contact) return notFound('Contact', id);
        return await getContactChampionBlockerStatus(id);
      }

      // ── Accounts ─────────────────────────────────────────────────────────────
      case 'searchAccounts': {
        // Reps can only list accounts they own; admins see all (matching HTTP controller).
        const accountOwnerId =
          ctx.userRole !== 'admin' ? ctx.userId : (toolInput.owner_id as string | undefined);
        return await listAccounts({
          search: toolInput.query as string | undefined,
          ownerId: accountOwnerId,
          accountType: toolInput.account_type as AccountType | undefined,
          tagIds: toolInput.tags as string[] | undefined,
          page: asPage(toolInput.page),
          limit: clampLimit(toolInput.limit as number | undefined),
          sort: toolInput.sort_by as AccountSortColumn | undefined,
          dir: asDir(toolInput.sort_dir),
        });
      }

      case 'getAccount': {
        const row = await findAccountById(toolInput.id as string);
        return row ?? notFound('Account', toolInput.id as string);
      }

      case 'createAccount': {
        return await createAccount(
          {
            name: toolInput.name as string,
            account_type: toolInput.account_type as AccountType | undefined,
            website: toolInput.website as string | undefined,
            industry: toolInput.industry as string | undefined,
            parent_account_id: toolInput.parent_account_id as string | undefined,
            owner_id: (toolInput.owner_id as string | undefined) ?? ctx.userId,
          },
          ctx.actor,
        );
      }

      case 'updateAccount': {
        const id = toolInput.id as string;
        const current = await findAccountById(id);
        if (!current) return notFound('Account', id);
        // Enforce ownership: reps can only update accounts they own (matches HTTP controller).
        if (current.owner_id !== ctx.userId && ctx.userRole !== 'admin') {
          logger.warn(
            {
              toolName: 'updateAccount',
              accountId: id,
              userId: ctx.userId,
              userRole: ctx.userRole,
            },
            'NLI permission denied: rep attempted to update account they do not own (MINCRM-434)',
          );
          throw Object.assign(new Error('You do not have permission to update this account'), {
            statusCode: 403,
          });
        }
        return await updateAccount(
          id,
          {
            name: toolInput.name as string | undefined,
            account_type: toolInput.account_type as AccountType | undefined,
            website: toolInput.website as string | undefined,
            industry: toolInput.industry as string | undefined,
            parent_account_id: toolInput.parent_account_id as string | undefined,
            owner_id: toolInput.owner_id as string | undefined,
            version: current.version,
          },
          ctx.actor,
          current,
        );
      }

      case 'deleteAccount': {
        await deleteAccount(toolInput.id as string, ctx.actor);
        return { deleted: true, id: toolInput.id };
      }

      case 'getAccountChurnExpansionSignal': {
        const id = toolInput.id as string;
        const account = await findAccountById(id);
        if (!account) return notFound('Account', id);
        return await getAccountChurnExpansionSignal(id);
      }

      case 'getAtRiskAndExpansionAccounts': {
        return await listChurnExpansionSignals();
      }

      // ── Leads ────────────────────────────────────────────────────────────────
      case 'searchLeads': {
        // Reps can only list leads they own; admins see all (matching HTTP controller).
        const leadOwnerId =
          ctx.userRole !== 'admin' ? ctx.userId : (toolInput.owner_id as string | undefined);
        return await listLeads({
          ownerId: leadOwnerId,
          status: toolInput.status as LeadStatus | undefined,
          lead_source: toolInput.source as LeadSource | undefined,
          page: asPage(toolInput.page),
          limit: clampLimit(toolInput.limit as number | undefined),
          sort: toolInput.sort_by as LeadSortColumn | undefined,
          dir: asDir(toolInput.sort_dir),
        });
      }

      case 'getLead': {
        const row = await findLeadById(toolInput.id as string);
        return row ?? notFound('Lead', toolInput.id as string);
      }

      case 'createLead': {
        return await createLead(
          {
            first_name: toolInput.first_name as string,
            last_name: toolInput.last_name as string | undefined,
            email: toolInput.email as string,
            phone: toolInput.phone as string | undefined,
            company_name: toolInput.company as string | undefined,
            lead_source: toolInput.source as LeadSource | undefined,
            notes: toolInput.notes as string | undefined,
            owner_id: (toolInput.owner_id as string | undefined) ?? ctx.userId,
          },
          ctx.actor,
        );
      }

      case 'updateLead': {
        const id = toolInput.id as string;
        const current = await findLeadById(id);
        if (!current) return notFound('Lead', id);
        return await updateLead(
          id,
          {
            first_name: toolInput.first_name as string | undefined,
            last_name: toolInput.last_name as string | undefined,
            email: toolInput.email as string | undefined,
            phone: toolInput.phone as string | undefined,
            company_name: toolInput.company as string | undefined,
            lead_source: toolInput.source as LeadSource | undefined,
            status: toolInput.status as LeadStatus | undefined,
            notes: toolInput.notes as string | undefined,
            owner_id: toolInput.owner_id as string | undefined,
            version: current.version,
          },
          ctx.actor,
        );
      }

      case 'deleteLead': {
        await deleteLead(toolInput.id as string, ctx.actor);
        return { deleted: true, id: toolInput.id };
      }

      case 'convertLead': {
        // Fetch the lead first so we can carry over its first_name and email to the contact.
        const leadForConversion = await findLeadById(toolInput.id as string);
        if (!leadForConversion) return notFound('Lead', toolInput.id as string);

        const shouldCreateAccount = toolInput.create_account === true;
        const accountInput = shouldCreateAccount
          ? {
              mode: 'create' as const,
              name: String(toolInput.account_name ?? leadForConversion.company_name ?? ''),
            }
          : { mode: 'link' as const, account_id: toolInput.account_id as string };

        if (!shouldCreateAccount && !toolInput.account_id) {
          return { error: 'account_id is required when create_account is false' };
        }

        return await convertLead(
          toolInput.id as string,
          {
            contact: {
              first_name: leadForConversion.first_name,
              last_name: toolInput.contact_last_name as string,
              email: (toolInput.contact_email as string | undefined) ?? leadForConversion.email,
            },
            account: accountInput,
            deal: {
              name: toolInput.deal_name as string,
              value:
                toolInput.deal_amount !== undefined ? String(toolInput.deal_amount) : undefined,
              close_date: toolInput.close_date as string | undefined,
            },
          },
          ctx.actor,
        );
      }

      // ── Deals ────────────────────────────────────────────────────────────────
      case 'searchDeals': {
        return await listDeals({
          ownerId: toolInput.owner_id as string | undefined,
          accountId: toolInput.account_id as string | undefined,
          pipelineId: toolInput.pipeline_id as string | undefined,
          tagIds: toolInput.tags as string[] | undefined,
          page: asPage(toolInput.page),
          limit: clampLimit(toolInput.limit as number | undefined),
          sort: toolInput.sort_by as DealSortColumn | undefined,
          dir: asDir(toolInput.sort_dir),
          requestingUser,
        });
      }

      case 'getDeal': {
        const row = await findDealById(toolInput.id as string);
        return row ?? notFound('Deal', toolInput.id as string);
      }

      case 'createDeal': {
        // The schema field is 'value'; 'currency' is a constrained union of ISO 4217 codes.
        return await createDeal(
          {
            name: toolInput.name as string,
            stage: (toolInput.stage_id as string | undefined) ?? '',
            value: toolInput.amount as number | undefined,
            currency: toolInput.currency as SupportedCurrency | undefined,
            close_date: toolInput.close_date as string | undefined,
            probability: toolInput.probability as number | undefined,
            account_id: toolInput.account_id as string | undefined,
            pipeline_id: toolInput.pipeline_id as string | undefined,
            owner_id: (toolInput.owner_id as string | undefined) ?? ctx.userId,
          },
          ctx.actor,
        );
      }

      case 'updateDeal': {
        const id = toolInput.id as string;
        const current = await findDealById(id);
        if (!current) return notFound('Deal', id);
        // UpdateDealInput uses 'value' for the amount field; 'contact_id' is not updatable.
        return await updateDeal(
          id,
          {
            name: toolInput.name as string | undefined,
            stage: toolInput.stage_id as string | undefined,
            value: toolInput.amount as number | null | undefined,
            close_date: toolInput.close_date as string | null | undefined,
            probability: toolInput.probability as number | null | undefined,
            account_id: toolInput.account_id as string | null | undefined,
            owner_id: toolInput.owner_id as string | undefined,
            version: current.version,
          },
          ctx.actor,
          current,
          requestingUser,
        );
      }

      case 'deleteDeal': {
        await deleteDeal(toolInput.id as string, ctx.actor);
        return { deleted: true, id: toolInput.id };
      }

      // ── Activities ───────────────────────────────────────────────────────────
      case 'searchActivities': {
        return await listActivities({
          type: toolInput.activity_type as string | undefined,
          ownerId: toolInput.owner_id as string | undefined,
          contactId: toolInput.contact_id as string | undefined,
          accountId: toolInput.account_id as string | undefined,
          dealId: toolInput.deal_id as string | undefined,
          start: toolInput.due_date_from as string | undefined,
          end: toolInput.due_date_to as string | undefined,
          page: asPage(toolInput.page),
          limit: clampLimit(toolInput.limit as number | undefined),
          requestingUser,
        });
      }

      case 'getActivity': {
        const row = await findActivityById(toolInput.id as string);
        return row ?? notFound('Activity', toolInput.id as string);
      }

      case 'createActivity': {
        // CreateActivityInput requires at least one of contact_id/account_id/deal_id.
        return await createActivity(
          {
            type: toolInput.activity_type as ActivityType,
            subject: toolInput.subject as string,
            contact_id: toolInput.contact_id as string | undefined,
            account_id: toolInput.account_id as string | undefined,
            deal_id: toolInput.deal_id as string | undefined,
            due_date: toolInput.due_date as string | undefined,
            notes: toolInput.notes as string | undefined,
            owner_id: (toolInput.owner_id as string | undefined) ?? ctx.userId,
          },
          ctx.actor,
        );
      }

      case 'updateActivity': {
        const id = toolInput.id as string;
        const current = await findActivityById(id);
        if (!current) return notFound('Activity', id);
        // UpdateActivityInput does NOT allow changing contact_id/account_id/deal_id/owner_id.
        return await updateActivity(
          id,
          {
            type: toolInput.activity_type as ActivityType | undefined,
            subject: toolInput.subject as string | undefined,
            status: toolInput.status as ActivityStatus | undefined,
            due_date: toolInput.due_date as string | null | undefined,
            notes: toolInput.notes as string | null | undefined,
            version: current.version,
          },
          ctx.actor,
        );
      }

      case 'deleteActivity': {
        await deleteActivity(toolInput.id as string, ctx.actor);
        return { deleted: true, id: toolInput.id };
      }

      case 'getObjectionPrecedents': {
        const category = toolInput.category as ObjectionCategory;
        return await findObjectionPrecedents(category);
      }

      // ── Notes ────────────────────────────────────────────────────────────────
      case 'searchNotes': {
        const entityType = toolInput.entity_type as NoteEntityType | undefined;
        const entityId = toolInput.entity_id as string | undefined;
        const requestedAuthorId = toolInput.author_id as string | undefined;

        // entity_id without entity_type is ambiguous and cannot be access-checked.
        // Reject early to match the original listNotes contract (both required together).
        if (entityId && !entityType) {
          return {
            error: {
              code: 'INVALID_INPUT',
              message: 'entity_type is required when entity_id is provided',
            },
          };
        }

        // When both entity_type and entity_id are provided, enforce ownership access
        // on the parent entity before returning its notes (prevents note leakage).
        if (entityType && entityId) {
          await assertEntityAccess(entityType, entityId, ctx);
        }

        // Reps performing a cross-entity search (no entity_id) are implicitly scoped
        // to notes they authored. This prevents a rep from browsing all team-visible
        // notes across records they do not own. Admins receive all notes unscoped.
        const impliedAuthorId =
          !entityId && ctx.userRole !== 'admin' ? ctx.userId : requestedAuthorId;

        return await searchNotesCrossEntity(
          {
            entity_type: entityType,
            entity_id: entityId,
            keyword: toolInput.keyword as string | undefined,
            author_id: impliedAuthorId,
            date_from: toolInput.date_from as string | undefined,
            date_to: toolInput.date_to as string | undefined,
            page: asPage(toolInput.page),
            limit: clampLimit(toolInput.limit as number | undefined),
          },
          ctx.userId,
        );
      }

      case 'getNote': {
        const row = await getNoteById(
          toolInput.entity_type as NoteEntityType,
          toolInput.entity_id as string,
          toolInput.id as string,
          ctx.userId,
        );
        return row ?? notFound('Note', toolInput.id as string);
      }

      case 'createNote': {
        const cnEntityType = toolInput.entity_type as NoteEntityType;
        const cnEntityId = toolInput.entity_id as string;
        // Verify caller owns the parent record before creating a note on it.
        // createNote only checks entity existence, not ownership. (MINCRM-422)
        await assertEntityAccess(cnEntityType, cnEntityId, ctx);
        return await createNote(
          cnEntityType,
          cnEntityId,
          {
            body: toolInput.body as string,
            visibility: (toolInput.visibility as 'private' | 'team' | undefined) ?? 'team',
            tags: [],
          },
          ctx.actor,
        );
      }

      case 'updateNote': {
        const result = await updateNote(
          toolInput.entity_type as NoteEntityType,
          toolInput.entity_id as string,
          toolInput.id as string,
          {
            body: toolInput.body as string | undefined,
            visibility: toolInput.visibility as 'private' | 'team' | undefined,
          },
          ctx.actor,
          ctx.userRole,
        );
        return result ?? notFound('Note', toolInput.id as string);
      }

      case 'deleteNote': {
        await deleteNote(
          toolInput.entity_type as NoteEntityType,
          toolInput.entity_id as string,
          toolInput.id as string,
          ctx.actor,
          ctx.userRole,
        );
        return { deleted: true, id: toolInput.id };
      }

      // ── Tags ─────────────────────────────────────────────────────────────────
      case 'listTags': {
        return await listTags(
          asPage(toolInput.page),
          clampLimit(toolInput.limit as number | undefined, 50),
        );
      }

      case 'attachTag': {
        const tagEntityType = toolInput.entity_type as AttachableEntity;
        const tagEntityId = toolInput.entity_id as string;
        // Verify write access to the target record before mutating its tags.
        await assertEntityAccess(tagEntityType, tagEntityId, ctx, true);
        // attachTag uses upsert-by-name semantics: creates the tag if it does not exist.
        // Leads are now supported alongside contacts, accounts, and deals. (MINCRM-433)
        await attachTag(
          tagEntityType,
          tagEntityId,
          { name: toolInput.tag_name as string },
          ctx.actor,
        );
        return { attached: true };
      }

      case 'detachTag': {
        const detachEntityType = toolInput.entity_type as AttachableEntity;
        const detachEntityId = toolInput.entity_id as string;
        // Verify write access to the target record before mutating its tags.
        await assertEntityAccess(detachEntityType, detachEntityId, ctx, true);
        // Leads are now supported alongside contacts, accounts, and deals. (MINCRM-433)
        await detachTag(detachEntityType, detachEntityId, toolInput.tag_id as string, ctx.actor);
        return { detached: true };
      }

      case 'renameTag': {
        // renameTag executes atomically with an audit entry. The AI is instructed to
        // call requestMutationConfirmation before invoking this tool. (MINCRM-433)
        let renameResult: Awaited<ReturnType<typeof renameTagByName>>;
        try {
          renameResult = await renameTagByName(
            toolInput.current_name as string,
            toolInput.new_name as string,
            ctx.actor,
          );
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'TAG_NAME_CONFLICT') {
            return {
              error: {
                code: 'TAG_NAME_CONFLICT',
                message: (err as Error).message,
              },
            };
          }
          throw err;
        }
        if (!renameResult) {
          return {
            error: {
              code: 'NOT_FOUND',
              message: `Tag '${String(toolInput.current_name)}' not found.`,
            },
          };
        }
        return {
          renamed: true,
          tag: renameResult.tag,
          affected: renameResult.summary,
        };
      }

      // ── Reports ──────────────────────────────────────────────────────────────
      case 'generateReport': {
        return await dispatchReport(toolInput, ctx);
      }

      case 'getWinLossPatterns': {
        return await getWinLossInsights();
      }

      case 'saveReport': {
        // Saves an NLI-generated analytic report to the Reports module under Custom Reports.
        // The config stores the NLI report parameters in the jsonb field so the Reports module
        // can display context about the saved report. (MINCRM-424)
        const rawDaysForSave = toolInput.days as number | undefined;
        const validDaysForSave = STAGE_TREND_DAYS_OPTIONS.includes(rawDaysForSave as 30 | 60 | 90)
          ? (rawDaysForSave as 30 | 60 | 90)
          : null;
        let savedReport: Awaited<ReturnType<typeof saveNliReport>>;
        try {
          savedReport = await saveNliReport(
            {
              name: toolInput.name as string,
              report_type: toolInput.report_type as
                | 'win_loss'
                | 'activity_volume'
                | 'stage_trend'
                | 'leads_summary',
              date_from: (toolInput.date_from as string | undefined) ?? null,
              date_to: (toolInput.date_to as string | undefined) ?? null,
              owner_id: (toolInput.owner_id as string | undefined) ?? null,
              days: validDaysForSave,
            },
            ctx.actor,
          );
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'CUSTOM_REPORT_NAME_CONFLICT') {
            return {
              error: {
                code: 'CUSTOM_REPORT_NAME_CONFLICT',
                message: (err as Error).message,
              },
            };
          }
          throw err;
        }
        return {
          saved: true,
          report_id: savedReport.id,
          name: savedReport.name,
        };
      }

      // ── Export ───────────────────────────────────────────────────────────────
      case 'exportEntities': {
        return await dispatchExport(toolInput, ctx);
      }

      // ── Admin: Pipelines ─────────────────────────────────────────────────────
      case 'listPipelines': {
        return await listPipelines();
      }

      case 'getPipeline': {
        const row = await findPipelineById(toolInput.id as string);
        return row ?? notFound('Pipeline', toolInput.id as string);
      }

      case 'listStages': {
        return await listPipelineStages(toolInput.pipeline_id as string);
      }

      // ── Admin: Custom Fields ─────────────────────────────────────────────────
      case 'listCustomFields': {
        return await listCustomFieldDefinitions(toolInput.entity_type as string);
      }

      // ── Admin: Automation Rules ──────────────────────────────────────────────
      case 'listAutomationRules': {
        return await listAutomationRules(
          asPage(toolInput.page),
          clampLimit(toolInput.limit as number | undefined),
        );
      }

      case 'getAutomationRule': {
        const row = await findAutomationRuleById(toolInput.id as string);
        return row ?? notFound('Automation Rule', toolInput.id as string);
      }

      // ── Admin: Webhooks ──────────────────────────────────────────────────────
      case 'listWebhooks': {
        // Strip secret_hash before returning to Claude — it is an encrypted signing
        // secret that must not be transmitted to the Anthropic API.
        const webhooks = await listWebhookSubscriptions();
        return webhooks.map(({ secret_hash: _omit, ...safe }) => safe);
      }

      // ── Admin: Email Templates ───────────────────────────────────────────────
      case 'listEmailTemplates': {
        return await listEmailTemplates({
          category: toolInput.category as string | undefined,
          enabled_only: (toolInput.enabled_only as boolean | undefined) ?? false,
          page: asPage(toolInput.page),
          limit: clampLimit(toolInput.limit as number | undefined),
        });
      }

      case 'getEmailTemplate': {
        const row = await findEmailTemplateById(toolInput.id as string);
        return row ?? notFound('Email Template', toolInput.id as string);
      }

      default:
        logger.warn({ toolName }, 'NLI tool executor received unknown tool name');
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    // Propagate auth failures as hard errors so the loop aborts cleanly.
    if (statusCode === 403 || statusCode === 401) throw err;

    // All other service errors are returned as structured error objects so Claude
    // can relay the message to the user gracefully.
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ toolName, err }, 'NLI tool call failed');
    return { error: message };
  }
}

// ── Private helpers ────────────────────────────────────────────────────────────

function notFound(entityLabel: string, id: string): { error: string } {
  return { error: `${entityLabel} not found: ${id}` };
}

function clampLimit(value: number | undefined | null, defaultValue = 20): number {
  if (value == null) return defaultValue;
  return Math.min(Math.max(1, Math.floor(value as number)), 100);
}

function asPage(value: unknown): number {
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function asDir(value: unknown): 'ASC' | 'DESC' {
  return String(value ?? '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
}

async function dispatchReport(
  toolInput: Record<string, unknown>,
  ctx: ToolCallContext,
): Promise<unknown> {
  const reportType = toolInput.report_type as string;
  // Reps can only report on themselves; admins may request any owner_id.
  const ownerId =
    ctx.userRole !== 'admin' ? ctx.userId : ((toolInput.owner_id as string | undefined) ?? null);
  const dateFrom = (toolInput.date_from as string | undefined) ?? thirtyDaysAgo();
  const dateTo = (toolInput.date_to as string | undefined) ?? today();

  switch (reportType) {
    case 'win_loss':
      // Inject report_type discriminator so NliResultBlock.extractReport can identify
      // the shape without fragile property-sniffing. (MINCRM-424)
      return {
        report_type: 'win_loss',
        ...(await getWinLossReport({ startDate: dateFrom, endDate: dateTo, ownerId })),
      };

    case 'activity_volume':
      return {
        report_type: 'activity_volume',
        ...(await getActivityVolumeReport({ startDate: dateFrom, endDate: dateTo, ownerId })),
      };

    case 'stage_trend': {
      const rawDays = toolInput.days as number | undefined;
      const days = STAGE_TREND_DAYS_OPTIONS.includes(rawDays as 30 | 60 | 90)
        ? (rawDays as 30 | 60 | 90)
        : 30;
      return {
        report_type: 'stage_trend',
        ...(await getStageTrendReport(days)),
      };
    }

    case 'leads_summary':
      return {
        report_type: 'leads_summary',
        ...(await getLeadsSummaryReport({ ownerId })),
      };

    default:
      return { error: `Report type '${reportType}' is not yet implemented in the NLI.` };
  }
}

async function dispatchExport(
  toolInput: Record<string, unknown>,
  ctx: ToolCallContext,
): Promise<unknown> {
  const entityType = toolInput.entity_type as string;
  const requestingUser = { id: ctx.userId, role: ctx.userRole };

  switch (entityType) {
    case 'contact':
      return {
        entity_type: 'contact',
        rows: await exportContactsForCsv({
          ownerId: toolInput.owner_id as string | undefined,
          search: toolInput.query as string | undefined,
          requestingUser,
        }),
      };

    case 'account': {
      // Reps see only their own accounts; admins may request any owner_id.
      const accountExportOwnerId =
        ctx.userRole !== 'admin' ? ctx.userId : (toolInput.owner_id as string | undefined);
      return {
        entity_type: 'account',
        rows: await exportAccountsForCsv({
          ownerId: accountExportOwnerId,
          search: toolInput.query as string | undefined,
        }),
      };
    }

    case 'deal':
      return {
        entity_type: 'deal',
        rows: await exportDealsForCsv({
          ownerId: toolInput.owner_id as string | undefined,
          requestingUser,
        }),
      };

    default:
      return { error: `Export not supported for entity type: ${entityType}` };
  }
}

/**
 * Verifies the calling user has access to a given CRM entity.
 *
 * For notes and read operations (requireWrite=false): reps must own the parent
 * record to read its notes.
 * For write operations (requireWrite=true): reps must own the record to mutate it.
 * Admins always pass.
 *
 * Throws a 403 error when access is denied; throws a 404-style error object
 * (non-throwing return) is not used here — the caller handles not-found itself.
 */
async function assertEntityAccess(
  entityType: NoteEntityType,
  entityId: string,
  ctx: ToolCallContext,
  requireWrite = false,
): Promise<void> {
  if (ctx.userRole === 'admin') return;

  let ownerId: string | undefined;

  switch (entityType) {
    case 'contact': {
      const row = await findContactById(entityId);
      ownerId = row?.owner_id;
      break;
    }
    case 'account': {
      const row = await findAccountById(entityId);
      ownerId = row?.owner_id;
      break;
    }
    case 'deal': {
      const row = await findDealById(entityId);
      ownerId = row?.owner_id;
      break;
    }
    case 'lead': {
      const row = await findLeadById(entityId);
      ownerId = row?.owner_id;
      break;
    }
    default:
      // Unknown entity type — deny access conservatively.
      throw Object.assign(new Error(`Unsupported entity type for access check: ${entityType}`), {
        statusCode: 403,
      });
  }

  if (ownerId !== ctx.userId) {
    const action = requireWrite ? 'update' : 'access';
    logger.warn(
      { entityType, entityId, userId: ctx.userId, userRole: ctx.userRole, requireWrite },
      `NLI permission denied: user cannot ${action} ${entityType} (MINCRM-434)`,
    );
    throw Object.assign(new Error(`You do not have permission to ${action} this ${entityType}`), {
      statusCode: 403,
    });
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function thirtyDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}
