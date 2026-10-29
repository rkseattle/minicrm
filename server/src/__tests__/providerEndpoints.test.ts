/**
 * Unit tests for the Gmail and Graph base URLs and the Graph origin pin.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  gmailApiBase,
  graphApiBase,
  isGraphOriginUrl,
} from '../services/mail/providerEndpoints.js';
import { createGmailProvider, testGmailAccess } from '../services/mail/gmailProvider.js';
import { createGraphProvider, testGraphAccess } from '../services/mail/graphProvider.js';
import type { OAuthAuthPayload } from '../services/connectedAccountService.js';
import { GMAIL_READ_SCOPE, GRAPH_MAIL_READ_SCOPE } from '../services/oauthProviderService.js';

const EMULATOR_GRAPH = 'http://mail-emulator:4010/v1.0/me';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('provider API bases', () => {
  it("defaults to the providers' own hosts", () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('GMAIL_API_BASE_URL', '');
    vi.stubEnv('GRAPH_API_BASE_URL', '');
    expect(gmailApiBase()).toBe('https://gmail.googleapis.com/gmail/v1/users/me');
    expect(graphApiBase()).toBe('https://graph.microsoft.com/v1.0/me');
  });

  it('uses the override under test', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('GMAIL_API_BASE_URL', 'http://mail-emulator:4010/gmail/v1/users/me');
    vi.stubEnv('GRAPH_API_BASE_URL', EMULATOR_GRAPH);
    expect(gmailApiBase()).toBe('http://mail-emulator:4010/gmail/v1/users/me');
    expect(graphApiBase()).toBe(EMULATOR_GRAPH);
  });

  it('ignores the override under production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('GRAPH_API_BASE_URL', EMULATOR_GRAPH);
    expect(graphApiBase()).toBe('https://graph.microsoft.com/v1.0/me');
  });
});

describe('isGraphOriginUrl', () => {
  it("accepts Graph's own origin by default and refuses any other", () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('GRAPH_API_BASE_URL', '');
    expect(isGraphOriginUrl('https://graph.microsoft.com/v1.0/me/delta?token=a')).toBe(true);
    expect(isGraphOriginUrl('https://graph.microsoft.com.evil.example/delta')).toBe(false);
    expect(isGraphOriginUrl('http://graph.microsoft.com/v1.0/me')).toBe(false);
    expect(isGraphOriginUrl(`${EMULATOR_GRAPH}/delta`)).toBe(false);
    expect(isGraphOriginUrl('not a url')).toBe(false);
  });

  it('pins to the override origin, and only that origin, when one is set', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('GRAPH_API_BASE_URL', EMULATOR_GRAPH);
    expect(isGraphOriginUrl(`${EMULATOR_GRAPH}/mailFolders/x/messages/delta`)).toBe(true);
    expect(isGraphOriginUrl('https://graph.microsoft.com/v1.0/me/delta')).toBe(false);
    expect(isGraphOriginUrl('http://mail-emulator:4011/v1.0/me')).toBe(false);
  });
});

describe('the drivers send every request to the configured base', () => {
  const GMAIL_OVERRIDE = 'http://mail-emulator:4010/gmail/v1/users/me';
  const AUTH: OAuthAuthPayload = {
    kind: 'oauth',
    access_token: 'emulator-token',
    refresh_token: null,
    expires_at: null,
  };

  function recordingFetch(answer: (url: string) => unknown): {
    urls: string[];
    fetchImpl: (url: string) => Promise<Response>;
  } {
    const urls: string[] = [];
    return {
      urls,
      fetchImpl: (url: string) => {
        urls.push(url);
        return Promise.resolve(Response.json(answer(url)));
      },
    };
  }

  it('Gmail: the connection test and a backfill page reach only the override', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('GMAIL_API_BASE_URL', GMAIL_OVERRIDE);
    const { urls, fetchImpl } = recordingFetch(() => ({
      emailAddress: 'rep@example.test',
      historyId: '1001',
    }));

    await testGmailAccess('emulator-token', [GMAIL_READ_SCOPE], fetchImpl);
    await createGmailProvider('rep@example.test', [GMAIL_READ_SCOPE], fetchImpl).fetchSince(
      AUTH,
      null,
      new Date(0),
    );

    expect(urls.length).toBeGreaterThan(1);
    for (const url of urls) expect(url.startsWith(`${GMAIL_OVERRIDE}/`)).toBe(true);
  });

  it('Graph: the connection test and a delta round reach only the override', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('GRAPH_API_BASE_URL', EMULATOR_GRAPH);
    const { urls, fetchImpl } = recordingFetch((url) =>
      url.includes('/delta')
        ? {
            value: [],
            '@odata.deltaLink': `${EMULATOR_GRAPH}/mailFolders/inbox/messages/delta?$deltatoken=1`,
          }
        : { id: 'inbox' },
    );

    await testGraphAccess('emulator-token', [GRAPH_MAIL_READ_SCOPE], fetchImpl);
    await createGraphProvider('rep@example.test', [GRAPH_MAIL_READ_SCOPE], fetchImpl).fetchSince(
      AUTH,
      null,
      new Date(0),
    );

    expect(urls.length).toBeGreaterThan(1);
    for (const url of urls) expect(url.startsWith(`${EMULATOR_GRAPH}/`)).toBe(true);
  });
});
