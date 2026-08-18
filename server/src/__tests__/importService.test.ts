/**
 * Integration tests for importService.
 * Tests CSV parsing, account/contact/deal import, duplicate detection,
 * validation failures, and error CSV generation.
 *
 *
 * Runs against a real PostgreSQL test database.
 */

import 'dotenv/config';
import {
  parseCsvBuffer,
  buildErrorCsv,
  importAccounts,
  importContacts,
  importDeals,
  type AccountMapping,
  type ContactMapping,
  type DealMapping,
} from '../services/importService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';

const FILE_PREFIX = 'import-svc';

/** Minimal admin user used as the importing admin */
const ADMIN_USER = {
  email: `${FILE_PREFIX}-admin@example.com`,
  name: 'Import Admin',
  role: 'admin' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let adminId: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const admin = await createUser(ADMIN_USER);
  adminId = admin.id;
});

beforeEach(async () => {
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id = $1)',
    [adminId],
  );
  await pool.query('DELETE FROM activities WHERE owner_id = $1', [adminId]);
  await pool.query('DELETE FROM deals WHERE owner_id = $1', [adminId]);
  await pool.query('DELETE FROM contacts WHERE owner_id = $1', [adminId]);
  await pool.query('DELETE FROM accounts WHERE owner_id = $1', [adminId]);
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── parseCsvBuffer ─────────────────────────────────────────────────────────────

