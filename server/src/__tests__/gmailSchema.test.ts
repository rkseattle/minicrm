import { describe, expect, it } from 'vitest';

import {
  DISCOVERY_REVISION,
  GMAIL_SCHEMA_NAMES,
  GMAIL_SCHEMAS,
  assertMatchesGmailSchema,
} from './gmailSchema.js';

/**
 * These assertions are what make the validator worth having. An unmodified Discovery
 * compile accepts every one of the malformed bodies below, so a suite that only checked
 * the happy path would pass identically against a validator that does nothing.
 */
describe('gmail discovery schema', () => {
  it('carries a revision, so a copy without provenance is visible', () => {
    // A shape check, not a provenance proof: nothing here can tell a real revision from a
    // plausible one. What it catches is a fixture pasted in with the field dropped. The
    // document is refreshed deliberately — no test fetches it, because a green build must
    // not depend on Google being reachable.
    expect(DISCOVERY_REVISION).toMatch(/^\d{8}$/);
  });

  it('closes the reference graph, so no schema points at a definition it lacks', () => {
    // Walking the graph, not spot-checking names: a missing definition surfaces otherwise
    // as ajv failing to compile inside whichever unrelated test happens to run first.
    const referenced = new Set<string>();
    const collect = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(collect);
        return;
      }
      if (typeof node !== 'object' || node === null) return;
      for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string') referenced.add(value);
        else collect(value);
      }
    };
    collect(GMAIL_SCHEMAS);

    expect([...referenced].filter((name) => !GMAIL_SCHEMA_NAMES.includes(name))).toEqual([]);
  });

  it('compiles every vendored schema, not only the four the driver reads', () => {
    for (const name of GMAIL_SCHEMA_NAMES) {
      expect(() => assertMatchesGmailSchema(name, {})).not.toThrow(/resolve reference/);
    }
  });

  it('accepts a faithful message', () => {
    expect(() =>
      assertMatchesGmailSchema('Message', {
        id: '18c0a1b2c3d4e5f6',
        threadId: '18c0a1b2c3d4e5f0',
        historyId: '90210',
        internalDate: '1756934400000',
        sizeEstimate: 4096,
        labelIds: ['INBOX'],
        raw: 'RnJvbTogYUBiLmNvbQ',
      }),
    ).not.toThrow();
  });

  it('rejects a wrongly typed field', () => {
    expect(() =>
      assertMatchesGmailSchema('Message', {
        id: '1',
        threadId: '2',
        sizeEstimate: '4096',
      }),
    ).toThrow(/sizeEstimate.*must be (a )?(number|integer)/i);
  });

  it('rejects an invented field, which bare Discovery would allow', () => {
    expect(() =>
      assertMatchesGmailSchema('Message', {
        id: '1',
        threadId: '2',
        threadID: '2',
      }),
    ).toThrow(/additional properties/i);
  });

  it('rejects a message missing the id every path dereferences', () => {
    expect(() => assertMatchesGmailSchema('Message', { threadId: '2' })).toThrow(
      /must have required property 'id'/,
    );
  });

  it('accepts a message with no thread id, which the RFC 5322 fallback exists for', () => {
    expect(() => assertMatchesGmailSchema('Message', { id: '1' })).not.toThrow();
  });

  it('accepts a profile with no history id, which means an unanchored mailbox', () => {
    expect(() =>
      assertMatchesGmailSchema('Profile', { emailAddress: 'rep@example.com' }),
    ).not.toThrow();
  });

  it('rejects an empty object, which bare Discovery would allow', () => {
    expect(() => assertMatchesGmailSchema('Message', {})).toThrow(/required property/);
  });

  it('validates a nested part, so an inline object is closed too', () => {
    expect(() =>
      assertMatchesGmailSchema('MessagePart', {
        partId: '0',
        mimeType: 'text/plain',
        headers: [{ name: 'Subject', value: 'Hello', extra: 'no' }],
      }),
    ).toThrow(/additional properties/i);
  });

  it('accepts a history page and rejects one whose record lost its id', () => {
    expect(() =>
      assertMatchesGmailSchema('ListHistoryResponse', {
        historyId: '90211',
        history: [{ id: '90210', messagesAdded: [{ message: { id: '1', threadId: '2' } }] }],
      }),
    ).not.toThrow();

    expect(() =>
      assertMatchesGmailSchema('ListHistoryResponse', {
        historyId: '90211',
        history: [{ messagesAdded: [{ message: { id: '1', threadId: '2' } }] }],
      }),
    ).toThrow(/must have required property 'id'/);
  });

  it('names an unknown schema rather than silently passing', () => {
    expect(() => assertMatchesGmailSchema('NotAGmailSchema', {})).toThrow(/No Gmail schema named/);
  });
});
