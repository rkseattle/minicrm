/**
 * MFA service — TOTP two-factor authentication.
 *
 * Secrets are stored AES-256-GCM encrypted (same pattern as file_storage_secret).
 * Recovery codes are bcrypt-hashed single-use codes; consuming one removes it from the array.
 * The login challenge uses a short-lived JWT ("mfaToken") so no server-side session store
 * is needed — stateless, horizontally scalable (industry-standard pre-auth token approach).
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import pool from '../db.js';
import { encrypt, decrypt } from './cryptoService.js';
import { writeAuditEntry } from './auditService.js';
import type { AuditActor } from './auditService.js';
import logger from '../logger.js';

/** Number of bcrypt rounds for recovery code hashing */
const RECOVERY_CODE_BCRYPT_ROUNDS = 10;

/** Number of recovery codes generated on MFA enable */
const RECOVERY_CODE_COUNT = 8;

/** Length of each recovery code in bytes (rendered as hex → 16 chars) */
const RECOVERY_CODE_BYTES = 8;

/** MFA challenge token lifetime: 5 minutes */
const MFA_TOKEN_EXPIRY_SECONDS = 5 * 60;

/** JWT purpose claim for MFA challenge tokens */
const MFA_TOKEN_PURPOSE = 'mfa_challenge';

/** Application name shown in authenticator app QR codes */
const APP_NAME = process.env.APP_NAME ?? 'MiniCRM';

interface MfaStatusRow {
  mfa_enabled: boolean;
  mfa_pending_secret: string | null;
  mfa_recovery_codes: string[];
}

// ── Setup flow ─────────────────────────────────────────────────────────────────

/**
 * Initiates MFA setup for a user.
 * Generates a new TOTP secret, stores it encrypted as the pending secret,
 * and returns a QR code data URL for the user to scan.
 * Does NOT enable MFA — call enableMfa() after the user verifies the code.
 */
export async function initiateMfaSetup(
  userId: string,
): Promise<{ otpauthUrl: string; qrDataUrl: string }> {
  const secretObj = speakeasy.generateSecret({ length: 20 });
  const secret = secretObj.base32;
  const encryptedSecret = encrypt(secret);

  const row = await pool.query<{ email: string; name: string }>(
    'SELECT email, name FROM users WHERE id = $1',
    [userId],
  );
  const user = row.rows[0];
  if (!user) throw new Error('User not found');

  await pool.query('UPDATE users SET mfa_pending_secret = $1, updated_at = NOW() WHERE id = $2', [
    encryptedSecret,
    userId,
  ]);

  const otpauthUrl = speakeasy.otpauthURL({
    secret,
    label: encodeURIComponent(user.email),
    issuer: APP_NAME,
    encoding: 'base32',
  });
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

  return { otpauthUrl, qrDataUrl };
}

/**
 * Completes MFA setup by verifying the user-supplied TOTP code against the
 * pending secret, then promotes it to the active secret and enables MFA.
 * Returns 8 plaintext recovery codes (shown once; stored hashed).
 *
 * @throws Error if no pending secret, if the code is invalid, or if MFA already enabled.
 */
