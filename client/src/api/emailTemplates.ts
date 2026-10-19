/**
 * Email templates API module. Read-only.
 */

import type { EmailTemplateSummary } from '@shared/schemas/emailTemplateSchema.js';
import type { PaginatedResponse } from '@shared/schemas/paginationSchema.js';

import apiClient from './axiosInstance.js';

/** React Query cache key for the enabled templates */
export const EMAIL_TEMPLATES_QUERY_KEY = ['email-templates'] as const;

/** The endpoint's own page ceiling. */
const TEMPLATE_PAGE_SIZE = 100;

/** Pages one picker reads at most; a list longer than this is reported, not silently cut. */
const MAX_TEMPLATE_PAGES = 10;

/**
 * The enabled templates a sender can pick, by name, read page by page.
 *
 * @returns every template up to the page bound, with the server's total so a caller can say
 *   when more exist than it was given.
 */
export async function listEmailTemplates(): Promise<{
  data: EmailTemplateSummary[];
  total: number;
}> {
  const data: EmailTemplateSummary[] = [];
  let total = 0;
  for (let page = 1; page <= MAX_TEMPLATE_PAGES; page += 1) {
    const response = await apiClient.get<PaginatedResponse<EmailTemplateSummary>>(
      '/email-templates',
      { params: { page, limit: TEMPLATE_PAGE_SIZE } },
    );
    data.push(...response.data.data);
    total = response.data.total;
    if (response.data.data.length === 0 || data.length >= total) break;
  }
  return { data, total };
}
