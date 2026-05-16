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
import * as protoLoader from '@grpc/proto-loader';

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
  /**
   * Absolute path to the .proto file that defines the service.
   * Required for `call()`, `serverStream()`, `clientStream()`, and `bidiStream()`.
   * Defaults to `E2E_GRPC_PROTO_PATH` environment variable.
   */
  protoPath?: string;
  /**
   * Fully-qualified service name as it appears in the proto package
   * (e.g. `echo.EchoService` or `acme.billing.v1.BillingService`).
   * Required for `call()`, `serverStream()`, `clientStream()`, and `bidiStream()`.
   * Defaults to `E2E_GRPC_SERVICE_NAME` environment variable.
   */
  serviceName?: string;
}

// ---------------------------------------------------------------------------
// GrpcClient
// ---------------------------------------------------------------------------

/**
 * Framework-managed gRPC client with typed call interfaces.
 *
 * Uses real protobuf binary serialization via @grpc/proto-loader. Construct
 * with `protoPath` + `serviceName` (or set `E2E_GRPC_PROTO_PATH` /
 * `E2E_GRPC_SERVICE_NAME` env vars) so that `call()`, `serverStream()`,
 * `clientStream()`, and `bidiStream()` can load the correct codec.
 *
 * The fixture constructs this and calls `close()` in teardown. Application
 * tests should never construct GrpcClient directly.
 */
export class GrpcClient {
  private readonly stub: grpc.Client;
  private readonly target: string;
  private readonly credentials: grpc.ChannelCredentials;
  private readonly protoPath: string | undefined;
  private readonly serviceName: string | undefined;
  /** Cached loaded service client for call()/serverStream()/clientStream()/bidiStream(). */
  private cachedServiceClient: object | null = null;
  private readonly protoCache = new Map<string, grpc.GrpcObject>();

  /**
   * @param options - Host, TLS, proto path, and service name. Reads from env
   *   vars `E2E_GRPC_HOST`, `E2E_GRPC_TLS`, `E2E_GRPC_PROTO_PATH`, and
   *   `E2E_GRPC_SERVICE_NAME` when not provided.
   */
  constructor(options: GrpcClientOptions = {}) {
    const host = options.host ?? process.env['E2E_GRPC_HOST'] ?? 'localhost:50051';
    const tlsEnv = process.env['E2E_GRPC_TLS']?.toLowerCase();
    const useTls = options.tls ?? tlsEnv === 'true';

    const credentials = useTls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure();

    this.target = host;
    this.credentials = credentials;
    this.stub = new grpc.Client(host, credentials, {});
    this.protoPath = options.protoPath ?? process.env['E2E_GRPC_PROTO_PATH'];
    this.serviceName = options.serviceName ?? process.env['E2E_GRPC_SERVICE_NAME'];
  }

  // -------------------------------------------------------------------------
  // Public call interfaces
  // -------------------------------------------------------------------------

