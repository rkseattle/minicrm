/**
 * Deal controller — request/response shaping for deal endpoints.
 * No business logic here; all DB access goes through dealService.
 */

import type { Request, Response } from 'express';
import { createDealSchema, updateDealSchema } from '@minicrm/shared/schemas/dealSchema.js';
import {
  createDeal,
  findDealById,
  listDeals,
  updateDeal,
  deleteDeal,
  listDealContacts,
  linkContactToDeal,
  unlinkContactFromDeal,
  exportDealsForCsv,
  DEAL_SORT_COLUMNS,
} from '../services/dealService.js';
import { getStageNames, getTerminalStageNames } from '../services/pipelineStageService.js';
import { findPipelineById } from '../services/pipelineService.js';
import { findContactById } from '../services/contactService.js';
import { findAccountById } from '../services/accountService.js';
import { getCoMemberIds } from '../services/teamService.js';
import { paginationParamsSchema } from '@minicrm/shared/schemas/paginationSchema.js';
import { findUserById } from '../services/userService.js';
import { queueAssignmentNotification } from '../services/notificationService.js';
import { serializeToCsv, csvFilename, formatExportDate } from '../utils/csvUtils.js';
import { listDefinitions, getValuesForRecord } from '../services/customFieldService.js';
import { listNotes } from '../services/noteService.js';
import { getBranding } from '../services/brandingService.js';
import {
  renderPdfDocument,
  setPdfResponseHeaders,
  pdfFilename,
  buildContactsTableSection,
  buildNotesTableSection,
  DETAIL_PDF_NOTES_LIMIT,
  type PdfTableColumn,
  type PdfTableRow,
} from '../services/pdfExportService.js';
import { z } from 'zod';

const FORBIDDEN_OWNERSHIP_ERROR = {
  error: {
    code: 'FORBIDDEN',
    message:
      'You can only edit or delete records you own. Contact an admin to make changes to records owned by others.',
  },
};

/**
 * POST /api/deals
 * Creates a new deal owned by the authenticated user.
 */
export async function createDealHandler(req: Request, res: Response): Promise<void> {
  const parsed = createDealSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  // Validate stage against live pipeline_stages table for the specified pipeline (MINCRM-180, MINCRM-397)
  const validStages = await getStageNames(parsed.data.pipeline_id);
  if (!validStages.includes(parsed.data.stage)) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: `Invalid stage: "${parsed.data.stage}"` },
    });
    return;
  }

  const deal = await createDeal(
    { ...parsed.data, owner_id: req.user!.id },
    { id: req.user!.id, name: req.user!.name },
  );
  res.status(201).json({ deal });
}

/**
 * GET /api/deals
 * Lists deals with optional filters and pagination:
 *   ?owner=me         — scope to the authenticated user's deals
 *   ?account=<uuid>   — filter by account UUID
 *   ?hideClosed=true  — exclude Closed Won and Closed Lost deals (MINCRM-176)
 *   ?sort=<col>       — sort column (created_at|name|close_date|value)
 *   ?dir=asc|desc     — sort direction
 *   ?page=<n>         — 1-based page number (default 1)
 *   ?limit=<n>        — records per page (default 50, max 100)
 */
export async function listDealsHandler(req: Request, res: Response): Promise<void> {
  const ownerParam = typeof req.query.owner === 'string' ? req.query.owner : undefined;
  const ownerId = ownerParam === 'me' ? req.user!.id : undefined;
  const ownerIds = ownerParam === 'my_team' ? await getCoMemberIds(req.user!.id) : undefined;
  const accountId =
    typeof req.query.account === 'string' && req.query.account ? req.query.account : undefined;
  const excludeClosedStages = req.query.hideClosed === 'true';

  const paginationParsed = paginationParamsSchema.safeParse({
    page: req.query.page,
    limit: req.query.limit,
  });
  if (!paginationParsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: paginationParsed.error.errors[0].message },
    });
    return;
  }

  const sortRaw = typeof req.query.sort === 'string' ? req.query.sort : '';
  const sort = (DEAL_SORT_COLUMNS as readonly string[]).includes(sortRaw)
    ? (sortRaw as (typeof DEAL_SORT_COLUMNS)[number])
    : undefined;
  const dir = req.query.dir === 'desc' ? ('DESC' as const) : ('ASC' as const);

  // Tag filter (MINCRM-186): ?tags=uuid,uuid — comma-separated tag IDs (any-match)
  const tagIds =
    typeof req.query.tags === 'string' && req.query.tags.trim().length > 0
      ? req.query.tags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

  // Optional ?pipelineId= filters the board to a specific pipeline (MINCRM-397)
  const pipelineId =
    typeof req.query['pipelineId'] === 'string' && req.query['pipelineId'].length > 0
      ? req.query['pipelineId']
      : undefined;

  const result = await listDeals({
    ownerId,
    ownerIds,
    accountId,
    excludeClosedStages,
    pipelineId,
    sort,
    dir,
    tagIds,
    ...paginationParsed.data,
    requestingUser: { id: req.user!.id, role: req.user!.role },
  });
  res.status(200).json(result);
}

