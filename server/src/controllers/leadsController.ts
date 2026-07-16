/**
 * Leads controller — request/response shaping for lead endpoints.
 * No business logic here; all DB access goes through leadsService.
 * (MINCRM-173, MINCRM-174, MINCRM-175)
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  createLeadSchema,
  updateLeadSchema,
  convertLeadSchema,
} from '@minicrm/shared/schemas/leadSchema.js';
import { leadRoutingSuggestionRequestSchema } from '@minicrm/shared/schemas/leadRoutingSchema.js';
import {
  createLead,
  findLeadByEmail,
  findLeadById,
  listLeads,
  updateLead,
  deleteLead,
  getLeadStatusHistory,
  convertLead,
  searchAccountsForConversion,
  exportLeadsForCsv,
  LEAD_SORT_COLUMNS,
} from '../services/leadsService.js';
import type { LeadExportRow } from '../services/leadsService.js';
import { computeLeadRoutingSuggestion } from '../services/leadRoutingService.js';
import { getCoMemberIds } from '../services/teamService.js';
import { paginationParamsSchema } from '@minicrm/shared/schemas/paginationSchema.js';
import { findUserById } from '../services/userService.js';
import { serializeToCsv, csvFilename, formatExportDate } from '../utils/csvUtils.js';
import { listNotes } from '../services/noteService.js';
import { getBranding } from '../services/brandingService.js';
import {
  renderPdfDocument,
  setPdfResponseHeaders,
  pdfFilename,
  buildNotesTableSection,
  DETAIL_PDF_NOTES_LIMIT,
  type PdfTableColumn,
  type PdfTableRow,
} from '../services/pdfExportService.js';

const FORBIDDEN_OWNERSHIP_ERROR = {
  error: {
    code: 'FORBIDDEN',
    message:
      'You can only edit or delete records you own. Contact an admin to make changes to records owned by others.',
  },
};

/**
 * POST /api/leads
 * Creates a new lead owned by the authenticated user.
 * Returns 409 if a lead with the same email already exists (unless ?force=true).
 */
export async function createLeadHandler(req: Request, res: Response): Promise<void> {
  const parsed = createLeadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const force = req.query.force === 'true';

  if (!force) {
    const duplicate = await findLeadByEmail(parsed.data.email);
    if (duplicate) {
      res.status(409).json({
        error: { code: 'DUPLICATE_EMAIL', message: 'A lead with this email already exists' },
        duplicate: {
          id: duplicate.id,
          first_name: duplicate.first_name,
          last_name: duplicate.last_name,
          email: duplicate.email,
        },
      });
      return;
    }
  }

  const ownerId = parsed.data.owner_id ?? req.user!.id;

  const lead = await createLead(
    { ...parsed.data, owner_id: ownerId },
    { id: req.user!.id, name: req.user!.name },
  );
  res.status(201).json({ lead });
}

/**
 * POST /api/v1/leads/routing-suggestion
 * Computes a routing suggestion for a draft lead, before it is created.
 * Returns 204 (no body) when confidence would be low — per the AC, the
 * suggestion is suppressed and the client should default to unassigned.
 * (MINCRM-475)
 */
export async function getLeadRoutingSuggestionHandler(req: Request, res: Response): Promise<void> {
  const parsed = leadRoutingSuggestionRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const suggestion = await computeLeadRoutingSuggestion({
    territory: parsed.data.territory ?? null,
    industry: parsed.data.industry ?? null,
    employeeRange: parsed.data.employee_range ?? null,
    leadSource: parsed.data.lead_source ?? null,
  });

  if (!suggestion) {
    res.status(204).send();
    return;
  }

  res.status(200).json(suggestion);
}

/**
 * GET /api/leads
 * Lists leads with optional filters and pagination.
 *   ?owner=me                — scope to authenticated user's leads
 *   ?status=<status>        — filter by status
 *   ?lead_source=<source>   — filter by lead source
 *   ?includeDisqualified=true — include Disqualified leads
 *   ?includeConverted=true  — include converted leads
 *   ?sort=<col>             — sort column
 *   ?dir=asc|desc           — sort direction
 *   ?page=<n>               — 1-based page (default 1)
 *   ?limit=<n>              — records per page (default 50)
 */
export async function listLeadsHandler(req: Request, res: Response): Promise<void> {
  const ownerParam = typeof req.query.owner === 'string' ? req.query.owner : undefined;
  const ownerId = ownerParam === 'me' ? req.user!.id : undefined;
  const ownerIds = ownerParam === 'my_team' ? await getCoMemberIds(req.user!.id) : undefined;

  const status =
    typeof req.query.status === 'string' && req.query.status.trim().length > 0
      ? req.query.status.trim()
      : undefined;

  const lead_source =
    typeof req.query.lead_source === 'string' && req.query.lead_source.trim().length > 0
      ? req.query.lead_source.trim()
      : undefined;

  const includeDisqualified = req.query.includeDisqualified === 'true';
  const includeConverted = req.query.includeConverted === 'true';

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
  const sort = (LEAD_SORT_COLUMNS as readonly string[]).includes(sortRaw)
    ? (sortRaw as (typeof LEAD_SORT_COLUMNS)[number])
    : undefined;
  const dir = req.query.dir === 'asc' ? ('ASC' as const) : ('DESC' as const);

  const result = await listLeads({
    ownerId,
    ownerIds,
    status,
    lead_source,
    includeDisqualified,
    includeConverted,
    sort,
    dir,
    ...paginationParsed.data,
  });
  res.status(200).json(result);
}

