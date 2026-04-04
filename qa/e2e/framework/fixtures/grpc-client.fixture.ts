/**
 * grpcClient fixture — manages the gRPC channel lifecycle per test.
 *
 * Opens the channel in fixture setup and closes it in teardown, even when the
 * test throws. Each test receives an independent GrpcClient instance with no
 * shared channel state.
 *
 * Usage:
 * ```ts
 * import { test, expect } from '@framework/fixtures';
 *
 * test('pings the service', async ({ grpcClient }) => {
 *   const response = await grpcClient.call<PingRequest, PingResponse>(
 *     '/echo.EchoService/Ping',
 *     { message: 'hello' },
 *   );
 *   expect(response.message).toBe('hello');
 * });
 * ```
 *
 * MINCRM-128
 */

import { test as base } from '@playwright/test';
import { GrpcClient } from '../clients/grpc-client.js';

// ---------------------------------------------------------------------------
// Fixture type
// ---------------------------------------------------------------------------

/** Fixtures added by this module. */
export interface GrpcClientFixtures {
  /**
   * Framework-managed GrpcClient instance, scoped per test.
   * Host is read from `E2E_GRPC_HOST`; TLS from `E2E_GRPC_TLS`.
   * Channel is closed in teardown even on test failure.
   */
  grpcClient: GrpcClient;
}

// ---------------------------------------------------------------------------
// Extended test object
// ---------------------------------------------------------------------------

/**
 * Playwright test extended with the `grpcClient` fixture.
 *
 * Re-exported and merged at the fixtures/index.ts level — do not import
 * this directly in test specs.
 */
export const test = base.extend<GrpcClientFixtures>({
  grpcClient: async ({}, use) => {
    const client = new GrpcClient();
    try {
      await use(client);
    } finally {
      // Always close the channel, even if the test threw.
      client.close();
    }
  },
});
