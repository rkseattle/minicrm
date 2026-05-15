/**
 * Unit tests for RestClient and auth strategies.
 *
 * Verifies all Acceptance Criteria from MINCRM-127:
 *
 * AC1 — post<T>() returns ApiResponse<T> with typed body.
 * AC2 — A 404 response throws RestClientError with status 404 and the body.
 * AC3 — Bearer, API key, and Basic auth strategies each inject the correct header.
 * AC4 — restClient fixture is available from @framework/fixtures (structural).
 * AC5 — Workers receive independent instances (structural / fixture-scope).
 * AC6 — All unit tests pass in CI.
 *
 * MINCRM-229 Acceptance Criteria:
 * AC-229-1 — Successful schema validation passes the parsed body through.
 * AC-229-2 — Shape mismatch throws RestClientError with endpoint in the message.
 * AC-229-3 — Callers without a schema continue to use the bare cast.
 * AC-229-4 — HTTP 4xx/5xx errors do not set validationError even when schema is provided.
 *
 * All tests mock the Playwright APIRequestContext so no server is required.
 *
 * MINCRM-127, MINCRM-229
 */

import { test, expect } from '@framework/fixtures';
import {
  RestClient,
  RestClientError,
  BearerAuthStrategy,
  ApiKeyAuthStrategy,
  BasicAuthStrategy,
} from '@framework/clients';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal mock APIResponse.
 *
 * @param status - HTTP status code.
 * @param body - Object that will be returned by json().
 * @param headers - Optional headers map.
 * @returns Mock APIResponse.
 */
function mockApiResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): APIResponse {
  return {
    status: () => status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: () => headers,
    ok: () => status >= 200 && status < 300,
    url: () => 'http://localhost:5173/test',
    body: () => Promise.resolve(Buffer.from(JSON.stringify(body))),
    dispose: () => Promise.resolve(),
  } as unknown as APIResponse;
}

/**
 * Builds a mock APIRequestContext that intercepts all HTTP method calls.
 * The provided `handler` is called for every request and returns a mock response.
 *
 * @param handler - Called with (method, url, options) for each request.
 * @returns Mock APIRequestContext.
 */
function mockContext(
  handler: (method: string, url: string, options?: Record<string, unknown>) => APIResponse,
): APIRequestContext {
  const call =
    (method: string) =>
    (url: string, options?: Record<string, unknown>): Promise<APIResponse> =>
      Promise.resolve(handler(method, url, options));

  return {
    get: call('GET'),
    post: call('POST'),
    put: call('PUT'),
    patch: call('PATCH'),
    delete: call('DELETE'),
    // Unused by RestClient but required by the interface.
    fetch: call('FETCH'),
    head: call('HEAD'),
    dispose: () => Promise.resolve(),
  } as unknown as APIRequestContext;
}

// ---------------------------------------------------------------------------
// AC1 — post<T>() returns ApiResponse<T> with typed body
// ---------------------------------------------------------------------------