/**
 * GET /api/leads/:id
 * Returns a single lead by ID.
 */
export async function getLeadHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const lead = await findLeadById(id);
  if (!lead) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Lead not found' } });
    return;
  }
  res.status(200).json({ lead });
}

/**
 * GET /api/leads/:id/export.pdf
 * Renders a single lead as a one-record summary PDF, mirroring the data shown
 * on the lead detail page. Visibility matches getLeadHandler — no ownership
 * restriction on read, consistent with GET /api/leads/:id.
 *
 * Leads do not support custom fields (ENTITY_TYPES excludes 'lead'), so unlike
 * the Deal/Account/Contact single-record PDFs, this omits a Custom Fields
 * section. (MINCRM-650)
 */
export async function exportLeadPdfHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const lead = await findLeadById(id);

  if (!lead) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Lead not found' } });
    return;
  }

  const [owner, notesPage] = await Promise.all([
    findUserById(lead.owner_id),
    listNotes('lead', id, req.user!.id, 1, DETAIL_PDF_NOTES_LIMIT),
  ]);

  const overviewLines: string[] = [
    `Name: ${lead.first_name} ${lead.last_name ?? ''}`.trim(),
    `Email: ${lead.email}`,
    `Phone: ${lead.phone ?? ''}`,
    `Company: ${lead.company_name ?? ''}`,
    `Source: ${lead.lead_source ?? ''}`,
    `Status: ${lead.status}`,
    `Disqualification Reason: ${lead.disqualification_reason ?? ''}`,
    `Notes: ${lead.notes ?? ''}`,
    `Owner: ${owner?.name ?? ''}`,
    `Converted: ${lead.converted_at ? formatExportDate(lead.converted_at) : ''}`,
    `Created: ${formatExportDate(lead.created_at)}`,
    `Updated: ${formatExportDate(lead.updated_at)}`,
  ];

  const branding = await getBranding();
  setPdfResponseHeaders(res, pdfFilename(`lead-${id}`));
  await renderPdfDocument(
    res,
    {
      title: `Lead: ${lead.first_name} ${lead.last_name ?? ''}`.trim(),
      sections: [
        { heading: 'Overview', lines: overviewLines },
        buildNotesTableSection(notesPage.data),
      ],
    },
    branding,
  );
}

/** Base CSV/PDF column headers for the leads list export, in display order */
const LEAD_EXPORT_HEADERS = [
  'First Name',
  'Last Name',
  'Email',
  'Phone',
  'Company',
  'Source',
  'Status',
  'Owner',
  'Created',
  'Updated',
] as const;

function toLeadExportRow(lead: LeadExportRow): Record<string, string | Date | null> {
  return {
    'First Name': lead.first_name,
    'Last Name': lead.last_name,
    Email: lead.email,
    Phone: lead.phone,
    Company: lead.company_name,
    Source: lead.lead_source,
    Status: lead.status,
    Owner: lead.owner_name,
    Created: lead.created_at,
    Updated: lead.updated_at,
  };
}

/**
 * Resolves the owner/status/source/visibility filters for the current request
 * and fetches matching leads. Shared by the CSV and PDF export handlers so
 * both formats reflect identical rows and ownership rules, mirroring
 * listLeadsHandler's filter resolution. (MINCRM-651)
 */
async function resolveLeadExportRows(req: Request): Promise<LeadExportRow[]> {
  const isAdmin = req.user!.role === 'admin';
  const exportAll = isAdmin && req.query.all === 'true';

  const ownerParam = typeof req.query.owner === 'string' ? req.query.owner : undefined;
  const ownerId = !exportAll && ownerParam === 'me' ? req.user!.id : undefined;
  const ownerIds =
    !exportAll && ownerParam === 'my_team' ? await getCoMemberIds(req.user!.id) : undefined;

  const status =
    typeof req.query.status === 'string' && req.query.status.trim().length > 0
      ? req.query.status.trim()
      : undefined;

  const lead_source =
    typeof req.query.lead_source === 'string' && req.query.lead_source.trim().length > 0
      ? req.query.lead_source.trim()
      : undefined;

  const includeDisqualified = req.query.includeDisqualified === 'true';
  const includeConverted = req.query.includeConverted === 'true';

  return exportLeadsForCsv({
    ownerId,
    ownerIds,
    status,
    lead_source,
    includeDisqualified,
    includeConverted,
  });
}

