/**
 * REST API client for the E2E framework.
 *
 * Wraps Playwright's APIRequestContext with typed request/response helpers and
 * a pluggable auth strategy system. Tests and TestDataManager should use this
 * rather than calling APIRequestContext directly.
 *
 */

import type { APIRequestContext } from '@playwright/test';

// ---------------------------------------------------------------------------
// Schema duck types — compatible with both Zod v3 and v4
// ---------------------------------------------------------------------------

/** Structural issue type present in both Zod v3 and v4 ZodError. */
export interface ZodIssue {
  message: string;
  path: PropertyKey[];
}

/** Structural error type that both Zod v3 and v4 ZodError satisfy. */
export interface SchemaError extends Error {
  issues: ZodIssue[];
}

/** Structural schema type that both Zod v3 and v4 schemas satisfy. */
export interface Schema {
  safeParse(
    data: unknown,
  ): { success: true; data: unknown } | { success: false; error: SchemaError };
}

// ---------------------------------------------------------------------------
// Auth strategy
// ---------------------------------------------------------------------------

/**
 * Pluggable authentication strategy. Implementations add the appropriate
 * headers to the outgoing request options.
 */
export interface AuthStrategy {
  /**
   * Mutates the provided headers map to add auth credentials.
   *
   * @param headers - Mutable record that will be merged into the request.
   */
  apply(headers: Record<string, string>): void;
}

/**
 * Bearer token auth — adds `Authorization: Bearer <token>`.
 */
export class BearerAuthStrategy implements AuthStrategy {
  /** @param token - The bearer token value (without "Bearer " prefix). */
  constructor(private readonly token: string) {}

  apply(headers: Record<string, string>): void {
    headers['Authorization'] = `Bearer ${this.token}`;
  }
}

/**
 * API key header auth — adds a single named header with the key value.
 */
export class ApiKeyAuthStrategy implements AuthStrategy {
  /**
   * @param headerName - The HTTP header name (e.g., `X-API-Key`).
   * @param apiKey - The API key value.
   */
  constructor(
    private readonly headerName: string,
    private readonly apiKey: string,
  ) {}

  apply(headers: Record<string, string>): void {
    headers[this.headerName] = this.apiKey;
  }
}

/**
 * HTTP Basic auth — adds `Authorization: Basic <base64(user:pass)>`.
 */
export class BasicAuthStrategy implements AuthStrategy {
  /**
   * @param username - The username.
   * @param password - The password.
   */
  constructor(
    private readonly username: string,
    private readonly password: string,
  ) {}

  apply(headers: Record<string, string>): void {
    const encoded = Buffer.from(`${this.username}:${this.password}`).toString('base64');
    headers['Authorization'] = `Basic ${encoded}`;
  }
}

// ---------------------------------------------------------------------------
// Response + error types
// ---------------------------------------------------------------------------

/**
 * Typed API response returned by all RestClient methods.
 *
 * @template T - The expected shape of the response body.
 */
export interface ApiResponse<T> {
  /** HTTP status code. */
  status: number;
  /** Parsed JSON body typed as T. */
  body: T;
  /** Response headers as a flat string→string map. */
  headers: Record<string, string>;
}

/**
 * Thrown by RestClient on any HTTP 4xx or 5xx response, or on Zod schema
 * validation failure when a schema is provided to the request method.
 */
export class RestClientError extends Error {
  /**
   * @param status - The HTTP status code.
   * @param body - The raw parsed response body.
   * @param validationError - Populated when the error is a schema parse failure
   *   rather than an HTTP error status. Callers can inspect this to get
   *   structured field-level validation details.
   * @param message - Override message; defaults to generic HTTP status message.
   */
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    public readonly validationError?: SchemaError,
    message?: string,
  ) {
    super(message ?? `REST request failed with status ${status}`);
    this.name = 'RestClientError';
  }
}

/** HTTP status meaning the record a request targets does not exist. */
const HTTP_NOT_FOUND = 404;

