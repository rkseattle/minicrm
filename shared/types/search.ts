/**
 * The GET /api/v1/search response, shared so the server that builds it and the client
 * that renders it cannot drift. Types only: the server builds it from its own queries,
 * so there is nothing to validate at runtime.
 */

import type { EmailLinkRecordType } from '../schemas/emailMessageSchema.js';

/** A contact the caller can see */
export interface ContactSearchResult {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

/** An account the caller can see */
export interface AccountSearchResult {
  id: string;
  name: string;
}

/** A deal the caller can see */
export interface DealSearchResult {
  id: string;
  name: string;
  stage: string;
}

/** A lead the caller can see */
export interface LeadSearchResult {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string;
  company_name: string | null;
}

/** One of the caller's own messages, with the linked record it opens */
export interface EmailSearchResult {
  id: string;
  subject: string | null;
  snippet: string | null;
  from_address: string;
  sent_at: string | null;
  record_type: EmailLinkRecordType;
  record_id: string;
}

/** Results grouped by entity type */
export interface SearchResults {
  contacts: ContactSearchResult[];
  accounts: AccountSearchResult[];
  deals: DealSearchResult[];
  leads: LeadSearchResult[];
  emails: EmailSearchResult[];
}
