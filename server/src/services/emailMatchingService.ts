/**
 * Links synced messages to the CRM records their addresses name.
 *
 * Runs inside the sync engine's own write transaction, on the messages that page just
 * created. Sharing the transaction is what makes a message and its links atomic: a commit
 * that stored mail without linking it would leave rows nothing points at, and nothing
 * re-reads a message once its provider id is on file.
 *
 * Every rule is one set-based statement over the whole page rather than a query per
 * message. A page is up to 200 messages on Gmail and unbounded on IMAP, and this runs with
 * the account row held, so a per-message loop would hold that lock for hundreds of round
 * trips.
 *
 * The reads are deliberately unscoped by RLS. A message arrives in one user's mailbox and
 * may name another user's contact, so matching must see every record regardless of owner —
 * it acts for the scheduler, not for a user, the way claimAccountsDueForSync does. Today
 * the app connects as a superuser so the policies do not apply at all; were it ever moved
 * to the NOBYPASSRLS role migration 092 created, these queries would need an explicit
 * bypass or they would match nothing and link nothing, silently.
 */

import type { PoolClient } from 'pg';

import type { EmailLinkRecordType } from '@minicrm/shared/schemas/emailMessageSchema.js';

import { NON_TERMINAL_STAGE_PREDICATE } from './pipelineStageService.js';

/**
 * How a link records the way it was made. Mirrors the table's match_type CHECK; a manual
 * link is the API's to write.
 */
const AUTO_MATCH = 'auto';

/**
 * What `source` records on a link the engine wrote.
 *
 * Auto-links are deliberately not audited, so the column is the only trace that the
 * matcher rather than a person filed the mail. NULL means a person, as it does on
 * `audit_log.source`.
 */
const SYSTEM_SOURCE = 'system';

/** A message this page created, with the addresses matching reads. */
export interface MatchableMessage {
  id: string;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
}

/**
 * Flattens each message to the addresses it names, as parallel arrays.
 *
 * Postgres takes the pair as one unnested relation, which is what lets every rule be a
 * single statement. Addresses arrive already lowercased and trimmed by the providers'
 * shared parser, so only the CRM side of each comparison needs LOWER().
 */
function toAddressPairs(messages: readonly MatchableMessage[]): {
  messageIds: string[];
  addresses: string[];
} {
  const messageIds: string[] = [];
  const addresses: string[] = [];

  for (const message of messages) {
    for (const address of [message.fromAddress, ...message.toAddresses, ...message.ccAddresses]) {
      if (address === '') continue;
      messageIds.push(message.id);
      addresses.push(address);
    }
  }

  return { messageIds, addresses };
}

/**
 * Links every message that names a contact's address.
 *
 * Both sides of the address comparison are already lowercase, but LOWER() stays on the
 * column so the functional index serves it and a row written before that normalization
 * still matches.
 */
async function linkContacts(
  client: PoolClient,
  messageIds: readonly string[],
  addresses: readonly string[],
): Promise<void> {
  await client.query(
    `INSERT INTO email_message_links (email_message_id, record_type, record_id, match_type, source)
     SELECT DISTINCT named.message_id, 'contact', c.id, $3, $4
       FROM unnest($1::uuid[], $2::text[]) AS named(message_id, address)
       JOIN contacts c ON LOWER(c.email) = named.address
     ON CONFLICT DO NOTHING`,
    [messageIds, addresses, AUTO_MATCH, SYSTEM_SOURCE],
  );
}

/**
 * Links leads, but only for an address no contact answered.
 *
 * That is the documented precedence — a contact beats a lead for the same address — and it
 * is expressed against `contacts` rather than against the rows just inserted, so the rule
 * does not depend on this function running after linkContacts.
 *
 * A converted lead is excluded outright, following the `converted_at IS NULL` filter
 * leadsService uses wherever it means "still a lead". Precedence alone would not cover it:
 * conversion takes the contact's address from the request body, so a rep who corrects it
 * leaves the lead holding the old one, and no contact would then answer that address.
 */