/**
 * GET /api/leads/export
 * Streams all matching leads as a UTF-8 CSV file.
 *
 * Query params mirror the list endpoint (owner, status, lead_source,
 * includeDisqualified, includeConverted) except pagination/sort — all
 * matching rows are exported. Reps get leads visible to them per the owner
 * param; admins may pass ?all=true to export every lead. (MINCRM-651)
 */
export async function exportLeadsHandler(req: Request, res: Response): Promise<void> {
  const leads = await resolveLeadExportRows(req);
  const rows = leads.map(toLeadExportRow);

  const csv = serializeToCsv([...LEAD_EXPORT_HEADERS], rows);
  const filename = csvFilename('leads');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
}

/**
 * GET /api/leads/export.pdf
 * Renders all matching leads as a paginated PDF table.
 *
 * Query params and ownership rules are identical to the CSV export above. (MINCRM-651)
 */
export async function exportLeadsPdfHandler(req: Request, res: Response): Promise<void> {
  const leads = await resolveLeadExportRows(req);

  const columns: PdfTableColumn[] = LEAD_EXPORT_HEADERS.map((label) => ({ key: label, label }));
  const rows: PdfTableRow[] = leads.map(toLeadExportRow);

  const branding = await getBranding();
  setPdfResponseHeaders(res, pdfFilename('leads'));
  await renderPdfDocument(
    res,
    {
      title: 'Leads',
      sections: [
        {
          heading: 'Leads',
          table: { columns, rows, emptyMessage: 'No leads match the current filters.' },
        },
      ],
    },
    branding,
  );
}

/**
 * PATCH /api/leads/:id
 * Updates one or more fields of an existing lead.
 * Reps may only update leads they own; admins may update any lead.
 */
export async function updateLeadHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateLeadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const id = String(req.params['id']);
  const existing = await findLeadById(id);
  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Lead not found' } });
    return;
  }

  if (existing.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json(FORBIDDEN_OWNERSHIP_ERROR);
    return;
  }

  let lead;
  try {
    lead = await updateLead(id, parsed.data, { id: req.user!.id, name: req.user!.name });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'OPTIMISTIC_LOCK_CONFLICT') {
      // Include current server state so the client can render a three-way merge without a second round-trip (MINCRM-351)
      const current = await findLeadById(id);
      res.status(409).json({ error: { code, message: (err as Error).message, current } });
      return;
    }
    throw err;
  }
  res.status(200).json({ lead });
}

/**
 * DELETE /api/leads/:id
 * Deletes a lead. Returns 204 No Content on success.
 * Reps may only delete leads they own; admins may delete any lead.
 */
export async function deleteLeadHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const existing = await findLeadById(id);
  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Lead not found' } });
    return;
  }

  if (existing.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json(FORBIDDEN_OWNERSHIP_ERROR);
    return;
  }

  await deleteLead(id, { id: req.user!.id, name: req.user!.name });
  res.status(204).send();
}

/**
 * GET /api/leads/:id/status-history
 * Returns the status change history for a lead. (MINCRM-174)
 */
export async function getLeadStatusHistoryHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const lead = await findLeadById(id);
  if (!lead) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Lead not found' } });
    return;
  }

  const history = await getLeadStatusHistory(id);
  res.status(200).json({ history });
}

/**
 * POST /api/leads/:id/convert
 * Atomically converts a lead into a contact, account, and deal. (MINCRM-175)
 * Lead must not be Disqualified or already converted.
 */
export async function convertLeadHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);

  const parsed = convertLeadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const existing = await findLeadById(id);
  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Lead not found' } });
    return;
  }

  if (existing.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json(FORBIDDEN_OWNERSHIP_ERROR);
    return;
  }

  try {
    const result = await convertLead(id, parsed.data, {
      id: req.user!.id,
      name: req.user!.name,
    });
    res.status(201).json({ conversion: result });
  } catch (err) {
    const error = err as Error & { code?: string };
    if (error.code === 'NOT_FOUND') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: error.message } });
    } else if (error.code === 'ALREADY_CONVERTED') {
      res.status(409).json({ error: { code: 'ALREADY_CONVERTED', message: error.message } });
    } else if (error.code === 'DISQUALIFIED') {
      res.status(422).json({ error: { code: 'DISQUALIFIED', message: error.message } });
    } else if (error.code === 'ACCOUNT_NOT_FOUND') {
      res.status(400).json({ error: { code: 'ACCOUNT_NOT_FOUND', message: error.message } });
    } else {
      throw err;
    }
  }
}

/**
 * GET /api/leads/accounts/search
 * Searches accounts by name for the conversion form. (MINCRM-175)
 */
export async function searchAccountsHandler(req: Request, res: Response): Promise<void> {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 1) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'q query parameter is required' },
    });
    return;
  }

  const accounts = await searchAccountsForConversion(q);
  res.status(200).json({ accounts });
}

/**
 * Validates a UUID query param and returns it or null.
 */
function _parseUuidParam(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = z.string().uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}

// keep linter happy — _parseUuidParam is intentionally defined for future use
void _parseUuidParam;
