/**
 * Startup validation tests (MINCRM-301).
 *
 * Verifies that server.ts exits non-zero before binding when required
 * environment variables are absent or malformed. Uses spawnSync so each
 * case runs in an isolated child process — the validation throws at module
 * load time, before any DB connection or port binding occurs.
 *
 * No database is required: the process exits in the env-var validation
 * block before pool.connect() is ever called.
 */

import { spawnSync } from 'child_process';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** Path to the server entry point, relative to this test file. */
const SERVER_ENTRY = resolve(__dirname, '../server.ts');

/** A valid 64-char hex key used to satisfy NODE_ENCRYPTION_KEY where we only
 *  want to test the JWT_SECRET path, and vice versa. */
const VALID_ENCRYPTION_KEY = 'a'.repeat(64);
const VALID_JWT_SECRET = 'a-sufficiently-long-jwt-secret-value-for-tests';

/**
 * Spawns server.ts via tsx with the given env overrides.
 * Returns the exit code (null means the process was killed by signal).
 */
function spawnServer(env: Record<string, string>): number | null {
  const result = spawnSync('npx', ['tsx', SERVER_ENTRY], {
    env: { ...process.env, ...env },
    timeout: 8_000,
    encoding: 'utf8',
  });
  return result.status;
}

// ── NODE_ENCRYPTION_KEY validation ────────────────────────────────────────────

describe('MINCRM-301 — NODE_ENCRYPTION_KEY startup validation', () => {
  it('exits non-zero when NODE_ENCRYPTION_KEY is absent', () => {
    const status = spawnServer({
      JWT_SECRET: VALID_JWT_SECRET,
      NODE_ENCRYPTION_KEY: '',
    });
    expect(status).not.toBe(0);
  });

  it('exits non-zero when NODE_ENCRYPTION_KEY is too short', () => {
    const status = spawnServer({
      JWT_SECRET: VALID_JWT_SECRET,
      NODE_ENCRYPTION_KEY: 'abc123',
    });
    expect(status).not.toBe(0);
  });

  it('exits non-zero when NODE_ENCRYPTION_KEY contains non-hex characters', () => {
    const status = spawnServer({
      JWT_SECRET: VALID_JWT_SECRET,
      NODE_ENCRYPTION_KEY: 'z'.repeat(64),
    });
    expect(status).not.toBe(0);
  });

  it('exits non-zero when NODE_ENCRYPTION_KEY is exactly 63 chars (one short)', () => {
    const status = spawnServer({
      JWT_SECRET: VALID_JWT_SECRET,
      NODE_ENCRYPTION_KEY: 'a'.repeat(63),
    });
    expect(status).not.toBe(0);
  });
});

// ── JWT_SECRET validation still works alongside the new check ─────────────────

describe('MINCRM-301 — JWT_SECRET validation still enforced', () => {
  it('exits non-zero when JWT_SECRET is absent', () => {
    const status = spawnServer({
      JWT_SECRET: '',
      NODE_ENCRYPTION_KEY: VALID_ENCRYPTION_KEY,
    });
    expect(status).not.toBe(0);
  });

  it('exits non-zero when JWT_SECRET is a known-weak value', () => {
    const status = spawnServer({
      JWT_SECRET: 'changeme',
      NODE_ENCRYPTION_KEY: VALID_ENCRYPTION_KEY,
    });
    expect(status).not.toBe(0);
  });
});
