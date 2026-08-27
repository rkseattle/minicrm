/**
 * Timeout bounds on the OAuth provider calls.
 *
 * Every one of these reaches a third party. The callback's exchange matters most: it runs
 * after the single-use state row is consumed, so an unbounded stall does not merely hang
 * one request — the user's retry finds no state and has to restart the whole flow.
 */

import 'dotenv/config';

import { exchangeAuthorizationCode, refreshAccessToken } from '../services/oauthProviderService.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // A provider whose discovery document will never resolve, so the call hangs at the
  // network rather than failing fast on configuration.
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('OAuth calls are bounded', () => {
  it('rejects rather than hanging when the provider never answers', async () => {
    // Reserved by RFC 2606: guaranteed not to resolve, so discovery cannot complete.
    process.env.MICROSOFT_OAUTH_TENANT = 'unreachable.invalid';

    await expect(refreshAccessToken('microsoft', 'some-refresh-token')).rejects.toBeInstanceOf(
      Error,
    );
  }, 30_000);

  it('rejects the code exchange rather than hanging', async () => {
    process.env.MICROSOFT_OAUTH_TENANT = 'unreachable.invalid';

    await expect(
      exchangeAuthorizationCode(
        'microsoft',
        'http://localhost/api/v1/connected-accounts/oauth/microsoft/callback?code=x&state=y',
        'y',
        'verifier',
      ),
    ).rejects.toBeInstanceOf(Error);
  }, 30_000);
});
