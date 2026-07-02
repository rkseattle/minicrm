/**
 * In-app notification feed service. (MINCRM-469)
 *
 * Minimal, generic notification primitive — insert a row, list a user's feed,
 * mark as read. Deliberately separate from notificationService.ts, which is
 * scoped to batched email delivery (queueAssignmentNotification,
 * sendOverdueDigests) and has no in-app/DB-persisted concept.
 *
 * type is free text (not a DB enum), matching the ai_token_usage_daily.feature
 * convention — new notification-producing features can start writing rows
 * without a migration.
 */

import pool from '../db.js';
import type {
  NotificationFeedItem,
  NotificationFeedResponse,
} from '@minicrm/shared/schemas/notificationFeedSchema.js';

interface CreateNotificationParams {
  userId: string;
  type: string;
  title: string;
  body?: string;
  linkPath?: string;
}

/** Inserts a new notification row for a user. Fire-and-forget callers should not await this synchronously in a request path — call from a background job context. */
export async function createNotification(params: CreateNotificationParams): Promise<void> {
  await pool.query(
    `INSERT INTO notifications (user_id, type, title, body, link_path)
     VALUES ($1, $2, $3, $4, $5)`,
    [params.userId, params.type, params.title, params.body ?? null, params.linkPath ?? null],
  );
}

/** Returns the most recent notifications for a user, plus the unread count. */
export async function getNotificationFeed(
  userId: string,
  limit = 50,
): Promise<NotificationFeedResponse> {
  const [listResult, countResult] = await Promise.all([
    pool.query<{
      id: string;
      type: string;
      title: string;
      body: string | null;
      link_path: string | null;
      read_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, type, title, body, link_path, read_at, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
      [userId],
    ),
  ]);

  const notifications: NotificationFeedItem[] = listResult.rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link_path: row.link_path,
    read_at: row.read_at ? row.read_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
  }));

  return {
    notifications,
    unread_count: parseInt(countResult.rows[0]?.count ?? '0', 10),
  };
}

/** Marks a single notification as read. Ownership must be checked by the caller. */
export async function markNotificationRead(notificationId: string, userId: string): Promise<void> {
  await pool.query(
    `UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
    [notificationId, userId],
  );
}

/** Marks all of a user's notifications as read. */
export async function markAllNotificationsRead(userId: string): Promise<void> {
  await pool.query(
    `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  );
}