test.describe('RestClient typed responses', () => {
  interface Contact {
    id: number;
    name: string;
  }

  test('post<Contact>() returns ApiResponse<Contact> with typed body', async () => {
    const responseBody: Contact = { id: 1, name: 'Alice' };
    const ctx = mockContext(() =>
      mockApiResponse(201, responseBody, { 'content-type': 'application/json' }),
    );
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:5173' });

    const result = await client.post<Contact>('/contacts', { name: 'Alice' });

    expect(result.status).toBe(201);
    expect(result.body.id).toBe(1);
    expect(result.body.name).toBe('Alice');
    expect(result.headers['content-type']).toBe('application/json');
  });

  test('get<T>() returns typed body on 200', async () => {
    interface User {
      id: number;
      email: string;
    }
    const body: User = { id: 42, email: 'bob@example.com' };
    const ctx = mockContext(() => mockApiResponse(200, body));
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:5173' });

    const result = await client.get<User>('/users/42');

    expect(result.status).toBe(200);
    expect(result.body.email).toBe('bob@example.com');
  });

  test('put<T>() returns typed body on 200', async () => {
    const body = { updated: true };
    const ctx = mockContext(() => mockApiResponse(200, body));
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:5173' });

    const result = await client.put<{ updated: boolean }>('/resource/1', { updated: true });

    expect(result.body.updated).toBe(true);
  });

  test('patch<T>() returns typed body on 200', async () => {
    const body = { patched: true };
    const ctx = mockContext(() => mockApiResponse(200, body));
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:5173' });

    const result = await client.patch<{ patched: boolean }>('/resource/1', { patched: true });

    expect(result.body.patched).toBe(true);
  });

  test('delete<T>() returns empty body on 204', async () => {
    const ctx = mockContext(() => mockApiResponse(204, {}));
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:5173' });

    const result = await client.delete<Record<string, never>>('/resource/1');

    expect(result.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// AC2 — 4xx/5xx throws RestClientError with correct status and body
// ---------------------------------------------------------------------------

test.describe('RestClientError on error responses', () => {
  test('404 response throws RestClientError with status 404 and response body', async () => {
    const errorBody = { error: { code: 'NOT_FOUND', message: 'Contact not found' } };
    const ctx = mockContext(() => mockApiResponse(404, errorBody));
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:5173' });

    await expect(client.get('/contacts/999')).rejects.toThrow(RestClientError);

    try {
      await client.get('/contacts/999');
    } catch (err) {
      expect(err).toBeInstanceOf(RestClientError);
      const restErr = err as RestClientError;
      expect(restErr.status).toBe(404);
      expect(restErr.body).toEqual(errorBody);
    }
  });

  test('500 response throws RestClientError with status 500', async () => {
    const ctx = mockContext(() => mockApiResponse(500, { error: 'Internal Server Error' }));
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:5173' });

    let caught: unknown;
    try {
      await client.post('/something', {});
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RestClientError);
    expect((caught as RestClientError).status).toBe(500);
  });

  test('401 response throws RestClientError — never returns null or undefined', async () => {
    const ctx = mockContext(() => mockApiResponse(401, { error: 'Unauthorized' }));
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:5173' });

    let result: unknown = undefined;
    let caught: unknown = undefined;
    try {
      result = await client.get('/protected');
    } catch (err) {
      caught = err;
    }

    expect(result).toBeUndefined();
    expect(caught).toBeInstanceOf(RestClientError);
  });

  test('403 response throws RestClientError', async () => {
    const ctx = mockContext(() => mockApiResponse(403, { error: 'Forbidden' }));
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:5173' });

    await expect(client.delete('/admin/resource')).rejects.toThrow(RestClientError);
  });
});

// ---------------------------------------------------------------------------
// AC3 — Auth strategies inject the correct headers
// ---------------------------------------------------------------------------

test.describe('Auth strategies', () => {
  /**
   * Captures the headers sent in the request and returns a 200.
   *
   * @param capturedHeaders - Object that will be populated with the headers.
   * @returns Mock APIRequestContext.
   */
  function captureHeadersContext(capturedHeaders: Record<string, string>): APIRequestContext {
    return mockContext((_method, _url, options) => {
      const headers = (options?.['headers'] ?? {}) as Record<string, string>;
      Object.assign(capturedHeaders, headers);
      return mockApiResponse(200, {});
    });
  }

  test('BearerAuthStrategy injects Authorization: Bearer <token>', async () => {
    const headers: Record<string, string> = {};
    const ctx = captureHeadersContext(headers);
    const client = new RestClient(ctx, {
      baseUrl: 'http://localhost:5173',
      authStrategy: new BearerAuthStrategy('my-secret-token'),
    });

    await client.get('/me');

    expect(headers['Authorization']).toBe('Bearer my-secret-token');
  });

  test('ApiKeyAuthStrategy injects the named header with the key value', async () => {
    const headers: Record<string, string> = {};
    const ctx = captureHeadersContext(headers);
    const client = new RestClient(ctx, {
      baseUrl: 'http://localhost:5173',
      authStrategy: new ApiKeyAuthStrategy('X-API-Key', 'supersecret'),
    });

    await client.get('/resource');

    expect(headers['X-API-Key']).toBe('supersecret');
  });

  test('BasicAuthStrategy injects Authorization: Basic <base64(user:pass)>', async () => {
    const headers: Record<string, string> = {};
    const ctx = captureHeadersContext(headers);
    const client = new RestClient(ctx, {
      baseUrl: 'http://localhost:5173',
      authStrategy: new BasicAuthStrategy('alice', 'p@ssword'),
    });

    await client.get('/resource');

    const expected = `Basic ${Buffer.from('alice:p@ssword').toString('base64')}`;
    expect(headers['Authorization']).toBe(expected);
  });

  test('No auth strategy — no Authorization header added', async () => {
    const headers: Record<string, string> = {};
    const ctx = captureHeadersContext(headers);
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:5173' });

    await client.get('/public');

    expect(headers['Authorization']).toBeUndefined();
  });

  test('Extra header overrides auth strategy header for the same key', async () => {
    // When a caller explicitly passes a header that the auth strategy would also
    // set, the per-request extra header must win (auth strategy applied first,
    // extra spread on top).
    const headers: Record<string, string> = {};
    const ctx = captureHeadersContext(headers);
    const client = new RestClient(ctx, {
      baseUrl: 'http://localhost:5173',
      authStrategy: new BearerAuthStrategy('default-token'),
    });

    await client.get('/resource', { headers: { Authorization: 'Bearer one-off-token' } });

    expect(headers['Authorization']).toBe('Bearer one-off-token');
  });
});

// ---------------------------------------------------------------------------
// AC3 (continued) — Base URL override works correctly
// ---------------------------------------------------------------------------

test.describe('Base URL override', () => {
  test('uses baseUrl from options when provided', async () => {
    let calledUrl = '';
    const ctx = mockContext((_method, url) => {
      calledUrl = url;
      return mockApiResponse(200, {});
    });

    const client = new RestClient(ctx, { baseUrl: 'http://api.example.com' });
    await client.get('/health');

    expect(calledUrl).toBe('http://api.example.com/health');
  });

  test('uses E2E_API_URL env var when no baseUrl in options', async () => {
    const original = process.env['E2E_API_URL'];
    process.env['E2E_API_URL'] = 'http://env-override:8080';

    let calledUrl = '';
    const ctx = mockContext((_method, url) => {
      calledUrl = url;
      return mockApiResponse(200, {});
    });

    try {
      const client = new RestClient(ctx);
      await client.get('/ping');
      expect(calledUrl).toBe('http://env-override:8080/ping');
    } finally {
      if (original !== undefined) {
        process.env['E2E_API_URL'] = original;
      } else {
        delete process.env['E2E_API_URL'];
      }
    }
  });

  test('falls back to http://localhost:3001 when no env or option set', async () => {
    const original = process.env['E2E_API_URL'];
    delete process.env['E2E_API_URL'];

    let calledUrl = '';
    const ctx = mockContext((_method, url) => {
      calledUrl = url;
      return mockApiResponse(200, {});
    });

    try {
      const client = new RestClient(ctx);
      await client.get('/ping');
      expect(calledUrl).toBe('http://localhost:3001/ping');
    } finally {
      if (original !== undefined) process.env['E2E_API_URL'] = original;
    }
  });
});

// ---------------------------------------------------------------------------
// AC4 — restClient fixture is available from @framework/fixtures
// ---------------------------------------------------------------------------

test.describe('restClient fixture availability', () => {
  // AC4: structural — if this test compiles and runs, the fixture is wired up.
  test('restClient fixture is injected from @framework/fixtures', async ({ restClient }) => {
    // restClient is a RestClient instance — verifying the fixture is available
    // without any additional setup.
    expect(restClient).toBeDefined();
    expect(typeof restClient.get).toBe('function');
    expect(typeof restClient.post).toBe('function');
    expect(typeof restClient.put).toBe('function');
    expect(typeof restClient.patch).toBe('function');
    expect(typeof restClient.delete).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// MINCRM-229 — Optional Zod schema validation
// ---------------------------------------------------------------------------

test.describe('RestClient Zod schema validation (MINCRM-229)', () => {
  // AC-229-1: Successful schema validation passes the parsed body through.
  test('get() with matching schema returns validated body', async () => {
    const schema = z.object({ id: z.number(), name: z.string() });
    const responseBody = { id: 1, name: 'Alice' };
    const ctx = mockContext(() => mockApiResponse(200, responseBody));
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:5173' });

    const result = await client.get<z.infer<typeof schema>>('/users/1', { schema });

    expect(result.status).toBe(200);
    expect(result.body.id).toBe(1);
    expect(result.body.name).toBe('Alice');
  });

  test('post() with matching schema returns validated body', async () => {
    const schema = z.object({ id: z.string().uuid(), email: z.string().email() });
    const responseBody = { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', email: 'x@example.com' };
    const ctx = mockContext(() => mockApiResponse(201, responseBody));
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:5173' });

    const result = await client.post<z.infer<typeof schema>>('/resource', {}, { schema });

    expect(result.body.email).toBe('x@example.com');
  });

  // AC-229-2: Shape mismatch throws RestClientError with endpoint in the message.
  test('get() with mismatched schema throws RestClientError containing method and path', async () => {
    const schema = z.object({ id: z.number(), name: z.string() });
    // Server returns a body where `id` is a string, not a number — contract violation.
    const badBody = { id: 'not-a-number', name: 'Alice' };
    const ctx = mockContext(() => mockApiResponse(200, badBody));
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:5173' });

    let caught: unknown;
    try {
      await client.get('/api/v1/resource/42', { schema });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RestClientError);
    const restErr = caught as RestClientError;
    // Error message must identify the method and endpoint.
    expect(restErr.message).toContain('GET');
    expect(restErr.message).toContain('/api/v1/resource/42');
    // validationError field should be populated with the ZodError.
    expect(restErr.validationError).toBeDefined();
    expect(restErr.validationError?.issues.length).toBeGreaterThan(0);
  });

  test('patch() with mismatched schema throws RestClientError containing method and path', async () => {
    const schema = z.object({ updated: z.boolean() });
    const badBody = { updated: 'yes' }; // string instead of boolean
    const ctx = mockContext(() => mockApiResponse(200, badBody));
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:5173' });

    let caught: unknown;
    try {
      await client.patch('/api/v1/items/7', { value: 1 }, { schema });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RestClientError);
    const restErr = caught as RestClientError;
    expect(restErr.message).toContain('PATCH');
    expect(restErr.message).toContain('/api/v1/items/7');
    expect(restErr.validationError).toBeDefined();
  });

  // AC-229-3: Callers without a schema continue to use the bare cast — no behaviour change.
  test('get() without schema uses bare cast — no validation, no error on shape mismatch', async () => {
    // The response body is structurally wrong for the inferred type, but without
    // a schema the bare cast succeeds silently (pre-MINCRM-229 behaviour preserved).
    const badBody = { wrong: 'shape' };
    const ctx = mockContext(() => mockApiResponse(200, badBody));
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:5173' });

    // No schema — should resolve without throwing even though the shape is wrong.
    const result = await client.get<{ id: number; name: string }>('/api/v1/resource/1');
    expect(result.status).toBe(200);
    // The body is the raw cast object.
    expect((result.body as unknown as { wrong: string }).wrong).toBe('shape');
  });

  test('delete() without schema continues to work unchanged', async () => {
    const ctx = mockContext(() => mockApiResponse(204, {}));
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:5173' });

    const result = await client.delete<Record<string, never>>('/api/v1/resource/1');
    expect(result.status).toBe(204);
  });

  // validationError field is undefined on normal HTTP errors.
  test('RestClientError from HTTP 4xx has no validationError', async () => {
    const ctx = mockContext(() => mockApiResponse(404, { error: 'not found' }));
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:5173' });

    let caught: unknown;
    try {
      await client.get('/missing');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RestClientError);
    expect((caught as RestClientError).validationError).toBeUndefined();
  });

  test('RestClientError from HTTP 5xx has no validationError even when schema is provided', async () => {
    const schema = z.object({ value: z.number() });
    const ctx = mockContext(() => mockApiResponse(500, { error: 'Internal Server Error' }));
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:5173' });

    let caught: unknown;
    try {
      await client.get('/broken', { schema });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RestClientError);
    const restErr = caught as RestClientError;
    expect(restErr.status).toBe(500);
    expect(restErr.validationError).toBeUndefined();
  });
});
