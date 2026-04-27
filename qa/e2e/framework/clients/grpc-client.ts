/**
 * gRPC client for the E2E framework.
 *
 * Wraps @grpc/grpc-js to provide a framework-managed channel lifecycle with
 * typed unary, server-streaming, client-streaming, and bidirectional-streaming
 * call interfaces. Channel creation and teardown are handled by the fixture —
 * tests never manage channel lifecycle directly.
 *
 */

import * as grpc from '@grpc/grpc-js';

// ---------------------------------------------------------------------------
// Codec helpers (JSON ↔ Buffer)
// ---------------------------------------------------------------------------

/**
 * Serializes a value to a plain JSON Buffer (no gRPC frame header).
 * The grpc-js Client handles the framing.
 *
 * @param value - Object to serialize.
 * @returns UTF-8 encoded JSON Buffer.
 */
function jsonSerialize(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
}

/**
 * Deserializes a plain JSON Buffer to a typed object.
 *
 * @template T - Expected output type.
 * @param buffer - UTF-8 encoded JSON Buffer.
 * @returns Parsed object.
 */
function jsonDeserialize<T>(buffer: Buffer): T {
  return JSON.parse(buffer.toString()) as T;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Thrown when a gRPC call returns a non-OK status code.
 */
export class GrpcClientError extends Error {
  /**
   * @param code - gRPC status code (e.g., grpc.status.NOT_FOUND).
   * @param message - Human-readable error message from the server.
   * @param details - Additional detail string from the gRPC error metadata.
   */
  constructor(
    public readonly code: grpc.status,
    message: string,
    public readonly details: string,
  ) {
    super(message);
    this.name = 'GrpcClientError';
  }
}

// ---------------------------------------------------------------------------
// GrpcClient options
// ---------------------------------------------------------------------------

/**
 * Options for constructing a GrpcClient instance.
 */
export interface GrpcClientOptions {
  /**
   * Target host:port for the gRPC server.
   * Defaults to `E2E_GRPC_HOST` environment variable.
   * Example: `localhost:50051`
   */
  host?: string;
  /**
   * Whether to use TLS. Defaults to `E2E_GRPC_TLS=true|false` env var
   * (case-insensitive). Falls back to `false` (insecure) if not set.
   */
  tls?: boolean;
}

// ---------------------------------------------------------------------------
// GrpcClient
// ---------------------------------------------------------------------------

/**
 * Framework-managed gRPC client with typed call interfaces.
 *
 * Uses the high-level grpc-js Client API (`makeUnaryRequest`,
 * `makeServerStreamRequest`) with JSON serialization. The fixture constructs
 * this and calls `close()` in teardown. Application tests should never
 * construct GrpcClient directly.
 */
export class GrpcClient {
  private readonly stub: grpc.Client;
  private readonly target: string;

  /**
   * @param options - Optional host and TLS overrides. Reads from env vars
   *   `E2E_GRPC_HOST` and `E2E_GRPC_TLS` when not provided.
   */
  constructor(options: GrpcClientOptions = {}) {
    const host = options.host ?? process.env['E2E_GRPC_HOST'] ?? 'localhost:50051';
    const tlsEnv = process.env['E2E_GRPC_TLS']?.toLowerCase();
    const useTls = options.tls ?? tlsEnv === 'true';

    const credentials = useTls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure();

    this.target = host;
    this.stub = new grpc.Client(host, credentials, {});
  }

  // -------------------------------------------------------------------------
  // Public call interfaces
  // -------------------------------------------------------------------------

  /**
   * Makes a unary gRPC call.
   *
   * @template TRequest - Request message type.
   * @template TResponse - Response message type.
   * @param method - Fully qualified method path (e.g., `/echo.EchoService/Ping`).
   * @param request - Request message object.
   * @param metadata - Optional gRPC metadata.
   * @returns Promise resolving with the typed response.
   * @throws GrpcClientError on non-OK status.
   */
  call<TRequest extends object, TResponse>(
    method: string,
    request: TRequest,
    metadata?: grpc.Metadata,
  ): Promise<TResponse> {
    const meta = metadata ?? new grpc.Metadata();

    return new Promise<TResponse>((resolve, reject) => {
      this.stub.makeUnaryRequest<TRequest, TResponse>(
        method,
        jsonSerialize,
        (buf) => jsonDeserialize<TResponse>(buf),
        request,
        meta,
        (err, response) => {
          if (err !== null && err !== undefined) {
            reject(
              new GrpcClientError(err.code ?? grpc.status.UNKNOWN, err.message, err.details ?? ''),
            );
            return;
          }
          if (response === undefined || response === null) {
            reject(new GrpcClientError(grpc.status.UNKNOWN, 'Empty response', ''));
            return;
          }
          resolve(response);
        },
      );
    });
  }

  /**
   * Makes a server-streaming gRPC call, returning an async iterator.
   *
   * @template TRequest - Request message type.
   * @template TResponse - Response message type.
   * @param method - Fully qualified method path (e.g., `/echo.EchoService/Stream`).
   * @param request - Request message object.
   * @param metadata - Optional gRPC metadata.
   * @returns Async iterator yielding each streamed response message.
   * @throws GrpcClientError on non-OK terminal status.
   */
  serverStream<TRequest extends object, TResponse>(
    method: string,
    request: TRequest,
    metadata?: grpc.Metadata,
  ): AsyncIterableIterator<TResponse> {
    const meta = metadata ?? new grpc.Metadata();

    const stream = this.stub.makeServerStreamRequest<TRequest, TResponse>(
      method,
      jsonSerialize,
      (buf) => jsonDeserialize<TResponse>(buf),
      request,
      meta,
    );

    // Bridge the Node.js readable stream to an async iterator using a
    // queue + promise pattern to handle backpressure correctly.
    const queue: TResponse[] = [];
    let resolveNext: ((result: IteratorResult<TResponse>) => void) | null = null;
    let rejectNext: ((err: unknown) => void) | null = null;
    let done = false;
    let terminalError: GrpcClientError | null = null;

    stream.on('data', (message: TResponse) => {
      if (resolveNext !== null) {
        const res = resolveNext;
        resolveNext = null;
        rejectNext = null;
        res({ value: message, done: false });
      } else {
        queue.push(message);
      }
    });

    stream.on('end', () => {
      done = true;
      if (resolveNext !== null) {
        const res = resolveNext;
        resolveNext = null;
        rejectNext = null;
        res({ value: undefined as unknown as TResponse, done: true });
      }
    });

    stream.on('error', (err: Error & { code?: grpc.status; details?: string }) => {
      done = true;
      terminalError = new GrpcClientError(
        err.code ?? grpc.status.UNKNOWN,
        err.message,
        err.details ?? '',
      );
      if (rejectNext !== null) {
        const rej = rejectNext;
        resolveNext = null;
        rejectNext = null;
        rej(terminalError);
      }
    });

    const iterator: AsyncIterableIterator<TResponse> = {
      next(): Promise<IteratorResult<TResponse>> {
        if (queue.length > 0) {
          return Promise.resolve({ value: queue.shift()!, done: false });
        }
        if (done) {
          if (terminalError !== null) {
            return Promise.reject(terminalError);
          }
          return Promise.resolve({ value: undefined as unknown as TResponse, done: true });
        }
        if (resolveNext !== null) {
          return Promise.reject(new Error('Concurrent calls to next() are not supported'));
        }
        return new Promise<IteratorResult<TResponse>>((resolve, reject) => {
          resolveNext = resolve;
          rejectNext = reject;
        });
      },
      [Symbol.asyncIterator]() {
        return this;
      },
      return(): Promise<IteratorResult<TResponse>> {
        stream.cancel();
        return Promise.resolve({ value: undefined as unknown as TResponse, done: true });
      },
    };

    return iterator;
  }

  /**
   * Makes a client-streaming gRPC call.
   *
   * The caller supplies an async iterable of request messages; the server reads
   * the full stream and responds with a single message once the client is done.
   * This follows the same async-iterable pattern as `serverStream`.
   *
   * @template TRequest - Request message type.
   * @template TResponse - Response message type.
   * @param method - Fully qualified method path (e.g., `/echo.EchoService/Collect`).
   * @param requests - Async iterable of request messages to stream to the server.
   * @param metadata - Optional gRPC metadata.
   * @returns Promise resolving with the single typed response.
   * @throws GrpcClientError on non-OK status.
   */
  clientStream<TRequest extends object, TResponse>(
    method: string,
    requests: AsyncIterable<TRequest>,
    metadata?: grpc.Metadata,
  ): Promise<TResponse> {
    const meta = metadata ?? new grpc.Metadata();

    return new Promise<TResponse>((resolve, reject) => {
      const stream = this.stub.makeClientStreamRequest<TRequest, TResponse>(
        method,
        jsonSerialize,
        (buf) => jsonDeserialize<TResponse>(buf),
        meta,
        (err, response) => {
          if (err !== null && err !== undefined) {
            reject(
              new GrpcClientError(err.code ?? grpc.status.UNKNOWN, err.message, err.details ?? ''),
            );
            return;
          }
          if (response === undefined || response === null) {
            reject(new GrpcClientError(grpc.status.UNKNOWN, 'Empty response', ''));
            return;
          }
          resolve(response);
        },
      );

      // Pipe the async iterable into the writable stream.
      (async () => {
        try {
          for await (const req of requests) {
            stream.write(req);
          }
          stream.end();
        } catch (err) {
          stream.destroy(err instanceof Error ? err : new Error(String(err)));
        }
      })();
    });
  }

  /**
   * Makes a bidirectional-streaming gRPC call, returning an async iterator.
   *
   * Both client and server stream messages simultaneously. The caller supplies
   * an async iterable of request messages; responses are yielded as they arrive
   * from the server. This follows the same queue + promise async-iterator
   * pattern as `serverStream`.
   *
   * @template TRequest - Request message type.
   * @template TResponse - Response message type.
   * @param method - Fully qualified method path (e.g., `/echo.EchoService/Echo`).
   * @param requests - Async iterable of request messages to stream to the server.
   * @param metadata - Optional gRPC metadata.
   * @returns Async iterator yielding each streamed response message.
   * @throws GrpcClientError on non-OK terminal status.
   */
  bidiStream<TRequest extends object, TResponse>(
    method: string,
    requests: AsyncIterable<TRequest>,
    metadata?: grpc.Metadata,
  ): AsyncIterableIterator<TResponse> {
    const meta = metadata ?? new grpc.Metadata();

    const stream = this.stub.makeBidiStreamRequest<TRequest, TResponse>(
      method,
      jsonSerialize,
      (buf) => jsonDeserialize<TResponse>(buf),
      meta,
    );

    // Bridge the duplex stream to an async iterator using the same
    // queue + promise pattern as serverStream.
    const queue: TResponse[] = [];
    let resolveNext: ((result: IteratorResult<TResponse>) => void) | null = null;
    let rejectNext: ((err: unknown) => void) | null = null;
    let done = false;
    let terminalError: GrpcClientError | null = null;

    stream.on('data', (message: TResponse) => {
      if (resolveNext !== null) {
        const res = resolveNext;
        resolveNext = null;
        rejectNext = null;
        res({ value: message, done: false });
      } else {
        queue.push(message);
      }
    });

    stream.on('end', () => {
      done = true;
      if (resolveNext !== null) {
        const res = resolveNext;
        resolveNext = null;
        rejectNext = null;
        res({ value: undefined as unknown as TResponse, done: true });
      }
    });

    stream.on('error', (err: Error & { code?: grpc.status; details?: string }) => {
      done = true;
      terminalError = new GrpcClientError(
        err.code ?? grpc.status.UNKNOWN,
        err.message,
        err.details ?? '',
      );
      if (rejectNext !== null) {
        const rej = rejectNext;
        resolveNext = null;
        rejectNext = null;
        rej(terminalError);
      }
    });

    // Pipe the request async iterable into the writable side of the duplex.
    (async () => {
      try {
        for await (const req of requests) {
          stream.write(req);
        }
        stream.end();
      } catch (err) {
        stream.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    const iterator: AsyncIterableIterator<TResponse> = {
      next(): Promise<IteratorResult<TResponse>> {
        if (queue.length > 0) {
          return Promise.resolve({ value: queue.shift()!, done: false });
        }
        if (done) {
          if (terminalError !== null) {
            return Promise.reject(terminalError);
          }
          return Promise.resolve({ value: undefined as unknown as TResponse, done: true });
        }
        if (resolveNext !== null) {
          return Promise.reject(new Error('Concurrent calls to next() are not supported'));
        }
        return new Promise<IteratorResult<TResponse>>((resolve, reject) => {
          resolveNext = resolve;
          rejectNext = reject;
        });
      },
      [Symbol.asyncIterator]() {
        return this;
      },
      return(): Promise<IteratorResult<TResponse>> {
        stream.cancel();
        return Promise.resolve({ value: undefined as unknown as TResponse, done: true });
      },
    };

    return iterator;
  }

  /**
   * Closes the underlying gRPC channel. Called by the fixture in teardown.
   * Safe to call even if the channel was never used.
   */
  close(): void {
    this.stub.close();
  }

  /**
   * Returns the target host:port this client is connected to.
   *
   * @returns The target string (e.g., `localhost:50051`).
   */
  getTarget(): string {
    return this.target;
  }

  /**
   * Returns the current connectivity state of the channel.
   *
   * @returns Current grpc.connectivityState value.
   */
  getConnectivityState(): grpc.connectivityState {
    return grpc.getClientChannel(this.stub).getConnectivityState(false);
  }
}
