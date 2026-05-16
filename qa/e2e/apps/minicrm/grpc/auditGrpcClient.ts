/**
 * Typed wrapper over GrpcClient for the MiniCRM AuditService (MINCRM-376).
 *
 * Exposes listAuditEvents (unary) and streamAuditEvents (server-streaming)
 * with types that mirror the proto schema in server/src/grpc/proto/audit.proto.
 *
 * The proto file path is resolved relative to this file so the wrapper works
 * from any working directory.
 */

import path from 'path';
import * as grpc from '@grpc/grpc-js';
import type { GrpcClient } from '@framework/clients/grpc-client.js';

// ── Proto message types (mirror audit.proto) ──────────────────────────────────

export interface AuditRequest {
  record_type?: string;
  record_id?: string;
  after?: string;
  before?: string;
  page?: number;
  limit?: number;
}

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

export interface AuditResponse {
  events: AuditEvent[];
  total: number;
  page: number;
  limit: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Resolve the proto path relative to this file: qa/e2e/apps/minicrm/grpc/ → server/src/grpc/proto/
const PROTO_PATH = path.resolve(__dirname, '../../../../../server/src/grpc/proto/audit.proto');

const SERVICE_NAME = 'minicrm.audit.v1.AuditService';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Calls ListAuditEvents (unary RPC).
 *
 * @param grpcClient - Framework-managed GrpcClient instance.
 * @param request - Filter and pagination parameters.
 * @param jwtToken - Admin JWT for the `authorization` metadata key.
 * @returns Paginated AuditResponse.
 */
export async function listAuditEvents(
  grpcClient: GrpcClient,
  request: AuditRequest,
  jwtToken: string,
): Promise<AuditResponse> {
  const meta = new grpc.Metadata();
  meta.set('authorization', `Bearer ${jwtToken}`);

  return grpcClient.protoCall<AuditRequest, AuditResponse>(
    PROTO_PATH,
    SERVICE_NAME,
    'ListAuditEvents',
    request,
    meta,
  );
}

/**
 * Calls StreamAuditEvents (server-streaming RPC).
 *
 * Subscribes to the live audit event stream. Each matching event is delivered
 * to `onEvent`. The optional `onEnd` callback fires when the stream closes
 * cleanly (after cancel or server shutdown).
 *
 * @param grpcClient - Framework-managed GrpcClient instance.
 * @param request - Filter parameters (record_type, record_id, after).
 * @param jwtToken - Admin JWT for the `authorization` metadata key.
 * @param onEvent - Called for each received AuditEvent.
 * @param onEnd - Called when the stream ends cleanly.
 * @returns A cancel function. Call it to terminate the stream.
 */
export async function streamAuditEvents(
  grpcClient: GrpcClient,
  request: AuditRequest,
  jwtToken: string,
  onEvent: (event: AuditEvent) => void,
  onEnd?: () => void,
): Promise<() => void> {
  const meta = new grpc.Metadata();
  meta.set('authorization', `Bearer ${jwtToken}`);

  const iterator = await grpcClient.protoServerStream<AuditRequest, AuditEvent>(
    PROTO_PATH,
    SERVICE_NAME,
    'StreamAuditEvents',
    request,
    meta,
  );

  let cancelled = false;

  // Drain the iterator in the background, delivering events via onEvent.
  const drainLoop = async (): Promise<void> => {
    try {
      for await (const event of iterator) {
        onEvent(event);
      }
      if (!cancelled) {
        onEnd?.();
      }
    } catch {
      // Errors after cancel are expected (cancelled stream closes with CANCELLED status).
      if (!cancelled) {
        onEnd?.();
      }
    }
  };

  void drainLoop();

  return (): void => {
    cancelled = true;
    void iterator.return?.();
  };
}
