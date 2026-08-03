/**
 * isTokenNearingExpiry — unit specs (MINCRM-697).
 *
 * Covers the predicate in qa/e2e/apps/minicrm/fixtures.ts that decides whether
 * the shared admin cookie is refreshed before a test runs.
 *
 * WHY THIS MATTERS
 * ----------------
 * This function is the whole of the MINCRM-697 fix's trigger condition. Return
 * false when it should return true and the seven AI specs fail again with
 * `HealingLocator: all strategies exhausted` — a message that reads as selector
 * drift and cost substantial debugging time to trace back to an expired session.
 * Return true too eagerly and every test pays a bcrypt login on a
 * single-threaded server, which is what caused a 60s timeout and a 229-test
 * serial-skip cascade during this ticket's own gate run.
 *
 * Lives under tests/framework/ because that is the only spec directory CI runs
 * unconditionally (`test:framework:coverage`, qa/package.json) — everything
 * under tests/apps/ reaches CI only through a `--grep @functional` filter. Note
 * the c8 coverage gate on that script scopes `--include` to e2e/framework/**,
 * so these specs execute but do not count toward the 80% threshold.
 *
 * No server and no browser are required.
 */

import { test, expect } from '@playwright/test';
import { isTokenNearingExpiry } from '@apps/minicrm/fixtures.js';

/**
 * Builds a JWT-shaped string whose payload carries the given claims.
 *
 * Only the payload segment is read by the function under test, so the header and
 * signature are placeholders.
 *
 * @param claims - Claims to encode into the payload segment.
 * @returns A `header.payload.signature` string.
 */
function makeToken(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `header.${payload}.signature`;
}

/** Seconds in the 30-minute sliding idle window the server issues. */
const TOKEN_LIFETIME_SECONDS = 30 * 60;

/**
 * Builds a token issued `ageSeconds` ago with the server's real lifetime.
 *
 * @param ageSeconds - How long ago the token was issued.
 * @returns A JWT-shaped string.
 */
function tokenAged(ageSeconds: number): string {
  const issuedAt = Math.floor(Date.now() / 1000) - ageSeconds;
  return makeToken({ iat: issuedAt, exp: issuedAt + TOKEN_LIFETIME_SECONDS });
}

test.describe('isTokenNearingExpiry', () => {
  test('returns false for a freshly issued token', () => {
    expect(isTokenNearingExpiry(tokenAged(0))).toBe(false);
  });

  test('returns false just outside the refresh threshold', () => {
    // Threshold is the last third of life — 20 minutes in, 10 remain.
    expect(isTokenNearingExpiry(tokenAged(19 * 60))).toBe(false);
  });

  test('returns true just inside the refresh threshold', () => {
    expect(isTokenNearingExpiry(tokenAged(21 * 60))).toBe(true);
  });

  test('returns true for an already-expired token', () => {
    expect(isTokenNearingExpiry(tokenAged(TOKEN_LIFETIME_SECONDS + 60))).toBe(true);
  });

  test('returns true when the payload segment is missing', () => {
    expect(isTokenNearingExpiry('not-a-jwt')).toBe(true);
  });

  test('returns true when the payload is not decodable JSON', () => {
    expect(isTokenNearingExpiry('header.!!!not-base64-json!!!.signature')).toBe(true);
  });

  test('returns true when exp is absent or non-numeric', () => {
    expect(isTokenNearingExpiry(makeToken({ iat: 1_700_000_000 }))).toBe(true);
    expect(isTokenNearingExpiry(makeToken({ iat: 1_700_000_000, exp: 'soon' }))).toBe(true);
  });

  test('returns true when iat is absent or non-numeric', () => {
    expect(isTokenNearingExpiry(makeToken({ exp: 1_700_000_000 }))).toBe(true);
    expect(isTokenNearingExpiry(makeToken({ iat: 'then', exp: 1_700_000_000 }))).toBe(true);
  });

  test('returns true when the claimed lifetime is zero or negative', () => {
    // exp <= iat cannot yield a meaningful threshold; refresh rather than divide
    // into a nonsense window.
    const now = Math.floor(Date.now() / 1000);
    expect(isTokenNearingExpiry(makeToken({ iat: now, exp: now }))).toBe(true);
    expect(isTokenNearingExpiry(makeToken({ iat: now, exp: now - 60 }))).toBe(true);
  });
});