async function linkLeads(
  client: PoolClient,
  messageIds: readonly string[],
  addresses: readonly string[],
): Promise<void> {
  await client.query(
    `INSERT INTO email_message_links (email_message_id, record_type, record_id, match_type, source)
     SELECT DISTINCT named.message_id, 'lead', l.id, $3, $4
       FROM unnest($1::uuid[], $2::text[]) AS named(message_id, address)
       JOIN leads l ON LOWER(l.email) = named.address
      WHERE l.converted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM contacts c WHERE LOWER(c.email) = named.address
        )
     ON CONFLICT DO NOTHING`,
    [messageIds, addresses, AUTO_MATCH, SYSTEM_SOURCE],
  );
}

/**
 * Links the account each matched contact belongs to.
 *
 * Reads the contact links this page just wrote rather than re-matching addresses, so a
 * contact that lost to nothing — or was linked by an earlier page — resolves the same way.
 */
async function linkContactAccounts(
  client: PoolClient,
  messageIds: readonly string[],
): Promise<void> {
  await client.query(
    `INSERT INTO email_message_links (email_message_id, record_type, record_id, match_type, source)
     SELECT DISTINCT link.email_message_id, 'account', c.account_id, $2, $3
       FROM email_message_links link
       JOIN contacts c ON c.id = link.record_id
      WHERE link.email_message_id = ANY($1::uuid[])
        AND link.record_type = 'contact'
        AND c.account_id IS NOT NULL
     ON CONFLICT DO NOTHING`,
    [messageIds, AUTO_MATCH, SYSTEM_SOURCE],
  );
}

/**
 * Links the open deals a matched contact participates in.
 *
 * Open means not in a terminal stage, resolved through the stage FK rather than the
 * denormalized `deals.stage` text — the same subquery dealService uses, and the reason it
 * gives: the text column goes stale. Terminal stages are per pipeline, so the correlation
 * on `d.pipeline_id` is load-bearing.
 */
async function linkContactDeals(client: PoolClient, messageIds: readonly string[]): Promise<void> {
  await client.query(
    `INSERT INTO email_message_links (email_message_id, record_type, record_id, match_type, source)
     SELECT DISTINCT link.email_message_id, 'deal', d.id, $2, $3
       FROM email_message_links link
       JOIN deal_contacts dc ON dc.contact_id = link.record_id
       JOIN deals d ON d.id = dc.deal_id
      WHERE link.email_message_id = ANY($1::uuid[])
        AND link.record_type = 'contact'
        AND ${NON_TERMINAL_STAGE_PREDICATE}
     ON CONFLICT DO NOTHING`,
    [messageIds, AUTO_MATCH, SYSTEM_SOURCE],
  );
}

/**
 * Links one page of newly stored messages to the records they name.
 *
 * Callers pass only messages this transaction created. A message that already existed has
 * already been matched, and re-matching it would restore links a user deliberately removed.
 *
 * @param client - The sync transaction's client. This function never opens its own.
 * @param messages - Messages created by this page's insert.
 * @param dealAutoLink - Whether to link open deals, from the system setting. Resolved once
 *   per tick by the caller rather than read here, which would query per page.
 */
export async function matchMessagesToRecords(
  client: PoolClient,
  messages: readonly MatchableMessage[],
  dealAutoLink: boolean,
): Promise<void> {
  if (messages.length === 0) return;

  const { messageIds, addresses } = toAddressPairs(messages);
  if (addresses.length === 0) return;

  await linkContacts(client, messageIds, addresses);
  await linkLeads(client, messageIds, addresses);

  // Both read back the contact links above, so they run after it rather than beside it.
  const linkedIds = messages.map((message) => message.id);
  await linkContactAccounts(client, linkedIds);
  if (dealAutoLink) await linkContactDeals(client, linkedIds);
}

