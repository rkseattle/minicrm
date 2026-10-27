/**
 * Unit tests for cryptoService.
 *
 * No database or external dependencies — pure Node.js crypto.
 * NODE_ENCRYPTION_KEY is loaded from .env.test via the global test setup.
 */

import 'dotenv/config';
import { encrypt, decrypt, keyedDigest } from '../services/cryptoService.js';
import { erasedAddressDigest } from '../services/mail/gdprRedaction.js';

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
    const [iv, authTag, ciphertext] = encrypted.split(':');
    // Flip the last byte of the original-length ciphertext so the auth tag
    // catches data mutation rather than a length mismatch triggering first.
    const lastByte = parseInt(ciphertext.slice(-2), 16);
    const flippedByte = (lastByte ^ 0xff).toString(16).padStart(2, '0');
    const tampered = `${iv}:${authTag}:${ciphertext.slice(0, -2)}${flippedByte}`;
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

describe('keyedDigest', () => {
  const OTHER_KEY = 'b'.repeat(64);

  it('is a 64-character hex digest, the same every time for one input', () => {
    const digest = keyedDigest('purpose-a', 'someone@example.com');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(keyedDigest('purpose-a', 'someone@example.com')).toBe(digest);
  });

  it('differs by purpose, so one use cannot be matched against another', () => {
    expect(keyedDigest('purpose-a', 'x')).not.toBe(keyedDigest('purpose-b', 'x'));
  });

  it('differs by value', () => {
    expect(keyedDigest('purpose-a', 'x')).not.toBe(keyedDigest('purpose-a', 'y'));
  });

  it('depends on NODE_ENCRYPTION_KEY, so it cannot be recomputed without the key', () => {
    const original = process.env.NODE_ENCRYPTION_KEY;
    const withOriginal = keyedDigest('purpose-a', 'x');
    try {
      process.env.NODE_ENCRYPTION_KEY = OTHER_KEY;
      expect(keyedDigest('purpose-a', 'x')).not.toBe(withOriginal);
    } finally {
      process.env.NODE_ENCRYPTION_KEY = original;
    }
    expect(keyedDigest('purpose-a', 'x')).toBe(withOriginal);
  });

  it('refuses to run without a valid key', () => {
    const original = process.env.NODE_ENCRYPTION_KEY;
    try {
      delete process.env.NODE_ENCRYPTION_KEY;
      expect(() => keyedDigest('purpose-a', 'x')).toThrow(/NODE_ENCRYPTION_KEY/);
    } finally {
      process.env.NODE_ENCRYPTION_KEY = original;
    }
  });
});

describe('erasedAddressDigest', () => {
  it('ignores case and surrounding whitespace, as stored addresses do', () => {
    expect(erasedAddressDigest('  Someone@Example.COM ')).toBe(
      erasedAddressDigest('someone@example.com'),
    );
  });

  it('is not the plain SHA-256 of the address', async () => {
    const { createHash } = await import('node:crypto');
    const plain = createHash('sha256').update('someone@example.com').digest('hex');
    expect(erasedAddressDigest('someone@example.com')).not.toBe(plain);
  });
});
