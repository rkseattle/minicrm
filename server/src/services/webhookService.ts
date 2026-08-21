/**
 * Webhook service — manages webhook subscriptions and delivers outbound webhook events.
 *
 * Two delivery modes:
 *  1. System subscriptions — admins subscribe endpoint URLs to specific event types;
 *     delivery is fire-and-forget with exponential-backoff retry (up to 5 attempts).
 *  2. Automation-triggered — `send_webhook` automation action; single attempt, no retry,
 *     subscription_id = null in delivery logs.
 *
 * Secret storage: signing secrets are stored AES-256-GCM encrypted (not bcrypt-hashed)
 * so the plaintext can be recovered at delivery time for HMAC-SHA256 signing.
 */

import crypto from 'crypto';
import type { PoolClient } from 'pg';
import pool from '../db.js';
import logger from '../logger.js';
import { encrypt, decrypt } from './cryptoService.js';
import { writeAuditEntry } from './auditService.js';
import type { AuditActor } from './auditService.js';
import { assertUrlIsFetchSafe, UrlNotSafeError } from '../utils/urlSafetyUtils.js';
import type { PaginatedResponse } from '@minicrm/shared/schemas/paginationSchema.js';
import type {
  WebhookEventType,
  CreateWebhookSubscriptionInput,
  UpdateWebhookSubscriptionInput,
} from '@minicrm/shared/schemas/webhookSchema.js';

// ── Constants ──────────────────────────────────────────────────────────────────

/** Fixed delays in ms for retry attempts 2–5. A lookup table, not a computed curve. */
const RETRY_DELAYS_MS = [
  5 * 60_000, // attempt 2: 5 min
  30 * 60_000, // attempt 3: 30 min
  2 * 60 * 60_000, // attempt 4: 2 h
  6 * 60 * 60_000, // attempt 5: 6 h
] as const;

/** Maximum number of delivery attempts before marking a subscription failed */
const MAX_ATTEMPTS = 5;

/** Timeout for all outbound webhook HTTP calls */
const DELIVERY_TIMEOUT_MS = 10_000;

/** Columns that may be updated via updateWebhookSubscription */
const ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateWebhookSubscriptionInput> = new Set([
  'url',
  'events',
  'status',
]);

/**
 * Error thrown when a webhook URL resolves to a blocked address.
 * Controller maps this to HTTP 422 with WEBHOOK_URL_NOT_ALLOWED.
 */
export class WebhookUrlNotAllowedError extends Error {
  readonly code = 'WEBHOOK_URL_NOT_ALLOWED' as const;
  constructor(reason: string) {
    super(reason);
    this.name = 'WebhookUrlNotAllowedError';
  }
}

/**
 * Validates that a webhook URL is safe to deliver to — thin wrapper over the shared
 * SSRF check in urlSafetyUtils.ts, translated to this service's error type so
 * existing callers/controllers are unaffected. See assertUrlIsFetchSafe() for the
 * checks performed (HTTPS-in-production, DNS resolution, blocked-range check).
 *
 * Called both at subscription creation/update time and immediately before every
 * delivery attempt (DNS rebinding mitigation).
 */
