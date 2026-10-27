/**
 * A GDPR deletion log row as the API returns it, shared so the server that builds it and the
 * client that shows it cannot drift. Types only, in wire format: timestamps are ISO strings.
 * The keyed address digest is deliberately absent; it never leaves the server.
 */
export interface GdprDeletionLogEntry {
  id: string;
  record_type: string;
  record_id: string;
  requested_by: string;
  requested_at: string;
  completed_at: string | null;
  erasure_scope: string[];
  notes: string | null;
  /** Synced messages the erasure redacted, across every mailbox. */
  email_messages_redacted: number;
  /** Links from synced messages to the erased record that it deleted. */
  email_links_deleted: number;
}
