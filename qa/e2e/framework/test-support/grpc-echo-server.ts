/**
 * Minimal in-process gRPC echo server for framework-level CI tests.
 *
 * Exposes four methods on the `EchoService` covering all four gRPC call patterns:
 *   - `Ping`    (unary)              — echoes the request message back.
 *   - `Stream`  (server-streaming)   — streams the request message `count` times.
 *   - `Collect` (client-streaming)   — collects all client messages and returns
 *                                      a count + the last received message.
 *   - `Echo`    (bidi-streaming)     — echoes each client message back immediately.
 *
 * The server is started and stopped within a Playwright fixture so it is
 * never a long-running process. It binds to an OS-assigned port so parallel
 * workers do not conflict.
 *
 * Protocol (JSON over raw gRPC):
 *   PingRequest    { message: string }
 *   PingResponse   { message: string }
 *   StreamRequest  { message: string; count: number }
 *   StreamResponse { message: string; index: number }
 *   CollectRequest  { message: string }
 *   CollectResponse { count: number; last: string }
 *   EchoRequest    { message: string }
 *   EchoResponse   { message: string }
 *
 */

import path from 'path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

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

/** One request message in the Collect client-streaming method. */
export interface CollectRequest {
  message: string;
}

/** Response from the Collect client-streaming method. */
export interface CollectResponse {
  /** Total number of request messages received from the client. */
  count: number;
  /** The last message received, or empty string if no messages were sent. */
  last: string;
}

/** One request message in the Echo bidirectional-streaming method. */
export interface EchoRequest {
  message: string;
}

/** One response message from the Echo bidirectional-streaming method. */
export interface EchoResponse {
  message: string;
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

/** gRPC method descriptor for Collect (client-streaming). */
const collectMethod: grpc.MethodDefinition<CollectRequest, CollectResponse> = {
  path: '/echo.EchoService/Collect',
  requestStream: true,
  responseStream: false,
  requestSerialize: encode,
  requestDeserialize: decode<CollectRequest>,
  responseSerialize: encode,
  responseDeserialize: decode<CollectResponse>,
};

/** gRPC method descriptor for Echo (bidirectional-streaming). */
const echoMethod: grpc.MethodDefinition<EchoRequest, EchoResponse> = {
  path: '/echo.EchoService/Echo',
  requestStream: true,
  responseStream: true,
  requestSerialize: encode,
  requestDeserialize: decode<EchoRequest>,
  responseSerialize: encode,
  responseDeserialize: decode<EchoResponse>,
};

/** Service definition for EchoService. */
const echoServiceDefinition: grpc.ServiceDefinition = {
  Ping: pingMethod,
  Stream: streamMethod,
  Collect: collectMethod,
  Echo: echoMethod,
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
    if (!call.write({ message, index })) break; // respect backpressure / cancellation
  }
  call.end();
}

/**
 * Handles the Collect client-streaming call — reads all client messages and
 * responds with the count and the last received message.
 *
 * @param call - gRPC server readable stream.
 * @param callback - Completion callback with the single response.
 */
function handleCollect(
  call: grpc.ServerReadableStream<CollectRequest, CollectResponse>,
  callback: grpc.sendUnaryData<CollectResponse>,
): void {
  let count = 0;
  let last = '';

  call.on('data', (req: CollectRequest) => {
    count++;
    last = req.message;
  });

  call.on('end', () => {
    callback(null, { count, last });
  });

  call.on('error', (err: Error) => {
    callback(err, null);
  });
}

/**
 * Handles the Echo bidirectional-streaming call — echoes each client message
 * back immediately as it arrives.
 *
 * @param call - gRPC server duplex stream.
 */
function handleEcho(call: grpc.ServerDuplexStream<EchoRequest, EchoResponse>): void {
  call.on('data', (req: EchoRequest) => {
    call.write({ message: req.message });
  });

  call.on('end', () => {
    call.end();
  });

  call.on('error', () => {
    call.end();
  });
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
      Collect: handleCollect,
      Echo: handleEcho,
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

// ---------------------------------------------------------------------------
// ProtoEchoServer — proto-loader-based echo server (MINCRM-376)
// ---------------------------------------------------------------------------

/**
 * In-process gRPC echo server that loads the EchoService definition from
 * `echo.proto` via `@grpc/proto-loader`. Used by framework tests that cover
 * `GrpcClient.protoCall()` and `GrpcClient.protoServerStream()`.
 *
 * Exposes the same Ping (unary) and Stream (server-streaming) methods as
 * `GrpcEchoServer`, but serialization is handled by the proto codec instead
 * of raw JSON buffers.
 */
export class ProtoEchoServer {
  private server: grpc.Server | null = null;
  private _port = 0;

  /** Absolute path to the echo.proto file co-located with this module. */
  static readonly PROTO_PATH = path.join(__dirname, 'echo.proto');

  /** Fully-qualified service name used with `GrpcClient.protoCall/protoServerStream`. */
  static readonly SERVICE_NAME = 'echo.EchoService';

  /**
   * Starts the server on an OS-assigned port.
   *
   * @returns Promise resolving with the bound port number.
   */
  async start(): Promise<number> {
    const packageDef = await protoLoader.load(ProtoEchoServer.PROTO_PATH, {
      keepCase: true,
      longs: Number,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const grpcObject = grpc.loadPackageDefinition(packageDef);
    const echoPackage = grpcObject['echo'] as grpc.GrpcObject;
    const EchoService = (echoPackage['EchoService'] as grpc.ServiceClientConstructor).service;

    this.server = new grpc.Server();
    this.server.addService(EchoService, {
      Ping: handlePing,
      Stream: handleStream,
    });

    return new Promise((resolve, reject) => {
      this.server!.bindAsync(
        '127.0.0.1:0',
        grpc.ServerCredentials.createInsecure(),
        (err, port) => {
          if (err !== null) {
            reject(err);
            return;
          }
          this._port = port;
          resolve(port);
        },
      );
    });
  }

  /**
   * Stops the server and drains in-flight calls.
   *
   * @returns Promise that resolves when the server has shut down.
   */
  stop(): Promise<void> {
    if (this.server === null) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.server!.tryShutdown((err) => {
        if (err !== undefined && err !== null) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /** The port the server is listening on. Only valid after `start()` resolves. */
  get port(): number {
    return this._port;
  }

  /** Convenience host:port string for connecting. */
  get address(): string {
    return `127.0.0.1:${this._port}`;
  }
}
