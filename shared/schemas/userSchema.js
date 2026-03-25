/**
 * Shared Zod schemas for user-related validation.
 * Imported by both the server (validation middleware) and the client (form validation).
 */

import { z } from 'zod';

/** Allowed user roles */
export const USER_ROLES = /** @type {const} */ (['admin', 'rep']);

/** Allowed user statuses */
export const USER_STATUSES = /** @type {const} */ ([
  'active',
  'invited',
  'inactive',
]);

/**
 * Schema for the login request body.
 * Validates that email is a properly formatted email address and password is present.
 */
export const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .email('Must be a valid email address')
    .toLowerCase()
    .trim(),
  password: z
    .string({ required_error: 'Password is required' })
    .min(1, 'Password is required'),
});

/**
 * Schema for the admin invite-user request body.
 * Password is not set at invite time — the invited user sets it via set-password flow.
 */
export const inviteUserSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .email('Must be a valid email address')
    .toLowerCase()
    .trim(),
  name: z
    .string({ required_error: 'Name is required' })
    .min(1, 'Name is required')
    .trim(),
  role: z.enum(USER_ROLES, {
    required_error: 'Role is required',
    invalid_type_error: 'Role must be admin or rep',
  }),
});

/**
 * Schema for the set-password request body (used in the invite acceptance flow).
 */
export const setPasswordSchema = z.object({
  token: z.string({ required_error: 'Token is required' }).min(1),
  password: z
    .string({ required_error: 'Password is required' })
    .min(8, 'Password must be at least 8 characters'),
});

/**
 * Schema for the update-role request body.
 */
export const updateRoleSchema = z.object({
  role: z.enum(USER_ROLES, {
    required_error: 'Role is required',
    invalid_type_error: 'Role must be admin or rep',
  }),
});

/**
 * Schema for the safe user response shape returned to API consumers.
 * Never includes password_hash.
 */
export const userResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: z.enum(USER_ROLES),
  status: z.enum(USER_STATUSES),
  created_at: z.string().or(z.date()),
});
