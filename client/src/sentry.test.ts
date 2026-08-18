/**
 * Unit tests for the Sentry PII redaction hook.
 *
 * Verifies that redactPiiFromEvent:
 *   - strips request.data (POST bodies)
 *   - hashes user.email, user.username, user.name with SHA-256
 *   - strips all extra fields
 *
 * No DOM, MSW, or Sentry DSN required — tests the pure transform function only.
 */

import { describe, it, expect } from 'vitest';
import type { ErrorEvent } from '@sentry/core';
import { redactPiiFromEvent } from './sentry.js';

/** ErrorEvent requires type: undefined as a discriminator. */
function makeEvent(fields: Omit<ErrorEvent, 'type'>): ErrorEvent {
  return { ...fields, type: undefined };
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const buffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('redactPiiFromEvent (client)', () => {
  it('removes request.data from the event', async () => {
    const event = makeEvent({
      request: {
        method: 'POST',
        url: '/api/v1/contacts',
        data: { email: 'alice@example.com', password: 'secret' },
      },
    });
    const result = await redactPiiFromEvent(event);
    expect(result.request?.data).toBeUndefined();
  });

  it('preserves other request fields when stripping data', async () => {
    const event = makeEvent({
      request: {
        method: 'POST',
        url: '/api/v1/contacts',
        data: { name: 'Alice' },
      },
    });
    const result = await redactPiiFromEvent(event);
    expect(result.request?.method).toBe('POST');
    expect(result.request?.url).toBe('/api/v1/contacts');
  });

  it('replaces user.email with its SHA-256 hash', async () => {
    const email = 'alice@example.com';
    const event = makeEvent({
      user: { id: 'u1', email, username: 'alice', name: 'Alice' },
    });
    const result = await redactPiiFromEvent(event);
    expect(result.user?.email).toBe(await sha256Hex(email));
  });

  it('replaces user.username with its SHA-256 hash', async () => {
    const username = 'alice';
    const event = makeEvent({
      user: { id: 'u1', email: 'alice@example.com', username, name: 'Alice' },
    });
    const result = await redactPiiFromEvent(event);
    expect(result.user?.username).toBe(await sha256Hex(username));
  });

  it('replaces user.name with its SHA-256 hash', async () => {
    const name = 'Alice';
    const event = makeEvent({
      user: { id: 'u1', email: 'alice@example.com', username: 'alice', name },
    });
    const result = await redactPiiFromEvent(event);
    expect(result.user?.name).toBe(await sha256Hex(name));
  });

  it('preserves user.id and other safe user fields', async () => {
    const event = makeEvent({
      user: { id: 'u1', email: 'alice@example.com', username: 'alice', name: 'Alice' },
    });
    const result = await redactPiiFromEvent(event);
    expect(result.user?.id).toBe('u1');
  });

  it('removes all extra fields from the event', async () => {
    const event = makeEvent({
      extra: { someToken: 'abc123', internalState: { foo: 'bar' } },
    });
    const result = await redactPiiFromEvent(event);
    expect(result.extra).toBeUndefined();
  });

  it('does not mutate the original event object', async () => {
    const original = makeEvent({
      request: { method: 'POST', url: '/api', data: { secret: 'x' } },
      user: { id: 'u1', email: 'a@b.com' },
      extra: { token: 'abc' },
    });
    const originalData = original.request?.data;
    const originalEmail = original.user?.email;
    const originalExtra = original.extra;
    await redactPiiFromEvent(original);
    expect(original.request?.data).toBe(originalData);
    expect(original.user?.email).toBe(originalEmail);
    expect(original.extra).toBe(originalExtra);
  });

  it('handles an event with no request field without throwing', async () => {
    const event = makeEvent({ message: 'something went wrong' });
    const result = await redactPiiFromEvent(event);
    expect(result.request).toBeUndefined();
  });

  it('handles an event with no user field without throwing', async () => {
    const event = makeEvent({ message: 'no user context' });
    const result = await redactPiiFromEvent(event);
    expect(result.user).toBeUndefined();
  });

  it('handles an event with no extra field without throwing', async () => {
    const event = makeEvent({ message: 'no extras' });
    const result = await redactPiiFromEvent(event);
    expect(result.extra).toBeUndefined();
  });

  it('preserves non-PII top-level fields (message, environment, tags)', async () => {
    const event = makeEvent({
      message: 'oops',
      environment: 'production',
      tags: { version: '1.2.3' },
      user: { id: 'u1', email: 'a@b.com' },
    });
    const result = await redactPiiFromEvent(event);
    expect(result.message).toBe('oops');
    expect(result.environment).toBe('production');
    expect(result.tags).toEqual({ version: '1.2.3' });
  });

  it('hashes all three user PII fields and strips request.data and extra in a single call', async () => {
    const email = 'a@b.com';
    const username = 'alice';
    const name = 'Alice Smith';
    const event = makeEvent({
      user: { id: 'u1', email, username, name },
      request: { method: 'POST', data: { payload: 'sensitive' } },
      extra: { requestId: 'req-999' },
    });
    const result = await redactPiiFromEvent(event);
    expect(result.user?.email).toBe(await sha256Hex(email));
    expect(result.user?.username).toBe(await sha256Hex(username));
    expect(result.user?.name).toBe(await sha256Hex(name));
    expect(result.request?.data).toBeUndefined();
    expect(result.extra).toBeUndefined();
  });

  it('omits user PII fields when they are undefined on the user object', async () => {
    const event = makeEvent({ user: { id: 'u1' } });
    const result = await redactPiiFromEvent(event);
    expect(result.user?.id).toBe('u1');
    expect('email' in (result.user ?? {})).toBe(false);
    expect('username' in (result.user ?? {})).toBe(false);
    expect('name' in (result.user ?? {})).toBe(false);
  });
});
