/**
 * ConnectRPC service implementation for the AuditService.
 *
 * Replaces the @grpc/grpc-js implementation from that change with
 * @connectrpc/connect-express, which serves gRPC, gRPC-Web, and the Connect
 * protocol on the same Express port as REST routes.
 *
 * Auth reads the JWT from the httpOnly cookie (same as the REST authenticate
 * middleware) rather than from gRPC metadata, so browser clients work without
 * any JavaScript access to the token.
 */

import { ConnectError, Code } from '@connectrpc/connect';
import type { ConnectRouter, HandlerContext } from '@connectrpc/connect';
import type { PartialMessage } from '@bufbuild/protobuf';
import jwt from 'jsonwebtoken';
import cookieLib from 'cookie';
import logger from '../logger.js';
import { findUserById } from '../services/userService.js';
import { listAuditLog, maskAuditEvent } from '../services/auditService.js';
import type { AuditLogRow, AuditRecordType, AuditEventType } from '../services/auditService.js';
import { auditEventBus } from '../services/auditEventBus.js';
import type { AuditNotification } from '../services/auditEventBus.js';
import type { JwtTokenPayload } from '../types/express.js';
import { AuditService } from '@minicrm/shared/generated/audit_connect.js';
import { AuditEvent, AuditResponse } from '@minicrm/shared/generated/audit_pb.js';
import type { AuditRequest } from '@minicrm/shared/generated/audit_pb.js';
import { AUTH_COOKIE_NAME } from '../middleware/auth.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 25;

// ── Auth helpers ──────────────────────────────────────────────────────────────

/**
 * Extracts and validates the admin JWT from the HTTP Cookie header in the
 * ConnectRPC call context. Throws a ConnectError on auth failure.
 *
 * The Connect/gRPC-Web transport sends the browser's cookies automatically
 * on same-origin requests, so no JS access to the httpOnly token is needed.
 */
async function requireAdminFromCookie(ctx: HandlerContext): Promise<JwtTokenPayload> {
  const cookieHeader = ctx.requestHeader.get('cookie') ?? '';
  const cookies = cookieLib.parse(cookieHeader);
  const rawToken = cookies[AUTH_COOKIE_NAME];

  // Also accept Authorization: Bearer <token> for non-browser clients (E2E tests via grpcClient).
  const authHeader = ctx.requestHeader.get('authorization') ?? '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  const token = rawToken ?? bearerToken;

  if (!token) {
    throw new ConnectError('Authentication required', Code.Unauthenticated);
  }

  let decoded: JwtTokenPayload;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET ?? '') as JwtTokenPayload;
  } catch {
    throw new ConnectError('Invalid or expired token', Code.Unauthenticated);
  }

  let user: Awaited<ReturnType<typeof findUserById>>;
  try {
    user = await findUserById(decoded.id);
  } catch {
    throw new ConnectError('Authentication error', Code.Internal);
  }

  if (!user || user.status !== 'active') {
    throw new ConnectError('Account is inactive', Code.Unauthenticated);
  }

  if (user.role !== 'admin') {
    throw new ConnectError('Admin role required', Code.PermissionDenied);
  }

  return decoded;
}

// ── Mapping helpers ───────────────────────────────────────────────────────────

function rowToEvent(row: AuditLogRow): PartialMessage<AuditEvent> {
  return {
    id: row.id,
    recordType: row.record_type,
    recordId: row.record_id ?? '',
    action: row.event_type,
    fieldName: row.field_name ?? '',
    oldValue: row.old_value ?? '',
    newValue: row.new_value ?? '',
    changedBy: row.changed_by_name ?? '',
    changedAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    source: row.source ?? '',
  };
}

function notificationToEvent(n: AuditNotification): PartialMessage<AuditEvent> {
  return {
    id: n.id,
    recordType: n.record_type,
    recordId: n.record_id ?? '',
    action: n.event_type,
    fieldName: n.field_name ?? '',
    oldValue: n.old_value ?? '',
    newValue: n.new_value ?? '',
    changedBy: n.changed_by_name ?? '',
    changedAt: n.created_at,
    source: n.source ?? '',
  };
}

function matchesStreamFilter(notification: AuditNotification, req: AuditRequest): boolean {
  if (req.recordType && notification.record_type !== req.recordType) return false;
  if (req.recordId && notification.record_id !== req.recordId) return false;
  if (req.after && notification.created_at < req.after) return false;
  if (req.source) {
    const notifSource = notification.source ?? null;
    if (req.source === 'human' && notifSource !== null) return false;
    if (req.source !== 'human' && notifSource !== req.source) return false;
  }
  return true;
}

// ── Service registration ───────────────────────────────────────────────────────

export function registerAuditService(router: ConnectRouter): void {
  router.service(AuditService, {
    /**
     * ListAuditEvents — unary RPC.
     * Requires admin JWT in the httpOnly cookie or Authorization header.
     */
    async listAuditEvents(req, ctx) {
      await requireAdminFromCookie(ctx);

      const page = req.page > 0 ? req.page : 1;
      const limit = req.limit > 0 ? req.limit : DEFAULT_LIMIT;

      let result: Awaited<ReturnType<typeof listAuditLog>>;
      try {
        result = await listAuditLog({
          recordType: (req.recordType || undefined) as AuditRecordType | undefined,
          recordId: req.recordId || undefined,
          from: req.after || undefined,
          to: req.before || undefined,
          eventType: (req.eventType || undefined) as AuditEventType | undefined,
          userId: req.changedById || undefined,
          source: (req.source || undefined) as 'AI (NLI)' | 'AI (context)' | 'human' | undefined,
          page,
          limit,
        });
      } catch (err) {
        logger.error({ err }, 'ListAuditEvents: query failed');
        throw new ConnectError('Internal error', Code.Internal);
      }

      return new AuditResponse({
        events: result.data.map(rowToEvent),
        total: result.total,
        page: result.page,
        limit: result.limit,
      });
    },

    /**
     * StreamAuditEvents — server-streaming RPC.
     *
     * Subscribes to auditEventBus and yields matching live events. Auth is
     * validated before the first yield. The ctx.signal aborts iteration when
     * the client disconnects or cancels.
     *
     * A sentinel event with action '__stream_ready__' is yielded immediately
     * after the EventEmitter listener is registered. This gives the client a
     * concrete signal that the subscription is active before it creates
     * resources that fire NOTIFYs, eliminating the race between HTTP response
     * headers and listener registration.
     */
    async *streamAuditEvents(req, ctx) {
      await requireAdminFromCookie(ctx);

      // Register the listener BEFORE yielding the sentinel so the subscription
      // is guaranteed to be active when the client receives the ready signal.
      const events = auditEventBus.asyncIterator(ctx.signal);

      // Sentinel: signals to the client that the stream is ready to receive
      // NOTIFYs. The client identifies and discards this by action value.
      yield new AuditEvent({ action: '__stream_ready__' });

      for await (const notification of events) {
        if (!matchesStreamFilter(notification, req)) continue;

        let masked: AuditNotification;
        try {
          masked = await maskAuditEvent(notification);
        } catch (err) {
          logger.warn({ err }, 'StreamAuditEvents: maskAuditEvent failed — skipping event');
          continue;
        }

        yield new AuditEvent(notificationToEvent(masked));
      }
    },
  });
}