export async function enableMfa(
  userId: string,
  code: string,
  actor: AuditActor,
): Promise<{ recoveryCodes: string[] }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const row = await client.query<MfaStatusRow>(
      'SELECT mfa_enabled, mfa_pending_secret, mfa_recovery_codes FROM users WHERE id = $1 FOR UPDATE',
      [userId],
    );
    const user = row.rows[0];
    if (!user) throw new Error('User not found');
    if (user.mfa_enabled) throw new Error('MFA_ALREADY_ENABLED');
    if (!user.mfa_pending_secret) throw new Error('MFA_SETUP_NOT_INITIATED');

    const secret = decrypt(user.mfa_pending_secret);
    const isValid = speakeasy.totp.verify({ secret, encoding: 'base32', token: code, window: 1 });
    if (!isValid) {
      throw new Error('MFA_INVALID_CODE');
    }

    const recoveryCodes = generateRecoveryCodes();
    const hashedCodes = await hashRecoveryCodes(recoveryCodes);

    await client.query(
      `UPDATE users
       SET mfa_enabled = true,
           mfa_secret = mfa_pending_secret,
           mfa_pending_secret = NULL,
           mfa_recovery_codes = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [hashedCodes, userId],
    );

    await writeAuditEntry(client, {
      recordType: 'user',
      recordId: userId,
      recordName: actor.name,
      eventType: 'mfa_enabled',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    return { recoveryCodes };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Disables MFA for a user after verifying their current password.
 * Clears the secret and all recovery codes.
 */
export async function disableMfa(
  userId: string,
  currentPasswordHash: string,
  suppliedPassword: string,
  actor: AuditActor,
): Promise<void> {
  const passwordMatch = await bcrypt.compare(suppliedPassword, currentPasswordHash);
  if (!passwordMatch) throw new Error('MFA_INVALID_PASSWORD');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE users
       SET mfa_enabled = false,
           mfa_secret = NULL,
           mfa_pending_secret = NULL,
           mfa_recovery_codes = '{}',
           updated_at = NOW()
       WHERE id = $1`,
      [userId],
    );

    await writeAuditEntry(client, {
      recordType: 'user',
      recordId: userId,
      recordName: actor.name,
      eventType: 'mfa_disabled',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Login challenge flow ───────────────────────────────────────────────────────

/**
 * Issues a short-lived MFA challenge JWT (5 min) after password verification passes.
 * The client sends this token back with the TOTP code to complete login.
 */
export function issueMfaToken(userId: string): string {
  return jwt.sign({ sub: userId, purpose: MFA_TOKEN_PURPOSE }, process.env.JWT_SECRET ?? '', {
    expiresIn: MFA_TOKEN_EXPIRY_SECONDS,
  });
}

/** Decoded payload from an MFA challenge token. */
interface MfaTokenPayload {
  sub: string;
  purpose: string;
  iat?: number;
  exp?: number;
}

/**
 * Verifies an MFA challenge token and returns the user ID.
 * Returns null if the token is invalid, expired, or not an MFA challenge token.
 */
export function verifyMfaToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET ?? '') as MfaTokenPayload;
    if (payload.purpose !== MFA_TOKEN_PURPOSE) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

/**
 * Verifies a TOTP code against the user's active MFA secret.
 * Returns false if the user has no active secret.
 */
export async function verifyTotpCode(userId: string, code: string): Promise<boolean> {
  const row = await pool.query<{ mfa_secret: string | null }>(
    'SELECT mfa_secret FROM users WHERE id = $1',
    [userId],
  );
  const mfaSecret = row.rows[0]?.mfa_secret;
  if (!mfaSecret) return false;

  try {
    const secret = decrypt(mfaSecret);
    return speakeasy.totp.verify({ secret, encoding: 'base32', token: code, window: 1 });
  } catch (err) {
    logger.error({ err, userId }, 'Failed to decrypt MFA secret during TOTP verify');
    return false;
  }
}

/**
 * Verifies a single-use recovery code for a user.
 * On match, removes the used code from the stored array (burn-on-use).
 * Returns false if no code matches.
 *
 * The CPU-bound bcrypt comparisons run against an unlocked read, before any
 * transaction or row lock is taken — bcrypt is deliberately slow, and holding
 * a `FOR UPDATE` lock across that work would serialize every other request
 * touching this user row (and tie up a pool connection) for the full duration
 * of the comparison loop. The row is only re-locked for the brief, genuinely
 * atomic read-check-write that removes the consumed code.
 */
export async function verifyAndConsumeRecoveryCode(
  userId: string,
  suppliedCode: string,
): Promise<boolean> {
  const normalizedCode = suppliedCode.trim().toLowerCase();

  const initialRow = await pool.query<{ mfa_recovery_codes: string[] }>(
    'SELECT mfa_recovery_codes FROM users WHERE id = $1',
    [userId],
  );
  const initialStored = initialRow.rows[0]?.mfa_recovery_codes ?? [];

  let matchedHash: string | null = null;
  for (const hash of initialStored) {
    if (await bcrypt.compare(normalizedCode, hash)) {
      matchedHash = hash;
      break;
    }
  }
  if (matchedHash === null) {
    return false;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Re-read under lock: another request may have consumed this same code
    // (or the user's codes may have been regenerated) between the unlocked
    // bcrypt check above and this transaction.
    const row = await client.query<{ mfa_recovery_codes: string[] }>(
      'SELECT mfa_recovery_codes FROM users WHERE id = $1 FOR UPDATE',
      [userId],
    );
    const stored = row.rows[0]?.mfa_recovery_codes ?? [];

    // Look up the exact hash first (fast path, avoids re-hashing when nothing
    // changed) but fall back to re-comparing the plaintext against the
    // locked set — if codes were regenerated between the unlocked check above
    // and this lock, matchedHash is stale even though the supplied plaintext
    // may still validly match one of the current hashes.
    let matchedIndex = stored.indexOf(matchedHash);
    if (matchedIndex === -1) {
      for (let idx = 0; idx < stored.length; idx += 1) {
        if (await bcrypt.compare(normalizedCode, stored[idx])) {
          matchedIndex = idx;
          break;
        }
      }
    }
    if (matchedIndex === -1) {
      await client.query('ROLLBACK');
      return false;
    }

    // Remove only the matched index, not every occurrence of the matched hash —
    // bcrypt hashes are salted so a genuine collision is not expected, but
    // this keeps the same one-code-consumed-per-call guarantee the original
    // index-based removal had, rather than relying on hash uniqueness to hold.
    const remaining = stored.filter((_, idx) => idx !== matchedIndex);
    await client.query(
      'UPDATE users SET mfa_recovery_codes = $1, updated_at = NOW() WHERE id = $2',
      [remaining, userId],
    );
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Status ─────────────────────────────────────────────────────────────────────

/** Returns the MFA status for a user. */
export async function getMfaStatus(userId: string): Promise<{
  enabled: boolean;
  recoveryCodesRemaining: number;
}> {
  const row = await pool.query<{ mfa_enabled: boolean; mfa_recovery_codes: string[] }>(
    'SELECT mfa_enabled, mfa_recovery_codes FROM users WHERE id = $1',
    [userId],
  );
  const user = row.rows[0];
  if (!user) throw new Error('User not found');
  return {
    enabled: user.mfa_enabled,
    recoveryCodesRemaining: user.mfa_recovery_codes.length,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Generates RECOVERY_CODE_COUNT random plaintext recovery codes. */
function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    crypto.randomBytes(RECOVERY_CODE_BYTES).toString('hex'),
  );
}

/** Bcrypt-hashes an array of plaintext recovery codes. */
async function hashRecoveryCodes(codes: string[]): Promise<string[]> {
  return Promise.all(
    codes.map((code) => bcrypt.hash(code.toLowerCase(), RECOVERY_CODE_BCRYPT_ROUNDS)),
  );
}

/**
 * Generates the current TOTP code for a user's active or pending MFA secret.
 * Prefers the active secret; falls back to the pending secret if no active secret
 * exists (i.e. the user is mid-setup). Returns null if neither secret is set.
 * Used by the dev-only /mfa/dev/totp-code endpoint for E2E testing.
 */
export async function generateCurrentTotpCode(userId: string): Promise<string | null> {
  const row = await pool.query<{ mfa_secret: string | null; mfa_pending_secret: string | null }>(
    'SELECT mfa_secret, mfa_pending_secret FROM users WHERE id = $1',
    [userId],
  );
  const user = row.rows[0];
  if (!user) return null;

  // Prefer the active secret; fall back to pending (mid-setup).
  const encryptedSecret = user.mfa_secret ?? user.mfa_pending_secret;
  if (!encryptedSecret) return null;

  try {
    const secret = decrypt(encryptedSecret);
    return speakeasy.totp({ secret, encoding: 'base32' });
  } catch (err) {
    logger.error({ err, userId }, 'Failed to generate TOTP code for dev endpoint');
    return null;
  }
}
