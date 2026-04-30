/**
 * Shared Zod schemas for webhook subscription validation.
 * Imported by both the server (request validation) and the client (API types).
 */

import { z } from 'zod';

// ── Event types ────────────────────────────────────────────────────────────────

/** All supported webhook event types. */
export const WEBHOOK_EVENT_TYPES = [
  'contact.created',
  'contact.updated',
  'contact.deleted',
  'account.created',
  'account.updated',
  'account.deleted',
  'deal.created',
  'deal.updated',
  'deal.stage_changed',
  'deal.won',
  'deal.lost',
  'deal.deleted',
  'activity.created',
  'activity.completed',
  'user.invited',
  'user.activated',
  'user.deactivated',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

// ── Subscription schemas ───────────────────────────────────────────────────────

export const createWebhookSubscriptionSchema = z.object({
  url: z.string().url('URL must be a valid URL'),
  events: z
    .array(z.enum(WEBHOOK_EVENT_TYPES))
    .min(1, 'At least one event type is required'),
});

export const updateWebhookSubscriptionSchema = z
  .object({
    url: z.string().url('URL must be a valid URL').optional(),
    events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1, 'At least one event type is required').optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

// ── Response schemas ───────────────────────────────────────────────────────────

/** Safe subscription response — never exposes secret_hash */
export const webhookSubscriptionResponseSchema = z.object({
  id: z.string().uuid(),
  url: z.string(),
  events: z.array(z.string()),
  status: z.enum(['active', 'failed', 'disabled']),
  created_by: z.string().uuid(),
  created_at: z.string().or(z.date()),
});

export const webhookDeliveryLogResponseSchema = z.object({
  id: z.string().uuid(),
  subscription_id: z.string().uuid().nullable(),
  event_id: z.string().uuid(),
  event_type: z.string(),
  attempt: z.number(),
  status_code: z.number().nullable(),
  response_ms: z.number().nullable(),
  error: z.string().nullable(),
  delivered_at: z.string().or(z.date()),
});

// ── Inferred types ─────────────────────────────────────────────────────────────

export type CreateWebhookSubscriptionInput = z.infer<typeof createWebhookSubscriptionSchema>;
export type UpdateWebhookSubscriptionInput = z.infer<typeof updateWebhookSubscriptionSchema>;
export type WebhookSubscriptionResponse = z.infer<typeof webhookSubscriptionResponseSchema>;
export type WebhookDeliveryLogResponse = z.infer<typeof webhookDeliveryLogResponseSchema>;
