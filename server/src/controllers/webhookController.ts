/**
 * Webhook controller — request/response shaping for webhook subscription endpoints.
 * No business logic here; all DB access goes through webhookService.
 * All endpoints are admin-only (enforced by the route layer via requireRole).
 */

import type { Request, Response } from 'express';
import {
  createWebhookSubscriptionSchema,
  updateWebhookSubscriptionSchema,
} from '@minicrm/shared/schemas/webhookSchema.js';
import { paginationParamsSchema } from '@minicrm/shared/schemas/paginationSchema.js';
import {
  createWebhookSubscription,
  findWebhookSubscriptionById,
  listWebhookSubscriptions,
  updateWebhookSubscription,
  deleteWebhookSubscription,
  listWebhookDeliveryLogs,
  WebhookUrlNotAllowedError,
} from '../services/webhookService.js';

/**
 * POST /api/v1/admin/webhooks
 * Creates a new webhook subscription. Returns the subscription and the plaintext
 * signing secret (shown once — not retrievable again). Admin only.
 */
export async function createWebhookSubscriptionHandler(req: Request, res: Response): Promise<void> {
  const parsed = createWebhookSubscriptionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  let subscription;
  let plaintextSecret;
  try {
    ({ subscription, plaintextSecret } = await createWebhookSubscription(
      { ...parsed.data, created_by: req.user!.id },
      actor,
    ));
  } catch (err) {
    if (err instanceof WebhookUrlNotAllowedError) {
      res.status(422).json({ error: { code: err.code, message: err.message } });
      return;
    }
    throw err;
  }

  // Expose safe fields only — never return secret_hash
  res.status(201).json({
    subscription: {
      id: subscription.id,
      url: subscription.url,
      events: subscription.events,
      status: subscription.status,
      created_by: subscription.created_by,
      created_at: subscription.created_at,
    },
    plaintextSecret,
  });
}

/**
 * GET /api/v1/admin/webhooks
 * Lists all webhook subscriptions. Admin only.
 */
export async function listWebhookSubscriptionsHandler(_req: Request, res: Response): Promise<void> {
  const rows = await listWebhookSubscriptions();
  const subscriptions = rows.map((s) => ({
    id: s.id,
    url: s.url,
    events: s.events,
    status: s.status,
    created_by: s.created_by,
    created_at: s.created_at,
  }));
  res.status(200).json({ subscriptions });
}

/**
 * GET /api/v1/admin/webhooks/:id
 * Returns a single webhook subscription. Admin only.
 */
export async function getWebhookSubscriptionHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const sub = await findWebhookSubscriptionById(id);

  if (!sub) {
    res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Webhook subscription not found' } });
    return;
  }

  res.status(200).json({
    subscription: {
      id: sub.id,
      url: sub.url,
      events: sub.events,
      status: sub.status,
      created_by: sub.created_by,
      created_at: sub.created_at,
    },
  });
}

/**
 * PATCH /api/v1/admin/webhooks/:id
 * Updates a webhook subscription (url, events, status). Admin only.
 */
export async function updateWebhookSubscriptionHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateWebhookSubscriptionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const id = String(req.params['id']);
  const actor = { id: req.user!.id, name: req.user!.name };
  let sub;
  try {
    sub = await updateWebhookSubscription(id, parsed.data, actor);
  } catch (err) {
    if (err instanceof WebhookUrlNotAllowedError) {
      res.status(422).json({ error: { code: err.code, message: err.message } });
      return;
    }
    throw err;
  }

  if (!sub) {
    res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Webhook subscription not found' } });
    return;
  }

  res.status(200).json({
    subscription: {
      id: sub.id,
      url: sub.url,
      events: sub.events,
      status: sub.status,
      created_by: sub.created_by,
      created_at: sub.created_at,
    },
  });
}

/**
 * DELETE /api/v1/admin/webhooks/:id
 * Deletes a webhook subscription and its delivery logs. Admin only.
 */
export async function deleteWebhookSubscriptionHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const actor = { id: req.user!.id, name: req.user!.name };
  const deleted = await deleteWebhookSubscription(id, actor);

  if (!deleted) {
    res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Webhook subscription not found' } });
    return;
  }

  res.status(204).send();
}

/**
 * GET /api/v1/admin/webhooks/:id/logs
 * Returns paginated delivery logs for a subscription. Admin only.
 */
export async function listWebhookDeliveryLogsHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);

  const sub = await findWebhookSubscriptionById(id);
  if (!sub) {
    res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Webhook subscription not found' } });
    return;
  }

  const parsed = paginationParamsSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const result = await listWebhookDeliveryLogs(id, parsed.data);
  res.status(200).json(result);
}
