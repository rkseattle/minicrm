/**
 * Redaction of a GDPR-erased data subject from synced mail, shared by the erasure cascade
 * and both ingest paths so all three redact identically.
 *
 * A redacted message keeps its row and thread: the subject's address becomes the erased
 * record's synthetic `gdpr-deleted-<id>@gdpr.invalid` in every address field, and the
 * subject line and bodies go, since free text can carry personal data anywhere. The row is
 * then a tombstone the sync upsert never overwrites.
 */

import type { PoolClient } from 'pg';

import { keyedDigest } from '../cryptoService.js';
import { normalizeAddress } from '../../utils/emailAddress.js';

/** Purpose label for the HKDF subkey, so this digest can never equal another use's. */
const ERASED_ADDRESS_DIGEST_PURPOSE = 'gdpr-erased-address';

/** What every erased text value reads, in rows and on read-time masking alike. */
export const GDPR_REDACTED_TEXT = '[GDPR deleted]';

/** GDPR_REDACTED_TEXT as a SQL literal; the text holds no quote, so it needs no escaping. */
export const GDPR_REDACTED_SQL = `'${GDPR_REDACTED_TEXT}'`;

const PLACEHOLDER_PREFIX = 'gdpr-deleted-';
const PLACEHOLDER_DOMAIN = '@gdpr.invalid';

/**
 * The synthetic address an erased record's email becomes, as SQL over its `id` column: the
 * same value erasedPlaceholderAddress builds for the mail that named it.
 */
export const GDPR_PLACEHOLDER_EMAIL_SQL = `'${PLACEHOLDER_PREFIX}' || id || '${PLACEHOLDER_DOMAIN}'`;

/**
 * Advisory lock key serializing erasure (exclusive) against mail ingest (shared). Two int4
 * halves, hashed from a fixed label so no other feature can pick the same pair by chance.
 */
const GDPR_INGEST_LOCK_SQL = `hashtext('gdpr-email-ingest'), 0`;

/** The keyed digest erasure records and ingest compares; the address itself is never stored. */
export function erasedAddressDigest(address: string): string {
  return keyedDigest(ERASED_ADDRESS_DIGEST_PURPOSE, normalizeAddress(address));
}

/** The synthetic address an erased record's address is replaced with. */
export function erasedPlaceholderAddress(recordId: string): string {
  return `${PLACEHOLDER_PREFIX}${recordId}${PLACEHOLDER_DOMAIN}`;
}

/** Taken by every ingest path, and thread privacy changes, before any intent or message row. */
export async function lockForIngest(client: PoolClient): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock_shared(${GDPR_INGEST_LOCK_SQL})`);
}

/** Taken by erasure before any intent or message row; waits for in-flight pages. */
export async function lockForErasure(client: PoolClient): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(${GDPR_INGEST_LOCK_SQL})`);
}

/**
 * SQL replacing one address with another in an address array, ignoring case and keeping
 * order. array_replace compares exactly; a mixed-case copy of the address would survive it.
 *
 * @param addressParam - Placeholder bound to the lowercased address, e.g. `$2`.
 * @param placeholderParam - Placeholder bound to its replacement.
 */
export function replaceInArray(
  column: string,
  addressParam = '$2',
  placeholderParam = '$3',
): string {
  return `ARRAY(SELECT CASE WHEN lower(a.address) = ${addressParam} THEN ${placeholderParam}
                         ELSE a.address END
                  FROM unnest(${column}) WITH ORDINALITY AS a(address, position)
                 ORDER BY a.position)`;
}

/** SQL true when an address array holds the given address in any case. */
export function arrayHasAddress(column: string, addressParam: string): string {
  return `EXISTS (SELECT 1 FROM unnest(${column}) AS a(address) WHERE lower(a.address) = ${addressParam})`;
}

/**
 * Redacts one address from the given messages, and their subject lines and bodies.
 *
 * @param address - The erased subject's address, lowercased.
 * @returns the number of messages redacted.
 */
export async function redactMessages(
  client: PoolClient,
  messageIds: readonly string[],
  address: string,
  placeholder: string,
): Promise<number> {
  if (messageIds.length === 0) return 0;
  const result = await client.query(
    `UPDATE email_messages
        SET from_address = CASE WHEN lower(from_address) = $2 THEN $3 ELSE from_address END,
            to_addresses = ${replaceInArray('to_addresses')},
            cc_addresses = ${replaceInArray('cc_addresses')},
            reply_to_addresses = ${replaceInArray('reply_to_addresses')},
            subject = $4,
            message_body_text = NULL,
            message_body_html = NULL,
            message_snippet = NULL,
            gdpr_redacted_at = COALESCE(gdpr_redacted_at, now())
      WHERE id = ANY($1::uuid[])`,
    [messageIds, address, placeholder, GDPR_REDACTED_TEXT],
  );
  return result.rowCount ?? 0;
}

/**
 * Redacts, as they are stored, the messages that name an address erased before they arrived.
 *
 * A redacted row protects only itself: a mailbox connected after an erasure, or one
 * disconnected and reconnected, would otherwise bring the subject's mail back in full. The
 * erasure log holds only a keyed digest, so each address is digested and matched here.
 */
export async function redactErasedOnIngest(
  client: PoolClient,
  accountId: string,
  providerMessageIds: readonly string[],
): Promise<void> {
  if (providerMessageIds.length === 0) return;
  const stored = await client.query<{ id: string; addresses: string[] }>(
    `SELECT id,
            public.email_message_addresses(from_address, to_addresses, cc_addresses,
                                           reply_to_addresses) AS addresses
       FROM email_messages
      WHERE connected_account_id = $1 AND provider_message_id = ANY($2)`,
    [accountId, providerMessageIds],
  );
  const digestByAddress = new Map<string, string>();
  for (const row of stored.rows) {
    for (const address of row.addresses) {
      const normalized = normalizeAddress(address);
      if (!digestByAddress.has(normalized)) {
        digestByAddress.set(normalized, erasedAddressDigest(normalized));
      }
    }
  }
  if (digestByAddress.size === 0) return;

  const erased = await client.query<{ record_id: string; erased_address_hmac: string }>(
    `SELECT record_id, erased_address_hmac FROM gdpr_deletion_log
      WHERE completed_at IS NOT NULL AND erased_address_hmac = ANY($1)`,
    [[...digestByAddress.values()]],
  );
  if (erased.rows.length === 0) return;

  for (const [address, digest] of digestByAddress) {
    for (const erasure of erased.rows.filter((row) => row.erased_address_hmac === digest)) {
      const ids = stored.rows
        .filter((row) => row.addresses.some((a) => normalizeAddress(a) === address))
        .map((row) => row.id);
      await redactMessages(client, ids, address, erasedPlaceholderAddress(erasure.record_id));
    }
  }
}
