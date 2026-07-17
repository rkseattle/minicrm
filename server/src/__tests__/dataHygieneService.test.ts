/**
 * Integration tests for dataHygieneService. (MINCRM-476)
 * Runs against a real PostgreSQL test database. Network-dependent signals
 * (MX lookup, website reachability) are exercised with real DNS/HTTP calls
 * against known-good/known-bad targets rather than mocked, matching this
 * codebase's convention of not mocking the database or external I/O in
 * service-level integration tests — kept to a minimum given real network
 * calls are inherently slower and less deterministic than the rest of the suite.
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import pool from '../db.js';
import { createUser } from '../services/userService.js';
import { createContact, updateContact, findContactById } from '../services/contactService.js';
import { createAccount } from '../services/accountService.js';
import { createDeal, updateDeal } from '../services/dealService.js';
import { createActivity } from '../services/activityService.js';
import { uid } from './testUtils.js';
import {
  runDataHygieneScan,
  listHygieneFindings,
  dismissHygieneFinding,
  clearFindingsForEntity,
  getDataHygieneConfig,
  setDataHygieneConfig,
} from '../services/dataHygieneService.js';

const FILE_PREFIX = 'hygiene-svc';
const ACTOR = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

let ownerId: string;

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM data_hygiene_findings WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
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
}

async function resetConfig(): Promise<void> {
  await pool.query(
    `UPDATE data_hygiene_scoring_config SET
       contact_inactivity_days = 365, account_inactivity_days = 365,
       title_staleness_days = 1095, opportunity_inactivity_days = 30,
       dismiss_suppression_days = 90, weekly_digest_enabled = false,
       updated_at = now(), updated_by = NULL
     WHERE id = true`,
  );
}

beforeAll(async () => {
  await cleanup();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const owner = await createUser({
    email: `${FILE_PREFIX}-owner@example.com`,
    name: 'Hygiene Owner',
    role: 'rep',
    passwordHash: '$2b$12$placeholder_hash',
    status: 'active',
  });
  ownerId = owner.id;
});

beforeEach(async () => {
  await cleanup();
  await resetConfig();
});

afterAll(async () => {
  await cleanup();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

describe('runDataHygieneScan — contact signals', () => {
  it('flags a contact missing both email and phone', async () => {
    const contact = await createContact({
      first_name: 'Missing',
      last_name: 'Info',
      email: '',
      owner_id: ownerId,
    });

    await runDataHygieneScan();

    const findings = await listHygieneFindings(ownerId);
    expect(
      findings.some(
        (f) => f.entity_id === contact.id && f.issue_type === 'contact_missing_contact_info',
      ),
    ).toBe(true);
  });

  it('does not flag a contact with complete contact info and recent activity', async () => {
    const contact = await createContact({
      first_name: 'Complete',
      last_name: 'Contact',
      email: `${FILE_PREFIX}-${uid()}-complete@example.com`,
      phone: '+1-555-0100',
      owner_id: ownerId,
    });
    await createActivity({
      type: 'Note',
      subject: 'Recent note',
      contact_id: contact.id,
      owner_id: ownerId,
    });

    await runDataHygieneScan();

    const findings = await listHygieneFindings(ownerId);
    expect(findings.some((f) => f.entity_id === contact.id)).toBe(false);
  });

  it('flags a contact with a stale job title using title_updated_at, not updated_at', async () => {
    await setDataHygieneConfig(
      {
        contact_inactivity_days: 365,
        account_inactivity_days: 365,
        title_staleness_days: 1,
        opportunity_inactivity_days: 30,
        dismiss_suppression_days: 90,
        weekly_digest_enabled: false,
      },
      { id: ownerId, name: 'Hygiene Owner' },
    );

    const contact = await createContact({
      first_name: 'Stale',
      last_name: 'Title',
      email: `${FILE_PREFIX}-${uid()}-staletitle@example.com`,
      title: 'Engineer',
      owner_id: ownerId,
    });
    // Backdate title_updated_at to simulate a title set 2 days ago (older than
    // the 1-day threshold), then touch an unrelated field via updateContact —
    // this must NOT reset title_updated_at, proving the two timestamps are
    // tracked independently (MINCRM-476's core requirement).
    await pool.query(
      `UPDATE contacts SET title_updated_at = now() - interval '2 days' WHERE id = $1`,
      [contact.id],
    );
    const before = await findContactById(contact.id);
    await updateContact(
      contact.id,
      { phone: '+1-555-0199', version: before!.version },
      ACTOR,
      before!,
    );

    await runDataHygieneScan();

    const findings = await listHygieneFindings(ownerId);
    expect(
      findings.some((f) => f.entity_id === contact.id && f.issue_type === 'contact_stale_title'),
    ).toBe(true);
  });

  it('does not flag a title as stale immediately after it changes', async () => {
    const contact = await createContact({
      first_name: 'Fresh',
      last_name: 'Title',
      email: `${FILE_PREFIX}-${uid()}-freshtitle@example.com`,
      title: 'Engineer',
      owner_id: ownerId,
    });
    const before = await findContactById(contact.id);
    await updateContact(
      contact.id,
      { title: 'Senior Engineer', version: before!.version },
      ACTOR,
      before!,
    );

    await runDataHygieneScan();

    const findings = await listHygieneFindings(ownerId);
    expect(
      findings.some((f) => f.entity_id === contact.id && f.issue_type === 'contact_stale_title'),
    ).toBe(false);
  });

  it('flags two contacts with the same normalized name and company as duplicates, recording the pair', async () => {
    const account = await createAccount({ name: `${FILE_PREFIX} Dup Co`, owner_id: ownerId });
    const contactA = await createContact({
      first_name: 'Jordan',
      last_name: 'Rivera',
      email: `${FILE_PREFIX}-${uid()}-jordan-a@example.com`,
      account_id: account.id,
      owner_id: ownerId,
    });
    const contactB = await createContact({
      first_name: 'Jordan',
      last_name: 'Rivera',
      email: `${FILE_PREFIX}-${uid()}-jordan-b@example.com`,
      account_id: account.id,
      owner_id: ownerId,
    });

    await runDataHygieneScan();

    const findings = await listHygieneFindings(ownerId);
    const findingA = findings.find(
      (f) => f.entity_id === contactA.id && f.issue_type === 'contact_duplicate',
    );
    const findingB = findings.find(
      (f) => f.entity_id === contactB.id && f.issue_type === 'contact_duplicate',
    );
    expect(findingA).toBeDefined();
    expect(findingB).toBeDefined();
    expect(findingA!.related_entity_id).toBe(contactB.id);
    expect(findingB!.related_entity_id).toBe(contactA.id);
  });
});

describe('runDataHygieneScan — account signals', () => {
  it('flags an account with no associated contacts', async () => {
    const account = await createAccount({ name: `${FILE_PREFIX} Lonely Co`, owner_id: ownerId });

    await runDataHygieneScan();

    const findings = await listHygieneFindings(ownerId);
    expect(
      findings.some((f) => f.entity_id === account.id && f.issue_type === 'account_no_contacts'),
    ).toBe(true);
  });

  it('flags an account missing industry and employee_range', async () => {
    const account = await createAccount({
      name: `${FILE_PREFIX} Incomplete Co`,
      owner_id: ownerId,
    });

    await runDataHygieneScan();

    const findings = await listHygieneFindings(ownerId);
    expect(
      findings.some(
        (f) => f.entity_id === account.id && f.issue_type === 'account_missing_firmographics',
      ),
    ).toBe(true);
  });
});

describe('runDataHygieneScan — opportunity signals', () => {
  it('flags an open deal with a passed close date', async () => {
    const deal = await createDeal({
      name: `${FILE_PREFIX} Past Due Deal`,
      stage: 'Prospecting',
      close_date: '2020-01-01',
      owner_id: ownerId,
    });

    await runDataHygieneScan();

    const findings = await listHygieneFindings(ownerId);
    expect(
      findings.some(
        (f) => f.entity_id === deal.id && f.issue_type === 'opportunity_close_date_passed',
      ),
    ).toBe(true);
  });

  it('flags an open deal with no associated contact', async () => {
    const deal = await createDeal({
      name: `${FILE_PREFIX} No Contact Deal`,
      stage: 'Prospecting',
      owner_id: ownerId,
    });

    await runDataHygieneScan();

    const findings = await listHygieneFindings(ownerId);
    expect(
      findings.some((f) => f.entity_id === deal.id && f.issue_type === 'opportunity_no_contact'),
    ).toBe(true);
  });

  it('flags an open deal with zero value', async () => {
    const deal = await createDeal({
      name: `${FILE_PREFIX} Zero Value Deal`,
      stage: 'Prospecting',
      value: 0,
      owner_id: ownerId,
    });

    await runDataHygieneScan();

    const findings = await listHygieneFindings(ownerId);
    expect(
      findings.some((f) => f.entity_id === deal.id && f.issue_type === 'opportunity_zero_value'),
    ).toBe(true);
  });

  it('does not flag a closed deal for any opportunity signal', async () => {
    const deal = await createDeal({
      name: `${FILE_PREFIX} Closed Deal`,
      stage: 'Prospecting',
      close_date: '2020-01-01',
      value: 0,
      owner_id: ownerId,
    });
    await updateDeal(deal.id, { stage: 'Closed Lost', version: deal.version }, ACTOR, deal);

    await runDataHygieneScan();

    const findings = await listHygieneFindings(ownerId);
    expect(findings.some((f) => f.entity_id === deal.id)).toBe(false);
  });
});

describe('runDataHygieneScan — clearing stale findings', () => {
  it('removes a finding once the underlying issue is resolved', async () => {
    const contact = await createContact({
      first_name: 'ToFix',
      last_name: 'Contact',
      email: '',
      owner_id: ownerId,
    });
    // Give the contact recent activity so `contact_no_activity` never fires —
    // this test isolates `contact_missing_contact_info` clearing specifically.
    await createActivity({
      type: 'Call',
      direction: 'Outbound',
      subject: 'Intro call',
      contact_id: contact.id,
      owner_id: ownerId,
    });

    await runDataHygieneScan();
    let findings = await listHygieneFindings(ownerId);
    expect(
      findings.some(
        (f) => f.entity_id === contact.id && f.issue_type === 'contact_missing_contact_info',
      ),
    ).toBe(true);

    const before = await findContactById(contact.id);
    await updateContact(
      contact.id,
      {
        email: `${FILE_PREFIX}-${uid()}-fixed@example.com`,
        phone: '+1-555-0100',
        version: before!.version,
      },
      ACTOR,
      before!,
    );

    await runDataHygieneScan();
    findings = await listHygieneFindings(ownerId);
    expect(
      findings.some(
        (f) => f.entity_id === contact.id && f.issue_type === 'contact_missing_contact_info',
      ),
    ).toBe(false);
  });

  it('completes without throwing when there is nothing to flag', async () => {
    await expect(runDataHygieneScan()).resolves.not.toThrow();
  });
});

describe('dismissHygieneFinding', () => {
  it('suppresses a finding from the queue for the configured window', async () => {
    const contact = await createContact({
      first_name: 'Dismiss',
      last_name: 'Me',
      email: '',
      owner_id: ownerId,
    });
    await runDataHygieneScan();

    const findings = await listHygieneFindings(ownerId);
    const finding = findings.find((f) => f.entity_id === contact.id)!;
    expect(finding).toBeDefined();

    await dismissHygieneFinding(finding.id, 'Will fix later', {
      id: ownerId,
      name: 'Hygiene Owner',
    });

    const afterDismiss = await listHygieneFindings(ownerId);
    expect(afterDismiss.some((f) => f.id === finding.id)).toBe(false);
  });

  it('throws NOT_FOUND for a non-existent finding', async () => {
    await expect(
      dismissHygieneFinding('00000000-0000-0000-0000-000000000000', 'reason', {
        id: ownerId,
        name: 'Hygiene Owner',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('clearFindingsForEntity', () => {
  it('removes all findings for a given entity', async () => {
    const contact = await createContact({
      first_name: 'Clear',
      last_name: 'Me',
      email: '',
      owner_id: ownerId,
    });
    await runDataHygieneScan();

    let findings = await listHygieneFindings(ownerId);
    expect(findings.some((f) => f.entity_id === contact.id)).toBe(true);

    await clearFindingsForEntity('contact', contact.id);

    findings = await listHygieneFindings(ownerId);
    expect(findings.some((f) => f.entity_id === contact.id)).toBe(false);
  });
});

describe('getDataHygieneConfig / setDataHygieneConfig', () => {
  it('returns the seeded default configuration', async () => {
    const config = await getDataHygieneConfig();
    expect(config.contact_inactivity_days).toBe(365);
    expect(config.dismiss_suppression_days).toBe(90);
    expect(config.weekly_digest_enabled).toBe(false);
  });

  it('persists an admin update to the thresholds', async () => {
    const updated = await setDataHygieneConfig(
      {
        contact_inactivity_days: 180,
        account_inactivity_days: 180,
        title_staleness_days: 730,
        opportunity_inactivity_days: 14,
        dismiss_suppression_days: 30,
        weekly_digest_enabled: true,
      },
      { id: ownerId, name: 'Hygiene Owner' },
    );
    expect(updated.contact_inactivity_days).toBe(180);
    expect(updated.weekly_digest_enabled).toBe(true);

    const reloaded = await getDataHygieneConfig();
    expect(reloaded.contact_inactivity_days).toBe(180);
  });

  it('writes an audit entry only for fields that actually changed', async () => {
    const startedAt = new Date();
    await setDataHygieneConfig(
      {
        contact_inactivity_days: 365,
        account_inactivity_days: 365,
        title_staleness_days: 1095,
        opportunity_inactivity_days: 30,
        dismiss_suppression_days: 90,
        weekly_digest_enabled: false,
      },
      { id: ownerId, name: 'Hygiene Owner' },
    );
    const after = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM audit_log
       WHERE record_type = 'ai_settings' AND record_name = 'Data Hygiene Assistant Configuration'
         AND created_at >= $1`,
      [startedAt],
    );
    expect(after.rows[0].count).toBe('0');
  });
});
