/**
 * Notification feed controller — request/response shaping only.
 * No business logic here; all DB access goes through notificationFeedService.
 */

import type { Request, Response } from 'express';
import {
  getNotificationFeed,
  markNotificationRead,
  markAllNotificationsRead,
} from '../services/notificationFeedService.js';

/** GET /api/v1/notifications */
export async function getNotificationFeedHandler(req: Request, res: Response): Promise<void> {
  const result = await getNotificationFeed(req.user!.id);
  res.status(200).json(result);
}

/** POST /api/v1/notifications/:id/read */
export async function markNotificationReadHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  await markNotificationRead(id, req.user!.id);
  const result = await getNotificationFeed(req.user!.id);
  res.status(200).json(result);
}

/** POST /api/v1/notifications/read-all */
export async function markAllNotificationsReadHandler(req: Request, res: Response): Promise<void> {
  await markAllNotificationsRead(req.user!.id);
  const result = await getNotificationFeed(req.user!.id);
  res.status(200).json(result);
}
