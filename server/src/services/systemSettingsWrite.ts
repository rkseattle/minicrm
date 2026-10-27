import type { PoolClient } from 'pg';
import { actorIdOrNull, type AuditActor } from './auditActor.js';

/**
 * Writes one setting, recording who changed it. Takes the pool or a transaction's client, so a
 * setter that audits can write the value on the same client as its audit entry.
 */
export async function upsertSystemSetting(
  queryable: Pick<PoolClient, 'query'>,
  key: string,
  value: string,
  actor: AuditActor,
): Promise<void> {
  await queryable.query(
    `INSERT INTO system_settings (key, value, updated_at, updated_by)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [key, value, actorIdOrNull(actor)],
  );
}
