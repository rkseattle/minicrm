/**
 * Account controller — request/response shaping for account endpoints.
 * No business logic here; all DB access goes through accountService.
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  createAccountSchema,
  updateAccountSchema,
  ACCOUNT_TYPE_VALUES,
} from '@minicrm/shared/schemas/accountSchema.js';
import {
  ACCOUNT_HEALTH_LIST_FILTER_STATES,
  type AccountHealthListFilterState,
} from '@minicrm/shared/schemas/accountHealthScoreSchema.js';
import {
  createAccount,
  findAccountById,
  findAccountByExactName,
  listAccounts,
  updateAccount,
  deleteAccount,
  exportAccountsForCsv,
  listChildAccounts,
  searchAccounts,
  ACCOUNT_SORT_COLUMNS,
} from '../services/accountService.js';
import { listContacts } from '../services/contactService.js';
import { getCoMemberIds } from '../services/teamService.js';
import { canAccessOwnedRecord } from '../services/visibilityService.js';
import {
  paginationParamsSchema,
  PAGINATION_MAX_LIMIT,
} from '@minicrm/shared/schemas/paginationSchema.js';
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
import { recordPath } from '@minicrm/shared/types/recordPath.js';

const FORBIDDEN_OWNERSHIP_ERROR = {
  error: {
    code: 'FORBIDDEN',
    message:
      'You can only edit or delete records you own. Contact an admin to make changes to records owned by others.',
  },
};

/**
 * POST /api/v1/accounts
 * Creates a new account owned by the authenticated user.
 *
 * If an account with the same name already exists (case-insensitive), returns
 * 409 with the duplicate account's id and name unless the request includes
 * ?force=true, which bypasses the duplicate check.
 */
export async function createAccountHandler(req: Request, res: Response): Promise<void> {
  const parsed = createAccountSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const force = req.query.force === 'true';

  if (!force) {
    // Note: same narrow TOCTOU window as the contact duplicate check — acceptable
    // for alpha scope, matching the existing contact create pattern.
    const duplicate = await findAccountByExactName(parsed.data.name);
    if (duplicate) {
      res.status(409).json({
        error: { code: 'DUPLICATE_NAME', message: 'An account with this name already exists' },
        duplicate: { id: duplicate.id, name: duplicate.name },
      });
      return;
    }
  }

  try {
    const account = await createAccount(
      { ...parsed.data, owner_id: req.user!.id },
      { id: req.user!.id, name: req.user!.name },
    );
    res.status(201).json({ account });
  } catch (err) {
    const linkCode = (err as { code?: string }).code;
    if (linkCode === 'CONTACT_LINKED_ELSEWHERE' || linkCode === 'CONTACT_NOT_LINKABLE') {
      res.status(409).json({ error: { code: linkCode, message: (err as Error).message } });
      return;
    }
    throw err;
  }
}

/**
 * GET /api/v1/accounts
 * Lists accounts with optional filters and pagination:
 *   ?owner=me        — scope to the authenticated user's accounts
 *   ?search=<text>   — case-insensitive substring match on account name
 *   ?industry=<text> — case-insensitive match on industry field
 *   ?sort=<col>      — sort column (created_at|name)
 *   ?dir=asc|desc    — sort direction
 *   ?page=<n>        — 1-based page number (default 1)
 *   ?limit=<n>       — records per page (default 50, max 100)
 */
