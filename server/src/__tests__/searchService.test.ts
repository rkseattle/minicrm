/**
 * Integration tests for searchService.
 *
 * Runs against a real PostgreSQL test database.
 * Creates isolated test users, contacts, accounts, and deals before each test.
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import { globalSearch, SEARCH_MIN_LENGTH } from '../services/searchService.js';
import { createContact } from '../services/contactService.js';
import { createAccount } from '../services/accountService.js';
import { createDeal } from '../services/dealService.js';
import { createLead } from '../services/leadsService.js';
import { createActivity } from '../services/activityService.js';
import { createNote } from '../services/noteService.js';
import { attachTag } from '../services/tagService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';

const FILE_PREFIX = 'search-svc';

/** Minimal user fixture */
const ADMIN_USER = {
  email: `${FILE_PREFIX}-admin@example.com`,
  name: 'Search Admin',
  role: 'admin' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

const REP_USER = {
  email: `${FILE_PREFIX}-rep@example.com`,
  name: 'Search Rep',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let adminId: string;
let repId: string;
let accountId: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM deal_tags WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM account_tags WHERE account_id IN (SELECT id FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contact_tags WHERE contact_id IN (SELECT id FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM tags WHERE name LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM notes WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM leads WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contact_addresses WHERE contact_id IN (SELECT id FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
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
  const rep = await createUser(REP_USER);
  repId = rep.id;

  const account = await createAccount({ name: 'Search Test Account', owner_id: adminId });
  accountId = account.id;
});

beforeEach(async () => {
  await pool.query(
    'DELETE FROM deal_tags WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM account_tags WHERE account_id IN (SELECT id FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contact_tags WHERE contact_id IN (SELECT id FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM tags WHERE name LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM notes WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM leads WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contact_addresses WHERE contact_id IN (SELECT id FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    "DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1) AND name <> 'Search Test Account'",
    [`${FILE_PREFIX}-%`],
  );
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM deal_tags WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM account_tags WHERE account_id IN (SELECT id FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contact_tags WHERE contact_id IN (SELECT id FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM tags WHERE name LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM notes WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM leads WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contact_addresses WHERE contact_id IN (SELECT id FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
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

describe('SEARCH_MIN_LENGTH', () => {
  it('is 2', () => {
    expect(SEARCH_MIN_LENGTH).toBe(2);
  });
});

describe('globalSearch — contacts', () => {
  it('returns a contact matching by first_name', async () => {
    await createContact({
      first_name: 'Zara',
      last_name: 'Findme',
      email: 'zara@example.com',
      owner_id: adminId,
    });

    const results = await globalSearch('Zara', { userId: adminId, role: 'admin' });
    expect(results.contacts).toHaveLength(1);
    expect(results.contacts[0].first_name).toBe('Zara');
  });

  it('returns a contact matching by last_name', async () => {
    await createContact({
      first_name: 'Test',
      last_name: 'Finnable',
      email: 'finnable@example.com',
      owner_id: adminId,
    });

    const results = await globalSearch('Finnable', { userId: adminId, role: 'admin' });
    expect(results.contacts).toHaveLength(1);
    expect(results.contacts[0].last_name).toBe('Finnable');
  });

  it('returns a contact matching by email', async () => {
    await createContact({
      first_name: 'Email',
      last_name: 'Match',
      email: 'uniqueemail123@example.com',
      owner_id: adminId,
    });

    const results = await globalSearch('uniqueemail123', { userId: adminId, role: 'admin' });
    expect(results.contacts).toHaveLength(1);
    expect(results.contacts[0].email).toBe('uniqueemail123@example.com');
  });

  it('is case-insensitive', async () => {
    await createContact({
      first_name: 'CaseSensitive',
      last_name: 'Test',
      email: 'casesensitive@example.com',
      owner_id: adminId,
    });

    const upper = await globalSearch('CASESENSITIVE', { userId: adminId, role: 'admin' });
    const lower = await globalSearch('casesensitive', { userId: adminId, role: 'admin' });
    expect(upper.contacts).toHaveLength(1);
    expect(lower.contacts).toHaveLength(1);
  });

  it('supports partial-word matching', async () => {
    await createContact({
      first_name: 'PartialMatch',
      last_name: 'Test',
      email: 'partial@example.com',
      owner_id: adminId,
    });

    const results = await globalSearch('artial', { userId: adminId, role: 'admin' });
    expect(results.contacts).toHaveLength(1);
  });

  it('returns empty array when no contact matches', async () => {
    const results = await globalSearch('zzznomatch999', { userId: adminId, role: 'admin' });
    expect(results.contacts).toHaveLength(0);
  });

  it('does not return contacts owned by others when role is rep', async () => {
    await createContact({
      first_name: 'OtherOwner',
      last_name: 'Contact',
      email: 'otherowner@example.com',
      owner_id: adminId,
    });

    const results = await globalSearch('OtherOwner', { userId: repId, role: 'rep' });
    expect(results.contacts).toHaveLength(0);
  });

  it('returns own contacts when role is rep', async () => {
    await createContact({
      first_name: 'RepOwned',
      last_name: 'Contact',
      email: 'repowned@example.com',
      owner_id: repId,
    });

    const results = await globalSearch('RepOwned', { userId: repId, role: 'rep' });
    expect(results.contacts).toHaveLength(1);
  });

  it('admin sees all contacts regardless of owner', async () => {
    await createContact({
      first_name: 'AdminVisible',
      last_name: 'One',
      email: 'adminvisible1@example.com',
      owner_id: repId,
    });
    await createContact({
      first_name: 'AdminVisible',
      last_name: 'Two',
      email: 'adminvisible2@example.com',
      owner_id: adminId,
    });

    const results = await globalSearch('AdminVisible', { userId: adminId, role: 'admin' });
    expect(results.contacts).toHaveLength(2);
  });
});

describe('globalSearch — accounts', () => {
  it('returns an account matching by name', async () => {
    await createAccount({ name: 'Unique Account Findme', owner_id: adminId });

    const results = await globalSearch('Findme', { userId: adminId, role: 'admin' });
    expect(results.accounts.some((a) => a.name === 'Unique Account Findme')).toBe(true);
  });

  it('supports partial matching on account name', async () => {
    await createAccount({ name: 'Acme Corporation', owner_id: adminId });

    const results = await globalSearch('Acm', { userId: adminId, role: 'admin' });
    expect(results.accounts.some((a) => a.name === 'Acme Corporation')).toBe(true);
  });

  it('does not return accounts owned by others when role is rep', async () => {
    await createAccount({ name: 'RepHidden Account', owner_id: adminId });

    const results = await globalSearch('RepHidden', { userId: repId, role: 'rep' });
    expect(results.accounts).toHaveLength(0);
  });
});

describe('globalSearch — deals', () => {
  it('returns a deal matching by name', async () => {
    await createDeal({
      name: 'Unique Deal Findme',
      stage: 'Prospecting',
      account_id: accountId,
      owner_id: adminId,
    });

    const results = await globalSearch('Findme', { userId: adminId, role: 'admin' });
    expect(results.deals.some((d) => d.name === 'Unique Deal Findme')).toBe(true);
  });

  it('does not return deals owned by others when role is rep', async () => {
    await createDeal({
      name: 'RepHidden Deal',
      stage: 'Prospecting',
      account_id: accountId,
      owner_id: adminId,
    });

    const results = await globalSearch('RepHidden', { userId: repId, role: 'rep' });
    expect(results.deals).toHaveLength(0);
  });
});

describe('globalSearch — multi-entity', () => {
  it('returns results across all three entity types in a single call', async () => {
    const suffix = 'MultiEntity';
    await createContact({
      first_name: suffix,
      last_name: 'Contact',
      email: `multientity@example.com`,
      owner_id: adminId,
    });
    await createAccount({ name: `${suffix} Account`, owner_id: adminId });
    await createDeal({
      name: `${suffix} Deal`,
      stage: 'Prospecting',
      account_id: accountId,
      owner_id: adminId,
    });

    const results = await globalSearch(suffix, { userId: adminId, role: 'admin' });
    expect(results.contacts.length).toBeGreaterThanOrEqual(1);
    expect(results.accounts.length).toBeGreaterThanOrEqual(1);
    expect(results.deals.length).toBeGreaterThanOrEqual(1);
  });
});

describe('globalSearch — special characters', () => {
  it("handles apostrophes in names without error (e.g., O'Brien)", async () => {
    await createContact({
      first_name: "O'Brien",
      last_name: 'Test',
      email: 'obrien@example.com',
      owner_id: adminId,
    });

    const results = await globalSearch("O'Brien", { userId: adminId, role: 'admin' });
    expect(results.contacts).toHaveLength(1);
  });

  it('handles ampersands in account names without error', async () => {
    await createAccount({ name: 'Smith & Co', owner_id: adminId });

    const results = await globalSearch('Smith & Co', { userId: adminId, role: 'admin' });
    expect(results.accounts.some((a) => a.name === 'Smith & Co')).toBe(true);
  });

  it('handles a very long query without error', async () => {
    const longQuery = 'a'.repeat(500);
    await expect(
      globalSearch(longQuery, { userId: adminId, role: 'admin' }),
    ).resolves.toBeDefined();
  });

  it('treats % as a literal character, not a wildcard', async () => {
    await createContact({
      first_name: 'Percent',
      last_name: 'Test',
      email: 'percent@example.com',
      owner_id: adminId,
    });

    // Searching for '%' should not match 'Percent' — it must be escaped
    const results = await globalSearch('%', { userId: adminId, role: 'admin' });
    expect(results.contacts.some((c) => c.first_name === 'Percent')).toBe(false);
  });

  it('treats _ as a literal character, not a single-character wildcard', async () => {
    await createContact({
      first_name: 'Underscore',
      last_name: 'Test',
      email: 'underscore@example.com',
      owner_id: adminId,
    });
    await createContact({
      first_name: 'AB',
      last_name: 'Test',
      email: 'ab@example.com',
      owner_id: adminId,
    });

    // Searching '_B' should not match 'AB' (single-char wildcard) when properly escaped
    const results = await globalSearch('_B', { userId: adminId, role: 'admin' });
    expect(results.contacts.some((c) => c.first_name === 'AB')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MINCRM-207 — expanded field coverage
// ---------------------------------------------------------------------------

describe('globalSearch — contacts expanded fields (MINCRM-207)', () => {
  it('returns a contact matching by phone number', async () => {
    await createContact({
      first_name: 'Phone',
      last_name: 'Matcher',
      email: 'phonematcher@example.com',
      phone: '555-867-5309',
      owner_id: adminId,
    });

    const results = await globalSearch('867-5309', { userId: adminId, role: 'admin' });
    expect(results.contacts.some((c) => c.email === 'phonematcher@example.com')).toBe(true);
  });

  it('returns a contact matching by title', async () => {
    await createContact({
      first_name: 'Title',
      last_name: 'Matcher',
      email: 'titlematcher@example.com',
      title: 'VP of Engineering',
      owner_id: adminId,
    });

    const results = await globalSearch('VP of Engineering', { userId: adminId, role: 'admin' });
    expect(results.contacts.some((c) => c.email === 'titlematcher@example.com')).toBe(true);
  });

  it('returns a contact matching by department', async () => {
    await createContact({
      first_name: 'Dept',
      last_name: 'Matcher',
      email: 'deptmatcher@example.com',
      department: 'UniqueSearchDepartment',
      owner_id: adminId,
    });

    const results = await globalSearch('UniqueSearchDepartment', {
      userId: adminId,
      role: 'admin',
    });
    expect(results.contacts.some((c) => c.email === 'deptmatcher@example.com')).toBe(true);
  });

  it('returns a contact matching by inline city field', async () => {
    await createContact({
      first_name: 'City',
      last_name: 'InlineMatcher',
      email: 'cityinlinematcher@example.com',
      city: 'UniqueInlineCity',
      owner_id: adminId,
    });

    const results = await globalSearch('UniqueInlineCity', { userId: adminId, role: 'admin' });
    expect(results.contacts.some((c) => c.email === 'cityinlinematcher@example.com')).toBe(true);
  });

  it('returns a contact matching by city in contact_addresses and deduplicates', async () => {
    const contact = await createContact({
      first_name: 'City',
      last_name: 'AddrMatcher',
      email: 'cityaddrm@example.com',
      owner_id: adminId,
    });

    await pool.query(
      `INSERT INTO contact_addresses (contact_id, label, city, is_default)
       VALUES ($1, 'Work', 'UniqueAddrCityXYZ', true)`,
      [contact.id],
    );

    const results = await globalSearch('UniqueAddrCityXYZ', { userId: adminId, role: 'admin' });
    const matches = results.contacts.filter((c) => c.id === contact.id);
    expect(matches).toHaveLength(1);
  });

  it('returns a contact matching by postal_code in contact_addresses', async () => {
    const contact = await createContact({
      first_name: 'Zip',
      last_name: 'AddrMatcher',
      email: 'zipaddrm@example.com',
      owner_id: adminId,
    });

    await pool.query(
      `INSERT INTO contact_addresses (contact_id, label, postal_code, city, is_default)
       VALUES ($1, 'Home', '99887', 'SomeCity', true)`,
      [contact.id],
    );

    const results = await globalSearch('99887', { userId: adminId, role: 'admin' });
    expect(results.contacts.some((c) => c.id === contact.id)).toBe(true);
  });

  it('does not duplicate a contact that matches via multiple contact_addresses rows', async () => {
    // Both address rows for the same contact match the query — DISTINCT ensures one result. (MINCRM-500)
    const contact = await createContact({
      first_name: 'NoDup',
      last_name: 'CityTest',
      email: 'nodupCity@example.com',
      owner_id: adminId,
    });

    await pool.query(
      `INSERT INTO contact_addresses (contact_id, label, city, is_default)
       VALUES ($1, 'Home', 'SharedCityValue', true)`,
      [contact.id],
    );
    await pool.query(
      `INSERT INTO contact_addresses (contact_id, label, city, is_default)
       VALUES ($1, 'Work', 'SharedCityValue', false)`,
      [contact.id],
    );

    const results = await globalSearch('SharedCityValue', { userId: adminId, role: 'admin' });
    const matches = results.contacts.filter((c) => c.id === contact.id);
    expect(matches).toHaveLength(1);
  });
});

describe('globalSearch — accounts expanded fields (MINCRM-207)', () => {
  it('returns an account matching by industry', async () => {
    await createAccount({
      name: 'IndustrySearchCo',
      industry: 'UniqueIndustrySector',
      owner_id: adminId,
    });

    const results = await globalSearch('UniqueIndustrySector', { userId: adminId, role: 'admin' });
    expect(results.accounts.some((a) => a.name === 'IndustrySearchCo')).toBe(true);
  });

  it('returns an account matching by website', async () => {
    await createAccount({
      name: 'WebsiteSearchCo',
      website: 'uniquedomain-xyz.com',
      owner_id: adminId,
    });

    const results = await globalSearch('uniquedomain-xyz', { userId: adminId, role: 'admin' });
    expect(results.accounts.some((a) => a.name === 'WebsiteSearchCo')).toBe(true);
  });
});

describe('globalSearch — deals expanded fields (MINCRM-207)', () => {
  it('returns a deal matching by loss_reason', async () => {
    const deal = await createDeal({
      name: 'LostToCompetitorDeal',
      stage: 'Closed Lost',
      account_id: accountId,
      owner_id: adminId,
    });
    await pool.query(`UPDATE deals SET loss_reason = 'lost to a direct competitor' WHERE id = $1`, [
      deal.id,
    ]);

    const results = await globalSearch('direct competitor', { userId: adminId, role: 'admin' });
    expect(results.deals.some((d) => d.name === 'LostToCompetitorDeal')).toBe(true);
  });

  it('returns a deal matching by currency code', async () => {
    await createDeal({
      name: 'GBPDeal',
      stage: 'Prospecting',
      account_id: accountId,
      owner_id: adminId,
      currency: 'GBP',
    });

    const results = await globalSearch('GBP', { userId: adminId, role: 'admin' });
    expect(results.deals.some((d) => d.name === 'GBPDeal')).toBe(true);
  });

  it('returns a deal matching by raw numeric value', async () => {
    await createDeal({
      name: 'ValueRawDeal',
      stage: 'Prospecting',
      account_id: accountId,
      owner_id: adminId,
      value: 120000,
    });

    const results = await globalSearch('120000', { userId: adminId, role: 'admin' });
    expect(results.deals.some((d) => d.name === 'ValueRawDeal')).toBe(true);
  });

  it('returns a deal matching by comma-formatted value', async () => {
    await createDeal({
      name: 'ValueCommaDeal',
      stage: 'Prospecting',
      account_id: accountId,
      owner_id: adminId,
      value: 120000,
    });

    const results = await globalSearch('120,000', { userId: adminId, role: 'admin' });
    expect(results.deals.some((d) => d.name === 'ValueCommaDeal')).toBe(true);
  });

  it('returns a deal matching by dollar-prefixed comma-formatted value', async () => {
    await createDeal({
      name: 'ValueDollarDeal',
      stage: 'Prospecting',
      account_id: accountId,
      owner_id: adminId,
      value: 120000,
    });

    const results = await globalSearch('$120,000', { userId: adminId, role: 'admin' });
    expect(results.deals.some((d) => d.name === 'ValueDollarDeal')).toBe(true);
  });
});

describe('globalSearch — leads (MINCRM-207)', () => {
  it('returns a lead matching by notes', async () => {
    await createLead({
      first_name: 'Notes',
      last_name: 'LeadPerson',
      email: 'noteslead@example.com',
      notes: 'uniqueLeadNoteContent',
      owner_id: adminId,
    });

    const results = await globalSearch('uniqueLeadNoteContent', { userId: adminId, role: 'admin' });
    expect(results.leads.some((l) => l.email === 'noteslead@example.com')).toBe(true);
  });

  it('returns a lead matching by disqualification_reason', async () => {
    await createLead({
      first_name: 'DisqLead',
      last_name: 'Person',
      email: 'disqlead@example.com',
      owner_id: adminId,
    });
    await pool.query(
      `UPDATE leads SET status = 'Disqualified', disqualification_reason = 'tooSmallBudgetXYZ' WHERE email = 'disqlead@example.com'`,
    );

    const results = await globalSearch('tooSmallBudgetXYZ', { userId: adminId, role: 'admin' });
    expect(results.leads.some((l) => l.email === 'disqlead@example.com')).toBe(true);
  });

  it('returns a lead matching by phone', async () => {
    await createLead({
      first_name: 'PhoneLead',
      last_name: 'Person',
      email: 'phonelead@example.com',
      phone: '555-111-2222',
      owner_id: adminId,
    });

    const results = await globalSearch('111-2222', { userId: adminId, role: 'admin' });
    expect(results.leads.some((l) => l.email === 'phonelead@example.com')).toBe(true);
  });

  it('returns a lead matching by company_name', async () => {
    await createLead({
      first_name: 'CompanyLead',
      last_name: 'Person',
      email: 'companylead@example.com',
      company_name: 'UniqueLeadCorp',
      owner_id: adminId,
    });

    const results = await globalSearch('UniqueLeadCorp', { userId: adminId, role: 'admin' });
    expect(results.leads.some((l) => l.email === 'companylead@example.com')).toBe(true);
  });

  it('does not return leads owned by others when role is rep', async () => {
    await createLead({
      first_name: 'OtherOwnerLead',
      last_name: 'Person',
      email: 'otherlead@example.com',
      owner_id: adminId,
    });

    const results = await globalSearch('OtherOwnerLead', { userId: repId, role: 'rep' });
    expect(results.leads).toHaveLength(0);
  });
});

describe('globalSearch — activities (MINCRM-207)', () => {
  it('searching an activity subject returns the linked contact', async () => {
    const contact = await createContact({
      first_name: 'ActivityContact',
      last_name: 'SubjectTest',
      email: 'activitycontact@example.com',
      owner_id: adminId,
    });

    await createActivity({
      type: 'Call',
      subject: 'UniqueActivitySubjectZZZ',
      contact_id: contact.id,
      owner_id: adminId,
    });

    const results = await globalSearch('UniqueActivitySubjectZZZ', {
      userId: adminId,
      role: 'admin',
    });
    expect(results.contacts.some((c) => c.id === contact.id)).toBe(true);
  });

  it('searching activity notes returns the linked contact', async () => {
    const contact = await createContact({
      first_name: 'ActivityNotesContact',
      last_name: 'Test',
      email: 'activitynotes@example.com',
      owner_id: adminId,
    });

    await createActivity({
      type: 'Note',
      subject: 'Follow up',
      notes: 'UniqueActivityNotesContent',
      contact_id: contact.id,
      owner_id: adminId,
    });

    const results = await globalSearch('UniqueActivityNotesContent', {
      userId: adminId,
      role: 'admin',
    });
    expect(results.contacts.some((c) => c.id === contact.id)).toBe(true);
  });

  it('searching activity outcome returns the linked account', async () => {
    const acct = await createAccount({ name: 'ActivityOutcomeAccount', owner_id: adminId });

    await createActivity({
      type: 'Meeting',
      subject: 'Quarterly review',
      outcome: 'UniqueOutcomeValueXYZ',
      account_id: acct.id,
      owner_id: adminId,
    });

    const results = await globalSearch('UniqueOutcomeValueXYZ', { userId: adminId, role: 'admin' });
    expect(results.accounts.some((a) => a.id === acct.id)).toBe(true);
  });

  it('searching activity subject returns the linked deal', async () => {
    const deal = await createDeal({
      name: 'ActivityDealLink',
      stage: 'Prospecting',
      account_id: accountId,
      owner_id: adminId,
    });

    await createActivity({
      type: 'Task',
      subject: 'UniqueDealActivitySubjectABC',
      deal_id: deal.id,
      owner_id: adminId,
    });

    const results = await globalSearch('UniqueDealActivitySubjectABC', {
      userId: adminId,
      role: 'admin',
    });
    expect(results.deals.some((d) => d.id === deal.id)).toBe(true);
  });

  it('a contact matching by name AND activity appears only once in contacts', async () => {
    const contact = await createContact({
      first_name: 'NoDupActivityContact',
      last_name: 'Test',
      email: 'nodupactivity@example.com',
      owner_id: adminId,
    });

    await createActivity({
      type: 'Call',
      subject: 'NoDupActivityContact call',
      contact_id: contact.id,
      owner_id: adminId,
    });

    const results = await globalSearch('NoDupActivityContact', { userId: adminId, role: 'admin' });
    const matches = results.contacts.filter((c) => c.id === contact.id);
    expect(matches).toHaveLength(1);
  });
});

describe('globalSearch — tags (MINCRM-207)', () => {
  it('searching a tag name returns contacts carrying that tag', async () => {
    const contact = await createContact({
      first_name: 'TagContact',
      last_name: 'Person',
      email: 'tagcontact@example.com',
      owner_id: adminId,
    });
    await attachTag('contact', contact.id, { name: `${FILE_PREFIX}-vip-search-tag` });

    const results = await globalSearch(`${FILE_PREFIX}-vip-search-tag`, {
      userId: adminId,
      role: 'admin',
    });
    expect(results.contacts.some((c) => c.id === contact.id)).toBe(true);
  });

  it('searching a tag name returns accounts carrying that tag', async () => {
    const acct = await createAccount({ name: 'TagAccount', owner_id: adminId });
    await attachTag('account', acct.id, { name: `${FILE_PREFIX}-key-acct-search-tag` });

    const results = await globalSearch(`${FILE_PREFIX}-key-acct-search-tag`, {
      userId: adminId,
      role: 'admin',
    });
    expect(results.accounts.some((a) => a.id === acct.id)).toBe(true);
  });

  it('searching a tag name returns deals carrying that tag', async () => {
    const deal = await createDeal({
      name: 'TagDeal',
      stage: 'Prospecting',
      account_id: accountId,
      owner_id: adminId,
    });
    await attachTag('deal', deal.id, { name: `${FILE_PREFIX}-enterprise-search-tag` });

    const results = await globalSearch(`${FILE_PREFIX}-enterprise-search-tag`, {
      userId: adminId,
      role: 'admin',
    });
    expect(results.deals.some((d) => d.id === deal.id)).toBe(true);
  });

  it('a contact matching by name AND tag appears only once', async () => {
    const contact = await createContact({
      first_name: 'NoDupTagContact',
      last_name: 'Person',
      email: `${FILE_PREFIX}-noduptagcontact@example.com`,
      owner_id: adminId,
    });
    await attachTag('contact', contact.id, { name: `${FILE_PREFIX}-NoDupTagContact` });

    const results = await globalSearch(`${FILE_PREFIX}-NoDupTagContact`, {
      userId: adminId,
      role: 'admin',
    });
    const matches = results.contacts.filter((c) => c.id === contact.id);
    expect(matches).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// MINCRM-362 — notes body_text search
// ---------------------------------------------------------------------------

/** Minimal Tiptap/ProseMirror doc JSON with the given plain text as a paragraph node.
 *  extractBodyText() walks `content` arrays looking for type=text nodes. */
function makeNoteDoc(text: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
}

describe('globalSearch — notes body_text (MINCRM-362)', () => {
  it('returns a contact that has a matching team note', async () => {
    const contact = await createContact({
      first_name: 'NoteSearch',
      last_name: 'ContactNote',
      email: `${FILE_PREFIX}-notesearch-contact@example.com`,
      owner_id: adminId,
    });
    await createNote(
      'contact',
      contact.id,
      {
        body: makeNoteDoc('uniqueContactNoteBodyText'),
        visibility: 'team',
        tags: [],
      },
      { id: adminId, name: 'Search Admin' },
    );

    const results = await globalSearch('uniqueContactNoteBodyText', {
      userId: adminId,
      role: 'admin',
    });
    expect(results.contacts.some((c) => c.id === contact.id)).toBe(true);
  });

  it('returns an account that has a matching team note', async () => {
    const account = await createAccount({ name: 'NoteSearchAccount', owner_id: adminId });
    await createNote(
      'account',
      account.id,
      {
        body: makeNoteDoc('uniqueAccountNoteBodyText'),
        visibility: 'team',
        tags: [],
      },
      { id: adminId, name: 'Search Admin' },
    );

    const results = await globalSearch('uniqueAccountNoteBodyText', {
      userId: adminId,
      role: 'admin',
    });
    expect(results.accounts.some((a) => a.id === account.id)).toBe(true);
  });

  it('returns a deal that has a matching team note', async () => {
    const deal = await createDeal({
      name: 'NoteSearchDeal',
      stage: 'Prospecting',
      account_id: accountId,
      owner_id: adminId,
    });
    await createNote(
      'deal',
      deal.id,
      {
        body: makeNoteDoc('uniqueDealNoteBodyText'),
        visibility: 'team',
        tags: [],
      },
      { id: adminId, name: 'Search Admin' },
    );

    const results = await globalSearch('uniqueDealNoteBodyText', {
      userId: adminId,
      role: 'admin',
    });
    expect(results.deals.some((d) => d.id === deal.id)).toBe(true);
  });

  it('returns a lead that has a matching team note', async () => {
    const lead = await createLead({
      first_name: 'NoteSearch',
      last_name: 'LeadNote',
      email: `${FILE_PREFIX}-notesearch-lead@example.com`,
      owner_id: adminId,
    });
    await createNote(
      'lead',
      lead.id,
      {
        body: makeNoteDoc('uniqueLeadNoteBodyText'),
        visibility: 'team',
        tags: [],
      },
      { id: adminId, name: 'Search Admin' },
    );

    const results = await globalSearch('uniqueLeadNoteBodyText', {
      userId: adminId,
      role: 'admin',
    });
    expect(results.leads.some((l) => l.id === lead.id)).toBe(true);
  });

  it('excludes a private note from search results for a non-author user', async () => {
    const contact = await createContact({
      first_name: 'PrivateNote',
      last_name: 'NonAuthor',
      email: `${FILE_PREFIX}-privatenote-nonauth@example.com`,
      owner_id: adminId,
    });
    // Admin creates a private note; rep searches — rep should not see the contact via that note.
    await createNote(
      'contact',
      contact.id,
      {
        body: makeNoteDoc('uniquePrivateNoteForNonAuthor'),
        visibility: 'private',
        tags: [],
      },
      { id: adminId, name: 'Search Admin' },
    );

    const results = await globalSearch('uniquePrivateNoteForNonAuthor', {
      userId: repId,
      role: 'rep',
    });
    expect(results.contacts.some((c) => c.id === contact.id)).toBe(false);
  });

  it('includes a private note in search results for the note author', async () => {
    const contact = await createContact({
      first_name: 'PrivateNote',
      last_name: 'Author',
      email: `${FILE_PREFIX}-privatenote-author@example.com`,
      owner_id: adminId,
    });
    await createNote(
      'contact',
      contact.id,
      {
        body: makeNoteDoc('uniquePrivateNoteForAuthor'),
        visibility: 'private',
        tags: [],
      },
      { id: adminId, name: 'Search Admin' },
    );

    const results = await globalSearch('uniquePrivateNoteForAuthor', {
      userId: adminId,
      role: 'admin',
    });
    expect(results.contacts.some((c) => c.id === contact.id)).toBe(true);
  });

  it('excludes a soft-deleted note from search results', async () => {
    const contact = await createContact({
      first_name: 'DeletedNote',
      last_name: 'Excluded',
      email: `${FILE_PREFIX}-deletednote@example.com`,
      owner_id: adminId,
    });
    const note = await createNote(
      'contact',
      contact.id,
      {
        body: makeNoteDoc('uniqueDeletedNoteBodyText'),
        visibility: 'team',
        tags: [],
      },
      { id: adminId, name: 'Search Admin' },
    );

    // Soft-delete the note directly in the DB (matches what deleteNote() does).
    await pool.query('UPDATE notes SET deleted_at = now() WHERE id = $1', [note.id]);

    const results = await globalSearch('uniqueDeletedNoteBodyText', {
      userId: adminId,
      role: 'admin',
    });
    // Contact should NOT appear — the only match was the deleted note.
    // The contact's own fields don't match the unique search term.
    expect(results.contacts.some((c) => c.id === contact.id)).toBe(false);
  });

  it('returns a contact exactly once when matched by both its own fields and a note', async () => {
    const uniqueTerm = 'NoDupNoteAndField';
    const contact = await createContact({
      first_name: uniqueTerm,
      last_name: 'DedupTest',
      email: `${FILE_PREFIX}-nodupnote@example.com`,
      owner_id: adminId,
    });
    await createNote(
      'contact',
      contact.id,
      {
        body: makeNoteDoc(uniqueTerm),
        visibility: 'team',
        tags: [],
      },
      { id: adminId, name: 'Search Admin' },
    );

    const results = await globalSearch(uniqueTerm, { userId: adminId, role: 'admin' });
    const matches = results.contacts.filter((c) => c.id === contact.id);
    expect(matches).toHaveLength(1);
  });
});
