import { describe, expect, it } from 'vitest';

import { assertMatchesGraphSchema, GRAPH_API_VERSION, GRAPH_SCHEMA_NAMES } from './graphSchema.js';

/**
 * These assertions are what make the validator worth having.
 *
 * The Graph fixture is hand-written rather than derived from a published document, so it
 * cannot catch a misreading the fake shares — but it can catch a fake drifting from
 * itself, and only if it actually rejects things. A suite checking the happy path alone
 * would pass identically against a validator that does nothing.
 */
describe('graph message schema', () => {
  it('carries an API version, so a copy without provenance is visible', () => {
    // A shape check, not a provenance proof: nothing here can tell a real version from a
    // plausible one. What it catches is a fixture pasted in with the field dropped.
    expect(GRAPH_API_VERSION).toMatch(/^v\d+\.\d+$/);
  });

  it('compiles every vendored schema, not only the ones the driver reads', () => {
    // A dangling $ref otherwise surfaces as ajv failing inside whichever unrelated test
    // happens to run first.
    for (const name of GRAPH_SCHEMA_NAMES) {
      expect(() => assertMatchesGraphSchema(name, {})).not.toThrow(/resolve reference/);
    }
  });

  it('accepts a faithful delta page', () => {
    expect(() =>
      assertMatchesGraphSchema('DeltaResponse', {
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/i/messages/delta',
        value: [
          {
            id: 'm1',
            conversationId: 'c1',
            isDraft: false,
            receivedDateTime: '2026-08-01T09:00:00Z',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('accepts the @removed shape a deleted or moved message arrives as', () => {
    expect(() =>
      assertMatchesGraphSchema('DeltaResponse', {
        value: [{ id: 'm1', '@removed': { reason: 'deleted' } }],
      }),
    ).not.toThrow();
  });

  it('rejects a message with no id, which the driver dereferences unguarded', () => {
    expect(() => assertMatchesGraphSchema('Message', { conversationId: 'c1' })).toThrow(
      /does not match/,
    );
  });

  it('rejects a misspelled field, which is how a fake drifts', () => {
    // The failure this fixture exists for: a case added later that agrees with nothing.
    expect(() => assertMatchesGraphSchema('Message', { id: 'm1', conversationid: 'c1' })).toThrow(
      /does not match/,
    );
  });

  it('rejects a wrong type on a field the driver branches on', () => {
    expect(() => assertMatchesGraphSchema('Message', { id: 'm1', isDraft: 'true' })).toThrow(
      /does not match/,
    );
  });

  it('rejects a folder response carrying no id', () => {
    // The driver treats this as malformed rather than as an absent folder, so the fake
    // must not be able to produce it accidentally.
    expect(() => assertMatchesGraphSchema('MailFolder', { displayName: 'Inbox' })).toThrow(
      /does not match/,
    );
  });

  it('names the schema and version in its failure, so a drifted fake is diagnosable', () => {
    expect(() => assertMatchesGraphSchema('Message', {})).toThrow(
      new RegExp(`Message \\(${GRAPH_API_VERSION}\\)`),
    );
  });
});