export async function listAccountsHandler(req: Request, res: Response): Promise<void> {
  const ownerParam = typeof req.query.owner === 'string' ? req.query.owner : undefined;
  const ownerId = ownerParam === 'me' ? req.user!.id : undefined;
  const ownerIds = ownerParam === 'my_team' ? await getCoMemberIds(req.user!.id) : undefined;

  const search =
    typeof req.query.search === 'string' && req.query.search.trim().length > 0
      ? req.query.search.trim()
      : undefined;

  const industry =
    typeof req.query.industry === 'string' && req.query.industry.trim().length > 0
      ? req.query.industry.trim()
      : undefined;

  // account_type filter — validate against allowlist
  const accountTypeRaw =
    typeof req.query.account_type === 'string' && req.query.account_type.trim().length > 0
      ? req.query.account_type.trim()
      : undefined;
  const accountType =
    accountTypeRaw !== undefined &&
    (ACCOUNT_TYPE_VALUES as readonly string[]).includes(accountTypeRaw)
      ? (accountTypeRaw as (typeof ACCOUNT_TYPE_VALUES)[number])
      : undefined;

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
  const sort = (ACCOUNT_SORT_COLUMNS as readonly string[]).includes(sortRaw)
    ? (sortRaw as (typeof ACCOUNT_SORT_COLUMNS)[number])
    : undefined;
  const dir = req.query.dir === 'desc' ? ('DESC' as const) : ('ASC' as const);

  // Tag filter: ?tags=uuid,uuid — comma-separated tag IDs (any-match)
  const tagIds =
    typeof req.query.tags === 'string' && req.query.tags.trim().length > 0
      ? req.query.tags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

  // Relationship health filter: ?health_status=at_risk,dormant — allowlist-validated
  const healthStatuses =
    typeof req.query.health_status === 'string' && req.query.health_status.trim().length > 0
      ? req.query.health_status
          .split(',')
          .map((s) => s.trim())
          .filter((s): s is AccountHealthListFilterState =>
            (ACCOUNT_HEALTH_LIST_FILTER_STATES as readonly string[]).includes(s),
          )
      : undefined;

  const result = await listAccounts({
    ownerId,
    ownerIds,
    search,
    industry,
    accountType,
    sort,
    dir,
    tagIds,
    healthStatuses,
    ...paginationParsed.data,
  });
  res.status(200).json(result);
}

/**
 * GET /api/v1/accounts/:id
 * Returns a single account by ID, subject to the org's account visibility policy.
 */
export async function getAccountHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const account = await findAccountById(id);

  if (!account) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } });
    return;
  }

  const canAccess = await canAccessOwnedRecord(
    'account',
    account.owner_id,
    req.user!.id,
    req.user!.role,
  );
  if (!canAccess) {
    res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'You do not have visibility into this account.',
      },
    });
    return;
  }

  res.status(200).json({ account });
}

/**
 * PATCH /api/v1/accounts/:id
 * Updates one or more fields of an existing account.
 * Reps may only update accounts they own; admins may update any account.
 */
export async function updateAccountHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateAccountSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const id = String(req.params['id']);
  const existing = await findAccountById(id);

  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } });
    return;
  }

  if (existing.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json(FORBIDDEN_OWNERSHIP_ERROR);
    return;
  }

  let account;
  try {
    account = await updateAccount(
      id,
      parsed.data,
      { id: req.user!.id, name: req.user!.name },
      existing,
    );
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'CIRCULAR_PARENT') {
      res.status(400).json({ error: { code, message: (err as Error).message } });
      return;
    }
    if (code === 'CONTACT_LINKED_ELSEWHERE' || code === 'CONTACT_NOT_LINKABLE') {
      res.status(409).json({
        error: { code, message: (err as Error).message },
      });
      return;
    }
    if (code === 'OPTIMISTIC_LOCK_CONFLICT') {
      // Include current server state so the client can render a three-way merge without a second round-trip
      const current = await findAccountById(id);
      res.status(409).json({ error: { code, message: (err as Error).message, current } });
      return;
    }
    throw err;
  }
  res.status(200).json({ account });

  // Fire-and-forget: notify the new owner when the account is reassigned.
  if (account && parsed.data.owner_id !== undefined && parsed.data.owner_id !== existing.owner_id) {
    void (async () => {
      try {
        const newOwner = await findUserById(parsed.data.owner_id!);
        if (newOwner && newOwner.notify_assignments) {
          queueAssignmentNotification(newOwner.id, newOwner.email, newOwner.name, {
            recordType: 'account',
            recordName: account.name,
            recordPath: recordPath('account', account.id),
            assignedByName: req.user!.name,
          });
        }
      } catch {
        // Swallow — notification failure must not affect the response
      }
    })();
  }
}

/** Column labels shared by the CSV and PDF account export formats, in display order. */
const ACCOUNT_EXPORT_BASE_HEADERS = [
  'Name',
  'Type',
  'Industry',
  'Website',
  'Employees',
  'Revenue Range',
  'Parent Account',
  'Owner',
  'Contacts',
  'Deals',
  'Created',
  'Updated',
] as const;

