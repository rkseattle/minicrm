/**
 * Typed wrapper for the MiniCRM AuditService (MINCRM-376, MINCRM-377).
 *
 * Uses the Connect protocol (JSON over HTTP/1.1) to call the AuditService
 * endpoints served by ConnectRPC on the Express port (3002 in E2E). This
 * replaces the previous @grpc/grpc-js implementation that targeted a separate
 * port 50051 server (removed in MINCRM-377).
 *
 * Unary calls (ListAuditEvents): POST with Content-Type: application/json.
 * Streaming calls (StreamAuditEvents): POST with Content-Type: application/connect+json
 *   and 5-byte envelope-framed request body (Connect streaming protocol).
 */

import * as grpc from '@grpc/grpc-js';
import { GrpcClientError } from '@framework/clients/grpc-client.js';
import type { GrpcClient } from '@framework/clients/grpc-client.js';
import { resolveApiBaseUrl } from '../apiBaseUrl.js';

// ── Domain types (snake_case, mirrors proto field names for compatibility) ────

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

// ── Connect → gRPC status mapping ────────────────────────────────────────────

/** Maps Connect protocol error code strings to grpc.status numbers. */
const CONNECT_CODE_TO_GRPC: Record<string, grpc.status> = {
  cancelled: grpc.status.CANCELLED,
  unknown: grpc.status.UNKNOWN,
  invalid_argument: grpc.status.INVALID_ARGUMENT,
  deadline_exceeded: grpc.status.DEADLINE_EXCEEDED,
  not_found: grpc.status.NOT_FOUND,
  already_exists: grpc.status.ALREADY_EXISTS,
  permission_denied: grpc.status.PERMISSION_DENIED,
  resource_exhausted: grpc.status.RESOURCE_EXHAUSTED,
  failed_precondition: grpc.status.FAILED_PRECONDITION,
  aborted: grpc.status.ABORTED,
  out_of_range: grpc.status.OUT_OF_RANGE,
  unimplemented: grpc.status.UNIMPLEMENTED,
  internal: grpc.status.INTERNAL,
  unavailable: grpc.status.UNAVAILABLE,
  data_loss: grpc.status.DATA_LOSS,
  unauthenticated: grpc.status.UNAUTHENTICATED,
};

/**
 * Throws a GrpcClientError when a Connect protocol response indicates an error.
 * Parses the Connect error JSON body to extract the code and message.
 */
async function throwOnConnectError(res: Response): Promise<void> {
  if (res.ok) return;
  let code = grpc.status.UNKNOWN;
  let message = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { code?: string; message?: string };
    if (body.code && CONNECT_CODE_TO_GRPC[body.code] !== undefined) {
      code = CONNECT_CODE_TO_GRPC[body.code]!;
    }
    if (body.message) message = body.message;
  } catch {
    // JSON parse failed — keep defaults.
  }
  throw new GrpcClientError(code, message, '');
}

// ── Connect protocol helpers ──────────────────────────────────────────────────

/** Connect protocol JSON request shape for ListAuditEvents. */
interface ConnectListRequest {
  recordType?: string;
  recordId?: string;
  after?: string;
  before?: string;
  page?: number;
  limit?: number;
}

/** Connect protocol JSON response shape for ListAuditEvents. */
interface ConnectListResponse {
  events?: ConnectAuditEvent[];
  total?: number;
  page?: number;
  limit?: number;
}

interface ConnectAuditEvent {
  id?: string;
  recordType?: string;
  recordId?: string;
  action?: string;
  fieldName?: string;
  oldValue?: string;
  newValue?: string;
  changedBy?: string;
  changedAt?: string;
}

function toConnectRequest(req: AuditRequest): ConnectListRequest {
  return {
    recordType: req.record_type,
    recordId: req.record_id,
    after: req.after,
    before: req.before,
    page: req.page,
    limit: req.limit,
  };
}

function fromConnectEvent(e: ConnectAuditEvent): AuditEvent {
  return {
    id: e.id ?? '',
    record_type: e.recordType ?? '',
    record_id: e.recordId ?? '',
    action: e.action ?? '',
    field_name: e.fieldName ?? '',
    old_value: e.oldValue ?? '',
    new_value: e.newValue ?? '',
    changed_by: e.changedBy ?? '',
    changed_at: e.changedAt ?? '',
  };
}

/**
 * Encodes a JSON value as a Connect protocol streaming envelope frame.
 * Frame format: [flags:1 byte][length:4 bytes big-endian][body:N bytes]
 * Flags: 0 = data message.
 */
function encodeConnectFrame(json: unknown): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(json));
  const frame = new Uint8Array(5 + body.length);
  frame[0] = 0; // data frame (flags = 0)
  const view = new DataView(frame.buffer);
  view.setUint32(1, body.length, false); // big-endian length
  frame.set(body, 5);
  return frame;
}

