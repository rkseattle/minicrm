/**
 * gRPC service implementation for the AuditService (MINCRM-376).
 *
 * Implements two RPCs:
 *   ListAuditEvents  — unary, wraps listAuditLog() with proto mapping
 *   StreamAuditEvents — server-streaming, pushes live events from auditEventBus
 *
 * Both RPCs enforce JWT authentication (via gRPC metadata) and admin-only access.
 */

import * as grpc from '@grpc/grpc-js';
import jwt from 'jsonwebtoken';
import logger from '../logger.js';
import { findUserById } from '../services/userService.js';
import { listAuditLog, maskAuditEvent } from '../services/auditService.js';
import type { AuditLogRow, AuditRecordType } from '../services/auditService.js';
import { auditEventBus } from '../services/auditEventBus.js';
import type { AuditNotification } from '../services/auditEventBus.js';
import type { JwtTokenPayload } from '../types/express.js';

// ── Proto message shapes (must match audit.proto field names) ──────────────────

/** Mirrors the proto AuditRequest message */
export interface AuditRequest {
  record_type: string;
  record_id: string;
  after: string;
  before: string;
  page: number;
  limit: number;
}

/** Mirrors the proto AuditEvent message */
export interface AuditEvent {
  id: string;
  record_type: string;
  record_id: string;
  action: string;
  field_name: string;
  old_value: string;
  new_value: string;
  changed_by: string;
  changed_at: string;
}

/** Mirrors the proto AuditResponse message */
export interface AuditResponse {
  events: AuditEvent[];
  total: number;
  page: number;
  limit: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default page size for ListAuditEvents when the caller omits limit */
const DEFAULT_LIMIT = 25;

// ── Auth helpers ──────────────────────────────────────────────────────────────

/**
 * Validates the JWT from gRPC metadata and returns the decoded payload.
 * Returns null if the token is missing, invalid, or belongs to an inactive user.
 * Returns the string 'PERMISSION_DENIED' if the user is active but not an admin.
 */
async function validateAdminToken(
  metadata: grpc.Metadata,
): Promise<JwtTokenPayload | null | 'PERMISSION_DENIED'> {
  const authValues = metadata.get('authorization');
  if (!authValues.length) return null;

  const raw = String(authValues[0]);
  // Accept both "Bearer <token>" and bare "<token>"
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : raw;

  let decoded: JwtTokenPayload;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET ?? '') as JwtTokenPayload;
  } catch {
    return null;
  }

  let user: Awaited<ReturnType<typeof findUserById>>;
  try {
    user = await findUserById(decoded.id);
  } catch {
    return null;
  }

  if (!user || user.status !== 'active') return null;
  if (user.role !== 'admin') return 'PERMISSION_DENIED';

  return decoded;
}

// ── Mapping helpers ───────────────────────────────────────────────────────────

