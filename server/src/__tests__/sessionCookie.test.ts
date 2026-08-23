/**
 * Session-cookie policy — unit specs.
 *
 * WHY THIS MATTERS
 * ----------------
 * These attributes are a security requirement, not a preference: `httpOnly`
 * keeps the session token out of reach of any script on the page, `secure`
 * keeps it off plaintext connections in production, `sameSite` blunts CSRF, and
 * a bounded `maxAge` stops a stolen cookie living forever.
 *
 * Before this module the same option block was repeated at five call sites
 * across three controllers, so the requirement held only because all five
 * happened to agree — a sixth login path was one forgotten `httpOnly` away from
 * shipping a script-readable session cookie, with nothing to catch it. These
 * specs pin the policy in the one place it now lives.
 *
 * The clear-side attributes are covered too: a cookie is only removable by a
 * clearCookie whose attributes match the ones it was written with, so a drift
 * between the two leaves a logged-out user holding a live session token.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Response } from 'express';
import {
  setSessionCookie,
  clearSessionCookie,
  AUTH_COOKIE_NAME,
  JWT_IDLE_EXPIRY_SECONDS,
  COOKIE_MAX_AGE_MS,
  ABSOLUTE_SESSION_CAP_SECONDS,
} from '../auth/sessionCookie.js';

/**
 * Builds a response double that records cookie calls.
 *
 * @returns The double plus the recorded calls.
 */
function mockResponse(): {
  res: Response;
  cookie: ReturnType<typeof vi.fn>;
  clearCookie: ReturnType<typeof vi.fn>;
} {
  const cookie = vi.fn();
  const clearCookie = vi.fn();
  return { res: { cookie, clearCookie } as unknown as Response, cookie, clearCookie };
}

describe('session cookie policy', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('constants', () => {
    it('uses a 30-minute idle expiry', () => {
      expect(JWT_IDLE_EXPIRY_SECONDS).toBe(30 * 60);
    });

    it('derives the cookie max-age from the idle expiry', () => {
      // Derived rather than restated, so the two cannot disagree.
      expect(COOKIE_MAX_AGE_MS).toBe(JWT_IDLE_EXPIRY_SECONDS * 1000);
    });

    it('caps a session at 8 hours regardless of refreshes', () => {
      expect(ABSOLUTE_SESSION_CAP_SECONDS).toBe(8 * 60 * 60);
    });

    it('keeps the absolute cap longer than the idle window', () => {
      // If these ever inverted, the idle expiry would be unreachable and the
      // sliding-session design would silently become a fixed one.
      expect(ABSOLUTE_SESSION_CAP_SECONDS).toBeGreaterThan(JWT_IDLE_EXPIRY_SECONDS);
    });
  });

  describe('setSessionCookie', () => {
    it('sets the token under the configured cookie name', () => {
      const { res, cookie } = mockResponse();
      setSessionCookie(res, 'a.b.c');
      expect(cookie).toHaveBeenCalledWith(AUTH_COOKIE_NAME, 'a.b.c', expect.anything());
    });

    it('marks the cookie httpOnly', () => {
      const { res, cookie } = mockResponse();
      setSessionCookie(res, 'a.b.c');
      // Without this the session token is readable by any script on the page.
      expect(cookie.mock.calls[0][2]).toMatchObject({ httpOnly: true });
    });

    it('sets sameSite lax', () => {
      const { res, cookie } = mockResponse();
      setSessionCookie(res, 'a.b.c');
      expect(cookie.mock.calls[0][2]).toMatchObject({ sameSite: 'lax' });
    });

    it('bounds the cookie lifetime to the idle window', () => {
      const { res, cookie } = mockResponse();
      setSessionCookie(res, 'a.b.c');
      expect(cookie.mock.calls[0][2]).toMatchObject({ maxAge: COOKIE_MAX_AGE_MS });
    });
  });

  describe('clearSessionCookie', () => {
    it('clears the configured cookie name', () => {
      const { res, clearCookie } = mockResponse();
      clearSessionCookie(res);
      expect(clearCookie).toHaveBeenCalledWith(AUTH_COOKIE_NAME, expect.anything());
    });

    it('clears with the same attributes the cookie was written with', () => {
      // A browser only removes a cookie when the clearing attributes match the
      // ones it was set with. Drift here means logout appears to work while the
      // session token survives in the jar.
      const { res, cookie } = mockResponse();
      setSessionCookie(res, 'a.b.c');
      const setOptions = cookie.mock.calls[0][2] as Record<string, unknown>;

      const clearing = mockResponse();
      clearSessionCookie(clearing.res);
      const clearOptions = clearing.clearCookie.mock.calls[0][1] as Record<string, unknown>;

      expect(clearOptions.httpOnly).toBe(setOptions.httpOnly);
      expect(clearOptions.secure).toBe(setOptions.secure);
      expect(clearOptions.sameSite).toBe(setOptions.sameSite);
    });
  });

  describe('secure flag', () => {
    it('is off outside production so local HTTP stacks work', async () => {
      process.env.NODE_ENV = 'test';
      vi.resetModules();
      const mod = await import('../auth/sessionCookie.js');
      const { res, cookie } = mockResponse();
      mod.setSessionCookie(res, 'a.b.c');
      expect(cookie.mock.calls[0][2]).toMatchObject({ secure: false });
    });

    it('is on in production so the token never crosses plaintext', async () => {
      process.env.NODE_ENV = 'production';
      vi.resetModules();
      const mod = await import('../auth/sessionCookie.js');
      const { res, cookie } = mockResponse();
      mod.setSessionCookie(res, 'a.b.c');
      expect(cookie.mock.calls[0][2]).toMatchObject({ secure: true });
    });

    it.each([
      ['unset', undefined],
      ['misspelled', 'producton'],
      ['differently cased', 'Production'],
      ['unrecognized', 'qa-box'],
    ])('is on when NODE_ENV is %s', async (_label, value) => {
      // A deployment that forgets the variable must not ship the session JWT
      // over plaintext. Only a recognized non-production value turns this off.
      if (value === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = value;
      }
      vi.resetModules();
      const mod = await import('../auth/sessionCookie.js');
      const { res, cookie } = mockResponse();
      mod.setSessionCookie(res, 'a.b.c');
      expect(cookie.mock.calls[0][2]).toMatchObject({ secure: true });
    });

    it('is on in staging, which carries real traffic', async () => {
      process.env.NODE_ENV = 'staging';
      vi.resetModules();
      const mod = await import('../auth/sessionCookie.js');
      const { res, cookie } = mockResponse();
      mod.setSessionCookie(res, 'a.b.c');
      // Staging serves the API docs but is a real multi-user deployment, so a
      // session JWT without Secure is as exposed there as in production.
      expect(cookie.mock.calls[0][2]).toMatchObject({ secure: true });
    });
  });
});
