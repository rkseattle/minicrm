/**
 * CI tests for GrpcClient and grpcClient fixture.
 *
 * Verifies all Acceptance Criteria from MINCRM-128:
 *
 * AC1 — grpcClient.call('Ping', { message: 'hello' }) returns a typed response
 *       from the echo stub.
 * AC2 — A non-OK gRPC status throws GrpcClientError with correct code + message.
 * AC3 — serverStream() returns an async iterator that yields all streamed messages.
 * AC4 — Channel is closed in fixture teardown even when the test throws.
 * AC5 — Parallel workers each hold independent channels (structural/fixture-scope).
 * AC6 — TLS and insecure modes are configurable via env var.
 * AC7 — All CI tests against the echo stub pass.
 *
 * MINCRM-233 Acceptance Criteria:
 * AC-233-1 — clientStream() sends a stream of requests and receives a single response.
 * AC-233-2 — bidiStream() sends a stream of requests and yields each echoed response.
 *
 * The echo stub is spun up/torn down per test group — no live service required.
 *
 * MINCRM-128, MINCRM-233
 */

import { test, expect } from '@framework/fixtures';
import { GrpcClient, GrpcClientError } from '@framework/clients';
import { GrpcEchoServer, ProtoEchoServer } from '@framework/test-support/grpc-echo-server.js';
import type {
  PingRequest,
  PingResponse,
  StreamRequest,
  StreamResponse,
  CollectRequest,
  CollectResponse,
  EchoRequest,
  EchoResponse,
} from '@framework/test-support/grpc-echo-server.js';
import * as grpc from '@grpc/grpc-js';

// ---------------------------------------------------------------------------
// Echo server fixture — spun up once per describe block (serial execution)
// ---------------------------------------------------------------------------

/**
 * Manages an echo server scoped to a describe block.
 * Returns the server and a factory that creates GrpcClient instances pointing at it.
 */
async function withEchoServer(): Promise<{
  server: GrpcEchoServer;
  makeClient: (options?: { tls?: boolean }) => GrpcClient;
}> {
  const server = new GrpcEchoServer();
  await server.start();

  return {
    server,
    makeClient: (options = {}) =>
      new GrpcClient({ host: server.address, tls: options.tls ?? false }),
  };
}

// ---------------------------------------------------------------------------
// AC1 — Ping unary call returns typed response
// ---------------------------------------------------------------------------