/** Maps an AuditLogRow (DB result) to the proto AuditEvent shape */
function rowToEvent(row: AuditLogRow): AuditEvent {
  return {
    id: row.id,
    record_type: row.record_type,
    record_id: row.record_id ?? '',
    action: row.event_type,
    field_name: row.field_name ?? '',
    old_value: row.old_value ?? '',
    new_value: row.new_value ?? '',
    changed_by: row.changed_by_name ?? '',
    changed_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

/** Maps an AuditNotification (NOTIFY payload) to the proto AuditEvent shape */
function notificationToEvent(n: AuditNotification): AuditEvent {
  return {
    id: n.id,
    record_type: n.record_type,
    record_id: n.record_id ?? '',
    action: n.event_type,
    field_name: n.field_name ?? '',
    old_value: n.old_value ?? '',
    new_value: n.new_value ?? '',
    changed_by: n.changed_by_name ?? '',
    changed_at: n.created_at,
  };
}

/** Returns true when a notification matches the stream filter in the request */
function matchesStreamFilter(notification: AuditNotification, req: AuditRequest): boolean {
  if (req.record_type && notification.record_type !== req.record_type) return false;
  if (req.record_id && notification.record_id !== req.record_id) return false;
  if (req.after && notification.created_at < req.after) return false;
  return true;
}

// ── RPC handlers ──────────────────────────────────────────────────────────────

/**
 * ListAuditEvents — unary RPC.
 *
 * Accepts pagination + filter params, calls listAuditLog(), and returns a
 * paginated AuditResponse. Requires admin JWT in 'authorization' metadata.
 */
export async function listAuditEventsHandler(
  call: grpc.ServerUnaryCall<AuditRequest, AuditResponse>,
  callback: grpc.sendUnaryData<AuditResponse>,
): Promise<void> {
  const authResult = await validateAdminToken(call.metadata);
  if (authResult === null) {
    callback({ code: grpc.status.UNAUTHENTICATED, message: 'Authentication required' });
    return;
  }
  if (authResult === 'PERMISSION_DENIED') {
    callback({ code: grpc.status.PERMISSION_DENIED, message: 'Admin role required' });
    return;
  }

  const req = call.request;
  const page = req.page > 0 ? req.page : 1;
  const limit = req.limit > 0 ? req.limit : DEFAULT_LIMIT;

  try {
    // Cast record_type: the service expects AuditRecordType; the proto carries a plain
    // string. Passing an unknown value is safe — the service will simply return no
    // results if the caller supplies an unrecognised type.
    const result = await listAuditLog({
      recordType: (req.record_type || undefined) as AuditRecordType | undefined,
      recordId: req.record_id || undefined,
      from: req.after || undefined,
      to: req.before || undefined,
      page,
      limit,
    });

    callback(null, {
      events: result.data.map(rowToEvent),
      total: result.total,
      page: result.page,
      limit: result.limit,
    });
  } catch (err) {
    logger.error({ err }, 'ListAuditEvents: query failed');
    callback({ code: grpc.status.INTERNAL, message: 'Internal error' });
  }
}

/**
 * StreamAuditEvents — server-streaming RPC.
 *
 * Subscribes to auditEventBus and writes matching live events to the stream.
 * Applies GDPR masking before forwarding. Handles backpressure by dropping
 * events when the write buffer is full. Requires admin JWT in metadata.
 *
 * The handler is intentionally synchronous: grpc-js calls server-streaming
 * handlers fire-and-forget (the return value is ignored), so declaring it
 * async would mean the bus listener is registered only after the first await,
 * creating a window where a NOTIFY could be missed before auth completes.
 * Instead, the listener is registered immediately and guarded by authValidated.
 */
export function streamAuditEventsHandler(
  call: grpc.ServerWritableStream<AuditRequest, AuditEvent>,
): void {
  const req = call.request;
  let authValidated = false;

  const listener = async (notification: AuditNotification): Promise<void> => {
    // Drop events that arrive before auth completes.
    if (!authValidated) return;
    if (!matchesStreamFilter(notification, req)) return;

    let masked: AuditNotification;
    try {
      masked = await maskAuditEvent(notification);
    } catch (err) {
      logger.warn({ err }, 'StreamAuditEvents: maskAuditEvent failed — skipping event');
      return;
    }

    // Backpressure: drop the event if the writable buffer is full rather than blocking the bus.
    if (call.writableNeedDrain) {
      logger.warn(
        { eventId: notification.id },
        'StreamAuditEvents: write buffer full — dropping event',
      );
      return;
    }

    try {
      call.write(notificationToEvent(masked));
    } catch (err) {
      logger.warn({ err }, 'StreamAuditEvents: write failed — client may have disconnected');
    }
  };

  // Wrap the async listener in a synchronous shim so we can remove it by reference.
  const busListener = (n: AuditNotification): void => {
    void listener(n);
  };

  // Register BEFORE any await so no NOTIFY can slip through during auth validation.
  auditEventBus.on('audit_event', busListener);

  const cleanup = (): void => {
    auditEventBus.removeListener('audit_event', busListener);
  };

  call.on('cancelled', () => {
    cleanup();
    call.end();
  });

  call.on('close', cleanup);

  // Auth runs async after the listener is already attached.
  void (async () => {
    const authResult = await validateAdminToken(call.metadata);
    if (authResult === null) {
      cleanup();
      call.destroy(
        Object.assign(new Error('Authentication required'), {
          code: grpc.status.UNAUTHENTICATED,
        }),
      );
      return;
    }
    if (authResult === 'PERMISSION_DENIED') {
      cleanup();
      call.destroy(
        Object.assign(new Error('Admin role required'), {
          code: grpc.status.PERMISSION_DENIED,
        }),
      );
      return;
    }
    // Open the gate — events from this point forward will be forwarded.
    authValidated = true;
  })();
}
