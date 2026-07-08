/**
 * Shared test utilities for controller integration tests.
 */

import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { AUTH_COOKIE_NAME } from '../middleware/auth.js';

/** Returns an 8-character random hex string for use in test email addresses. */
export const uid = () => randomUUID().slice(0, 8);

/**
 * Signs a JWT with the test secret and returns a cookie string
 * that can be passed via supertest's `.set('Cookie', ...)`.
 *
 * @param payload - The user fields to embed in the token.
 */
export function makeAuthCookie(payload: {
  id: string;
  email: string;
  name: string;
  role: string;
}): string {
  const token = jwt.sign(payload, process.env.JWT_SECRET ?? '', { expiresIn: '1h' });
  return `${AUTH_COOKIE_NAME}=${token}`;
}

/**
 * Polls `check` until it resolves truthy, or throws once `timeoutMs` elapses.
 *
 * Prefer this over a fixed `setTimeout` + single assertion when testing
 * time-based behavior (cache TTLs, scheduled state changes): a fixed sleep
 * races the real clock and produces a coin-flip failure whenever the process
 * is under any scheduling pressure, since a single sample right at the
 * boundary can land on either side. Polling instead asserts "this becomes
 * true within a generous bound," which is deterministic — it passes as soon
 * as the condition is genuinely met and only fails if it never is.
 *
 * @param check - Predicate to poll; called repeatedly until it returns true.
 * @param timeoutMs - Maximum time to wait before throwing.
 * @param intervalMs - Delay between poll attempts.
 */
export async function waitUntil(
  check: () => Promise<boolean> | boolean,
  timeoutMs: number,
  intervalMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() >= deadline) {
      throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