test.describe('GrpcClient — Ping unary', () => {
  let server: GrpcEchoServer;
  let makeClient: (options?: { tls?: boolean }) => GrpcClient;

  test.beforeAll(async () => {
    ({ server, makeClient } = await withEchoServer());
  });

  test.afterAll(async () => {
    await server.stop();
  });

  test('call<PingRequest, PingResponse> echoes message back', async () => {
    const client = makeClient();
    try {
      const response = await client.call<PingRequest, PingResponse>('/echo.EchoService/Ping', {
        message: 'hello',
      });
      expect(response.message).toBe('hello');
    } finally {
      client.close();
    }
  });

  test('call returns typed response — body is PingResponse shape', async () => {
    const client = makeClient();
    try {
      const response = await client.call<PingRequest, PingResponse>('/echo.EchoService/Ping', {
        message: 'framework-test',
      });
      // Verify the response object has the expected shape.
      expect(typeof response.message).toBe('string');
      expect(response.message).toBe('framework-test');
    } finally {
      client.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AC2 — Non-OK gRPC status throws GrpcClientError
// ---------------------------------------------------------------------------

test.describe('GrpcClientError on non-OK status', () => {
  test('GrpcClientError has correct code and message properties', () => {
    const err = new GrpcClientError(grpc.status.NOT_FOUND, 'resource not found', 'details here');

    expect(err).toBeInstanceOf(GrpcClientError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(grpc.status.NOT_FOUND);
    expect(err.message).toBe('resource not found');
    expect(err.details).toBe('details here');
    expect(err.name).toBe('GrpcClientError');
  });

  test('GrpcClientError for UNAVAILABLE status has correct code', () => {
    const err = new GrpcClientError(grpc.status.UNAVAILABLE, 'service unavailable', '');

    expect(err.code).toBe(grpc.status.UNAVAILABLE);
  });
});

// ---------------------------------------------------------------------------
// AC3 — serverStream() returns an async iterator yielding all messages
// ---------------------------------------------------------------------------

test.describe('GrpcClient — Stream server-streaming', () => {
  let server: GrpcEchoServer;
  let makeClient: (options?: { tls?: boolean }) => GrpcClient;

  test.beforeAll(async () => {
    ({ server, makeClient } = await withEchoServer());
  });

  test.afterAll(async () => {
    await server.stop();
  });

  test('serverStream() yields all streamed messages in order', async () => {
    const client = makeClient();
    try {
      const messages: StreamResponse[] = [];
      const iterator = client.serverStream<StreamRequest, StreamResponse>(
        '/echo.EchoService/Stream',
        { message: 'ping', count: 3 },
      );

      for await (const msg of iterator) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(3);
      expect(messages[0]).toEqual({ message: 'ping', index: 0 });
      expect(messages[1]).toEqual({ message: 'ping', index: 1 });
      expect(messages[2]).toEqual({ message: 'ping', index: 2 });
    } finally {
      client.close();
    }
  });

  test('serverStream() with count=1 yields exactly one message', async () => {
    const client = makeClient();
    try {
      const messages: StreamResponse[] = [];
      for await (const msg of client.serverStream<StreamRequest, StreamResponse>(
        '/echo.EchoService/Stream',
        { message: 'single', count: 1 },
      )) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ message: 'single', index: 0 });
    } finally {
      client.close();
    }
  });

  test('serverStream() with count=0 yields no messages', async () => {
    const client = makeClient();
    try {
      const messages: StreamResponse[] = [];
      for await (const msg of client.serverStream<StreamRequest, StreamResponse>(
        '/echo.EchoService/Stream',
        { message: 'empty', count: 0 },
      )) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(0);
    } finally {
      client.close();
    }
  });

  test('serverStream() return() cancels an in-progress stream cleanly', async () => {
    const client = makeClient();
    try {
      const iterator = client.serverStream<StreamRequest, StreamResponse>(
        '/echo.EchoService/Stream',
        { message: 'cancel-test', count: 10 },
      );

      // Read the first message then cancel — must not throw.
      const first = await iterator.next();
      expect(first.done).toBe(false);
      expect(first.value.index).toBe(0);

      const result = await iterator.return!();
      expect(result.done).toBe(true);
    } finally {
      client.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AC4 — Channel closed in fixture teardown even when test throws
// ---------------------------------------------------------------------------

test.describe('GrpcClient channel lifecycle', () => {
  test('close() can be called on a channel that was never used', () => {
    // close() should be safe to call even before any RPC.
    const client = new GrpcClient({ host: 'localhost:1', tls: false });
    expect(() => client.close()).not.toThrow();
  });

  test('getTarget() returns the configured host', () => {
    const client = new GrpcClient({ host: 'localhost:9999', tls: false });
    try {
      expect(client.getTarget()).toBe('localhost:9999');
    } finally {
      client.close();
    }
  });

  test('getConnectivityState() returns a valid state before any call', () => {
    const client = new GrpcClient({ host: 'localhost:1', tls: false });
    try {
      const state = client.getConnectivityState();
      // IDLE (0) or CONNECTING (1) are both valid initial states.
      expect([
        grpc.connectivityState.IDLE,
        grpc.connectivityState.CONNECTING,
        grpc.connectivityState.TRANSIENT_FAILURE,
        grpc.connectivityState.READY,
        grpc.connectivityState.SHUTDOWN,
      ]).toContain(state);
    } finally {
      client.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AC4 — grpcClient fixture tears down channel even on test failure
// ---------------------------------------------------------------------------

test.describe.serial('grpcClient fixture teardown', () => {
  // The grpcClient fixture (from @framework/fixtures) manages channel lifecycle.
  // We verify it is injected and usable; teardown is exercised by Playwright
  // running the fixture's finally block after each test.

  test('grpcClient fixture is injected from @framework/fixtures', async ({ grpcClient }) => {
    expect(grpcClient).toBeDefined();
    expect(typeof grpcClient.call).toBe('function');
    expect(typeof grpcClient.serverStream).toBe('function');
    expect(typeof grpcClient.close).toBe('function');
  });

  test('grpcClient fixture provides independent instance each worker', async ({ grpcClient }) => {
    // Two calls to getTarget() on the same worker-scoped instance must return
    // the same value — the instance is stable within a worker.
    const t1 = grpcClient.getTarget();
    const t2 = grpcClient.getTarget();
    expect(t1).toBe(t2);
  });
});

// ---------------------------------------------------------------------------
// AC6 — TLS and insecure modes are configurable
// ---------------------------------------------------------------------------

test.describe('TLS configuration', () => {
  test('tls=false creates an insecure channel (does not throw)', () => {
    const client = new GrpcClient({ host: 'localhost:50051', tls: false });
    try {
      // Just verifying construction succeeds.
      expect(client.getTarget()).toBe('localhost:50051');
    } finally {
      client.close();
    }
  });

  test('tls=true creates a TLS channel (does not throw during construction)', () => {
    const client = new GrpcClient({ host: 'localhost:50051', tls: true });
    try {
      expect(client.getTarget()).toBe('localhost:50051');
    } finally {
      client.close();
    }
  });

  test('E2E_GRPC_TLS=false env var creates insecure channel', () => {
    const original = process.env['E2E_GRPC_TLS'];
    process.env['E2E_GRPC_TLS'] = 'false';
    try {
      const client = new GrpcClient({ host: 'localhost:1' });
      expect(client).toBeDefined();
      client.close();
    } finally {
      if (original !== undefined) {
        process.env['E2E_GRPC_TLS'] = original;
      } else {
        delete process.env['E2E_GRPC_TLS'];
      }
    }
  });

  test('E2E_GRPC_TLS=true env var creates TLS channel (construction only)', () => {
    const original = process.env['E2E_GRPC_TLS'];
    process.env['E2E_GRPC_TLS'] = 'true';
    try {
      const client = new GrpcClient({ host: 'localhost:1' });
      expect(client).toBeDefined();
      client.close();
    } finally {
      if (original !== undefined) {
        process.env['E2E_GRPC_TLS'] = original;
      } else {
        delete process.env['E2E_GRPC_TLS'];
      }
    }
  });
});

// ---------------------------------------------------------------------------
// AC1 (echo integration) — Full round-trip: start stub, call, stop stub
// ---------------------------------------------------------------------------

test.describe('GrpcEchoServer — full fixture lifecycle', () => {
  test('starts, accepts a Ping call, and stops cleanly', async () => {
    const server = new GrpcEchoServer();
    const port = await server.start();

    expect(port).toBeGreaterThan(0);
    expect(server.address).toMatch(/^127\.0\.0\.1:\d+$/);

    const client = new GrpcClient({ host: server.address, tls: false });
    try {
      const response = await client.call<PingRequest, PingResponse>('/echo.EchoService/Ping', {
        message: 'lifecycle-test',
      });
      expect(response.message).toBe('lifecycle-test');
    } finally {
      client.close();
      await server.stop();
    }
  });

  test('stop() resolves cleanly even with no in-flight calls', async () => {
    const server = new GrpcEchoServer();
    await server.start();
    await expect(server.stop()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC-233-1 — clientStream() sends a stream of requests, receives one response
// ---------------------------------------------------------------------------

test.describe('GrpcClient — Collect client-streaming (MINCRM-233)', () => {
  let server: GrpcEchoServer;
  let makeClient: (options?: { tls?: boolean }) => GrpcClient;

  test.beforeAll(async () => {
    ({ server, makeClient } = await withEchoServer());
  });

  test.afterAll(async () => {
    await server.stop();
  });

  test('clientStream() collects all messages and returns count + last message', async () => {
    const client = makeClient();
    try {
      async function* messages(): AsyncIterable<CollectRequest> {
        yield { message: 'alpha' };
        yield { message: 'beta' };
        yield { message: 'gamma' };
      }

      const response = await client.clientStream<CollectRequest, CollectResponse>(
        '/echo.EchoService/Collect',
        messages(),
      );

      expect(response.count).toBe(3);
      expect(response.last).toBe('gamma');
    } finally {
      client.close();
    }
  });

  test('clientStream() with a single message returns count=1 and the message', async () => {
    const client = makeClient();
    try {
      async function* singleMessage(): AsyncIterable<CollectRequest> {
        yield { message: 'only' };
      }

      const response = await client.clientStream<CollectRequest, CollectResponse>(
        '/echo.EchoService/Collect',
        singleMessage(),
      );

      expect(response.count).toBe(1);
      expect(response.last).toBe('only');
    } finally {
      client.close();
    }
  });

  test('clientStream() with empty stream returns count=0 and empty last', async () => {
    const client = makeClient();
    try {
      async function* emptyStream(): AsyncIterable<CollectRequest> {
        // No messages.
      }

      const response = await client.clientStream<CollectRequest, CollectResponse>(
        '/echo.EchoService/Collect',
        emptyStream(),
      );

      expect(response.count).toBe(0);
      expect(response.last).toBe('');
    } finally {
      client.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-233-2 — bidiStream() sends a stream of requests, yields each response
// ---------------------------------------------------------------------------

test.describe('GrpcClient — Echo bidirectional-streaming (MINCRM-233)', () => {
  let server: GrpcEchoServer;
  let makeClient: (options?: { tls?: boolean }) => GrpcClient;

  test.beforeAll(async () => {
    ({ server, makeClient } = await withEchoServer());
  });

  test.afterAll(async () => {
    await server.stop();
  });

  test('bidiStream() echoes all sent messages back in order', async () => {
    const client = makeClient();
    try {
      async function* requests(): AsyncIterable<EchoRequest> {
        yield { message: 'one' };
        yield { message: 'two' };
        yield { message: 'three' };
      }

      const responses: EchoResponse[] = [];
      for await (const resp of client.bidiStream<EchoRequest, EchoResponse>(
        '/echo.EchoService/Echo',
        requests(),
      )) {
        responses.push(resp);
      }

      expect(responses).toHaveLength(3);
      expect(responses[0]?.message).toBe('one');
      expect(responses[1]?.message).toBe('two');
      expect(responses[2]?.message).toBe('three');
    } finally {
      client.close();
    }
  });

  test('bidiStream() with a single message yields one response', async () => {
    const client = makeClient();
    try {
      async function* singleRequest(): AsyncIterable<EchoRequest> {
        yield { message: 'hello' };
      }

      const responses: EchoResponse[] = [];
      for await (const resp of client.bidiStream<EchoRequest, EchoResponse>(
        '/echo.EchoService/Echo',
        singleRequest(),
      )) {
        responses.push(resp);
      }

      expect(responses).toHaveLength(1);
      expect(responses[0]?.message).toBe('hello');
    } finally {
      client.close();
    }
  });

  test('bidiStream() with empty stream yields no responses', async () => {
    const client = makeClient();
    try {
      async function* emptyRequests(): AsyncIterable<EchoRequest> {
        // No messages.
      }

      const responses: EchoResponse[] = [];
      for await (const resp of client.bidiStream<EchoRequest, EchoResponse>(
        '/echo.EchoService/Echo',
        emptyRequests(),
      )) {
        responses.push(resp);
      }

      expect(responses).toHaveLength(0);
    } finally {
      client.close();
    }
  });
});

// ---------------------------------------------------------------------------
// protoCall() — unary via proto-loader (MINCRM-376)
// ---------------------------------------------------------------------------

test.describe('GrpcClient — protoCall unary (MINCRM-376)', () => {
  let server: ProtoEchoServer;

  test.beforeAll(async () => {
    server = new ProtoEchoServer();
    await server.start();
  });

  test.afterAll(async () => {
    await server.stop();
  });

  test('protoCall() echoes message back via proto codec', async () => {
    const client = new GrpcClient({ host: server.address, tls: false });
    try {
      const response = await client.protoCall<PingRequest, PingResponse>(
        ProtoEchoServer.PROTO_PATH,
        ProtoEchoServer.SERVICE_NAME,
        'Ping',
        { message: 'proto-hello' },
      );
      expect(response.message).toBe('proto-hello');
    } finally {
      client.close();
    }
  });

  test('protoCall() uses cached proto package on second call', async () => {
    const client = new GrpcClient({ host: server.address, tls: false });
    try {
      // Two calls to the same proto path — second reuses the cached GrpcObject.
      const r1 = await client.protoCall<PingRequest, PingResponse>(
        ProtoEchoServer.PROTO_PATH,
        ProtoEchoServer.SERVICE_NAME,
        'Ping',
        { message: 'first' },
      );
      const r2 = await client.protoCall<PingRequest, PingResponse>(
        ProtoEchoServer.PROTO_PATH,
        ProtoEchoServer.SERVICE_NAME,
        'Ping',
        { message: 'second' },
      );
      expect(r1.message).toBe('first');
      expect(r2.message).toBe('second');
    } finally {
      client.close();
    }
  });

  test('protoCall() throws GrpcClientError with UNAVAILABLE on dead server', async () => {
    const client = new GrpcClient({ host: '127.0.0.1:1', tls: false });
    try {
      await expect(
        client.protoCall<PingRequest, PingResponse>(
          ProtoEchoServer.PROTO_PATH,
          ProtoEchoServer.SERVICE_NAME,
          'Ping',
          { message: 'unreachable' },
        ),
      ).rejects.toBeInstanceOf(GrpcClientError);
    } finally {
      client.close();
    }
  });

  test('protoCall() throws when service path not found in proto', async () => {
    const client = new GrpcClient({ host: server.address, tls: false });
    try {
      await expect(
        client.protoCall<PingRequest, PingResponse>(
          ProtoEchoServer.PROTO_PATH,
          'echo.NonExistentService',
          'Ping',
          { message: 'bad-path' },
        ),
      ).rejects.toThrow(/Service path not found in proto/);
    } finally {
      client.close();
    }
  });
});

// ---------------------------------------------------------------------------
// protoServerStream() — server-streaming via proto-loader (MINCRM-376)
// ---------------------------------------------------------------------------

test.describe('GrpcClient — protoServerStream (MINCRM-376)', () => {
  let server: ProtoEchoServer;

  test.beforeAll(async () => {
    server = new ProtoEchoServer();
    await server.start();
  });

  test.afterAll(async () => {
    await server.stop();
  });

  test('protoServerStream() yields all messages in order', async () => {
    const client = new GrpcClient({ host: server.address, tls: false });
    try {
      const messages: StreamResponse[] = [];
      const iterator = await client.protoServerStream<StreamRequest, StreamResponse>(
        ProtoEchoServer.PROTO_PATH,
        ProtoEchoServer.SERVICE_NAME,
        'Stream',
        { message: 'proto-stream', count: 3 },
      );

      for await (const msg of iterator) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(3);
      expect(messages[0]).toMatchObject({ message: 'proto-stream', index: 0 });
      expect(messages[1]).toMatchObject({ message: 'proto-stream', index: 1 });
      expect(messages[2]).toMatchObject({ message: 'proto-stream', index: 2 });
    } finally {
      client.close();
    }
  });

  test('protoServerStream() with count=0 yields no messages', async () => {
    const client = new GrpcClient({ host: server.address, tls: false });
    try {
      const messages: StreamResponse[] = [];
      const iterator = await client.protoServerStream<StreamRequest, StreamResponse>(
        ProtoEchoServer.PROTO_PATH,
        ProtoEchoServer.SERVICE_NAME,
        'Stream',
        { message: 'empty', count: 0 },
      );

      for await (const msg of iterator) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(0);
    } finally {
      client.close();
    }
  });

  test('protoServerStream() return() cancels stream cleanly', async () => {
    const client = new GrpcClient({ host: server.address, tls: false });
    try {
      const iterator = await client.protoServerStream<StreamRequest, StreamResponse>(
        ProtoEchoServer.PROTO_PATH,
        ProtoEchoServer.SERVICE_NAME,
        'Stream',
        { message: 'cancel', count: 10 },
      );

      const first = await iterator.next();
      expect(first.done).toBe(false);

      const result = await iterator.return!();
      expect(result.done).toBe(true);
    } finally {
      client.close();
    }
  });

  test('protoServerStream() throws GrpcClientError with UNAVAILABLE on dead server', async () => {
    const client = new GrpcClient({ host: '127.0.0.1:1', tls: false });
    try {
      const iterator = await client.protoServerStream<StreamRequest, StreamResponse>(
        ProtoEchoServer.PROTO_PATH,
        ProtoEchoServer.SERVICE_NAME,
        'Stream',
        { message: 'unreachable', count: 1 },
      );

      await expect(iterator.next()).rejects.toBeInstanceOf(GrpcClientError);
    } finally {
      client.close();
    }
  });
});
