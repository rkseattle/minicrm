/**
 * Unit tests for cryptoService. (MINCRM-197)
 *
 * No database or external dependencies — pure Node.js crypto.
 * NODE_ENCRYPTION_KEY is loaded from .env.test via the global test setup.
 */

import 'dotenv/config';
import { encrypt, decrypt } from '../services/cryptoService.js';

// ── encrypt ───────────────────────────────────────────────────────────────────

describe('encrypt', () => {
  it('returns a non-plaintext string', () => {
    const result = encrypt('my-secret');
    expect(result).not.toBe('my-secret');
  });

  it('returns a colon-delimited iv:authTag:ciphertext format', () => {
    const result = encrypt('value');
    const parts = result.split(':');
    expect(parts).toHaveLength(3);
    // iv = 12 bytes → 24 hex chars
    expect(parts[0]).toHaveLength(24);
    // authTag = 16 bytes → 32 hex chars
    expect(parts[1]).toHaveLength(32);
    // ciphertext is non-empty
    expect(parts[2].length).toBeGreaterThan(0);
  });

  it('produces a different ciphertext on every call (random IV)', () => {
    const a = encrypt('same-value');
    const b = encrypt('same-value');
    expect(a).not.toBe(b);
  });

  it('encrypts an empty string without throwing', () => {
    expect(() => encrypt('')).not.toThrow();
  });

  it('encrypts a long string without throwing', () => {
    expect(() => encrypt('x'.repeat(10_000))).not.toThrow();
  });

  it('throws when NODE_ENCRYPTION_KEY is missing', () => {
    const original = process.env.NODE_ENCRYPTION_KEY;
    try {
      delete process.env.NODE_ENCRYPTION_KEY;
      expect(() => encrypt('value')).toThrow(/NODE_ENCRYPTION_KEY/);
    } finally {
      process.env.NODE_ENCRYPTION_KEY = original;
    }
  });

  it('throws when NODE_ENCRYPTION_KEY is too short', () => {
    const original = process.env.NODE_ENCRYPTION_KEY;
    try {
      process.env.NODE_ENCRYPTION_KEY = 'tooshort';
      expect(() => encrypt('value')).toThrow(/NODE_ENCRYPTION_KEY/);
    } finally {
      process.env.NODE_ENCRYPTION_KEY = original;
    }
  });

  it('throws when NODE_ENCRYPTION_KEY contains non-hex characters', () => {
    const original = process.env.NODE_ENCRYPTION_KEY;
    try {
      // 64 chars but not valid hex
      process.env.NODE_ENCRYPTION_KEY = 'z'.repeat(64);
      expect(() => encrypt('value')).toThrow(/NODE_ENCRYPTION_KEY/);
    } finally {
      process.env.NODE_ENCRYPTION_KEY = original;
    }
  });
});

// ── decrypt ───────────────────────────────────────────────────────────────────

describe('decrypt', () => {
  it('round-trips a plaintext value', () => {
    const plaintext = 'super-secret-s3-key';
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it('round-trips an empty string', () => {
    expect(decrypt(encrypt(''))).toBe('');
  });

  it('round-trips a string with special characters', () => {
    const value = '!@#$%^&*()_+{}|:"<>?`~';
    expect(decrypt(encrypt(value))).toBe(value);
  });

  it('round-trips unicode content', () => {
    const value = '日本語テスト 🔑 émojis';
    expect(decrypt(encrypt(value))).toBe(value);
  });

  it('round-trips a long string', () => {
    const value = 'a'.repeat(10_000);
    expect(decrypt(encrypt(value))).toBe(value);
  });

  it('throws on a tampered auth tag', () => {
    const encrypted = encrypt('value');
    const [iv, , ciphertext] = encrypted.split(':');
    // Replace auth tag with a different valid-length hex string
    const tampered = `${iv}:deadbeefdeadbeefdeadbeefdeadbeef:${ciphertext}`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it('throws on a tampered ciphertext', () => {
    const encrypted = encrypt('value');
    const [iv, authTag] = encrypted.split(':');
    const tamperedCiphertext = 'ff'.repeat(8);
    const tampered = `${iv}:${authTag}:${tamperedCiphertext}`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it('throws on a payload with too few segments', () => {
    expect(() => decrypt('onlytwoparts:here')).toThrow(/Invalid encrypted payload format/);
  });

  it('throws on a payload with too many segments', () => {
    expect(() => decrypt('a:b:c:d')).toThrow(/Invalid encrypted payload format/);
  });

  it('throws on an IV with wrong byte length', () => {
    // IV segment is only 4 chars (2 bytes) instead of 24 (12 bytes)
    expect(() => decrypt('ffff:' + 'aa'.repeat(16) + ':' + 'bb'.repeat(8))).toThrow(
      /Invalid IV length/,
    );
  });

  it('throws on an auth tag with wrong byte length', () => {
    // authTag segment is only 4 chars (2 bytes) instead of 32 (16 bytes)
    expect(() => decrypt('aa'.repeat(12) + ':ffff:' + 'bb'.repeat(8))).toThrow(
      /Invalid auth tag length/,
    );
  });

  it('throws when NODE_ENCRYPTION_KEY is missing', () => {
    const original = process.env.NODE_ENCRYPTION_KEY;
    const payload = encrypt('value');
    try {
      delete process.env.NODE_ENCRYPTION_KEY;
      expect(() => decrypt(payload)).toThrow(/NODE_ENCRYPTION_KEY/);
    } finally {
      process.env.NODE_ENCRYPTION_KEY = original;
    }
  });

  it('produces distinct ciphertexts for the same plaintext (no determinism)', () => {
    const a = encrypt('repeat');
    const b = encrypt('repeat');
    expect(a).not.toBe(b);
    // Both must decrypt back to the same value
    expect(decrypt(a)).toBe('repeat');
    expect(decrypt(b)).toBe('repeat');
  });
});
