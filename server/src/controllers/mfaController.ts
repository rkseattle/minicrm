/**
 * MFA controller — TOTP two-factor authentication setup and login challenge.
 * Request/response shaping only — no direct DB access. (MINCRM-392)
 */

import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import * as mfaService from '../services/mfaService.js';
import * as userService from '../services/userService.js';
import { sanitizeUser } from '../utils/userUtils.js';
import {
  mfaVerifySetupSchema,
  mfaDisableSchema,
  mfaVerifyLoginSchema,
  mfaRecoveryLoginSchema,
} from '@minicrm/shared/schemas/mfaSchema.js';
import logger from '../logger.js';
import { JWT_IDLE_EXPIRY_SECONDS, setSessionCookie } from '../auth/sessionCookie.js';

/**
 * GET /api/v1/auth/mfa/status
 * Returns the MFA status for the authenticated user.
 */
export async function getMfaStatus(req: Request, res: Response): Promise<void> {
  const status = await mfaService.getMfaStatus(req.user!.id);
  res.status(200).json(status);
}

/**
 * POST /api/v1/auth/mfa/setup
 * Initiates MFA setup — generates a pending TOTP secret and returns a QR code.
 * The user must call /verify-setup with a valid code to activate MFA.
 */
export async function setupMfa(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const status = await mfaService.getMfaStatus(userId);
  if (status.enabled) {
    res.status(409).json({
      error: { code: 'MFA_ALREADY_ENABLED', message: 'MFA is already enabled for this account.' },
    });
    return;
  }

  const { otpauthUrl, qrDataUrl } = await mfaService.initiateMfaSetup(userId);
  res.status(200).json({ otpauthUrl, qrDataUrl });
}

/**
 * POST /api/v1/auth/mfa/verify-setup
 * Verifies the TOTP code against the pending secret and enables MFA.
 * Returns 8 single-use plaintext recovery codes (shown once only).
 */
export async function verifyMfaSetup(req: Request, res: Response): Promise<void> {
  const parseResult = mfaVerifySetupSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parseResult.error.errors[0].message },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };

  try {
    const { recoveryCodes } = await mfaService.enableMfa(
      req.user!.id,
      parseResult.data.code,
      actor,
    );
    res.status(200).json({ recoveryCodes });
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message === 'MFA_ALREADY_ENABLED') {
      res.status(409).json({
        error: { code: 'MFA_ALREADY_ENABLED', message: 'MFA is already enabled.' },
      });
    } else if (message === 'MFA_SETUP_NOT_INITIATED') {
      res.status(400).json({
        error: { code: 'MFA_SETUP_NOT_INITIATED', message: 'MFA setup has not been initiated.' },
      });
    } else if (message === 'MFA_INVALID_CODE') {
      res.status(401).json({
        error: { code: 'MFA_INVALID_CODE', message: 'Invalid verification code.' },
      });
    } else {
      throw err;
    }
  }
}

/**
 * POST /api/v1/auth/mfa/disable
 * Disables MFA after confirming the user's current password.
 */
export async function disableMfa(req: Request, res: Response): Promise<void> {
  const parseResult = mfaDisableSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parseResult.error.errors[0].message },
    });
    return;
  }

  const userId = req.user!.id;
  const user = await userService.findUserById(userId);
  if (!user || !user.password_hash) {
    res.status(401).json({
      error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials.' },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };

  try {
    await mfaService.disableMfa(
      userId,
      user.password_hash,
      parseResult.data.currentPassword,
      actor,
    );
    res.status(200).json({ message: 'Two-factor authentication has been disabled.' });
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message === 'MFA_INVALID_PASSWORD') {
      res.status(401).json({
        error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Current password is incorrect.' },
      });
    } else {
      throw err;
    }
  }
}

/**
 * POST /api/v1/auth/mfa/verify-login
 * Completes login after MFA challenge.
 * Verifies the short-lived mfaToken (pre-auth JWT) + TOTP code,
 * then issues the full session cookie.
 */
export async function verifyMfaLogin(req: Request, res: Response): Promise<void> {
  const parseResult = mfaVerifyLoginSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parseResult.error.errors[0].message },
    });
    return;
  }

  const { mfaToken, code } = parseResult.data;

  const userId = mfaService.verifyMfaToken(mfaToken);
  if (!userId) {
    res.status(401).json({
      error: {
        code: 'MFA_TOKEN_INVALID',
        message: 'Invalid or expired MFA session. Please log in again.',
      },
    });
    return;
  }

  const user = await userService.findUserById(userId);
  if (!user || user.status !== 'active') {
    res.status(401).json({
      error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials.' },
    });
    return;
  }

  const totpValid = await mfaService.verifyTotpCode(userId, code);
  if (!totpValid) {
    res.status(401).json({
      error: { code: 'MFA_INVALID_CODE', message: 'Invalid verification code.' },
    });
    return;
  }

  issueSessionCookie(res, user);
  res.status(200).json({ user: sanitizeUser(user), mustChangePassword: user.must_change_password });
}

/**
 * POST /api/v1/auth/mfa/recovery-login
 * Completes login using a single-use recovery code instead of TOTP.
 */
export async function verifyMfaRecoveryLogin(req: Request, res: Response): Promise<void> {
  const parseResult = mfaRecoveryLoginSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parseResult.error.errors[0].message },
    });
    return;
  }

  const { mfaToken, recoveryCode } = parseResult.data;

  const userId = mfaService.verifyMfaToken(mfaToken);
  if (!userId) {
    res.status(401).json({
      error: {
        code: 'MFA_TOKEN_INVALID',
        message: 'Invalid or expired MFA session. Please log in again.',
      },
    });
    return;
  }

  const user = await userService.findUserById(userId);
  if (!user || user.status !== 'active') {
    res.status(401).json({
      error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials.' },
    });
    return;
  }

  const codeValid = await mfaService.verifyAndConsumeRecoveryCode(userId, recoveryCode);
  if (!codeValid) {
    res.status(401).json({
      error: { code: 'MFA_INVALID_RECOVERY_CODE', message: 'Invalid recovery code.' },
    });
    return;
  }

  logger.info({ userId }, 'User logged in with MFA recovery code');
  issueSessionCookie(res, user);
  res.status(200).json({ user: sanitizeUser(user), mustChangePassword: user.must_change_password });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Signs a session JWT and sets the httpOnly cookie.
 * Extracted to avoid duplication between TOTP and recovery login paths.
 */
function issueSessionCookie(
  res: Response,
  user: Awaited<ReturnType<typeof userService.findUserById>> & {},
): void {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const tokenPayload = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    login_at: nowSeconds,
  };
  const token = jwt.sign(tokenPayload, process.env.JWT_SECRET ?? '', {
    expiresIn: JWT_IDLE_EXPIRY_SECONDS,
  });
  setSessionCookie(res, token);
}
