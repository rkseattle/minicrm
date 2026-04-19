/**
 * Barrel export for the E2E fixture layer.
 *
 * All test specs and behaviors must import `test` and `expect` from here
 * rather than directly from `@playwright/test`. This ensures the healPage,
 * restClient, and grpcClient fixtures are always available and that imports
 * don't bypass the fixture layer.
 *
 * MINCRM-126, MINCRM-127, MINCRM-128, MINCRM-209
 */

import { mergeTests } from '@playwright/test';
import { test as healPageTest } from './heal-page.fixture.js';
import { test as restClientTest } from './rest-client.fixture.js';
import { test as grpcClientTest } from './grpc-client.fixture.js';

/**
 * Merged test object that includes all framework fixtures:
 * - `healPage` (MINCRM-126)
 * - `pageFacade` (MINCRM-209)
 * - `restClient` (MINCRM-127)
 * - `grpcClient` (MINCRM-128)
 */
export const test = mergeTests(healPageTest, restClientTest, grpcClientTest);

export { expect } from '@playwright/test';

export type { HealPage, HealMethods, LocateOptions } from './heal-methods.js';
export type { RestClientFixtures } from './rest-client.fixture.js';
export type { GrpcClientFixtures } from './grpc-client.fixture.js';
export type { SafePage } from '../types/safe-page.js';
export type { PageFacade } from '../types/page-facade.js';
export { createPageFacade } from '../types/page-facade.js';