/**
 * Clears the links pointing at a record being hard-deleted.
 *
 * `record_id` carries no foreign key — the reference is polymorphic, so nothing cascades —
 * and an orphan is not self-correcting: it is invisible to every read, because both list
 * paths reach links by joining from the record. Call inside the deleting transaction,
 * alongside softDeleteNotesByEntity.
 *
 * @param client - Active DB client, inside the caller's transaction.
 * @param recordType - Type of the record being deleted.
 * @param recordId - Id of the record being deleted.
 */
export async function deleteLinksForDeletedEntity(
  client: PoolClient,
  recordType: EmailLinkRecordType,
  recordId: string,
): Promise<void> {
  await client.query('DELETE FROM email_message_links WHERE record_type = $1 AND record_id = $2', [
    recordType,
    recordId,
  ]);
}

/** Set-based counterpart for bulk deletes, which remove many rows in one statement. */
export async function deleteLinksForDeletedEntities(
  client: PoolClient,
  recordType: EmailLinkRecordType,
  recordIds: readonly string[],
): Promise<void> {
  if (recordIds.length === 0) return;
  await client.query(
    'DELETE FROM email_message_links WHERE record_type = $1 AND record_id = ANY($2::uuid[])',
    [recordType, recordIds],
  );
}

/**
 * Moves a converted lead's links to the contact it became.
 *
 * Conversion keeps the lead row and only stamps `converted_at`, but every read path hides
 * a converted lead — so its links would sit on a record nothing joins from, losing exactly
 * the pre-conversion history this feature exists to surface. The matcher refuses converted
 * leads from then on, so this moves the ones already written.
 *
 * Guarded for the same reason the merge is: a message that named both the lead and the new
 * contact's address already has a contact row, and a bare UPDATE would raise 23505 and roll
 * the conversion back.
 */
export async function relinkLinksToConvertedLead(
  client: PoolClient,
  leadId: string,
  contactId: string,
): Promise<void> {
  await client.query(
    `UPDATE email_message_links lead_link
        SET record_type = 'contact', record_id = $2
      WHERE lead_link.record_type = 'lead'
        AND lead_link.record_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM email_message_links contact_link
           WHERE contact_link.email_message_id = lead_link.email_message_id
             AND contact_link.record_type = 'contact'
             AND contact_link.record_id = $2
        )`,
    [leadId, contactId],
  );
  await client.query(
    `DELETE FROM email_message_links WHERE record_type = 'lead' AND record_id = $1`,
    [leadId],
  );
}

/**
 * Recomputes the `account` and `deal` auto-links on a set of messages from current state.
 *
 * Rules 3 and 4 derive a link from a relationship — `contacts.account_id`, `deal_contacts`
 * — rather than from an address, and a relationship changes after the mail arrives. A
 * contact who moves employer would otherwise keep filing correspondence against the old
 * account forever, and a contact deleted or dropped from a deal would leave the deal
 * holding mail nothing justifies.
 *
 * Recomputing beats patching each individual change: every caller is some edit to the
 * contact set or its relationships, and the answer is always "whatever the surviving
 * contacts justify now". One statement per record type over the whole message set, so a
 * bulk caller costs the same two round trips as a single one.
 *
 * Only `match_type = 'auto'` rows are touched. A manual link is somebody's deliberate
 * filing decision and the engine does not overrule it.
 *
 * @param client - The transaction that changed the contacts or their relationships.
 * @param messageIds - The messages to recompute. Empty is a no-op.
 * @param dealAutoLink - Whether rule 4 may write deal links, read from the system setting.
 *   The reconcile path takes the same gate as the sync path, or an admin who switched
 *   auto-linking off would see deals reappear whenever a relationship changed.
 */