/**
 * GET /api/deals/:id
 * Returns a single deal by ID, including its linked contacts.
 */
export async function getDealHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const deal = await findDealById(id);

  if (!deal) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Deal not found' } });
    return;
  }

  const contacts = await listDealContacts(id);
  res.status(200).json({ deal, contacts });
}

/**
 * PATCH /api/deals/:id
 * Updates one or more fields of an existing deal.
 * Reps may only update deals they own; admins may update any deal.
 */
export async function updateDealHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateDealSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const id = String(req.params['id']);
  const existing = await findDealById(id);

  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Deal not found' } });
    return;
  }

  if (existing.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json(FORBIDDEN_OWNERSHIP_ERROR);
    return;
  }

  // When pipeline_id is changing, validate the target pipeline exists (MINCRM-408)
  if (parsed.data.pipeline_id !== undefined && parsed.data.pipeline_id !== existing.pipeline_id) {
    const targetPipeline = await findPipelineById(parsed.data.pipeline_id);
    if (!targetPipeline) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Pipeline not found' },
      });
      return;
    }
    // Stage is required when changing pipeline — the current stage may not exist in the new pipeline
    if (parsed.data.stage === undefined) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Stage is required when changing pipeline' },
      });
      return;
    }
  }

  // Validate stage against the target pipeline (incoming pipeline_id if changing, existing otherwise).
  // (MINCRM-180, MINCRM-397, MINCRM-408)
  const effectivePipelineId = parsed.data.pipeline_id ?? existing.pipeline_id;
  if (parsed.data.stage !== undefined) {
    const validStages = await getStageNames(effectivePipelineId);
    if (!validStages.includes(parsed.data.stage)) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: `Invalid stage: "${parsed.data.stage}"` },
      });
      return;
    }
  }

  // MINCRM-121: reject a future close_date even when stage is not in the payload —
  // use existing.stage to determine if the deal is already in a terminal stage.
  // Use live terminal stage list so custom terminal stages are respected (MINCRM-180, MINCRM-397, MINCRM-408).
  if (parsed.data.close_date) {
    const stageForTerminalCheck = parsed.data.stage ?? existing.stage;
    const today = new Date().toISOString().split('T')[0];
    const terminalStages = await getTerminalStageNames(effectivePipelineId);
    if (terminalStages.includes(stageForTerminalCheck) && parsed.data.close_date > today) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Close date cannot be in the future' },
      });
      return;
    }
  }

  let deal;
  try {
    deal = await updateDeal(id, parsed.data, { id: req.user!.id, name: req.user!.name }, existing, {
      id: req.user!.id,
      role: req.user!.role,
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'OPTIMISTIC_LOCK_CONFLICT') {
      // Include current server state so the client can render a three-way merge without a second round-trip (MINCRM-351)
      const current = await findDealById(id);
      res.status(409).json({ error: { code, message: (err as Error).message, current } });
      return;
    }
    if (code === 'REASSIGNMENT_NOT_PERMITTED') {
      res.status(403).json({ error: { code, message: (err as Error).message } });
      return;
    }
    if (code === 'STAGE_EXIT_REQUIREMENTS_NOT_MET') {
      // Return the missing fields so the client can present a targeted error or warning. (MINCRM-527)
      const typedErr = err as Error & {
        missing_fields: string[];
        warning_fields: string[];
        severity: 'error' | 'warning';
      };
      res.status(400).json({
        error: {
          code,
          message: typedErr.message,
          missing_fields: typedErr.missing_fields,
          warning_fields: typedErr.warning_fields,
          severity: typedErr.severity,
        },
      });
      return;
    }
    throw err;
  }
  if (!deal) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Deal not found' } });
    return;
  }
  res.status(200).json({ deal });

  // Fire-and-forget: notify the new owner when the deal is reassigned. (MINCRM-162)
  if (parsed.data.owner_id !== undefined && parsed.data.owner_id !== existing.owner_id) {
    void (async () => {
      try {
        const newOwner = await findUserById(parsed.data.owner_id!);
        if (newOwner && newOwner.notify_assignments) {
          queueAssignmentNotification(newOwner.id, newOwner.email, newOwner.name, {
            recordType: 'deal',
            recordName: deal.name,
            recordPath: `/deals/${deal.id}`,
            assignedByName: req.user!.name,
          });
        }
      } catch {
        // Swallow — notification failure must not affect the response
      }
    })();
  }
}