export async function validateWebhookUrl(urlString: string): Promise<void> {
  try {
    await assertUrlIsFetchSafe(urlString);
  } catch (err) {
    if (err instanceof UrlNotSafeError) {
      throw new WebhookUrlNotAllowedError(err.message);
    }
    throw err;
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────

const SYSTEM_ACTOR: AuditActor = {
  id: '00000000-0000-0000-0000-000000000000',
  name: 'System',
};

/** Shape of a webhook_subscriptions row */
export interface WebhookSubscriptionRow {
  id: string;
  url: string;
  events: string[];
  secret_hash: string;
  status: 'active' | 'failed' | 'disabled';
  /** NULL when the creating user has been deleted */
  created_by: string | null;
  created_at: Date;
}

/** Shape of a webhook_delivery_logs row */
export interface WebhookDeliveryLogRow {
  id: string;
  subscription_id: string | null;
  event_id: string;
  event_type: string;
  attempt: number;
  status_code: number | null;
  response_ms: number | null;
  error: string | null;
  delivered_at: Date;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/**
 * Computes HMAC-SHA256 of rawBody signed with secret.
 * Returns the hex digest for the X-MiniCRM-Signature header.
 */
export function signPayload(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** Inserts a single delivery log row */
async function writeDeliveryLog(params: {
  subscriptionId: string | null;
  eventId: string;
  eventType: string;
  attempt: number;
  statusCode: number | null;
  responseMs: number | null;
  error: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO webhook_delivery_logs
       (subscription_id, event_id, event_type, attempt, status_code, response_ms, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      params.subscriptionId,
      params.eventId,
      params.eventType,
      params.attempt,
      params.statusCode,
      params.responseMs,
      params.error,
    ],
  );
}

/**
 * Performs a single HTTP delivery attempt.
 * Returns the HTTP status code on success; throws on network/timeout error.
 */
async function attemptDelivery(url: string, rawBody: string, signature: string): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    // redirect: 'manual' — fetch() follows redirects by default, which would let a
    // subscription's endpoint 3xx to a blocked address (e.g. cloud metadata) and
    // bypass validateWebhookUrl()'s check of the original hostname entirely. A
    // redirect response is surfaced as its raw 3xx status rather than followed, so
    // callers see it as a non-2xx delivery outcome (retried/failed like any other
    // non-2xx), never as a silently-redirected request.
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MiniCRM-Signature': signature,
      },
      body: rawBody,
      signal: controller.signal,
      redirect: 'manual',
    });
    return response.status;
  } finally {
    clearTimeout(timer);
  }
}

/** Parameters for the self-scheduling delivery runner */
interface DeliverParams {
  subscriptionId: string;
  url: string;
  encryptedSecret: string;
  rawBody: string;
  eventId: string;
  eventType: string;
  attempt: number;
}

/**
 * Self-scheduling delivery runner.
 * On non-2xx or network error, schedules the next attempt with exponential backoff.
 * After MAX_ATTEMPTS failures marks the subscription 'failed' and notifies admins.
 */
async function deliverWithRetry(params: DeliverParams): Promise<void> {
  const { subscriptionId, url, encryptedSecret, rawBody, eventId, eventType, attempt } = params;
  const start = Date.now();
  let statusCode: number | null = null;
  let error: string | null = null;

  try {
    // Re-validate before each attempt to mitigate DNS rebinding attacks
    await validateWebhookUrl(url);

    const secret = decrypt(encryptedSecret);
    const signature = signPayload(rawBody, secret);
    statusCode = await attemptDelivery(url, rawBody, signature);
    const responseMs = Date.now() - start;

    await writeDeliveryLog({
      subscriptionId,
      eventId,
      eventType,
      attempt,
      statusCode,
      responseMs,
      error: null,
    });

    if (statusCode >= 200 && statusCode < 300) {
      return; // success — done
    }

    error = `HTTP ${statusCode}`;
  } catch (err) {
    const responseMs = Date.now() - start;
    error = err instanceof Error ? err.message : String(err);

    logger.warn(
      { subscriptionId, eventType, attempt, err },
      'webhookService: delivery attempt failed',
    );

    try {
      await writeDeliveryLog({
        subscriptionId,
        eventId,
        eventType,
        attempt,
        statusCode: null,
        responseMs,
        error,
      });
    } catch (logErr) {
      logger.error({ logErr }, 'webhookService: failed to write delivery log');
    }
  }

  // Schedule retry or mark failed
  const nextAttempt = attempt + 1;
  if (nextAttempt > MAX_ATTEMPTS) {
    logger.warn(
      { subscriptionId, url },
      'webhookService: subscription exhausted all retries, marking failed',
    );
    try {
      await pool.query(`UPDATE webhook_subscriptions SET status = 'failed' WHERE id = $1`, [
        subscriptionId,
      ]);
    } catch (updateErr) {
      logger.error(
        { subscriptionId, updateErr },
        'webhookService: failed to mark subscription as failed',
      );
    }
    // Notify admins — best-effort, no await
    void notifyWebhookFailed(subscriptionId, url).catch((notifyErr) => {
      logger.warn(
        { subscriptionId, notifyErr },
        'webhookService: admin notification for failed webhook failed',
      );
    });
    return;
  }

  const delayMs = RETRY_DELAYS_MS[nextAttempt - 2];
  setTimeout(() => {
    void deliverWithRetry({ ...params, attempt: nextAttempt }).catch((err) => {
      logger.error(
        { subscriptionId, eventType, attempt: nextAttempt, err },
        'webhookService: unhandled error in retry',
      );
    });
  }, delayMs);
}

