/**
 * Crypto service — symmetric AES-256-GCM encryption for secrets stored at rest.
 * Used to encrypt the S3 secret access key in system_settings. (MINCRM-169)
 *
 * Requires the NODE_ENCRYPTION_KEY environment variable to be set to a
 * 64-character hex string (32 bytes). Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Key rotation scaffold (MINCRM-519):
 * The versioned API (encryptVersioned / decryptVersioned) uses a keyring built from
 * ENCRYPTION_KEY_V<n> environment variables. NODE_ENCRYPTION_KEY is always V1 of the
 * keyring for backward compatibility.  CURRENT_ENCRYPTION_KEY_VERSION controls which
 * version is used for new encryptions; it defaults to 1.
 *
 * To rotate:
 *   1. Set ENCRYPTION_KEY_V2 to a new 64-char hex key.
 *   2. Set CURRENT_ENCRYPTION_KEY_VERSION=2 in the environment and redeploy.
 *   3. Run the key rotation script (see docs/admin-guide.md) to re-encrypt all
 *      existing ciphertexts with the new key and update key_version columns.
 *   4. Once all rows are on V2, you may remove ENCRYPTION_KEY_V1.
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
 * Returns the 32-byte key for a given version from the keyring.
 * Version 1 resolves to NODE_ENCRYPTION_KEY for backward compatibility.
 * Higher versions resolve to ENCRYPTION_KEY_V<n>.
 *
 * @param version - Key version number (positive integer).
 * @throws If the versioned key env var is missing or malformed.
 */
function getVersionedKey(version: number): Buffer {
  const raw =
    version === 1
      ? (process.env.NODE_ENCRYPTION_KEY ?? '')
      : (process.env[`ENCRYPTION_KEY_V${version}`] ?? '');

  if (raw.length !== 64 || !/^[0-9a-fA-F]+$/.test(raw)) {
    const varName = version === 1 ? 'NODE_ENCRYPTION_KEY' : `ENCRYPTION_KEY_V${version}`;
    throw new Error(
      `${varName} must be a 64-character hex string (32 bytes) for key version ${version}.`,
    );
  }
  return Buffer.from(raw, 'hex');
}

/**
 * Returns the current key version to use for new encryptions.
 * Reads CURRENT_ENCRYPTION_KEY_VERSION from the environment; defaults to 1.
 */
function getCurrentKeyVersion(): number {
  const raw = process.env.CURRENT_ENCRYPTION_KEY_VERSION;
  if (!raw) return 1;
  const version = parseInt(raw, 10);
  if (!Number.isInteger(version) || version < 1 || String(version) !== raw.trim()) {
    throw new Error(`CURRENT_ENCRYPTION_KEY_VERSION must be a positive integer, got '${raw}'`);
  }
  return version;
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

// ── Versioned keyring API (MINCRM-519) ────────────────────────────────────────

/** Result of an encryptVersioned call: the ciphertext and the key version used. */
export interface VersionedCiphertext {
  ciphertext: string;
  keyVersion: number;
}

/**
 * Encrypts a plain-text string using the current key version from the keyring.
 * Stores the version alongside the ciphertext so decryptVersioned can select
 * the correct key during key rotation.
 *
 * @param plaintext - The value to encrypt.
 * @returns The ciphertext (iv:authTag:ciphertext hex format) and the key version used.
 */
export function encryptVersioned(plaintext: string): VersionedCiphertext {
  const keyVersion = getCurrentKeyVersion();
  const key = getVersionedKey(keyVersion);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const ciphertext = `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  return { ciphertext, keyVersion };
}

/**
 * Decrypts a ciphertext produced by `encryptVersioned`, using the key
 * identified by the stored key version.
 *
 * @param ciphertext - Colon-delimited hex string: iv:authTag:ciphertext
 * @param keyVersion - Key version to use for decryption.
 * @returns The original plain-text string.
 * @throws If the ciphertext is malformed, the key version is unknown, or authentication fails.
 */
export function decryptVersioned(ciphertext: string, keyVersion: number): string {
  const key = getVersionedKey(keyVersion);
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format');
  }
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  if (iv.length !== IV_BYTES) throw new Error('Invalid IV length');

  const authTag = Buffer.from(authTagHex, 'hex');
  if (authTag.length !== AUTH_TAG_BYTES) throw new Error('Invalid auth tag length');

  const cipherData = Buffer.from(ciphertextHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(cipherData).toString('utf8') + decipher.final('utf8');
}
