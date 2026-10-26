/**
 * Email template HTTP handlers. Read-only: templates are written through the admin AI tools.
 */

import type { Request, Response } from 'express';

import type { EmailTemplateSummary } from '@minicrm/shared/schemas/emailTemplateSchema.js';
import { paginationParamsSchema } from '@minicrm/shared/schemas/paginationSchema.js';

import { listEmailTemplates } from '../services/emailTemplateService.js';
import { respondValidationError } from '../utils/validationError.js';

/**
 * GET /api/v1/email-templates
 * Lists the enabled templates a sender can pick, without who wrote them or when.
 */
export async function listEmailTemplatesHandler(req: Request, res: Response): Promise<void> {
  const parsed = paginationParamsSchema.safeParse({ page: req.query.page, limit: req.query.limit });
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }

  const { page, limit } = parsed.data;
  const result = await listEmailTemplates({ enabled_only: true, page, limit });
  const data: EmailTemplateSummary[] = result.data.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    subject: row.subject,
    body: row.body,
    merge_tags: row.merge_tags,
  }));
  res.status(200).json({ data, total: result.total, page: result.page, limit: result.limit });
}
