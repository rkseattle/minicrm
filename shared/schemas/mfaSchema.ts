/**
 * Shared Zod schemas for MFA (TOTP two-factor authentication).
 * Imported by both the server (validation) and the client (form validation).
 */

import { z } from 'zod';

/** 6-digit TOTP code */
const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Code must be exactly 6 digits');

/** Schema for POST /api/v1/auth/mfa/verify-setup — confirms pending secret and enables MFA */
export const mfaVerifySetupSchema = z.object({
  code: totpCodeSchema,
});

/** Schema for POST /api/v1/auth/mfa/disable */
export const mfaDisableSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
});

/**
 * Schema for POST /api/v1/auth/mfa/verify-login.
 * mfaToken is the short-lived pre-auth JWT issued by /login when MFA is required.
 */
export const mfaVerifyLoginSchema = z.object({
  mfaToken: z.string().min(1, 'MFA token is required'),
  code: totpCodeSchema,
});

/**
 * Schema for POST /api/v1/auth/mfa/recovery-login.
 * Allows login using a single-use recovery code instead of TOTP.
 */
export const mfaRecoveryLoginSchema = z.object({
  mfaToken: z.string().min(1, 'MFA token is required'),
  recoveryCode: z.string().trim().min(1, 'Recovery code is required'),
});

// ── Inferred types ─────────────────────────────────────────────────────────────

export type MfaVerifySetupInput = z.infer<typeof mfaVerifySetupSchema>;
export type MfaDisableInput = z.infer<typeof mfaDisableSchema>;
export type MfaVerifyLoginInput = z.infer<typeof mfaVerifyLoginSchema>;
export type MfaRecoveryLoginInput = z.infer<typeof mfaRecoveryLoginSchema>;
