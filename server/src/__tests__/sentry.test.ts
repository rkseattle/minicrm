/**
 * Unit tests for the Sentry PII redaction hook (MINCRM-394).
 *
 * Verifies that redactPiiFromEvent strips:
 *   - request.data (POST bodies)
 *   - user.email, user.username, user.name
 *   - all extra fields
 *
 * No database or Sentry DSN required — tests the pure transform function only.
 */

import { describe, it, expect } from 'vitest';
import type { ErrorEvent } from '@sentry/node';
import { redactPiiFromEvent } from '../sentry.js';

/** ErrorEvent requires type: undefined as a discriminator. */
function makeEvent(fields: Omit<ErrorEvent, 'type'>): ErrorEvent {
  return { ...fields, type: undefined };
}

describe('MINCRM-394 — redactPiiFromEvent (server)', () => {
  it('removes request.data from the event', () => {
    const event = makeEvent({
      request: {
        method: 'POST',
        url: '/api/v1/contacts',
        data: { email: 'alice@example.com', password: 'secret' },
      },
    });
    const result = redactPiiFromEvent(event);
    expect(result.request?.data).toBeUndefined();
  });

  it('preserves other request fields when stripping data', () => {
    const event = makeEvent({
      request: {
        method: 'POST',
        url: '/api/v1/contacts',
        data: { name: 'Alice' },
      },
    });
    const result = redactPiiFromEvent(event);
    expect(result.request?.method).toBe('POST');
    expect(result.request?.url).toBe('/api/v1/contacts');
  });

  it('removes user.email from the event', () => {
    const event = makeEvent({
      user: { id: 'u1', email: 'alice@example.com', username: 'alice', name: 'Alice' },
    });
    const result = redactPiiFromEvent(event);
    expect(result.user?.email).toBeUndefined();
  });

  it('removes user.username from the event', () => {
    const event = makeEvent({
      user: { id: 'u1', email: 'alice@example.com', username: 'alice', name: 'Alice' },
    });
    const result = redactPiiFromEvent(event);
    expect(result.user?.username).toBeUndefined();
  });

  it('removes user.name from the event', () => {
    const event = makeEvent({
      user: { id: 'u1', email: 'alice@example.com', username: 'alice', name: 'Alice' },
    });
    const result = redactPiiFromEvent(event);
    expect(result.user?.name).toBeUndefined();
  });

  it('preserves user.id and other safe user fields', () => {
    const event = makeEvent({
      user: { id: 'u1', email: 'alice@example.com', username: 'alice', name: 'Alice' },
    });
    const result = redactPiiFromEvent(event);
    expect(result.user?.id).toBe('u1');
  });

  it('removes all extra fields from the event', () => {
    const event = makeEvent({
      extra: { someToken: 'abc123', internalState: { foo: 'bar' } },
    });
    const result = redactPiiFromEvent(event);
    expect(result.extra).toBeUndefined();
  });

  it('does not mutate the original event object', () => {
    const original = makeEvent({
      request: { method: 'POST', url: '/api', data: { secret: 'x' } },
      user: { id: 'u1', email: 'a@b.com' },
      extra: { token: 'abc' },
    });
    const originalData = original.request?.data;
    const originalEmail = original.user?.email;
    const originalExtra = original.extra;
    redactPiiFromEvent(original);
    expect(original.request?.data).toBe(originalData);
    expect(original.user?.email).toBe(originalEmail);
    expect(original.extra).toBe(originalExtra);
  });

  it('handles an event with no request field without throwing', () => {
    const event = makeEvent({ message: 'something went wrong' });
    expect(() => redactPiiFromEvent(event)).not.toThrow();
    expect(redactPiiFromEvent(event).request).toBeUndefined();
  });

  it('handles an event with no user field without throwing', () => {
    const event = makeEvent({ message: 'no user context' });
    expect(() => redactPiiFromEvent(event)).not.toThrow();
    expect(redactPiiFromEvent(event).user).toBeUndefined();
  });

  it('handles an event with no extra field without throwing', () => {
    const event = makeEvent({ message: 'no extras' });
    expect(() => redactPiiFromEvent(event)).not.toThrow();
    expect(redactPiiFromEvent(event).extra).toBeUndefined();
  });

  it('preserves non-PII top-level fields (message, environment, tags)', () => {
    const event = makeEvent({
      message: 'oops',
      environment: 'production',
      tags: { version: '1.2.3' },
      user: { id: 'u1', email: 'a@b.com' },
    });
    const result = redactPiiFromEvent(event);
    expect(result.message).toBe('oops');
    expect(result.environment).toBe('production');
    expect(result.tags).toEqual({ version: '1.2.3' });
  });

  it('strips all three user PII fields together in a single call', () => {
    const event = makeEvent({
      user: { id: 'u1', email: 'a@b.com', username: 'alice', name: 'Alice Smith' },
      request: { method: 'POST', data: { payload: 'sensitive' } },
      extra: { requestId: 'req-999' },
    });
    const result = redactPiiFromEvent(event);
    expect(result.user?.email).toBeUndefined();
    expect(result.user?.username).toBeUndefined();
    expect(result.user?.name).toBeUndefined();
    expect(result.request?.data).toBeUndefined();
    expect(result.extra).toBeUndefined();
  });
});
