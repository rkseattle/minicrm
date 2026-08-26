/**
 * Startup validation tests.
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

/** How long a spawned server may run before it is killed. */
const SPAWN_KILL_TIMEOUT = 8_000;

/** A valid 64-char hex key used to satisfy NODE_ENCRYPTION_KEY where we only
 *  want to test the JWT_SECRET path, and vice versa. */
const VALID_ENCRYPTION_KEY = 'a'.repeat(64);
const VALID_JWT_SECRET = 'a-sufficiently-long-jwt-secret-value-for-tests';

/**
 * Spawns server.ts via tsx with the given env overrides.
 * Returns the exit code (null means the process was killed by signal).
 */
function spawnServerCapturing(env: Record<string, string>): {
  status: number | null;
  stderr: string;
} {
  const result = spawnSync('npx', ['tsx', SERVER_ENTRY], {
    // NODE_ENV is pinned, not inherited: server.ts refuses to boot on an
    // unrecognized one, so a parent that stopped supplying it would leave every
    // case below passing on the wrong guard. Cases override it where that is the point.
    env: { ...process.env, NODE_ENV: 'test', ...env },
    timeout: SPAWN_KILL_TIMEOUT,
    encoding: 'utf8',
  });
  return { status: result.status, stderr: result.stderr ?? '' };
}

function spawnServer(env: Record<string, string>): number | null {
  return spawnServerCapturing(env).status;
}

// ── NODE_ENCRYPTION_KEY validation ────────────────────────────────────────────

// Vitest's default is 5 s, below SPAWN_KILL_TIMEOUT — give each test longer than
// the child gets, so a hung boot surfaces as this file's assertion, not a runner kill.
const SPAWN_TEST_TIMEOUT = 12_000;

describe('NODE_ENCRYPTION_KEY startup validation', () => {
  it(
    'exits non-zero when NODE_ENCRYPTION_KEY is absent',
    () => {
      const status = spawnServer({
        JWT_SECRET: VALID_JWT_SECRET,
        NODE_ENCRYPTION_KEY: '',
      });
      expect(status).not.toBe(0);
    },
    SPAWN_TEST_TIMEOUT,
  );

  it(
    'exits non-zero when NODE_ENCRYPTION_KEY is too short',
    () => {
      const status = spawnServer({
        JWT_SECRET: VALID_JWT_SECRET,
        NODE_ENCRYPTION_KEY: 'abc123',
      });
      expect(status).not.toBe(0);
    },
    SPAWN_TEST_TIMEOUT,
  );

  it(
    'exits non-zero when NODE_ENCRYPTION_KEY contains non-hex characters',
    () => {
      const status = spawnServer({
        JWT_SECRET: VALID_JWT_SECRET,
        NODE_ENCRYPTION_KEY: 'z'.repeat(64),
      });
      expect(status).not.toBe(0);
    },
    SPAWN_TEST_TIMEOUT,
  );

  it(
    'exits non-zero when NODE_ENCRYPTION_KEY is exactly 63 chars (one short)',
    () => {
      const status = spawnServer({
        JWT_SECRET: VALID_JWT_SECRET,
        NODE_ENCRYPTION_KEY: 'a'.repeat(63),
      });
      expect(status).not.toBe(0);
    },
    SPAWN_TEST_TIMEOUT,
  );
});

// ── JWT_SECRET validation still works alongside the new check ─────────────────

describe('JWT_SECRET validation still enforced', () => {
  it(
    'exits non-zero when JWT_SECRET is absent',
    () => {
      const status = spawnServer({
        JWT_SECRET: '',
        NODE_ENCRYPTION_KEY: VALID_ENCRYPTION_KEY,
      });
      expect(status).not.toBe(0);
    },
    SPAWN_TEST_TIMEOUT,
  );

  it(
    'exits non-zero when JWT_SECRET is a known-weak value',
    () => {
      const status = spawnServer({
        JWT_SECRET: 'changeme',
        NODE_ENCRYPTION_KEY: VALID_ENCRYPTION_KEY,
      });
      expect(status).not.toBe(0);
    },
    SPAWN_TEST_TIMEOUT,
  );
});

// ── NODE_ENV validation ───────────────────────────────────────────────────────

describe('NODE_ENV startup validation', () => {
  // Asserts the message, not just a non-zero exit: this server cannot reach a
  // database here either, so exit status alone passes whether the guard exists or not.
  it(
    'refuses to boot, naming the offending value, when NODE_ENV is not recognized',
    () => {
      const { status, stderr } = spawnServerCapturing({
        JWT_SECRET: VALID_JWT_SECRET,
        NODE_ENCRYPTION_KEY: VALID_ENCRYPTION_KEY,
        NODE_ENV: 'producton',
      });

      expect(status).not.toBe(0);
      expect(stderr).toContain("'producton'");
      expect(stderr).toContain('development, test, staging, production');
    },
    SPAWN_TEST_TIMEOUT,
  );
});
