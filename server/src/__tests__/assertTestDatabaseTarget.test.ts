/**
 * Tests for the refuse-to-run guard on the destructive E2E scripts. (MINCRM-684)
 *
 * These scripts truncate and reseed every table they touch — reset-e2e-data.ts runs
 * `TRUNCATE audit_log CASCADE`. The guard is what makes "this cannot destroy the dev
 * database" a property rather than a hope, so the CI-parity cases matter as much as the
 * throw cases: a guard that breaks CI would be reverted, and the protection lost.
 */

import {
  assertTestDatabaseTarget,
  assertTestDatabasePort,
} from '../scripts/assertTestDatabaseTarget.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.CI;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('assertTestDatabaseTarget', () => {
  it('accepts a test database on the test stack port', () => {
    process.env.DB_PORT = '5433';
    process.env.DB_NAME = 'minicrm_e2e';

    expect(assertTestDatabaseTarget('spec')).toEqual({
      host: 'localhost',
      port: '5433',
      database: 'minicrm_e2e',
    });
  });

  // CI has one Postgres service container on 5432 and sets DB_NAME explicitly. The guard
  // must be inert there — see the DB_PORT: 5432 / DB_NAME: minicrm_e2e pairs in ci.yml.
  it("accepts CI's port 5432 when the database is a test database", () => {
    process.env.DB_PORT = '5432';
    process.env.DB_NAME = 'minicrm_e2e';
    process.env.CI = 'true';

    expect(assertTestDatabaseTarget('spec').database).toBe('minicrm_e2e');
  });

  it('accepts minicrm_test, the unit-suite database', () => {
    process.env.DB_PORT = '5433';
    process.env.DB_NAME = 'minicrm_test';

    expect(assertTestDatabaseTarget('spec').database).toBe('minicrm_test');
  });

  it('throws when DB_PORT is unset, rather than defaulting to the dev port', () => {
    delete process.env.DB_PORT;
    process.env.DB_NAME = 'minicrm_e2e';

    expect(() => assertTestDatabaseTarget('spec')).toThrow(/DB_PORT is not set/);
  });

  // Number('abc') || 5432 at a call site silently resolves to the dev port, so a
  // non-numeric value must be rejected here rather than passed through.
  it('throws when DB_PORT is non-numeric', () => {
    process.env.DB_PORT = 'abc';
    process.env.DB_NAME = 'minicrm_e2e';

    expect(() => assertTestDatabaseTarget('spec')).toThrow(/not a number/);
  });

  // The destructive guard must be at least as strict about the port as the port-only
  // guard, or the two can diverge and the more dangerous scripts get the weaker check.
  it('rejects the dev port off CI, same as assertTestDatabasePort', () => {
    process.env.DB_PORT = '5432';
    process.env.DB_NAME = 'minicrm_e2e';
    delete process.env.CI;

    expect(() => assertTestDatabaseTarget('spec')).toThrow(/is the dev database/);
  });

  // The original failure: root .env supplies DB_NAME=minicrm, and the script truncates.
  it('throws when DB_NAME is the dev database', () => {
    process.env.DB_PORT = '5433';
    process.env.DB_NAME = 'minicrm';

    expect(() => assertTestDatabaseTarget('spec')).toThrow(/is not a test database/);
  });

  it('throws when DB_NAME is the dev coverage database', () => {
    process.env.DB_PORT = '5433';
    process.env.DB_NAME = 'minicrm_coverage';

    expect(() => assertTestDatabaseTarget('spec')).toThrow(/is not a test database/);
  });

  it('throws when DB_NAME is unset', () => {
    process.env.DB_PORT = '5433';
    delete process.env.DB_NAME;

    expect(() => assertTestDatabaseTarget('spec')).toThrow(/DB_NAME is not set/);
  });

  it('validates COVERAGE_DB_NAME when asked to', () => {
    process.env.DB_PORT = '5433';
    process.env.COVERAGE_DB_NAME = 'minicrm_coverage_e2e';

    expect(assertTestDatabaseTarget('spec', 'COVERAGE_DB_NAME').database).toBe(
      'minicrm_coverage_e2e',
    );
  });

  it('throws when COVERAGE_DB_NAME is the dev coverage database', () => {
    process.env.DB_PORT = '5433';
    process.env.COVERAGE_DB_NAME = 'minicrm_coverage';

    expect(() => assertTestDatabaseTarget('spec', 'COVERAGE_DB_NAME')).toThrow(
      /is not a test database/,
    );
  });

  it('names the offending script and value in the error', () => {
    process.env.DB_PORT = '5433';
    process.env.DB_NAME = 'minicrm';

    expect(() => assertTestDatabaseTarget('reset-e2e-data')).toThrow(
      /\[reset-e2e-data\].*"minicrm"/s,
    );
  });
});

describe('assertTestDatabasePort', () => {
  it('accepts the test stack port', () => {
    process.env.DB_PORT = '5433';

    expect(assertTestDatabasePort('spec')).toBe('5433');
  });

  it('throws when DB_PORT is unset', () => {
    delete process.env.DB_PORT;

    expect(() => assertTestDatabasePort('spec')).toThrow(/DB_PORT is not set/);
  });

  it('throws when DB_PORT is non-numeric', () => {
    process.env.DB_PORT = '54a33';

    expect(() => assertTestDatabasePort('spec')).toThrow(/not a number/);
  });

  // Locally, 5432 is the dev instance — creating test databases there is what the
  // separation removed.
  it('throws on the dev port when not running in CI', () => {
    process.env.DB_PORT = '5432';

    expect(() => assertTestDatabasePort('spec')).toThrow(/is the dev database/);
  });

  // In CI the only Postgres is on 5432, so provisioning there is correct.
  it('accepts the dev port when CI is set', () => {
    process.env.DB_PORT = '5432';
    process.env.CI = 'true';

    expect(assertTestDatabasePort('spec')).toBe('5432');
  });
});
