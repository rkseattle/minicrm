/**
 * AI output derived from activity text: what a scrub clears, and the version guard a late
 * writer checks before saving.
 *
 * A scrub (private thread, erasure) removes an activity's text and bumps its version under
 * the row lock. A derived result already stored is cleared here in the scrub's transaction;
 * one still being computed is saved only after `activitiesUnchangedSince` share-locks its
 * sources at the versions it read, so it either commits before the scrub's clear or is
 * discarded. Optimistic concurrency, as Rails' lock_version and JPA's @Version.
 *
 * It owns the scrub's writes to those three tables on purpose: the invariant belongs to the
 * scrub, and each owning service imports activityService, so a clear function in each owner
 * would close an import cycle. Depends on no service, so every writer can import it too.
 */

import type { PoolClient } from 'pg';
import { recordPath } from '@minicrm/shared/types/recordPath.js';
import {
  CHURN_RISK_NOTIFICATION_TYPE,
  clearNotificationBodies,
} from './notificationFeedService.js';

/** An activity as an analysis read it: its id and the version its text was read at. */
export interface ActivityReadVersion {
  id: string;
  version: number;
}

/**
 * Share-locks the given activities and reports whether every one is still at the version
 * read. Call it in the transaction that saves the derived result, before the write.
 */
export async function activitiesUnchangedSince(
  client: PoolClient,
  read: readonly ActivityReadVersion[],
): Promise<boolean> {
  if (read.length === 0) return true;
  const result = await client.query(
    `SELECT a.id FROM activities a
       JOIN unnest($1::uuid[], $2::int[]) AS r(id, version)
         ON r.id = a.id AND r.version = a.version
      ORDER BY a.id
        FOR SHARE OF a`,
    [read.map((activity) => activity.id), read.map((activity) => activity.version)],
  );
  return result.rowCount === new Set(read.map((activity) => activity.id)).size;
}

/**
 * Clears what AI analysis derived from the given activities' text. A signal or brief does
 * not record which activities it drew on, so everything drawn from their contacts and
 * accounts goes; labels without text (statuses, signal types) stay.
 */
export async function clearTextDerivedFromActivities(
  client: PoolClient,
  activityIds: readonly string[],
): Promise<void> {
  if (activityIds.length === 0) return;
  await client.query(
    `UPDATE contact_champion_blocker_signals
        SET contributing_signals = '[]'::jsonb, updated_at = now()
      WHERE contact_id IN (SELECT contact_id FROM activities WHERE id = ANY($1::uuid[]))
        AND contributing_signals <> '[]'::jsonb`,
    [activityIds],
  );
  // A brief summarizes its contact's recent activities, not only its own.
  await client.query(
    `DELETE FROM activity_meeting_briefs
      WHERE activity_id IN (
        SELECT id FROM activities
         WHERE contact_id IN (SELECT contact_id FROM activities WHERE id = ANY($1::uuid[])))`,
    [activityIds],
  );
  await client.query(
    `UPDATE account_churn_expansion_signals
        SET contributing_factors = '[]'::jsonb
      WHERE account_id IN (SELECT account_id FROM activities WHERE id = ANY($1::uuid[]))
        AND contributing_factors <> '[]'::jsonb`,
    [activityIds],
  );
  const accounts = await client.query<{ account_id: string }>(
    `SELECT DISTINCT account_id FROM activities
      WHERE id = ANY($1::uuid[]) AND account_id IS NOT NULL`,
    [activityIds],
  );
  // The churn alert quotes a factor in its body.
  await clearNotificationBodies(
    client,
    CHURN_RISK_NOTIFICATION_TYPE,
    accounts.rows.map((row) => recordPath('account', row.account_id)),
  );
}
