/**
 * Unit tests for the browser coverage agent (MINCRM-605, MINCRM-606).
 *
 * pullBrowserCoverage mocks SafePage.evaluate directly — no real browser
 * is needed since the function under test is a thin wrapper around a
 * single evaluate() call. submitBrowserDump mocks RestClient.post the
 * same way rest-client.spec.ts does for other framework HTTP callers.
 */

import { test, expect } from '@framework/fixtures';
import {
  pullBrowserCoverage,
  pullAndSubmitBrowserCoverage,
  submitBrowserDump,
} from '@framework/coverageAgent/browser-coverage-agent';
import { RestClient } from '@framework/clients';
import type { SafePage } from '@framework/types/safe-page';
import type { APIRequestContext, APIResponse } from '@playwright/test';

function mockPage(evaluateResult: unknown): SafePage {
  return {
    evaluate: () => Promise.resolve(evaluateResult),
  } as unknown as SafePage;
}

function mockApiResponse(status: number, body: unknown): APIResponse {
  return {
    status: () => status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: () => ({}),
    ok: () => status >= 200 && status < 300,
    url: () => 'http://localhost:3001/api/v1/admin/coverage/dump',
    body: () => Promise.resolve(Buffer.from(JSON.stringify(body))),
    dispose: () => Promise.resolve(),
  } as unknown as APIResponse;
}

function mockPostOnlyContext(
  handler: (url: string, options?: unknown) => APIResponse,
): APIRequestContext {
  return {
    post: (url: string, options?: unknown) => Promise.resolve(handler(url, options)),
    get: () => Promise.reject(new Error('unexpected GET in this test')),
    put: () => Promise.reject(new Error('unexpected PUT in this test')),
    patch: () => Promise.reject(new Error('unexpected PATCH in this test')),
    delete: () => Promise.reject(new Error('unexpected DELETE in this test')),
    fetch: () => Promise.reject(new Error('unexpected FETCH in this test')),
    head: () => Promise.reject(new Error('unexpected HEAD in this test')),
    dispose: () => Promise.resolve(),
  } as unknown as APIRequestContext;
}

test.describe('pullBrowserCoverage', () => {
  test('returns undefined when window.__coverage__ is absent', async () => {
    const page = mockPage(undefined);
    await expect(pullBrowserCoverage(page)).resolves.toBeUndefined();
  });

  test('returns the coverage map when window.__coverage__ is present', async () => {
    const coverageMap = { 'src/App.tsx': { path: 'src/App.tsx', s: { '0': 1 } } };
    const page = mockPage(coverageMap);
    await expect(pullBrowserCoverage(page)).resolves.toEqual(coverageMap);
  });
});

test.describe('submitBrowserDump', () => {
  test('POSTs the coverage map with source "browser" and returns dump metadata', async () => {
    let capturedBody: unknown;
    const ctx = mockPostOnlyContext((_url, options) => {
      capturedBody = (options as { data?: unknown } | undefined)?.data;
      return mockApiResponse(201, { dump: { dumpId: 'test-dump-id' } });
    });
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:3001' });
    const coverageMap = { 'src/App.tsx': { path: 'src/App.tsx', s: { '0': 1 } } };

    const dump = await submitBrowserDump(client, coverageMap, 'my-label');

    expect(dump.dumpId).toBe('test-dump-id');
    expect(capturedBody).toMatchObject({
      label: 'my-label',
      source: 'browser',
      payload: coverageMap,
    });
  });
});

test.describe('pullAndSubmitBrowserCoverage', () => {
  test('no-ops and returns undefined when the page has no coverage', async () => {
    const page = mockPage(undefined);
    const ctx = mockPostOnlyContext(() => {
      throw new Error('should not be called — no coverage to submit');
    });
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:3001' });

    await expect(pullAndSubmitBrowserCoverage(page, client, 'label')).resolves.toBeUndefined();
  });

  test('no-ops when window.__coverage__ is present but empty', async () => {
    const page = mockPage({});
    const ctx = mockPostOnlyContext(() => {
      throw new Error('should not be called — coverage map is empty');
    });
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:3001' });

    await expect(pullAndSubmitBrowserCoverage(page, client, 'label')).resolves.toBeUndefined();
  });

  test('pulls and submits when coverage is present', async () => {
    const coverageMap = { 'src/App.tsx': { path: 'src/App.tsx', s: { '0': 1 } } };
    const page = mockPage(coverageMap);
    const ctx = mockPostOnlyContext(() =>
      mockApiResponse(201, { dump: { dumpId: 'submitted-id' } }),
    );
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:3001' });

    const dump = await pullAndSubmitBrowserCoverage(page, client, 'label');
    expect(dump?.dumpId).toBe('submitted-id');
  });
});
