/**
 * MFA API module — TOTP two-factor authentication. (MINCRM-392)
 */

import type { UserResponse } from '@shared/schemas/userSchema.js';
import apiClient from './axiosInstance.js';

export interface MfaStatus {
  enabled: boolean;
  recoveryCodesRemaining: number;
}

export interface MfaSetupResponse {
  otpauthUrl: string;
  qrDataUrl: string;
}

export interface MfaVerifySetupResponse {
  recoveryCodes: string[];
}

export interface MfaLoginResponse {
  user: UserResponse;
  mustChangePassword: boolean;
}

/** React Query cache key for MFA status */
export const MFA_STATUS_QUERY_KEY = ['mfa', 'status'] as const;

/** React Query cache key for org-wide MFA enforcement setting */
export const MFA_REQUIRED_SETTING_QUERY_KEY = ['settings', 'mfa-required'] as const;

/**
 * Returns the MFA status for the authenticated user.
 */
export async function getMfaStatus(): Promise<MfaStatus> {
  const res = await apiClient.get<MfaStatus>('/auth/mfa/status');
  return res.data;
}

/**
 * Initiates MFA setup — returns a QR code data URL for the authenticator app.
 */
export async function setupMfa(): Promise<MfaSetupResponse> {
  const res = await apiClient.post<MfaSetupResponse>('/auth/mfa/setup');
  return res.data;
}

/**
 * Verifies the TOTP code against the pending secret and enables MFA.
 * Returns 8 plaintext recovery codes (shown once only).
 *
 * @param code - 6-digit TOTP code from the authenticator app.
 */
export async function verifyMfaSetup(code: string): Promise<MfaVerifySetupResponse> {
  const res = await apiClient.post<MfaVerifySetupResponse>('/auth/mfa/verify-setup', { code });
  return res.data;
}

/**
 * Disables MFA after the user confirms their current password.
 *
 * @param currentPassword - The user's current password for confirmation.
 */
export async function disableMfa(currentPassword: string): Promise<void> {
  await apiClient.post('/auth/mfa/disable', { currentPassword });
}

/**
 * Completes login using a TOTP code after the password step returned mfaRequired:true.
 *
 * @param mfaToken - Short-lived pre-auth token returned by /auth/login.
 * @param code - 6-digit TOTP code.
 */
export async function verifyMfaLogin(mfaToken: string, code: string): Promise<MfaLoginResponse> {
  const res = await apiClient.post<MfaLoginResponse>('/auth/mfa/verify-login', { mfaToken, code });
  return res.data;
}

/**
 * Completes login using a single-use recovery code.
 *
 * @param mfaToken - Short-lived pre-auth token returned by /auth/login.
 * @param recoveryCode - One of the user's single-use recovery codes.
 */
export async function verifyMfaRecoveryLogin(
  mfaToken: string,
  recoveryCode: string,
): Promise<MfaLoginResponse> {
  const res = await apiClient.post<MfaLoginResponse>('/auth/mfa/recovery-login', {
    mfaToken,
    recoveryCode,
  });
  return res.data;
}

/**
 * Returns the org-wide MFA enforcement setting. Admin only.
 */
export async function getMfaRequiredSetting(): Promise<{ mfa_required: boolean }> {
  const res = await apiClient.get<{ mfa_required: boolean }>('/settings/mfa-required');
  return res.data;
}

/**
 * Sets the org-wide MFA enforcement flag. Admin only.
 *
 * @param mfaRequired - Whether to require MFA for all users.
 */
export async function setMfaRequiredSetting(
  mfaRequired: boolean,
): Promise<{ mfa_required: boolean }> {
  const res = await apiClient.patch<{ mfa_required: boolean }>('/settings/mfa-required', {
    mfa_required: mfaRequired,
  });
  return res.data;
}