export async function reconcileDerivedLinks(
  client: PoolClient,
  messageIds: readonly string[],
  dealAutoLink: boolean,
): Promise<void> {
  if (messageIds.length === 0) {
    return;
  }

  // Delete first, then insert: a contact can move from one account to another in the same
  // call, and the surviving set is what the insert re-derives.
  await client.query(
    `DELETE FROM email_message_links stale
      WHERE stale.email_message_id = ANY($1::uuid[])
        AND stale.record_type = 'account'
        AND stale.match_type = $2
        AND NOT EXISTS (
          SELECT 1 FROM email_message_links contact_link
            JOIN contacts c ON c.id = contact_link.record_id
           WHERE contact_link.email_message_id = stale.email_message_id
             AND contact_link.record_type = 'contact'
             AND c.account_id = stale.record_id
        )`,
    [messageIds, AUTO_MATCH],
  );

  await client.query(
    `DELETE FROM email_message_links stale
      WHERE stale.email_message_id = ANY($1::uuid[])
        AND stale.record_type = 'deal'
        AND stale.match_type = $2
        AND NOT EXISTS (
          SELECT 1 FROM email_message_links contact_link
            JOIN deal_contacts dc ON dc.contact_id = contact_link.record_id
           WHERE contact_link.email_message_id = stale.email_message_id
             AND contact_link.record_type = 'contact'
             AND dc.deal_id = stale.record_id
        )`,
    [messageIds, AUTO_MATCH],
  );

  await client.query(
    `INSERT INTO email_message_links (email_message_id, record_type, record_id, match_type, source)
     SELECT DISTINCT link.email_message_id, 'account', c.account_id, $2, $3
       FROM email_message_links link
       JOIN contacts c ON c.id = link.record_id
      WHERE link.email_message_id = ANY($1::uuid[])
        AND link.record_type = 'contact'
        AND c.account_id IS NOT NULL
     ON CONFLICT DO NOTHING`,
    [messageIds, AUTO_MATCH, SYSTEM_SOURCE],
  );

  if (dealAutoLink) {
    await linkContactDeals(client, messageIds);
  }
}

/**
 * The messages linked to any of these contacts — the input `reconcileDerivedLinks` needs.
 *
 * Read it BEFORE the change that invalidates the links, since a delete removes the contact
 * rows the lookup joins through.
 *
 * @param client - The transaction about to change these contacts.
 * @param contactIds - The contacts whose messages are affected.
 */
export async function messagesLinkedToContacts(
  client: PoolClient,
  contactIds: readonly string[],
): Promise<string[]> {
  if (contactIds.length === 0) {
    return [];
  }
  const result = await client.query<{ email_message_id: string }>(
    `SELECT DISTINCT email_message_id FROM email_message_links
      WHERE record_type = 'contact' AND record_id = ANY($1::uuid[])`,
    [contactIds],
  );
  return result.rows.map((row) => row.email_message_id);
}

/**
 * Moves a merged-away contact's links to the surviving contact.
 *
 * A merge consolidates two records, so the loser's conversation history must follow rather
 * than be dropped — the same reason mergeContacts re-points notes and attachments. The
 * guard is not optional: UNIQUE (email_message_id, record_type, record_id) means a message
 * naming both contacts already has a winner row, and a bare UPDATE would raise 23505 and
 * roll the whole merge back. What the guard skips is deleted, exactly as
 * custom_field_values is handled two statements above the call site.
 */
export async function relinkLinksToMergedContact(
  client: PoolClient,
  winnerId: string,
  loserId: string,
): Promise<void> {
  await client.query(
    `UPDATE email_message_links loser
        SET record_id = $1
      WHERE loser.record_type = 'contact'
        AND loser.record_id = $2
        AND NOT EXISTS (
          SELECT 1 FROM email_message_links winner
           WHERE winner.email_message_id = loser.email_message_id
             AND winner.record_type = 'contact'
             AND winner.record_id = $1
        )`,
    [winnerId, loserId],
  );
  await client.query(
    `DELETE FROM email_message_links WHERE record_type = 'contact' AND record_id = $1`,
    [loserId],
  );
}
