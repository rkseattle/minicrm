/**
 * REST API client for the E2E framework.
 *
 * Wraps Playwright's APIRequestContext with typed request/response helpers and
 * a pluggable auth strategy system. Tests and TestDataManager should use this
 * rather than calling APIRequestContext directly.
 *
 * MINCRM-127
 */

import type { APIRequestContext } from '@playwright/test';

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
  /** @param username - The username. */
  /** @param password - The password. */
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
 * Thrown by RestClient on any HTTP 4xx or 5xx response.
 */
export class RestClientError extends Error {
  /** @param status - The HTTP status code. */
  /** @param body - The raw parsed response body. */
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`REST request failed with status ${status}`);
    this.name = 'RestClientError';
  }
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
    const headers: Record<string, string> = { ...extra };
    this.authStrategy?.apply(headers);
    return headers;
  }

  /**
   * Parses a Playwright APIResponse into an ApiResponse<T>, throwing
   * RestClientError on 4xx/5xx.
   *
   * @template T - Expected body type.
   * @param response - Raw Playwright APIResponse.
   * @returns Typed ApiResponse<T>.
   */
  private async parseResponse<T>(
    response: Awaited<ReturnType<APIRequestContext['get']>>,
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
   * @param headers - Optional additional headers.
   * @returns Typed ApiResponse<T>.
   */
  async get<T>(path: string, headers?: Record<string, string>): Promise<ApiResponse<T>> {
    const response = await this.request.get(this.url(path), {
      headers: this.buildHeaders(headers),
    });
    return this.parseResponse<T>(response);
  }

  /**
   * Sends a POST request with a JSON body.
   *
   * @template T - Expected response body type.
   * @param path - Relative URL path.
   * @param body - Request payload (will be JSON-serialized).
   * @param headers - Optional additional headers.
   * @returns Typed ApiResponse<T>.
   */
  async post<T>(
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<ApiResponse<T>> {
    const response = await this.request.post(this.url(path), {
      data: body,
      headers: this.buildHeaders(headers),
    });
    return this.parseResponse<T>(response);
  }

  /**
   * Sends a PUT request with a JSON body.
   *
   * @template T - Expected response body type.
   * @param path - Relative URL path.
   * @param body - Request payload (will be JSON-serialized).
   * @param headers - Optional additional headers.
   * @returns Typed ApiResponse<T>.
   */
  async put<T>(
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<ApiResponse<T>> {
    const response = await this.request.put(this.url(path), {
      data: body,
      headers: this.buildHeaders(headers),
    });
    return this.parseResponse<T>(response);
  }

  /**
   * Sends a PATCH request with a JSON body.
   *
   * @template T - Expected response body type.
   * @param path - Relative URL path.
   * @param body - Request payload (will be JSON-serialized).
   * @param headers - Optional additional headers.
   * @returns Typed ApiResponse<T>.
   */
  async patch<T>(
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<ApiResponse<T>> {
    const response = await this.request.patch(this.url(path), {
      data: body,
      headers: this.buildHeaders(headers),
    });
    return this.parseResponse<T>(response);
  }

  /**
   * Sends a DELETE request.
   *
   * @template T - Expected response body type.
   * @param path - Relative URL path.
   * @param headers - Optional additional headers.
   * @returns Typed ApiResponse<T>.
   */
  async delete<T>(path: string, headers?: Record<string, string>): Promise<ApiResponse<T>> {
    const response = await this.request.delete(this.url(path), {
      headers: this.buildHeaders(headers),
    });
    return this.parseResponse<T>(response);
  }
}