/**
 * True when an error means "the record is already gone" rather than "the
 * request failed".
 *
 * The distinction matters to every teardown path: a 404 is successful cleanup
 * (the test deleted the record itself, or a cascade took it with its parent),
 * while any other error leaves the row in the database. Swallowing the second
 * kind reports success while the record leaks.
 *
 * `validationError === undefined` is part of the predicate because
 * RestClientError is one class for two unrelated failures — an error status and
 * a schema parse failure — and only the first means the record is gone.
 *
 * @param err - The thrown value to classify.
 * @returns True if the error is a plain 404.
 */
export function isAlreadyGone(err: unknown): boolean {
  return (
    err instanceof RestClientError &&
    err.status === HTTP_NOT_FOUND &&
    err.validationError === undefined
  );
}

// ---------------------------------------------------------------------------
// Per-request options
// ---------------------------------------------------------------------------

/**
 * Optional per-request options for RestClient methods.
 *
 * @template T - The expected response body type (inferred from the method call).
 */
export interface RequestOptions {
  /**
   * Zod schema to validate the parsed response body against at runtime.
   *
   * When provided, `parseResponse` calls `schema.safeParse(body)` instead of the
   * bare `body as T` cast. A parse failure throws a `RestClientError` with a
   * message that includes the HTTP method, endpoint path, and Zod error detail
   * so that API contract violations are immediately diagnosable.
   *
   * When omitted, behaviour is identical to a bare cast.
   */
  schema?: Schema;
}

// ---------------------------------------------------------------------------
// RestClient options
// ---------------------------------------------------------------------------

/**
 * Construction options for RestClient.
 */
export interface RestClientOptions {
  /**
   * Base URL for all requests. Defaults to the `E2E_API_URL` environment
   * variable, which itself defaults to `http://localhost:3001`.
   */
  baseUrl?: string;
  /**
   * Auth strategy to apply on every request. If omitted, no auth headers
   * are added.
   */
  authStrategy?: AuthStrategy;
  /**
   * Headers merged into every outgoing request, applied after the auth
   * strategy but before any per-call `options.headers` (which still win on
   * conflict). Useful for cross-cutting request-scoped headers a caller
   * wants applied to every call on this client instance — e.g. a
   * correlation/trace ID — without threading them through every call site.
   * Mutable after construction via `setDefaultHeader`/`clearDefaultHeader`.
   */
  defaultHeaders?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// RestClient
// ---------------------------------------------------------------------------

/** Default base URL when E2E_API_URL is not set. */
const DEFAULT_BASE_URL = 'http://localhost:3001';

/**
 * Typed HTTP client wrapping Playwright's APIRequestContext.
 *
 * All methods throw RestClientError on 4xx/5xx. The auth strategy (if any) is
 * applied automatically; tests never manage auth headers directly.
 */
export class RestClient {
  private readonly baseUrl: string;
  private readonly authStrategy?: AuthStrategy;
  private readonly defaultHeaders: Record<string, string>;

  /**
   * @param request - Playwright APIRequestContext (injected by fixture).
   * @param options - Optional base URL and auth strategy overrides.
   */
  constructor(
    private readonly request: APIRequestContext,
    options: RestClientOptions = {},
  ) {
    this.baseUrl = options.baseUrl ?? process.env['E2E_API_URL'] ?? DEFAULT_BASE_URL;
    this.authStrategy = options.authStrategy;
    this.defaultHeaders = { ...options.defaultHeaders };
  }

  /**
   * Sets (or overwrites) a header applied to every subsequent request on
   * this client instance, until cleared.
   */
  setDefaultHeader(name: string, value: string): void {
    this.defaultHeaders[name] = value;
  }

  /** Removes a previously-set default header. No-op if not set. */
  clearDefaultHeader(name: string): void {
    delete this.defaultHeaders[name];
  }

