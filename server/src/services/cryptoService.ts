/**
 * Crypto service — symmetric AES-256-GCM encryption for secrets stored at rest.
 * Used to encrypt the S3 secret access key in system_settings. (MINCRM-169)
 *
 * Requires the NODE_ENCRYPTION_KEY environment variable to be set to a
 * 64-character hex string (32 bytes). Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

import crypto from 'crypto';

/** AES-256-GCM algorithm identifier */
const ALGORITHM = 'aes-256-gcm';

/** IV length in bytes for AES-GCM */
const IV_BYTES = 12;

/** Auth tag length in bytes */
const AUTH_TAG_BYTES = 16;

/**
 * Derives the 32-byte encryption key from the NODE_ENCRYPTION_KEY env var.
 * Throws at call time if the env var is missing or malformed so the error
 * surfaces immediately rather than silently on first use.
 *
 * @returns 32-byte Buffer.
 */
function getKey(): Buffer {
  const raw = process.env.NODE_ENCRYPTION_KEY ?? '';
  if (raw.length !== 64 || !/^[0-9a-fA-F]+$/.test(raw)) {
    throw new Error(
      'NODE_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return Buffer.from(raw, 'hex');
}

/**
 * Encrypts a plain-text string using AES-256-GCM.
 * Returns a colon-delimited hex string: iv:authTag:ciphertext
 *
 * @param plaintext - The value to encrypt.
 * @returns Encrypted payload as iv:authTag:ciphertext (all hex).
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a payload produced by `encrypt`.
 *
 * @param payload - Colon-delimited hex string: iv:authTag:ciphertext
 * @returns The original plain-text string.
 * @throws If the payload is malformed or authentication fails.
 */
export function decrypt(payload: string): string {
  const key = getKey();
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format');
  }
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  if (iv.length !== IV_BYTES) throw new Error('Invalid IV length');

  const authTag = Buffer.from(authTagHex, 'hex');
  if (authTag.length !== AUTH_TAG_BYTES) throw new Error('Invalid auth tag length');

  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8');
}