  /**
   * Makes a unary gRPC call using protobuf binary serialization.
   *
   * @template TRequest - Request message type.
   * @template TResponse - Response message type.
   * @param method - Fully qualified method path (e.g., `/echo.EchoService/Ping`).
   * @param request - Request message object.
   * @param metadata - Optional gRPC metadata.
   * @returns Promise resolving with the typed response.
   * @throws GrpcClientError on non-OK status.
   */
  async call<TRequest extends object, TResponse>(
    method: string,
    request: TRequest,
    metadata?: grpc.Metadata,
  ): Promise<TResponse> {
    const meta = metadata ?? new grpc.Metadata();
    const serviceClient = await this.ensureServiceClient();
    const methodName = method.split('/').pop()!;

    const rpcMethod = (serviceClient as Record<string, unknown>)[methodName] as (
      req: TRequest,
      meta: grpc.Metadata,
      cb: (err: (Error & { code?: grpc.status; details?: string }) | null, res?: TResponse) => void,
    ) => void;

    return new Promise<TResponse>((resolve, reject) => {
      rpcMethod.call(serviceClient, request, meta, (err, response) => {
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
      });
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
   * @returns Promise resolving with an async iterator yielding each response.
   * @throws GrpcClientError on non-OK terminal status.
   */
  async serverStream<TRequest extends object, TResponse>(
    method: string,
    request: TRequest,
    metadata?: grpc.Metadata,
  ): Promise<AsyncIterableIterator<TResponse>> {
    const meta = metadata ?? new grpc.Metadata();
    const serviceClient = await this.ensureServiceClient();
    const methodName = method.split('/').pop()!;

    const rpcMethod = (serviceClient as Record<string, unknown>)[methodName] as (
      req: TRequest,
      meta: grpc.Metadata,
    ) => grpc.ClientReadableStream<TResponse>;

    const stream = rpcMethod.call(serviceClient, request, meta);
    return this.streamToAsyncIterator(stream);
  }

  /**
   * Makes a client-streaming gRPC call.
   *
   * @template TRequest - Request message type.
   * @template TResponse - Response message type.
   * @param method - Fully qualified method path (e.g., `/echo.EchoService/Collect`).
   * @param requests - Async iterable of request messages to stream to the server.
   * @param metadata - Optional gRPC metadata.
   * @returns Promise resolving with the single typed response.
   * @throws GrpcClientError on non-OK status.
   */
  async clientStream<TRequest extends object, TResponse>(
    method: string,
    requests: AsyncIterable<TRequest>,
    metadata?: grpc.Metadata,
  ): Promise<TResponse> {
    const meta = metadata ?? new grpc.Metadata();
    const serviceClient = await this.ensureServiceClient();
    const methodName = method.split('/').pop()!;

    const rpcMethod = (serviceClient as Record<string, unknown>)[methodName] as (
      meta: grpc.Metadata,
      cb: (err: (Error & { code?: grpc.status; details?: string }) | null, res?: TResponse) => void,
    ) => grpc.ClientWritableStream<TRequest>;

    return new Promise<TResponse>((resolve, reject) => {
      const stream = rpcMethod.call(serviceClient, meta, (err, response) => {
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
      });

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
   * @template TRequest - Request message type.
   * @template TResponse - Response message type.
   * @param method - Fully qualified method path (e.g., `/echo.EchoService/Echo`).
   * @param requests - Async iterable of request messages to stream to the server.
   * @param metadata - Optional gRPC metadata.
   * @returns Promise resolving with an async iterator yielding each response.
   * @throws GrpcClientError on non-OK terminal status.
   */
  async bidiStream<TRequest extends object, TResponse>(
    method: string,
    requests: AsyncIterable<TRequest>,
    metadata?: grpc.Metadata,
  ): Promise<AsyncIterableIterator<TResponse>> {
    const meta = metadata ?? new grpc.Metadata();
    const serviceClient = await this.ensureServiceClient();
    const methodName = method.split('/').pop()!;

    const rpcMethod = (serviceClient as Record<string, unknown>)[methodName] as (
      meta: grpc.Metadata,
    ) => grpc.ClientDuplexStream<TRequest, TResponse>;

    const stream = rpcMethod.call(serviceClient, meta);

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

    return this.streamToAsyncIterator(stream);
  }

  /**
   * Makes a unary gRPC call using a .proto file for serialization/deserialization.
   *
   * Unlike `call()`, which uses JSON on the wire, `protoCall()` loads the proto
   * definition and uses the generated codec. The proto package is cached after
   * first load.
   *
   * @template TRequest - Request message type (must match the proto schema).
   * @template TResponse - Response message type (must match the proto schema).
   * @param protoPath - Absolute path to the .proto file.
   * @param serviceName - Fully-qualified service name (e.g. `acme.billing.v1.BillingService`).
   * @param methodName - RPC method name (e.g. `GetInvoice`).
   * @param request - Request message object.
   * @param metadata - Optional gRPC metadata.
   * @returns Promise resolving with the typed response.
   * @throws GrpcClientError on non-OK status.
   */
  async protoCall<TRequest extends object, TResponse>(
    protoPath: string,
    serviceName: string,
    methodName: string,
    request: TRequest,
    metadata?: grpc.Metadata,
  ): Promise<TResponse> {
    const meta = metadata ?? new grpc.Metadata();
    const serviceClient = await this.loadProtoServiceClient(protoPath, serviceName);

    return new Promise<TResponse>((resolve, reject) => {
      const method = (serviceClient as Record<string, unknown>)[methodName] as (
        req: TRequest,
        meta: grpc.Metadata,
        cb: (
          err: (Error & { code?: grpc.status; details?: string }) | null,
          res?: TResponse,
        ) => void,
      ) => void;

      method.call(serviceClient, request, meta, (err, response) => {
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
      });
    });
  }

  /**
   * Makes a server-streaming gRPC call using a .proto file, returning an async iterator.
   *
   * @template TRequest - Request message type.
   * @template TResponse - Response message type.
   * @param protoPath - Absolute path to the .proto file.
   * @param serviceName - Fully-qualified service name.
   * @param methodName - RPC method name.
   * @param request - Request message object.
   * @param metadata - Optional gRPC metadata.
   * @returns Promise resolving with an async iterator yielding each streamed response.
   * @throws GrpcClientError on non-OK terminal status.
   */
  async protoServerStream<TRequest extends object, TResponse>(
    protoPath: string,
    serviceName: string,
    methodName: string,
    request: TRequest,
    metadata?: grpc.Metadata,
  ): Promise<AsyncIterableIterator<TResponse>> {
    const meta = metadata ?? new grpc.Metadata();
    const serviceClient = await this.loadProtoServiceClient(protoPath, serviceName);

    const method = (serviceClient as Record<string, unknown>)[methodName] as (
      req: TRequest,
      meta: grpc.Metadata,
    ) => grpc.ClientReadableStream<TResponse>;

    const stream = method.call(serviceClient, request, meta);

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
   * Returns a loaded service client for the proto/service configured at construction
   * time, caching it after the first load.
   *
   * @throws Error if `protoPath` or `serviceName` were not provided.
   */
  private async ensureServiceClient(): Promise<object> {
    if (!this.protoPath || !this.serviceName) {
      throw new Error(
        'GrpcClient: protoPath and serviceName are required for call()/serverStream()/' +
          'clientStream()/bidiStream(). Pass them as constructor options or set ' +
          'E2E_GRPC_PROTO_PATH and E2E_GRPC_SERVICE_NAME environment variables.',
      );
    }
    if (!this.cachedServiceClient) {
      this.cachedServiceClient = await this.loadProtoServiceClient(
        this.protoPath,
        this.serviceName,
      );
    }
    return this.cachedServiceClient;
  }

  /**
   * Bridges a grpc-js readable stream to an AsyncIterableIterator using a
   * queue + promise pattern that handles backpressure correctly.
   */
  private streamToAsyncIterator<TResponse>(
    stream: grpc.ClientReadableStream<TResponse>,
  ): AsyncIterableIterator<TResponse> {
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
   * Loads a proto-defined service client, caching the GrpcObject by proto path.
   *
   * @param protoPath - Absolute path to the .proto file.
   * @param serviceName - Dot-separated service path (e.g. `acme.billing.v1.BillingService`).
   * @returns A new service client instance using this channel's credentials.
   */
  private async loadProtoServiceClient(protoPath: string, serviceName: string): Promise<object> {
    let grpcObject = this.protoCache.get(protoPath);

    if (!grpcObject) {
      const packageDef = await protoLoader.load(protoPath, {
        keepCase: true,
        longs: Number,
        enums: String,
        defaults: true,
        oneofs: true,
      });
      grpcObject = grpc.loadPackageDefinition(packageDef);
      this.protoCache.set(protoPath, grpcObject);
    }

    const parts = serviceName.split('.');
    let node: grpc.GrpcObject | grpc.ServiceClientConstructor = grpcObject as
      | grpc.GrpcObject
      | grpc.ServiceClientConstructor;

    for (const part of parts) {
      node = (node as grpc.GrpcObject)[part] as grpc.GrpcObject | grpc.ServiceClientConstructor;
      if (!node) {
        throw new Error(`Service path not found in proto: ${serviceName} (failed at '${part}')`);
      }
    }

    const ServiceConstructor = node as grpc.ServiceClientConstructor;
    return new ServiceConstructor(this.target, this.credentials, {});
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