  /**
   * Reads a cookie's current value from the underlying request context.
   *
   * This client has no cookie jar of its own — it delegates every call to the
   * injected APIRequestContext, whose jar is the authoritative one. Callers
   * that need to inspect session state (to decide whether a token is nearing
   * expiry, say) have no other route to it, since the context itself is
   * private. `storageState()` is the supported accessor.
   *
   * @param name - Cookie name to look up.
   * @returns The cookie's value, or null when the jar holds no such cookie.
   */
  async getCookie(name: string): Promise<string | null> {
    const state = await this.request.storageState();
    return state.cookies.find((cookie) => cookie.name === name)?.value ?? null;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Builds the full URL from a path segment.
   *
   * @param path - Relative path (e.g., `/api/items`).
   * @returns Absolute URL string.
   */
  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  /**
   * Builds the headers map: auth strategy, then this client's default
   * headers, then per-call `extra` headers — each layer able to override
   * the previous, extra always winning on conflict.
   *
   * @param extra - Extra headers to merge in.
   * @returns Final headers record.
   */
  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {};
    this.authStrategy?.apply(headers);
    return { ...headers, ...this.defaultHeaders, ...extra };
  }

  /**
   * Shared retry loop. Retries fn() when the thrown error message matches
   * the supplied pattern. Backoff: 250 ms after attempt 1, 500 ms after attempt 2.
   */
  private async retryOn<T>(fn: () => Promise<T>, pattern: RegExp): Promise<T> {
    const DELAYS = [250, 500];
    let lastErr: unknown;
    for (let attempt = 0; attempt <= DELAYS.length; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!pattern.test(msg)) throw err;
        lastErr = err;
        if (attempt < DELAYS.length) {
          await new Promise((r) => setTimeout(r, DELAYS[attempt]));
        }
      }
    }
    throw lastErr;
  }

  /**
   * Retries an idempotent network call (GET, DELETE) on any transient
   * connection error. ECONNRESET and ETIMEDOUT are included because a
   * repeated read or delete cannot produce duplicate side-effects.
   */
  private withRetryIdempotent<T>(fn: () => Promise<T>): Promise<T> {
    return this.retryOn(fn, /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/);
  }

  /**
   * Retries a mutating network call (POST, PUT, PATCH) only on errors that
   * guarantee the server never received the request. ECONNREFUSED means the
   * TCP handshake was refused before any bytes were sent; ENOTFOUND means DNS
   * failed before a connection was even attempted. ECONNRESET and ETIMEDOUT
   * are intentionally excluded: they can fire after the server has already
   * committed a write, so retrying would create duplicate resources.
   */
  private withRetrySafe<T>(fn: () => Promise<T>): Promise<T> {
    return this.retryOn(fn, /ECONNREFUSED|ENOTFOUND/);
  }

  /**
   * Parses a Playwright APIResponse into an ApiResponse<T>, throwing
   * RestClientError on 4xx/5xx or on Zod validation failure.
   *
   * @template T - Expected body type.
   * @param response - Raw Playwright APIResponse.
   * @param method - HTTP method string (e.g., `GET`) — included in error messages.
   * @param path - Relative URL path — included in error messages.
   * @param options - Optional request options (schema for runtime validation).
   * @returns Typed ApiResponse<T>.
   */
  private async parseResponse<T>(
    response: Awaited<ReturnType<APIRequestContext['get']>>,
    method: string,
    path: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<T>> {
    const status = response.status();
    // Parse body as JSON; fall back to text if not JSON.
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }

    if (status >= 400) {
      throw new RestClientError(status, body);
    }

    // Collect headers into a plain record.
    const rawHeaders = response.headers();
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawHeaders)) {
      headers[key] = value;
    }

    // When a Zod schema is provided, validate the body at runtime.
    // A parse failure throws RestClientError with method, path, and Zod details
    // so the contract violation is immediately diagnosable at the call site.
    if (options?.schema !== undefined) {
      const result = options.schema.safeParse(body);
      if (!result.success) {
        const zodErr = result.error;
        throw new RestClientError(
          status,
          body,
          zodErr,
          `${method} ${path} response failed schema validation: ${zodErr.message}`,
        );
      }
      return { status, body: result.data as T, headers };
    }

    return { status, body: body as T, headers };
  }

  // -------------------------------------------------------------------------
  // Public HTTP methods
  // -------------------------------------------------------------------------

  /**
   * Sends a GET request.
   *
   * @template T - Expected response body type.
   * @param path - Relative URL path.
   * @param options - Optional headers and/or Zod schema for response validation.
   * @returns Typed ApiResponse<T>.
   */
  async get<T>(
    path: string,
    options?: RequestOptions & { headers?: Record<string, string>; timeout?: number },
  ): Promise<ApiResponse<T>> {
    const response = await this.withRetryIdempotent(() =>
      this.request.get(this.url(path), {
        headers: this.buildHeaders(options?.headers),
        timeout: options?.timeout,
      }),
    );
    return this.parseResponse<T>(response, 'GET', path, options);
  }

  /**
   * Sends a POST request with a JSON body.
   *
   * @template T - Expected response body type.
   * @param path - Relative URL path.
   * @param body - Request payload (will be JSON-serialized).
   * @param options - Optional headers and/or Zod schema for response validation.
   * @returns Typed ApiResponse<T>.
   */
  async post<T>(
    path: string,
    body?: unknown,
    options?: RequestOptions & { headers?: Record<string, string> },
  ): Promise<ApiResponse<T>> {
    const response = await this.withRetrySafe(() =>
      this.request.post(this.url(path), {
        data: body,
        headers: this.buildHeaders(options?.headers),
      }),
    );
    return this.parseResponse<T>(response, 'POST', path, options);
  }

  /**
   * Sends a PUT request with a JSON body.
   *
   * @template T - Expected response body type.
   * @param path - Relative URL path.
   * @param body - Request payload (will be JSON-serialized).
   * @param options - Optional headers and/or Zod schema for response validation.
   * @returns Typed ApiResponse<T>.
   */
  async put<T>(
    path: string,
    body?: unknown,
    options?: RequestOptions & { headers?: Record<string, string> },
  ): Promise<ApiResponse<T>> {
    const response = await this.withRetrySafe(() =>
      this.request.put(this.url(path), {
        data: body,
        headers: this.buildHeaders(options?.headers),
      }),
    );
    return this.parseResponse<T>(response, 'PUT', path, options);
  }

  /**
   * Sends a PATCH request with a JSON body.
   *
   * @template T - Expected response body type.
   * @param path - Relative URL path.
   * @param body - Request payload (will be JSON-serialized).
   * @param options - Optional headers and/or Zod schema for response validation.
   * @returns Typed ApiResponse<T>.
   */
  async patch<T>(
    path: string,
    body?: unknown,
    options?: RequestOptions & { headers?: Record<string, string> },
  ): Promise<ApiResponse<T>> {
    const response = await this.withRetrySafe(() =>
      this.request.patch(this.url(path), {
        data: body,
        headers: this.buildHeaders(options?.headers),
      }),
    );
    return this.parseResponse<T>(response, 'PATCH', path, options);
  }

  /**
   * Sends a DELETE request.
   *
   * @template T - Expected response body type.
   * @param path - Relative URL path.
   * @param options - Optional headers and/or Zod schema for response validation.
   * @returns Typed ApiResponse<T>.
   */
  async delete<T>(
    path: string,
    options?: RequestOptions & { headers?: Record<string, string> },
  ): Promise<ApiResponse<T>> {
    const response = await this.withRetryIdempotent(() =>
      this.request.delete(this.url(path), {
        headers: this.buildHeaders(options?.headers),
      }),
    );
    return this.parseResponse<T>(response, 'DELETE', path, options);
  }
}
