/**
 * Minimal in-process gRPC echo server for framework-level CI tests.
 *
 * Exposes two methods on the `EchoService`:
 *   - `Ping` (unary)  — echoes the request message back as the response.
 *   - `Stream` (server-streaming) — streams the request message `count` times.
 *
 * The server is started and stopped within a Playwright fixture so it is
 * never a long-running process. It binds to an OS-assigned port so parallel
 * workers do not conflict.
 *
 * Protocol (JSON over raw gRPC):
 *   PingRequest  { message: string }
 *   PingResponse { message: string }
 *   StreamRequest  { message: string; count: number }
 *   StreamResponse { message: string; index: number }
 *
 * MINCRM-128
 */

import * as grpc from '@grpc/grpc-js';

// ---------------------------------------------------------------------------
// Message shapes (JSON-serialised over the wire)
// ---------------------------------------------------------------------------

/** Request for the Ping unary method. */
export interface PingRequest {
  message: string;
}

/** Response from the Ping unary method. */
export interface PingResponse {
  message: string;
}

/** Request for the Stream server-streaming method. */
export interface StreamRequest {
  message: string;
  /** Number of response messages to stream back. */
  count: number;
}

/** One message in the Stream server-streaming response. */
export interface StreamResponse {
  message: string;
  /** Zero-based index of this message in the stream. */
  index: number;
}

// ---------------------------------------------------------------------------
// Codec helpers (JSON ↔ Buffer)
// ---------------------------------------------------------------------------

/**
 * Serializes a value to a raw JSON Buffer.
 *
 * grpc-js handles the gRPC wire framing (5-byte header) automatically.
 * The serialize/deserialize functions only deal with the message payload.
 *
 * @param value - Object to serialize.
 * @returns UTF-8 encoded JSON Buffer.
 */
function encode(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
}

/**
 * Deserializes a raw JSON Buffer to a typed object.
 *
 * grpc-js strips the gRPC wire frame before calling this function.
 *
 * @template T - Expected type after parsing.
 * @param buffer - Raw UTF-8 JSON Buffer (no frame header).
 * @returns Parsed object.
 */
function decode<T>(buffer: Buffer): T {
  return JSON.parse(buffer.toString()) as T;
}

// ---------------------------------------------------------------------------
// Method descriptors
// ---------------------------------------------------------------------------

/** gRPC method descriptor for Ping (unary). */
const pingMethod: grpc.MethodDefinition<PingRequest, PingResponse> = {
  path: '/echo.EchoService/Ping',
  requestStream: false,
  responseStream: false,
  requestSerialize: encode,
  requestDeserialize: decode<PingRequest>,
  responseSerialize: encode,
  responseDeserialize: decode<PingResponse>,
};

/** gRPC method descriptor for Stream (server-streaming). */
const streamMethod: grpc.MethodDefinition<StreamRequest, StreamResponse> = {
  path: '/echo.EchoService/Stream',
  requestStream: false,
  responseStream: true,
  requestSerialize: encode,
  requestDeserialize: decode<StreamRequest>,
  responseSerialize: encode,
  responseDeserialize: decode<StreamResponse>,
};

/** Service definition for EchoService. */
const echoServiceDefinition: grpc.ServiceDefinition = {
  Ping: pingMethod,
  Stream: streamMethod,
};

// ---------------------------------------------------------------------------
// Handler implementations
// ---------------------------------------------------------------------------

/**
 * Handles the Ping unary call — echoes the request message.
 *
 * @param call - gRPC server unary call.
 * @param callback - Completion callback.
 */
function handlePing(
  call: grpc.ServerUnaryCall<PingRequest, PingResponse>,
  callback: grpc.sendUnaryData<PingResponse>,
): void {
  callback(null, { message: call.request.message });
}

/**
 * Handles the Stream server-streaming call — streams the message `count` times.
 *
 * @param call - gRPC server writable stream.
 */
function handleStream(call: grpc.ServerWritableStream<StreamRequest, StreamResponse>): void {
  const { message, count } = call.request;
  for (let index = 0; index < count; index++) {
    call.write({ message, index });
  }
  call.end();
}

// ---------------------------------------------------------------------------
// GrpcEchoServer
// ---------------------------------------------------------------------------

/**
 * Lightweight gRPC echo server for CI fixture use.
 *
 * Start it with `start()`, get the bound port via `port`, use it in tests,
 * then call `stop()` in fixture teardown.
 */
export class GrpcEchoServer {
  private server: grpc.Server;
  private _port = 0;

  constructor() {
    this.server = new grpc.Server();
    this.server.addService(echoServiceDefinition, {
      Ping: handlePing,
      Stream: handleStream,
    });
  }

  /**
   * Starts the server on an OS-assigned port (avoids conflicts between
   * parallel workers).
   *
   * @returns Promise that resolves with the bound port number.
   */
  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      // Binding to port 0 lets the OS assign a free port.
      this.server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, port) => {
        if (err !== null) {
          reject(err);
          return;
        }
        this._port = port;
        resolve(port);
      });
    });
  }

  /**
   * Stops the server and drains in-flight calls.
   *
   * @returns Promise that resolves when the server has shut down.
   */
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.tryShutdown((err) => {
        if (err !== undefined && err !== null) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * The port the server is listening on. Only valid after `start()` resolves.
   *
   * @returns Bound port number.
   */
  get port(): number {
    return this._port;
  }

  /**
   * Convenience host:port string for use as `E2E_GRPC_HOST`.
   *
   * @returns `127.0.0.1:<port>` string.
   */
  get address(): string {
    return `127.0.0.1:${this._port}`;
  }
}