function apiBase(): string {
  return resolveApiBaseUrl();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Calls ListAuditEvents via the Connect protocol (JSON POST over HTTP/1.1).
 *
 * @param _grpcClient - Unused (kept for API compatibility with call sites).
 * @param request - Filter and pagination parameters.
 * @param jwtToken - Admin JWT for the Authorization header.
 * @returns Paginated AuditResponse.
 * @throws GrpcClientError on authentication/authorization or other RPC errors.
 */
export async function listAuditEvents(
  _grpcClient: GrpcClient,
  request: AuditRequest,
  jwtToken: string,
): Promise<AuditResponse> {
  const url = `${apiBase()}/api/minicrm.audit.v1.AuditService/ListAuditEvents`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwtToken}`,
      },
      body: JSON.stringify(toConnectRequest(request)),
    });
  } catch (fetchErr) {
    // Network-level failure (ECONNREFUSED, DNS, etc.) — surface as UNAVAILABLE.
    throw new GrpcClientError(grpc.status.UNAVAILABLE, String(fetchErr), '');
  }

  await throwOnConnectError(res);

  const json = (await res.json()) as ConnectListResponse;

  return {
    events: (json.events ?? []).map(fromConnectEvent),
    total: json.total ?? 0,
    page: json.page ?? 1,
    limit: json.limit ?? 25,
  };
}

/**
 * Calls StreamAuditEvents via the Connect protocol streaming format.
 *
 * Uses Content-Type: application/connect+json with 5-byte envelope framing
 * for the request. Response messages are also envelope-framed; each data
 * frame contains a JSON-encoded AuditEvent.
 *
 * @param _grpcClient - Unused (kept for API compatibility with call sites).
 * @param request - Filter parameters.
 * @param jwtToken - Admin JWT for the Authorization header.
 * @param onEvent - Called for each received AuditEvent.
 * @param onEnd - Called when the stream ends cleanly.
 * @returns A cancel function. Call it to terminate the stream.
 */
export async function streamAuditEvents(
  _grpcClient: GrpcClient,
  request: AuditRequest,
  jwtToken: string,
  onEvent: (event: AuditEvent) => void,
  onEnd?: () => void,
): Promise<() => void> {
  const url = `${apiBase()}/api/minicrm.audit.v1.AuditService/StreamAuditEvents`;
  const abortController = new AbortController();

  // Resolves when the server's '__stream_ready__' sentinel frame arrives,
  // confirming that the EventEmitter listener is registered and the stream is
  // ready to deliver live NOTIFYs. Rejects if the connection fails before the
  // sentinel is received. This eliminates the race between the caller creating
  // a resource (which fires a NOTIFY) and the server registering its listener
  // (MINCRM-554).
  let resolveReady!: () => void;
  let rejectReady!: (err: unknown) => void;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const STREAM_READY_SENTINEL = '__stream_ready__';

  const drainLoop = async (): Promise<void> => {
    try {
      const body = encodeConnectFrame(toConnectRequest(request));

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/connect+json',
          Authorization: `Bearer ${jwtToken}`,
        },
        body,
        signal: abortController.signal,
      });

      if (!res.ok || res.body === null) {
        await throwOnConnectError(res);
        rejectReady(new Error(`StreamAuditEvents: server returned ${res.status}`));
        return;
      }

      const reader = res.body.getReader();
      // Buffer holds bytes not yet consumed. We process 5-byte frame headers
      // then read the declared payload length.
      let buf = new Uint8Array(0);

      const appendBuf = (chunk: Uint8Array): void => {
        const next = new Uint8Array(buf.length + chunk.length);
        next.set(buf, 0);
        next.set(chunk, buf.length);
        buf = next;
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        appendBuf(value);

        // Consume all complete frames from the buffer.
        while (buf.length >= 5) {
          const flags = buf[0]!;
          const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
          const payloadLen = view.getUint32(1, false); // big-endian

          if (buf.length < 5 + payloadLen) break; // wait for more data

          const payload = buf.slice(5, 5 + payloadLen);
          buf = buf.slice(5 + payloadLen);

          // Bit 1 of flags = end-stream trailer frame — skip it.
          if (flags & 0x02) continue;

          try {
            const text = new TextDecoder().decode(payload);
            const msg = JSON.parse(text) as ConnectAuditEvent;

            // Server-sent ready sentinel — resolve the caller's await and
            // discard; do not forward to onEvent.
            if (msg.action === STREAM_READY_SENTINEL) {
              resolveReady();
              continue;
            }

            // Skip Connect end-stream envelope frames that carry trailers.
            if (msg.id || msg.recordType || msg.action) {
              onEvent(fromConnectEvent(msg));
            }
          } catch {
            // Skip malformed frames.
          }
        }
      }

      // Stream ended without sentinel — server regression or proxy dropped body.
      rejectReady(new Error('Stream ended before __stream_ready__ sentinel'));
      onEnd?.();
    } catch (err) {
      if (!abortController.signal.aborted) {
        rejectReady(err);
        onEnd?.();
      }
    }
  };

  void drainLoop();

  // Block until the server's sentinel arrives, confirming the subscription is
  // active. The server yields the sentinel as its very first frame, so this
  // resolves as soon as the HTTP response begins streaming (MINCRM-554).
  await readyPromise;

  return (): void => {
    abortController.abort();
  };
}
