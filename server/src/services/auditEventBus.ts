/**
 * Audit event bus — subscribes to the PostgreSQL 'audit_events' NOTIFY channel
 * and re-emits payloads as Node EventEmitter events.
 *
 * A single dedicated PoolClient is held for the lifetime of the server process.
 * It never returns to the pool — returning a LISTEN client to the pool would
 * leave the next caller in a LISTEN state, corrupting pool connection management.
 *
 * Consumers (e.g. gRPC streaming handler) subscribe via:
 *   auditEventBus.on('audit_event', (event: AuditNotification) => { ... })
 *
 */

import { EventEmitter } from 'events';
import type { Pool, PoolClient } from 'pg';
import logger from '../logger.js';

/** Reconnect delay in milliseconds after a connection error */
const RECONNECT_DELAY_MS = 5_000;

/** The PostgreSQL NOTIFY channel name */
const AUDIT_CHANNEL = 'audit_events';

/**
 * Shape of the JSON payload delivered by the audit_log_notify trigger.
 * Field names match the audit_log column names.
 */
export interface AuditNotification {
  id: string;
  record_type: string;
  record_id: string | null;
  record_name: string | null;
  event_type: string;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  changed_by_id: string | null;
  changed_by_name: string | null;
  source: string | null;
  created_at: string;
}

class AuditEventBus extends EventEmitter {
  private client: PoolClient | null = null;
  private pool: Pool | null = null;

  /**
   * Returns an async iterator over live AuditNotification events.
   *
   * The iterator yields events until the provided AbortSignal fires (client
   * disconnect or handler cancellation). Callers use this in a for-await loop;
   * no manual listener cleanup is required.
   *
   * @param signal - AbortSignal from ConnectRPC HandlerContext; fires on client disconnect.
   */
  asyncIterator(signal: AbortSignal): AsyncGenerator<AuditNotification> {
    // Use a closure queue + promise-resolve pair to bridge EventEmitter → async iterator.
    const queue: AuditNotification[] = [];
    let resolve: (() => void) | null = null;
    let done = false;

    const onEvent = (event: AuditNotification): void => {
      queue.push(event);
      resolve?.();
      resolve = null;
    };

    const onAbort = (): void => {
      done = true;
      resolve?.();
      resolve = null;
      this.removeListener('audit_event', onEvent);
    };

    this.on('audit_event', onEvent);
    signal.addEventListener('abort', onAbort, { once: true });

    return (async function* () {
      try {
        while (!done) {
          while (queue.length > 0) {
            yield queue.shift()!; // Non-null: we just checked queue.length > 0
          }
          if (!done) {
            await new Promise<void>((r) => {
              resolve = r;
            });
          }
        }
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    })();
  }

  /**
   * Acquires a dedicated connection from the pool, issues LISTEN, and wires
   * up notification and error handlers. Must be called once during server
   * startup, before HTTP connections are accepted.
   *
   * @param pool - The application connection pool
   */
  async start(pool: Pool): Promise<void> {
    this.pool = pool;
    this.client = await pool.connect();

    await this.client.query(`LISTEN ${AUDIT_CHANNEL}`);

    this.client.on('notification', (msg) => {
      if (msg.channel !== AUDIT_CHANNEL || !msg.payload) return;
      try {
        const event = JSON.parse(msg.payload) as AuditNotification;
        this.emit('audit_event', event);
      } catch (err) {
        logger.warn({ err, payload: msg.payload }, 'auditEventBus: malformed NOTIFY payload');
      }
    });

    this.client.on('error', (err) => {
      logger.error({ err }, 'auditEventBus: LISTEN connection error — reconnecting in 5 s');
      this.client = null;
      // Guard: pool may have been shut down before the reconnect fires
      if (this.pool) {
        setTimeout(() => {
          if (this.pool) void this.start(this.pool);
        }, RECONNECT_DELAY_MS);
      }
    });

    logger.info('auditEventBus: LISTEN connection established');
  }

  /**
   * Releases the dedicated connection and clears internal state.
   * Must be called during graceful shutdown, before the pool is drained.
   */
  async stop(): Promise<void> {
    this.pool = null;
    if (this.client) {
      this.client.removeAllListeners();
      this.client.release();
      this.client = null;
      logger.info('auditEventBus: LISTEN connection released');
    }
  }
}

export const auditEventBus = new AuditEventBus();