interface AccountExportData {
  headers: string[];
  rows: Record<string, string | number | Date | null | undefined>[];
}

/**
 * Resolves the owner/search/industry filters for the current request, fetches matching
 * accounts, and merges in custom field columns. Shared by the CSV and PDF export handlers
 * so both formats reflect identical rows and ownership rules.
 */
async function resolveAccountExportData(req: Request): Promise<AccountExportData> {
  const isAdmin = req.user!.role === 'admin';
  const exportAll = req.query.all === 'true';

  const ownerId = !isAdmin || !exportAll ? req.user!.id : undefined;

  const search =
    typeof req.query.search === 'string' && req.query.search.trim().length > 0
      ? req.query.search.trim()
      : undefined;

  const industry =
    typeof req.query.industry === 'string' && req.query.industry.trim().length > 0
      ? req.query.industry.trim()
      : undefined;

  const accountRows = await exportAccountsForCsv({ ownerId, search, industry });

  // Custom field columns — fetch definitions and values in application code
  const customDefs = await listDefinitions('account');
  const recordIds = accountRows.map((r) => r.id);
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

  const headers = [...ACCOUNT_EXPORT_BASE_HEADERS, ...customDefs.map((d) => d.name)];

  const rows = accountRows.map((r) => {
    const base: Record<string, string | number | Date | null | undefined> = {
      Name: r.name,
      Type: r.account_type,
      Industry: r.industry,
      Website: r.website,
      Employees: r.employee_range,
      'Revenue Range': r.revenue_range,
      'Parent Account': r.parent_account_name,
      Owner: r.owner_name,
      Contacts: r.contact_count,
      Deals: r.deal_count,
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
 * GET /api/v1/accounts/export
 * Streams all matching accounts as a UTF-8 CSV file.
 *
 * Query params mirror the list endpoint (owner, search, industry) except
 * pagination/sort — all matching rows are exported.
 * Reps automatically get their own accounts; admins may pass ?all=true to export all.
 */
export async function exportAccountsHandler(req: Request, res: Response): Promise<void> {
  const data = await resolveAccountExportData(req);

  const csv = serializeToCsv(data.headers, data.rows);
  const filename = csvFilename('accounts');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
}

/**
 * GET /api/v1/accounts/export.pdf
 * Renders all matching accounts as a paginated PDF table.
 *
 * Query params and ownership rules are identical to the CSV export above.
 */
/** PDF-only: numeric columns rendered right-aligned instead of left-aligned like text. */
const ACCOUNT_PDF_NUMERIC_COLUMNS = new Set(['Contacts', 'Deals']);

/**
 * PDF-only: columns useful in CSV/spreadsheet form but low-value in a printed
 * table, dropped once the 12-base-column export (plus any custom fields) exceeds
 * WIDE_TABLE_COLUMN_THRESHOLD. CSV export is unaffected. (follow-up)
 */
const ACCOUNT_PDF_LOW_PRIORITY_COLUMNS = new Set([
  'Website',
  'Parent Account',
  'Created',
  'Updated',
]);

export async function exportAccountsPdfHandler(req: Request, res: Response): Promise<void> {
  const data = await resolveAccountExportData(req);

  const columns: PdfTableColumn[] = data.headers.map((label) => ({
    key: label,
    label,
    align: ACCOUNT_PDF_NUMERIC_COLUMNS.has(label) ? 'right' : undefined,
    lowPriority: ACCOUNT_PDF_LOW_PRIORITY_COLUMNS.has(label),
  }));
  const rows: PdfTableRow[] = data.rows;

  const branding = await getBranding();
  setPdfResponseHeaders(res, pdfFilename('accounts'));
  await renderPdfDocument(
    res,
    {
      title: 'Accounts',
      sections: [
        {
          heading: 'Accounts',
          table: { columns, rows, emptyMessage: 'No accounts match the current filters.' },
        },
      ],
    },
    branding,
  );
}

/**
 * GET /api/v1/accounts/:id/export.pdf
 * Renders a single account as a one-record summary PDF, mirroring the data
 * shown on the account detail page. Visibility matches getAccountHandler —
 * subject to the org's account visibility policy.
 */
export async function exportAccountPdfHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const account = await findAccountById(id);

  if (!account) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } });
    return;
  }

  const canAccess = await canAccessOwnedRecord(
    'account',
    account.owner_id,
    req.user!.id,
    req.user!.role,
  );
  if (!canAccess) {
    res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'You do not have visibility into this account.',
      },
    });
    return;
  }

  const [parentAccount, owner, children, contactsPage, customValues, notesPage] = await Promise.all(
    [
      account.parent_account_id
        ? findAccountById(account.parent_account_id)
        : Promise.resolve(null),
      findUserById(account.owner_id),
      listChildAccounts(id),
      listContacts({ accountId: id, limit: PAGINATION_MAX_LIMIT }),
      getValuesForRecord(id),
      listNotes('account', id, req.user!.id, 1, DETAIL_PDF_NOTES_LIMIT),
    ],
  );

  const overviewLines: string[] = [
    `Name: ${account.name}`,
    `Type: ${account.account_type ?? ''}`,
    `Industry: ${account.industry ?? ''}`,
    `Website: ${account.website ?? ''}`,
    `Employees: ${account.employee_range ?? ''}`,
    `Revenue: ${account.revenue_range ?? ''}`,
    `Parent Account: ${parentAccount?.name ?? ''}`,
    `Owner: ${owner?.name ?? ''}`,
    `Created: ${formatExportDate(account.created_at)}`,
    `Updated: ${formatExportDate(account.updated_at)}`,
  ];

  const customFieldLines = customValues.map((v) => `${v.definition.name}: ${v.value ?? ''}`);

  const childAccountColumns: PdfTableColumn[] = [
    { key: 'name', label: 'Name' },
    { key: 'account_type', label: 'Type' },
  ];
  const childAccountRows: PdfTableRow[] = children.map((c) => ({
    name: c.name,
    account_type: c.account_type,
  }));

  const branding = await getBranding();
  setPdfResponseHeaders(res, pdfFilename(`account-${id}`));
  await renderPdfDocument(
    res,
    {
      title: `Account: ${account.name}`,
      sections: [
        { heading: 'Overview', lines: overviewLines },
        {
          heading: 'Custom Fields',
          lines: customFieldLines,
          emptyMessage: 'No custom fields defined.',
        },
        buildContactsTableSection(contactsPage.data),
        {
          heading: 'Child Accounts',
          table: {
            columns: childAccountColumns,
            rows: childAccountRows,
            emptyMessage: 'No child accounts.',
          },
        },
        buildNotesTableSection(notesPage.data),
      ],
    },
    branding,
  );
}

