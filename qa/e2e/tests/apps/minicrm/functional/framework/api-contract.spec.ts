/**
 * API Contract PoC — MINCRM-370
 *
 * Purpose: demonstrate that Zod schema validation in restClient helpers catches
 * plausible API regressions before any domain assertion is reached.
 *
 * Each test exercises one of the previously unvalidated endpoints (tag, activity,
 * user invite, auth/me) by creating a real entity through the helper and relying
 * on the schema validation wired in that helper to fail fast on any shape mismatch.
 *
 * The PoC also includes a negative test: it calls RestClient.post directly with a
 * schema that does NOT match the server response, and asserts that a RestClientError
 * is thrown — proving the machinery catches regressions without requiring a domain
 * assertion to happen to exercise the broken field.
 *
 * Framework conventions:
 *   - import test/expect from @apps/minicrm/fixtures.js only
 *   - no @pages/* imports
 *   - no raw locators
 *   - all test data managed via helpers / TestDataManager
 *
 * MINCRM-370
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import {
  createTestTag,
  createTestContact,
  createTestActivity,
  createTestUser,
} from '@apps/minicrm/helpers.js';
import { authMeResponseEnvelopeSchema } from '@minicrm/shared/schemas/userSchema.js';
import { RestClientError } from '@framework/clients/rest-client.js';
import { z } from 'zod';

const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[api-contract] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// CT-1 — tag endpoint: schema validates the real server response
// ---------------------------------------------------------------------------

test(
  'CT-1: createTestTag validates { tag } envelope against tagResponseEnvelopeSchema',
  { tag: ['@functional'] },
  async ({ testData, restClient }) => {
    await loginAsAdmin(restClient);

    // If the server renames `tag` to `data`, or drops `id`/`name`, the schema
    // validation inside createTestTag will throw before this line returns.
    const tag = await createTestTag(testData, restClient, { name: `ct1-tag-${Date.now()}` });

    expect(tag.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(typeof tag.name).toBe('string');
  },
);

// ---------------------------------------------------------------------------
// CT-2 — activity endpoint: schema validates the real server response
// ---------------------------------------------------------------------------

test(
  'CT-2: createTestActivity validates { activity } envelope against activityResponseEnvelopeSchema',
  { tag: ['@functional'] },
  async ({ testData, restClient }) => {
    await loginAsAdmin(restClient);

    const contact = await createTestContact(testData, restClient, {
      first_name: 'CT2',
      last_name: 'Contract',
    });

    // Schema validation inside createTestActivity catches any envelope rename or
    // field-type change before this assertion is reached.
    const activity = await createTestActivity(testData, restClient, {
      type: 'Task',
      contact_id: contact.id,
    });

    expect(activity.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(activity.type).toBe('Task');
    expect(activity.status).toBe('open');
  },
);

// ---------------------------------------------------------------------------
// CT-3 — user invite endpoint: schema validates the real server response
// ---------------------------------------------------------------------------

test(
  'CT-3: createTestUser validates { user, inviteToken } envelope against inviteUserResponseEnvelopeSchema',
  { tag: ['@functional'] },
  async ({ restClient }) => {
    await loginAsAdmin(restClient);

    let createdUserId: string | undefined;
    try {
      // Schema validation inside createTestUser catches any rename of `user`→`data`,
      // missing `inviteToken`, or role/status enum change.
      const user = await createTestUser(restClient, { role: 'rep' });
      createdUserId = user.id;

      expect(user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(user.status).toBe('active');
    } finally {
      // Users cannot be hard-deleted; deactivate to keep the E2E DB clean.
      if (createdUserId) {
        await restClient
          .patch(`/api/v1/users/${createdUserId}/deactivate`, {})
          .catch(() => undefined);
      }
    }
  },
);

// ---------------------------------------------------------------------------
// CT-4 — auth/me endpoint: schema validates the real server response
// ---------------------------------------------------------------------------

test(
  'CT-4: GET /api/v1/auth/me validates { user } envelope against authMeResponseEnvelopeSchema',
  { tag: ['@functional'] },
  async ({ restClient }) => {
    await loginAsAdmin(restClient);

    // Any change to the /me response shape (field rename, status enum addition,
    // missing must_change_password) will throw here before domain assertions run.
    const res = await restClient.get<{ user: { id: string; role: string } }>('/api/v1/auth/me', {
      schema: authMeResponseEnvelopeSchema,
    });

    expect(res.body.user.role).toBe('admin');
  },
);

// ---------------------------------------------------------------------------
// CT-5 — negative test: malformed schema throws RestClientError immediately
//
// This is the PoC regression demonstration. A schema that expects a field
// `missing_field: z.string()` will never match any real server response.
// When wired into a restClient call the validation fires before any domain
// assertion, proving the machinery catches regressions independent of whether
// a test happens to assert on the changed field.
// ---------------------------------------------------------------------------

test(
  'CT-5: restClient throws RestClientError when response fails schema validation',
  { tag: ['@functional'] },
  async ({ testData, restClient }) => {
    await loginAsAdmin(restClient);

    // A schema that requires a field no server endpoint returns.
    const impossibleSchema = z.object({
      tag: z.object({
        id: z.string().uuid(),
        name: z.string(),
        missing_field: z.string(), // ← this field never exists in the response
      }),
    });

    const payload = { name: `ct5-neg-${Date.now()}` };
    // Register for cleanup even though we expect the call to throw — the tag IS
    // created server-side before validation runs on the response.
    let tagId: string | undefined;

    try {
      await restClient.post('/api/v1/tags', payload, { schema: impossibleSchema });
    } catch (err) {
      if (err instanceof RestClientError) {
        tagId = (err.body as { tag?: { id?: string } })?.tag?.id;
      }
      // Confirm the error is a schema validation failure, not an HTTP error.
      expect(err).toBeInstanceOf(RestClientError);
      const rcErr = err as RestClientError;
      expect(rcErr.validationError).toBeDefined();
      expect(rcErr.message).toContain('response failed schema validation');
      return;
    } finally {
      if (tagId) {
        testData.register('tag', tagId, `/api/v1/tags/${tagId}`);
      }
    }

    // If we reach here the schema validation did not throw — fail the test.
    throw new Error('Expected RestClientError was not thrown');
  },
);