/**
 * POST /api/deals/:id/contacts/:contactId
 * Links a contact to a deal.
 * Returns the updated contacts list for the deal.
 */
export async function linkContactHandler(req: Request, res: Response): Promise<void> {
  const dealId = String(req.params['id']);
  const contactId = String(req.params['contactId']);

  const deal = await findDealById(dealId);
  if (!deal) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Deal not found' } });
    return;
  }

  if (deal.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json(FORBIDDEN_OWNERSHIP_ERROR);
    return;
  }

  const contact = await findContactById(contactId);
  if (!contact) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contact not found' } });
    return;
  }

  await linkContactToDeal(dealId, contactId);
  const contacts = await listDealContacts(dealId);
  res.status(200).json({ contacts });
}

/**
 * DELETE /api/deals/:id/contacts/:contactId
 * Unlinks a contact from a deal without deleting either record.
 * Returns the updated contacts list for the deal.
 */
export async function unlinkContactHandler(req: Request, res: Response): Promise<void> {
  const dealId = String(req.params['id']);
  const contactId = String(req.params['contactId']);

  const deal = await findDealById(dealId);
  if (!deal) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Deal not found' } });
    return;
  }

  if (deal.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json(FORBIDDEN_OWNERSHIP_ERROR);
    return;
  }

  await unlinkContactFromDeal(dealId, contactId);
  const contacts = await listDealContacts(dealId);
  res.status(200).json({ contacts });
}

/**
 * DELETE /api/deals/:id
 * Deletes a deal. Linked contacts and accounts are not affected.
 * Returns 204 No Content on success.
 * Reps may only delete deals they own; admins may delete any deal.
 */
export async function deleteDealHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const existing = await findDealById(id);

  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Deal not found' } });
    return;
  }

  if (existing.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json(FORBIDDEN_OWNERSHIP_ERROR);
    return;
  }

  await deleteDeal(id, { id: req.user!.id, name: req.user!.name }, existing.name);
  res.status(204).send();
}

/** Column labels shared by the CSV and PDF deal export formats, in display order. */
const DEAL_EXPORT_BASE_HEADERS = [
  'Name',
  'Stage',
  'Value',
  'Currency',
  'Close Date',
  'Loss Reason',
  'Account',
  'Contacts',
  'Owner',
  'Created',
  'Updated',
] as const;

interface DealExportData {
  headers: string[];
  rows: Record<string, string | number | Date | null | undefined>[];
}

/**
 * Resolves the owner/account filters for the current request, fetches matching deals,
 * and merges in custom field columns. Shared by the CSV and PDF export handlers so both
 * formats reflect identical rows and ownership rules (MINCRM-601).
 *
 * @returns null if the request had an invalid `account` param; the response has already
 * been written to in that case and the caller must return without further writes.
 */
async function resolveDealExportData(req: Request, res: Response): Promise<DealExportData | null> {
  const orgWideRead = req.user!.role === 'admin' || req.user!.role === 'viewer';
  const exportAll = req.query.all === 'true';

  // Org-wide readers (admin/viewer): export all when ?all=true, otherwise own records only.
  // All other roles (rep, manager): apply visibility filter via requestingUser so managers
  // get team-scoped results matching what they see in the list view (MINCRM-534).
  const ownerId = orgWideRead && !exportAll ? req.user!.id : undefined;
  const requestingUser = !orgWideRead ? { id: req.user!.id, role: req.user!.role } : undefined;

  let accountId: string | undefined;
  if (typeof req.query.account === 'string' && req.query.account.length > 0) {
    const parsed = z.string().uuid().safeParse(req.query.account);
    if (!parsed.success) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'account must be a valid UUID' },
      });
      return null;
    }
    accountId = parsed.data;
  }

  const dealRows = await exportDealsForCsv({ ownerId, accountId, requestingUser });

  // Custom field columns — fetch definitions and values in application code (MINCRM-276)
  const customDefs = await listDefinitions('deal');
  const recordIds = dealRows.map((r) => r.id);
  const valuesByRecord = new Map<string, Map<string, string | null>>();
  await Promise.all(
    recordIds.map(async (recordId) => {
      const vals = await getValuesForRecord(recordId);
      const byDef = new Map<string, string | null>();
      for (const v of vals) {
        byDef.set(v.definition_id, v.value);
      }
      valuesByRecord.set(recordId, byDef);
    }),
  );

  const headers = [...DEAL_EXPORT_BASE_HEADERS, ...customDefs.map((d) => d.name)];

  const rows = dealRows.map((r) => {
    const base: Record<string, string | number | Date | null | undefined> = {
      Name: r.name,
      Stage: r.stage,
      Value: r.value,
      Currency: r.currency,
      'Close Date': r.close_date,
      'Loss Reason': r.loss_reason,
      Account: r.account_name,
      Contacts: r.contact_names,
      Owner: r.owner_name,
      Created: r.created_at,
      Updated: r.updated_at,
    };
    const recordVals = valuesByRecord.get(r.id);
    for (const def of customDefs) {
      base[def.name] = recordVals?.get(def.id) ?? '';
    }
    return base;
  });

  return { headers, rows };
}