/**
 * DELETE /api/v1/accounts/:id
 * Deletes an account and unlinks associated contacts. Returns 204 No Content on success.
 * Reps may only delete accounts they own; admins may delete any account.
 */
export async function deleteAccountHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const existing = await findAccountById(id);

  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } });
    return;
  }

  if (existing.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json(FORBIDDEN_OWNERSHIP_ERROR);
    return;
  }

  await deleteAccount(id, { id: req.user!.id, name: req.user!.name }, existing.name);
  res.status(204).send();
}

/**
 * GET /api/v1/accounts/:id/children
 * Returns all direct subsidiary accounts of the given account.
 */
export async function listChildAccountsHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const account = await findAccountById(id);

  if (!account) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } });
    return;
  }

  const children = await listChildAccounts(id);
  res.status(200).json({ accounts: children });
}

/**
 * GET /api/v1/accounts/search
 * Type-ahead search for accounts by name. Returns up to 10 matches.
 * Used by the Parent Account selector in AccountForm.
 *
 * Query params:
 *   ?q=<text>       — required substring to match
 *   ?exclude=<uuid> — optional UUID to exclude from results (prevent self-parenting)
 */
export async function searchAccountsHandler(req: Request, res: Response): Promise<void> {
  const query =
    typeof req.query.q === 'string' && req.query.q.trim().length > 0
      ? req.query.q.trim()
      : undefined;

  if (!query) {
    res.status(200).json({ accounts: [] });
    return;
  }

  const excludeRaw = typeof req.query.exclude === 'string' ? req.query.exclude : undefined;
  const excludeId =
    excludeRaw !== undefined && z.string().uuid().safeParse(excludeRaw).success
      ? excludeRaw
      : undefined;

  const accounts = await searchAccounts(query, excludeId);
  res.status(200).json({ accounts });
}
