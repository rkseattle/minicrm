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
