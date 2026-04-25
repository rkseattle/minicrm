/**
 * REST API client for the E2E framework.
 *
 * Wraps Playwright's APIRequestContext with typed request/response helpers and
 * a pluggable auth strategy system. Tests and TestDataManager should use this
 * rather than calling APIRequestContext directly.
 *
 * MINCRM-127, MINCRM-229
 */

import type { APIRequestContext } from '@playwright/test';

// ---------------------------------------------------------------------------
// Schema duck types — compatible with both Zod v3 and v4 (MINCRM-229)
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

// ---------------------------------------------------------------------------
// Per-request options (MINCRM-229)
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
   * When omitted, behaviour is identical to the pre-MINCRM-229 bare cast.
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
   * Base URL for all requests. Defaults to the `E2E_BASE_URL` environment
   * variable, which itself defaults to `http://localhost:5173`.
   */
  baseUrl?: string;
  /**
   * Auth strategy to apply on every request. If omitted, no auth headers
   * are added.
   */
  authStrategy?: AuthStrategy;
}

// ---------------------------------------------------------------------------
// RestClient
// ---------------------------------------------------------------------------

/** Default base URL when E2E_BASE_URL is not set. */
const DEFAULT_BASE_URL = 'http://localhost:5173';

/**
 * Typed HTTP client wrapping Playwright's APIRequestContext.
 *
 * All methods throw RestClientError on 4xx/5xx. The auth strategy (if any) is
 * applied automatically; tests never manage auth headers directly.
 */
export class RestClient {
  private readonly baseUrl: string;
  private readonly authStrategy?: AuthStrategy;

  /**
   * @param request - Playwright APIRequestContext (injected by fixture).
   * @param options - Optional base URL and auth strategy overrides.
   */
  constructor(
    private readonly request: APIRequestContext,
    options: RestClientOptions = {},
  ) {
    this.baseUrl = options.baseUrl ?? process.env['E2E_BASE_URL'] ?? DEFAULT_BASE_URL;
    this.authStrategy = options.authStrategy;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Builds the full URL from a path segment.
   *
   * @param path - Relative path (e.g., `/contacts`).
   * @returns Absolute URL string.
   */
  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  /**
   * Builds the headers map, applying the auth strategy if present.
   *
   * @param extra - Extra headers to merge in.
   * @returns Final headers record.
   */
  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    // Apply auth strategy first so that explicitly supplied extra headers win.
    const headers: Record<string, string> = {};
    this.authStrategy?.apply(headers);
    return { ...headers, ...extra };
  }

  /**
   * Parses a Playwright APIResponse into an ApiResponse<T>, throwing
   * RestClientError on 4xx/5xx or on Zod validation failure (MINCRM-229).
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

    // When a Zod schema is provided, validate the body at runtime (MINCRM-229).
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
    options?: RequestOptions & { headers?: Record<string, string> },
  ): Promise<ApiResponse<T>> {
    const response = await this.request.get(this.url(path), {
      headers: this.buildHeaders(options?.headers),
    });
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
    const response = await this.request.post(this.url(path), {
      data: body,
      headers: this.buildHeaders(options?.headers),
    });
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
    const response = await this.request.put(this.url(path), {
      data: body,
      headers: this.buildHeaders(options?.headers),
    });
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
    const response = await this.request.patch(this.url(path), {
      data: body,
      headers: this.buildHeaders(options?.headers),
    });
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
    const response = await this.request.delete(this.url(path), {
      headers: this.buildHeaders(options?.headers),
    });
    return this.parseResponse<T>(response, 'DELETE', path, options);
  }
}