describe('parseCsvBuffer', () => {
  it('parses a well-formed CSV into headers and rows', () => {
    const csv = 'name,industry\nAcme Corp,Software\nGlobal Inc,Finance';
    const result = parseCsvBuffer(Buffer.from(csv));
    expect(result.headers).toEqual(['name', 'industry']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({ name: 'Acme Corp', industry: 'Software' });
  });

  it('limits preview to 5 rows', () => {
    const rows = Array.from({ length: 8 }, (_, i) => `Row ${i + 1},val`).join('\n');
    const csv = `name,extra\n${rows}`;
    const result = parseCsvBuffer(Buffer.from(csv));
    expect(result.rows).toHaveLength(8);
    expect(result.preview).toHaveLength(5);
  });

  it('trims whitespace from values', () => {
    const csv = 'name,industry\n  Acme  ,  Software  ';
    const result = parseCsvBuffer(Buffer.from(csv));
    expect(result.rows[0]).toEqual({ name: 'Acme', industry: 'Software' });
  });

  it('throws when CSV has no data rows', () => {
    const csv = 'name,industry\n';
    expect(() => parseCsvBuffer(Buffer.from(csv))).toThrow('CSV file contains no data rows');
  });
});

// ── buildErrorCsv ──────────────────────────────────────────────────────────────

describe('buildErrorCsv', () => {
  it('returns empty string when there are no failures', () => {
    expect(buildErrorCsv([])).toBe('');
  });

  it('includes row_number, reason, and original data columns', () => {
    const failures = [
      { row: 2, data: { name: 'Bad Corp', industry: '' }, reason: 'Missing required field: name' },
    ];
    const csv = buildErrorCsv(failures);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('row_number,reason,name,industry');
    expect(lines[1]).toContain('2');
    expect(lines[1]).toContain('Missing required field: name');
    expect(lines[1]).toContain('Bad Corp');
  });

  it('escapes double quotes in values', () => {
    const failures = [{ row: 1, data: { name: 'He said "hi"' }, reason: 'test' }];
    const csv = buildErrorCsv(failures);
    expect(csv).toContain('He said ""hi""');
  });
});

// ── importAccounts ────────────────────────────────────────────────

describe('importAccounts', () => {
  const mapping: AccountMapping = { name: 'Company', industry: 'Sector' };

  it('creates new accounts', async () => {
    const rows = [
      { Company: 'Acme Corp', Sector: 'Software' },
      { Company: 'Global Inc', Sector: 'Finance' },
    ];
    const result = await importAccounts(rows, mapping, adminId);
    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.failed).toHaveLength(0);

    const { rows: dbRows } = await pool.query(
      'SELECT name FROM accounts WHERE owner_id = $1 ORDER BY name',
      [adminId],
    );
    expect(dbRows.map((r: { name: string }) => r.name)).toEqual(['Acme Corp', 'Global Inc']);
  });

  it('skips duplicate account names (case-insensitive) by default', async () => {
    // Pre-insert one account
    await pool.query('INSERT INTO accounts (name, owner_id) VALUES ($1, $2)', [
      'Acme Corp',
      adminId,
    ]);

    const rows = [{ Company: 'acme corp', Sector: 'Software' }];
    const result = await importAccounts(rows, mapping, adminId);
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('imports a duplicate when skipDuplicates is false', async () => {
    await pool.query('INSERT INTO accounts (name, owner_id) VALUES ($1, $2)', [
      'Acme Corp',
      adminId,
    ]);

    const rows = [{ Company: 'Acme Corp', Sector: 'Software' }];
    const result = await importAccounts(rows, mapping, adminId, false);
    expect(result.created).toBe(1);
  });

  it('fails rows with missing required name field', async () => {
    const rows = [{ Company: '', Sector: 'Software' }];
    const result = await importAccounts(rows, mapping, adminId);
    expect(result.created).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain('Missing required field: name');
    expect(result.failed[0].row).toBe(1);
  });

  it('handles a mix of valid, duplicate, and failed rows', async () => {
    await pool.query('INSERT INTO accounts (name, owner_id) VALUES ($1, $2)', [
      'Existing Co',
      adminId,
    ]);

    const rows = [
      { Company: 'New Corp', Sector: 'Tech' },
      { Company: 'Existing Co', Sector: 'Old' },
      { Company: '', Sector: 'None' },
    ];
    const result = await importAccounts(rows, mapping, adminId);
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toHaveLength(1);
  });
});

// ── importContacts ────────────────────────────────────────────────

describe('importContacts', () => {
  const mapping: ContactMapping = {
    first_name: 'First',
    last_name: 'Last',
    email: 'Email',
  };

  it('creates new contacts', async () => {
    const rows = [
      { First: 'Alice', Last: 'Smith', Email: `${FILE_PREFIX}-alice@example.com` },
      { First: 'Bob', Last: 'Jones', Email: `${FILE_PREFIX}-bob@example.com` },
    ];
    const result = await importContacts(rows, mapping, adminId);
    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.failed).toHaveLength(0);
  });

  it('skips contacts with duplicate email', async () => {
    await pool.query(
      'INSERT INTO contacts (first_name, last_name, email, owner_id) VALUES ($1, $2, $3, $4)',
      ['Existing', 'Person', 'existing@example.com', adminId],
    );

    const rows = [{ First: 'Other', Last: 'Person', Email: 'existing@example.com' }];
    const result = await importContacts(rows, mapping, adminId);
    expect(result.skipped).toBe(1);
  });

  it('fails rows with missing email field', async () => {
    const rows = [{ First: 'Alice', Last: 'Smith', Email: '' }];
    const result = await importContacts(rows, mapping, adminId);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain('Missing required field: email');
  });

  it('fails rows with invalid email format', async () => {
    const rows = [{ First: 'Alice', Last: 'Smith', Email: 'not-an-email' }];
    const result = await importContacts(rows, mapping, adminId);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain('Invalid email format');
  });

  it('fails rows with missing required fields', async () => {
    const rows = [{ First: '', Last: 'Smith', Email: `${FILE_PREFIX}-alice@example.com` }];
    const result = await importContacts(rows, mapping, adminId);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain('first_name');
  });

  it('links contact to account by name when account_name mapping is provided', async () => {
    const { rows: acctRows } = await pool.query(
      'INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id',
      ['Target Account', adminId],
    );
    const accountId = acctRows[0].id as string;

    const mappingWithAccount: ContactMapping = {
      ...mapping,
      account_name: 'AccountName',
    };
    const rows = [
      {
        First: 'Alice',
        Last: 'Smith',
        Email: `${FILE_PREFIX}-alice@example.com`,
        AccountName: 'Target Account',
      },
    ];
    const result = await importContacts(rows, mappingWithAccount, adminId);
    expect(result.created).toBe(1);

    const { rows: dbRows } = await pool.query('SELECT account_id FROM contacts WHERE email = $1', [
      `${FILE_PREFIX}-alice@example.com`,
    ]);
    expect(dbRows[0].account_id).toBe(accountId);
  });

  it('sets owner_id to the importing admin for all created contacts', async () => {
    const rows = [{ First: 'Alice', Last: 'Smith', Email: `${FILE_PREFIX}-alice@example.com` }];
    await importContacts(rows, mapping, adminId);

    const { rows: dbRows } = await pool.query('SELECT owner_id FROM contacts WHERE email = $1', [
      `${FILE_PREFIX}-alice@example.com`,
    ]);
    expect(dbRows[0].owner_id).toBe(adminId);
  });
});

// ── importDeals ───────────────────────────────────────────────────

describe('importDeals', () => {
  const mapping: DealMapping = { name: 'Deal', stage: 'Stage' };

  it('creates new deals', async () => {
    const rows = [
      { Deal: 'Big Sale', Stage: 'Prospecting' },
      { Deal: 'Small Deal', Stage: 'Qualification' },
    ];
    const result = await importDeals(rows, mapping, adminId);
    expect(result.created).toBe(2);
    expect(result.failed).toHaveLength(0);

    const { rows: dbRows } = await pool.query(
      'SELECT name, stage FROM deals WHERE owner_id = $1 ORDER BY name',
      [adminId],
    );
    expect(dbRows[0]).toMatchObject({ name: 'Big Sale', stage: 'Prospecting' });
  });

  it('matches stage case-insensitively', async () => {
    const rows = [{ Deal: 'Test', Stage: 'closed won' }];
    const result = await importDeals(rows, mapping, adminId);
    expect(result.created).toBe(1);

    const { rows: dbRows } = await pool.query('SELECT stage FROM deals WHERE name = $1', ['Test']);
    expect(dbRows[0].stage).toBe('Closed Won');
  });

  it('fails rows with missing stage field', async () => {
    const rows = [{ Deal: 'Test', Stage: '' }];
    const result = await importDeals(rows, mapping, adminId);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain('Missing required field: stage');
  });

  it('fails rows with unrecognised stage', async () => {
    const rows = [{ Deal: 'Test', Stage: 'UnknownStage' }];
    const result = await importDeals(rows, mapping, adminId);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain('Unrecognised stage');
  });

  it('fails rows with missing required name', async () => {
    const rows = [{ Deal: '', Stage: 'Prospecting' }];
    const result = await importDeals(rows, mapping, adminId);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain('Missing required field: name');
  });

  it('links deal to account by name', async () => {
    const { rows: acctRows } = await pool.query(
      'INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id',
      ['Partner Co', adminId],
    );
    const accountId = acctRows[0].id as string;

    const mappingWithAccount: DealMapping = { ...mapping, account_name: 'Account' };
    const rows = [{ Deal: 'Big Sale', Stage: 'Prospecting', Account: 'Partner Co' }];
    const result = await importDeals(rows, mappingWithAccount, adminId);
    expect(result.created).toBe(1);

    const { rows: dbRows } = await pool.query('SELECT account_id FROM deals WHERE name = $1', [
      'Big Sale',
    ]);
    expect(dbRows[0].account_id).toBe(accountId);
  });

  it('skips deal when account is unresolvable and skip_unresolvable_accounts is true', async () => {
    const mappingSkip: DealMapping = {
      ...mapping,
      account_name: 'Account',
      skip_unresolvable_accounts: true,
    };
    const rows = [{ Deal: 'Big Sale', Stage: 'Prospecting', Account: 'Nonexistent Co' }];
    const result = await importDeals(rows, mappingSkip, adminId);
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('imports deal without account link when account is unresolvable and skip is false', async () => {
    const mappingNoSkip: DealMapping = {
      ...mapping,
      account_name: 'Account',
      skip_unresolvable_accounts: false,
    };
    const rows = [{ Deal: 'Big Sale', Stage: 'Prospecting', Account: 'Nonexistent Co' }];
    const result = await importDeals(rows, mappingNoSkip, adminId);
    expect(result.created).toBe(1);

    const { rows: dbRows } = await pool.query('SELECT account_id FROM deals WHERE name = $1', [
      'Big Sale',
    ]);
    expect(dbRows[0].account_id).toBeNull();
  });

  it('accepts a valid numeric value', async () => {
    const mappingWithValue: DealMapping = { ...mapping, value: 'Value' };
    const rows = [{ Deal: 'Good Deal', Stage: 'Prospecting', Value: '9999.99' }];
    const result = await importDeals(rows, mappingWithValue, adminId);
    expect(result.created).toBe(1);
    const { rows: dbRows } = await pool.query('SELECT value FROM deals WHERE name = $1', [
      'Good Deal',
    ]);
    expect(Number(dbRows[0].value)).toBe(9999.99);
  });

  it('fails rows with invalid value', async () => {
    const mappingWithValue: DealMapping = { ...mapping, value: 'Value' };
    const rows = [{ Deal: 'Bad Deal', Stage: 'Prospecting', Value: 'notanumber' }];
    const result = await importDeals(rows, mappingWithValue, adminId);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain('Invalid value');
  });

  it('fails rows with close_date not in YYYY-MM-DD format', async () => {
    const mappingWithDate: DealMapping = { ...mapping, close_date: 'CloseDate' };
    const rows = [{ Deal: 'Bad Date', Stage: 'Prospecting', CloseDate: 'Jan 1 2025' }];
    const result = await importDeals(rows, mappingWithDate, adminId);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain('Invalid close_date');
  });

  it('accepts close_date in YYYY-MM-DD format', async () => {
    const mappingWithDate: DealMapping = { ...mapping, close_date: 'CloseDate' };
    const rows = [{ Deal: 'Good Date', Stage: 'Prospecting', CloseDate: '2025-12-31' }];
    const result = await importDeals(rows, mappingWithDate, adminId);
    expect(result.created).toBe(1);
  });

  it('handles a mix of valid, failed, and skipped rows', async () => {
    const mappingSkip: DealMapping = {
      ...mapping,
      account_name: 'Account',
      skip_unresolvable_accounts: true,
    };
    const rows = [
      { Deal: 'Good Deal', Stage: 'Prospecting', Account: '' },
      { Deal: 'Skip Deal', Stage: 'Qualification', Account: 'Nonexistent' },
      { Deal: '', Stage: 'Prospecting', Account: '' },
    ];
    const result = await importDeals(rows, mappingSkip, adminId);
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toHaveLength(1);
  });
});

// ── Partial-commit design documentation ──────────────────────────
//
// Import is intentionally per-row — successful rows commit immediately and are
// not rolled back when subsequent rows fail. This is by design: the import
// service favors maximum data ingestion over all-or-nothing atomicity, so
// operators can fix and re-import only the failed rows rather than the whole file.

describe('importContacts — partial-commit is intentional design', () => {
  it('commits 3 valid rows even when the 4th row fails validation', async () => {
    // Import is intentionally per-row — successful rows commit immediately and are
    // not rolled back when subsequent rows fail. This is by design.
    const mapping: ContactMapping = {
      first_name: 'First',
      last_name: 'Last',
      email: 'Email',
    };

    const rows = [
      { First: 'Alice', Last: 'A', Email: 'partial-alice@example.com' },
      { First: 'Bob', Last: 'B', Email: 'partial-bob@example.com' },
      { First: 'Carol', Last: 'C', Email: 'partial-carol@example.com' },
      // 4th row is intentionally invalid — missing required first_name
      { First: '', Last: 'D', Email: 'partial-dave@example.com' },
    ];

    const result = await importContacts(rows, mapping, adminId);

    expect(result.created).toBe(3);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].row).toBe(4);

    // The 3 valid rows must be committed to the DB even though the 4th failed
    const { rows: dbRows } = await pool.query(
      `SELECT email FROM contacts WHERE email = ANY($1) ORDER BY email`,
      [['partial-alice@example.com', 'partial-bob@example.com', 'partial-carol@example.com']],
    );
    expect(dbRows).toHaveLength(3);
  });
});