/** Logs a warning when a webhook endpoint exhausts all retries. */
async function notifyWebhookFailed(subscriptionId: string, url: string): Promise<void> {
  // Log at warn level so monitoring systems can alert on this.
  // Full email notification for failed webhooks is a future enhancement.
  logger.warn(
    { subscriptionId, url },
    'webhookService: webhook endpoint exhausted all retries and has been disabled',
  );
}

// ── CRUD functions ─────────────────────────────────────────────────────────────

/**
 * Creates a new webhook subscription.
 * Generates a random signing secret, stores it encrypted, and returns the
 * plaintext once — it is never retrievable again.
 */
export async function createWebhookSubscription(
  params: CreateWebhookSubscriptionInput & { created_by: string },
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<{ subscription: WebhookSubscriptionRow; plaintextSecret: string }> {
  await validateWebhookUrl(params.url);

  const plaintextSecret = crypto.randomBytes(32).toString('hex');
  const encryptedSecret = encrypt(plaintextSecret);

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<WebhookSubscriptionRow>(
      `INSERT INTO webhook_subscriptions (url, events, secret_hash, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, url, events, secret_hash, status, created_by, created_at`,
      [params.url, params.events, encryptedSecret, params.created_by],
    );
    const subscription = result.rows[0];

    await writeAuditEntry(client, {
      recordType: 'system_settings',
      recordId: subscription.id,
      recordName: `Webhook: ${params.url}`,
      eventType: 'created',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    return { subscription, plaintextSecret };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Returns a single webhook subscription by ID, or null if not found. */
export async function findWebhookSubscriptionById(
  id: string,
): Promise<WebhookSubscriptionRow | null> {
  const result = await pool.query<WebhookSubscriptionRow>(
    `SELECT id, url, events, secret_hash, status, created_by, created_at
     FROM webhook_subscriptions
     WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/** Returns all webhook subscriptions ordered by creation date descending. */
export async function listWebhookSubscriptions(): Promise<WebhookSubscriptionRow[]> {
  const result = await pool.query<WebhookSubscriptionRow>(
    `SELECT id, url, events, secret_hash, status, created_by, created_at
     FROM webhook_subscriptions
     ORDER BY created_at DESC`,
  );
  return result.rows;
}

/**
 * Updates a webhook subscription.
 * Admins may update url, events, and status (active/disabled only — 'failed' is system-set).
 */
export async function updateWebhookSubscription(
  id: string,
  params: UpdateWebhookSubscriptionInput,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<WebhookSubscriptionRow | null> {
  if (params.url !== undefined) {
    await validateWebhookUrl(params.url);
  }

  const fields = Object.keys(params).filter((k) =>
    (ALLOWED_UPDATE_FIELDS as ReadonlySet<string>).has(k),
  ) as (keyof UpdateWebhookSubscriptionInput)[];

  if (fields.length === 0) return null;

  const setClauses = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
  const values = fields.map((f) => params[f]);

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<WebhookSubscriptionRow>(
      `UPDATE webhook_subscriptions
       SET ${setClauses}
       WHERE id = $1
       RETURNING id, url, events, secret_hash, status, created_by, created_at`,
      [id, ...values],
    );
    const subscription = result.rows[0] ?? null;

    if (subscription) {
      await writeAuditEntry(client, {
        recordType: 'system_settings',
        recordId: id,
        recordName: `Webhook: ${subscription.url}`,
        eventType: 'updated',
        changedById: actor.id,
        changedByName: actor.name,
      });
    }

    await client.query('COMMIT');
    return subscription;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Deletes a webhook subscription and its delivery logs (CASCADE). */
export async function deleteWebhookSubscription(
  id: string,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<WebhookSubscriptionRow | null> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<WebhookSubscriptionRow>(
      `DELETE FROM webhook_subscriptions WHERE id = $1
       RETURNING id, url, events, secret_hash, status, created_by, created_at`,
      [id],
    );
    const subscription = result.rows[0] ?? null;

    if (subscription) {
      await writeAuditEntry(client, {
        recordType: 'system_settings',
        recordId: id,
        recordName: `Webhook: ${subscription.url}`,
        eventType: 'deleted',
        changedById: actor.id,
        changedByName: actor.name,
      });
    }

    await client.query('COMMIT');
    return subscription;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Returns paginated delivery logs for a subscription.
 * Most recent deliveries first.
 */
export async function listWebhookDeliveryLogs(
  subscriptionId: string,
  options: { page: number; limit: number },
): Promise<PaginatedResponse<WebhookDeliveryLogRow>> {
  const { page, limit } = options;
  const offset = (page - 1) * limit;

  const [countResult, rowsResult] = await Promise.all([
    pool.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM webhook_delivery_logs WHERE subscription_id = $1`,
      [subscriptionId],
    ),
    pool.query<WebhookDeliveryLogRow>(
      `SELECT id, subscription_id, event_id, event_type, attempt,
              status_code, response_ms, error, delivered_at
       FROM webhook_delivery_logs
       WHERE subscription_id = $1
       ORDER BY delivered_at DESC
       LIMIT $2 OFFSET $3`,
      [subscriptionId, limit, offset],
    ),
  ]);

  return {
    data: rowsResult.rows,
    total: parseInt(countResult.rows[0].total, 10),
    page,
    limit,
  };
}

// ── Dispatch ───────────────────────────────────────────────────────────────────

/**
 * Dispatches a webhook event to all active subscriptions listening to this event type.
 * Fire-and-forget: wrapped in setImmediate so it never blocks the originating operation.
 * All errors are caught internally and logged.
 *
 * @param eventType - CRM event type (e.g. 'contact.created')
 * @param data - Full current state of the record
 * @param previousData - Previous state; included for .updated and .stage_changed events
 */
export function dispatchWebhookEvent(
  eventType: WebhookEventType,
  data: Record<string, unknown>,
  previousData?: Record<string, unknown>,
): void {
  setImmediate(() => {
    void (async () => {
      const eventId = crypto.randomUUID();
      const payload: Record<string, unknown> = {
        event: eventType,
        event_id: eventId,
        timestamp: new Date().toISOString(),
        delivery_attempt: 1,
        data,
      };
      if (previousData !== undefined) {
        payload.previous_data = previousData;
      }
      const rawBody = JSON.stringify(payload);

      let subscriptions: WebhookSubscriptionRow[];
      try {
        const result = await pool.query<WebhookSubscriptionRow>(
          `SELECT id, url, events, secret_hash, status, created_by, created_at
           FROM webhook_subscriptions
           WHERE status = 'active' AND $1 = ANY(events)`,
          [eventType],
        );
        subscriptions = result.rows;
      } catch (err) {
        logger.error(
          { eventType, err },
          'webhookService: failed to fetch subscriptions for dispatch',
        );
        return;
      }

      for (const sub of subscriptions) {
        void deliverWithRetry({
          subscriptionId: sub.id,
          url: sub.url,
          encryptedSecret: sub.secret_hash,
          rawBody,
          eventId,
          eventType,
          attempt: 1,
        }).catch((err) => {
          logger.error(
            { subscriptionId: sub.id, eventType, err },
            'webhookService: unhandled error in deliverWithRetry',
          );
        });
      }
    })();
  });
}

/**
 * Executes a one-shot webhook delivery for an automation send_webhook action.
 * Single attempt only, no retry. Logs to webhook_delivery_logs with subscription_id = null.
 */
export async function sendWebhookForAutomation(params: {
  url: string;
  method: 'POST' | 'GET';
  headers?: Record<string, string>;
  eventType: string;
  data: Record<string, unknown>;
}): Promise<void> {
  const eventId = crypto.randomUUID();
  const payload = {
    event: params.eventType,
    event_id: eventId,
    timestamp: new Date().toISOString(),
    delivery_attempt: 1,
    data: params.data,
  };
  const rawBody = JSON.stringify(payload);
  const start = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const response = await fetch(params.url, {
      method: params.method,
      headers: {
        'Content-Type': 'application/json',
        ...params.headers,
      },
      body: params.method === 'POST' ? rawBody : undefined,
      signal: controller.signal,
    });
    const responseMs = Date.now() - start;

    await writeDeliveryLog({
      subscriptionId: null,
      eventId,
      eventType: params.eventType,
      attempt: 1,
      statusCode: response.status,
      responseMs,
      error: response.ok ? null : `HTTP ${response.status}`,
    });
  } catch (err) {
    const responseMs = Date.now() - start;
    const errorMsg = err instanceof Error ? err.message : String(err);

    await writeDeliveryLog({
      subscriptionId: null,
      eventId,
      eventType: params.eventType,
      attempt: 1,
      statusCode: null,
      responseMs,
      error: errorMsg,
    });

    throw err;
  } finally {
    clearTimeout(timer);
  }
}
