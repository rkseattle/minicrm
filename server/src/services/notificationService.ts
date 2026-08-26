/**
 * Notification service — orchestrates email notification delivery.
 *
 * Responsibilities:
 *   - sendOverdueDigests(): daily batch job for overdue task emails
 *   - queueAssignmentNotification(): batches assignment emails within a 2-minute window
 *
 * All errors are caught and logged — a failing notification must never abort
 * the triggering operation.
 *
 *
 */

import pool from '../db.js';
import logger from '../logger.js';
import { getEmailNotificationsEnabled } from './settingsService.js';
import { sendOverdueTaskDigest, sendAssignmentNotification } from './emailService.js';
import type { OverdueTaskItem, AssignmentItem } from './emailService.js';
import { isRecordLinkType, recordPathOrNull } from '@minicrm/shared/types/recordPath.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** A row from the overdue tasks query */
interface OverdueTaskRow {
  activity_id: string;
  owner_id: string;
  owner_email: string;
  owner_name: string;
  subject: string;
  due_date: string;
  linked_record_name: string | null;
  linked_record_type: string | null;
  linked_record_id: string | null;
}

/** Pending assignment batch for a single recipient */
interface PendingBatch {
  recipientEmail: string;
  recipientName: string;
  items: AssignmentItem[];
  timer: ReturnType<typeof setTimeout>;
}

// ── Assignment batching ──────────────────────────────────────────

/** In-memory map of pending assignment batches keyed by recipient user ID */
const pendingBatches = new Map<string, PendingBatch>();

/** Batching window in milliseconds (2 minutes) */
const BATCH_WINDOW_MS = 2 * 60 * 1000;

/**
 * Queues an assignment notification for a user.
 * If a batch is already pending for that user, the new item is appended
 * and the timer is NOT reset (first item in the window determines send time).
 *
 * @param recipientId - UUID of the user being assigned to.
 * @param recipientEmail - Email of the recipient.
 * @param recipientName - Display name of the recipient.
 * @param item - The assignment details.
 */
export function queueAssignmentNotification(
  recipientId: string,
  recipientEmail: string,
  recipientName: string,
  item: AssignmentItem,
): void {
  const existing = pendingBatches.get(recipientId);
  if (existing) {
    existing.items.push(item);
    return;
  }

  const batch: PendingBatch = {
    recipientEmail,
    recipientName,
    items: [item],
    timer: setTimeout(() => {
      void flushAssignmentBatch(recipientId);
    }, BATCH_WINDOW_MS),
  };
  // Allow the timer to be garbage-collected if the process shuts down cleanly
  batch.timer.unref();
  pendingBatches.set(recipientId, batch);
}

/**
 * Flushes the pending assignment batch for a user and sends the email.
 * Called automatically after the batching window expires.
 *
 * @param recipientId - UUID of the recipient.
 */
async function flushAssignmentBatch(recipientId: string): Promise<void> {
  const batch = pendingBatches.get(recipientId);
  if (!batch) return;
  pendingBatches.delete(recipientId);

  try {
    const globalEnabled = await getEmailNotificationsEnabled();
    if (!globalEnabled) {
      logger.info(
        { recipientId },
        'notificationService: assignment email suppressed (global kill switch)',
      );
      return;
    }

    await sendAssignmentNotification(batch.recipientEmail, batch.recipientName, batch.items);
    logger.info(
      { recipientId, count: batch.items.length },
      'notificationService: assignment notification sent',
    );
  } catch (err) {
    logger.error(
      { err, recipientId },
      'notificationService: failed to send assignment notification',
    );
  }
}

// ── Overdue task digest ─────────────────────────────────────────

/**
 * Daily job: finds all newly-overdue open tasks, groups them by owner,
 * sends one digest email per owner, and records each task as notified so
 * it is not re-sent on subsequent days.
 *
 * Respects the global email kill switch and individual user opt-out flags.
 * Safe to call repeatedly — already-notified tasks are excluded via the
 * overdue_task_notifications dedup table.
 */
export async function sendOverdueDigests(): Promise<void> {
  try {
    const globalEnabled = await getEmailNotificationsEnabled();
    if (!globalEnabled) {
      logger.info('notificationService: overdue digest skipped (global kill switch)');
      return;
    }

    // Find open tasks past due date that have not been notified yet,
    // and whose owner has opted in to overdue notifications.
    const result = await pool.query<OverdueTaskRow>(`
      SELECT
        a.id              AS activity_id,
        a.owner_id,
        u.email           AS owner_email,
        u.name            AS owner_name,
        a.subject,
        a.due_date::text  AS due_date,
        COALESCE(c.first_name || ' ' || c.last_name, acc.name, d.name) AS linked_record_name,
        CASE
          WHEN a.contact_id IS NOT NULL THEN 'contact'
          WHEN a.account_id IS NOT NULL THEN 'account'
          WHEN a.deal_id    IS NOT NULL THEN 'deal'
        END AS linked_record_type,
        COALESCE(a.contact_id, a.account_id, a.deal_id)::text AS linked_record_id
      FROM activities a
      JOIN users u ON u.id = a.owner_id
      LEFT JOIN contacts c    ON c.id = a.contact_id
      LEFT JOIN accounts acc  ON acc.id = a.account_id
      LEFT JOIN deals d       ON d.id = a.deal_id
      WHERE a.type = 'Task'
        AND a.status = 'open'
        AND a.due_date < CURRENT_DATE
        AND u.status = 'active'
        AND u.notify_overdue_tasks = true
        AND NOT EXISTS (
          SELECT 1 FROM overdue_task_notifications otn
          WHERE otn.activity_id = a.id
        )
    `);

    if (result.rows.length === 0) {
      logger.info('notificationService: no newly-overdue tasks found');
      return;
    }

    // Group rows by owner
    const byOwner = new Map<string, { email: string; name: string; tasks: OverdueTaskItem[] }>();
    for (const row of result.rows) {
      if (!byOwner.has(row.owner_id)) {
        byOwner.set(row.owner_id, { email: row.owner_email, name: row.owner_name, tasks: [] });
      }
      byOwner.get(row.owner_id)!.tasks.push({
        id: row.activity_id,
        subject: row.subject,
        due_date: row.due_date,
        linked_record_name: row.linked_record_name,
        // The SQL CASE emits only contact/account/deal, but the column is text:
        // the guard keeps an unexpected value out of the path rather than into it.
        linked_record_path: isRecordLinkType(row.linked_record_type)
          ? recordPathOrNull(row.linked_record_type, row.linked_record_id)
          : null,
      });
    }

    // Send one digest per owner and record the notified task IDs.
    // Dedup rows are inserted BEFORE sending so that a transient delivery failure
    // does not cause the same tasks to be re-notified on the next cron run.
    for (const [ownerId, { email, name, tasks }] of byOwner) {
      try {
        // Mark tasks as notified first — prevents duplicate emails on delivery failure
        const placeholders = tasks.map((_, i) => `($${i + 1})`).join(', ');
        await pool.query(
          `INSERT INTO overdue_task_notifications (activity_id)
           VALUES ${placeholders}
           ON CONFLICT DO NOTHING`,
          tasks.map((t) => t.id),
        );

        await sendOverdueTaskDigest(email, name, tasks);

        logger.info({ ownerId, count: tasks.length }, 'notificationService: overdue digest sent');
      } catch (err) {
        // Log but continue — one failing user should not block others
        logger.error(
          { err, ownerId },
          'notificationService: failed to send overdue digest to user',
        );
      }
    }
  } catch (err) {
    logger.error({ err }, 'notificationService: sendOverdueDigests failed');
  }
}
