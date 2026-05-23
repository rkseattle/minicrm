/**
 * Shared Zod schemas for user-related validation.
 * Imported by both the server (validation middleware) and the client (form validation).
 */

import { z } from 'zod';
import { SUPPORTED_LOCALES } from './settingsSchema.js';

/** Allowed user roles */
export const USER_ROLES = ['admin', 'rep'] as const;

/** Allowed user statuses */
export const USER_STATUSES = ['active', 'invited', 'inactive'] as const;

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
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required'),
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
  name: z.string({ required_error: 'Name is required' }).min(1, 'Name is required').trim(),
  role: z.enum(USER_ROLES, {
    required_error: 'Role is required',
    invalid_type_error: 'Role must be admin or rep',
  }),
});

/** Minimum password length (MINCRM-391) */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * Validates password complexity per NIST 800-63B aligned rules (MINCRM-391):
 * at least 12 characters, one letter, one number, and one special character.
 */
export const passwordComplexitySchema = z
  .string({ required_error: 'Password is required' })
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .regex(/[a-zA-Z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^a-zA-Z0-9]/, 'Password must contain at least one special character');

/**
 * Schema for the set-password request body (used in the invite acceptance flow).
 */
export const setPasswordSchema = z.object({
  token: z.string({ required_error: 'Token is required' }).min(1),
  password: passwordComplexitySchema,
});

/**
 * Schema for the admin-set-password request body.
 * Used when an admin sets another user's password directly (no invite token required).
 */
export const adminSetPasswordSchema = z.object({
  password: passwordComplexitySchema,
});

/**
 * Schema for the POST /api/auth/forgot-password request body.
 */
export const forgotPasswordSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .email('Must be a valid email address')
    .toLowerCase()
    .trim(),
});

/**
 * Schema for the POST /api/auth/reset-password request body.
 */
export const resetPasswordSchema = z.object({
  token: z.string({ required_error: 'Token is required' }).min(1, 'Token is required'),
  password: passwordComplexitySchema,
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
 * Schema for the PATCH /api/users/me/language request body.
 * Passing null clears the preference and falls back to the system default.
 */
export const updatePreferredLanguageSchema = z.object({
  language: z
    .enum(SUPPORTED_LOCALES, {
      errorMap: (issue) =>
        issue.code === 'invalid_type' && issue.received === 'undefined'
          ? { message: 'Language is required' }
          : { message: `Language must be one of: ${SUPPORTED_LOCALES.join(', ')}` },
    })
    .nullable(),
});

/**
 * Schema for PATCH /api/users/me/notification-preferences request body. (MINCRM-163)
 */
export const updateNotificationPrefsSchema = z.object({
  notify_overdue_tasks: z.boolean(),
  notify_assignments: z.boolean(),
  notify_deal_stage_changes: z.boolean(),
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
  must_change_password: z.boolean(),
  preferred_language: z.enum(SUPPORTED_LOCALES).nullable().optional(),
  notify_overdue_tasks: z.boolean().optional(),
  notify_assignments: z.boolean().optional(),
  notify_deal_stage_changes: z.boolean().optional(),
  created_at: z.string().or(z.date()),
});

// ── Envelope schemas (for API response validation) ─────────────────────────────

/** Envelope returned by GET /api/auth/me — { user } */
export const authMeResponseEnvelopeSchema = z.object({ user: userResponseSchema });

/** Envelope returned by POST /api/users/invite — { user, inviteToken } */
export const inviteUserResponseEnvelopeSchema = z.object({
  user: userResponseSchema,
  inviteToken: z.string().min(1),
});

// ── Inferred types ─────────────────────────────────────────────────────────────

export type UserRole = (typeof USER_ROLES)[number];
export type UserStatus = (typeof USER_STATUSES)[number];
export type LoginInput = z.infer<typeof loginSchema>;
export type InviteUserInput = z.infer<typeof inviteUserSchema>;
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;
export type AdminSetPasswordInput = z.infer<typeof adminSetPasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type UpdatePreferredLanguageInput = z.infer<typeof updatePreferredLanguageSchema>;
export type UpdateNotificationPrefsInput = z.infer<typeof updateNotificationPrefsSchema>;
export type UserResponse = z.infer<typeof userResponseSchema>;