/**
 * GET /api/deals/export
 * Streams all matching deals as a UTF-8 CSV file.
 *
 * Query params mirror the list endpoint (owner, account) except pagination/sort.
 * Reps automatically get their own deals; admins may pass ?all=true to export all.
 * (MINCRM-166)
 */
export async function exportDealsHandler(req: Request, res: Response): Promise<void> {
  const data = await resolveDealExportData(req, res);
  if (!data) return;

  const csv = serializeToCsv(data.headers, data.rows);
  const filename = csvFilename('deals');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
}

/**
 * GET /api/deals/export.pdf
 * Renders all matching deals as a paginated PDF table.
 *
 * Query params and ownership rules are identical to the CSV export above (MINCRM-601).
 */
/** PDF-only: numeric columns rendered right-aligned instead of left-aligned like text. (MINCRM-655) */
const DEAL_PDF_NUMERIC_COLUMNS = new Set(['Value']);

/**
 * PDF-only: columns useful in CSV/spreadsheet form but low-value in a printed
 * table, dropped once the 11-base-column export (plus any custom fields) exceeds
 * WIDE_TABLE_COLUMN_THRESHOLD. CSV export is unaffected. (follow-up)
 */
const DEAL_PDF_LOW_PRIORITY_COLUMNS = new Set(['Loss Reason', 'Created', 'Updated']);

export async function exportDealsPdfHandler(req: Request, res: Response): Promise<void> {
  const data = await resolveDealExportData(req, res);
  if (!data) return;

  const columns: PdfTableColumn[] = data.headers.map((label) => ({
    key: label,
    label,
    align: DEAL_PDF_NUMERIC_COLUMNS.has(label) ? 'right' : undefined,
    lowPriority: DEAL_PDF_LOW_PRIORITY_COLUMNS.has(label),
  }));
  const rows: PdfTableRow[] = data.rows;

  const branding = await getBranding();
  setPdfResponseHeaders(res, pdfFilename('deals'));
  await renderPdfDocument(
    res,
    {
      title: 'Deals',
      sections: [
        {
          heading: 'Deals',
          table: { columns, rows, emptyMessage: 'No deals match the current filters.' },
        },
      ],
    },
    branding,
  );
}

/**
 * GET /api/deals/:id/export.pdf
 * Renders a single deal as a one-record summary PDF, mirroring the data shown
 * on the deal detail page. Visibility matches getDealHandler — no ownership
 * restriction on read, consistent with GET /api/deals/:id. (MINCRM-650)
 */
export async function exportDealPdfHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const deal = await findDealById(id);

  if (!deal) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Deal not found' } });
    return;
  }

  const [account, owner, contacts, customValues, notesPage] = await Promise.all([
    deal.account_id ? findAccountById(deal.account_id) : Promise.resolve(null),
    findUserById(deal.owner_id),
    listDealContacts(id),
    getValuesForRecord(id),
    listNotes('deal', id, req.user!.id, 1, DETAIL_PDF_NOTES_LIMIT),
  ]);

  const overviewLines: string[] = [
    `Name: ${deal.name}`,
    `Stage: ${deal.stage}`,
    `Value: ${deal.value ?? ''} ${deal.currency}`,
    `Close Date: ${deal.close_date ?? ''}`,
    `Loss Reason: ${deal.loss_reason ?? ''}`,
    `Account: ${account?.name ?? ''}`,
    `Owner: ${owner?.name ?? ''}`,
    `Created: ${formatExportDate(deal.created_at)}`,
    `Updated: ${formatExportDate(deal.updated_at)}`,
  ];

  const customFieldLines = customValues.map((v) => `${v.definition.name}: ${v.value ?? ''}`);

  const branding = await getBranding();
  setPdfResponseHeaders(res, pdfFilename(`deal-${id}`));
  await renderPdfDocument(
    res,
    {
      title: `Deal: ${deal.name}`,
      sections: [
        { heading: 'Overview', lines: overviewLines },
        {
          heading: 'Custom Fields',
          lines: customFieldLines,
          emptyMessage: 'No custom fields defined.',
        },
        buildContactsTableSection(contacts),
        buildNotesTableSection(notesPage.data),
      ],
    },
    branding,
  );
}
