/**
 * A named lock per contact or lead: exclusive for a merge or lead conversion, shared by every
 * write that names one by id (claiming a send, linking mail).
 *
 * Row locks cannot do this. A merge moves what names its records, but it cannot lock a row
 * another transaction has yet to insert, so a send claimed or a message linked while the
 * merge runs would be left on the removed record, out of erasure's reach. An advisory lock
 * per record id serializes the two instead, as Postgres documents for application-defined
 * locks, keyed on the canonical uuid text so any spelling of an id takes the same lock.
 * Transaction-scoped, so a rollback releases it. Each transaction takes all of its
 * record locks in one statement, ordered by lock key: two statements, or another order,
 * can deadlock against a merge taking the same two records.
 *
 * Lock order: after the GDPR ingest lock, before any send intent. The full order is in
 * docs/dev/email-sync.md.
 */

import type { PoolClient } from 'pg';

/** Namespace for the per-record advisory lock, so it cannot collide with another feature's. */
const RECORD_MERGE_LOCK_NAMESPACE = 'crm_record_merge';

/** Takes the lock on each record exclusively, for a merge or conversion of them. */
export async function lockRecordsForMerge(
  client: PoolClient,
  recordIds: readonly string[],
): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1), key)
       FROM (SELECT DISTINCT hashtext(unnest($2::uuid[])::text) AS key ORDER BY 1) keys`,
    [RECORD_MERGE_LOCK_NAMESPACE, recordIds],
  );
}

/**
 * Takes the lock on each record shared, so no merge or conversion of them runs until this
 * transaction commits, and one already running has committed.
 */
export async function holdRecordsAgainstMerge(
  client: PoolClient,
  recordIds: readonly string[],
): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock_shared(hashtext($1), key)
       FROM (SELECT DISTINCT hashtext(unnest($2::uuid[])::text) AS key ORDER BY 1) keys`,
    [RECORD_MERGE_LOCK_NAMESPACE, recordIds],
  );
}

/**
 * Holds every contact and lead the addresses name, and any named directly, against a merge,
 * in one acquisition, and returns the matched ids. A record that comes to match only while
 * this waited is not held, so callers link only what is returned: the same as if that change
 * had landed just after.
 */
export async function holdMatchedRecordsAgainstMerge(
  client: PoolClient,
  addresses: readonly string[],
  alsoRecordIds: readonly string[] = [],
): Promise<string[]> {
  const matched = await client.query<{ record_id: string }>(
    `SELECT DISTINCT record_id FROM address_matched_records($1::text[])`,
    [addresses],
  );
  const recordIds = matched.rows.map((row) => row.record_id);
  await holdRecordsAgainstMerge(client, [...recordIds, ...alsoRecordIds]);
  return recordIds;
}

/**
 * Whether a contact, or a lead not yet converted, still exists: what a merge or conversion
 * leaves behind once it commits. Call it holding the record's lock.
 */
export async function mergeableRecordExists(
  client: PoolClient,
  recordType: 'contact' | 'lead',
  recordId: string,
): Promise<boolean> {
  const found = await client.query(
    `SELECT 1 FROM contacts WHERE $1 = 'contact' AND id = $2::uuid
     UNION ALL
     SELECT 1 FROM leads WHERE $1 = 'lead' AND id = $2::uuid AND converted_at IS NULL`,
    [recordType, recordId],
  );
  return found.rowCount !== 0;
}
