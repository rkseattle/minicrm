/**
 * Shared types for the minimal in-app notification feed. (MINCRM-469)
 * Used by both client and server.
 */

export interface NotificationFeedItem {
  id: string;
  /** Free text, not a DB enum — new notification-producing features can start writing without a migration. */
  type: string;
  title: string;
  body: string | null;
  link_path: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationFeedResponse {
  notifications: NotificationFeedItem[];
  unread_count: number;
}
