/**
 * Integration tests for dataHygieneService, against a real PostgreSQL test
 * database. Fixtures use reserved domains, which the MX check skips, so these
 * do not depend on DNS; that logic is unit-tested in dataHygieneMxLookup.test.ts.
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
import { randomUUID } from 'node:crypto';
import { uid, countAuditRowsFor, expectActorScopingIsolatesForeignRows } from './testUtils.js';
import {
  runDataHygieneScan,
  listHygieneFindings,
  dismissHygieneFinding,
  clearFindingsForEntity,
  mergeDuplicateContactFindings,
  getDataHygieneConfig,
  setDataHygieneConfig,
} from '../services/dataHygieneService.js';

const FILE_PREFIX = 'hygiene-svc';
const ACTOR = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

/**
 * The record_name setDataHygieneConfig writes its audit rows under. Shared with
 * dataHygieneController.test.ts, which is why it cannot scope an assertion on
 * its own — see the audit-count tests below.
 */
const DATA_HYGIENE_CONFIG_RECORD_NAME = 'Data Hygiene Assistant Configuration';

let ownerId: string;
let otherOwnerId: string;

/** Counts this file's own config audit rows. See countAuditRowsFor. */
function countConfigAuditRows(actorId: string): Promise<number> {
  return countAuditRowsFor(pool, {
    recordType: 'ai_settings',
    recordName: DATA_HYGIENE_CONFIG_RECORD_NAME,
    actorId,
  });
}

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

  const otherOwner = await createUser({
    email: `${FILE_PREFIX}-other-owner@example.com`,
    name: 'Other Owner',
    role: 'rep',
    passwordHash: '$2b$12$placeholder_hash',
    status: 'active',
  });
  otherOwnerId = otherOwner.id;
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
    // tracked independently.
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

  it('keeps a dismissed finding when the scan no longer detects it', async () => {
    const contact = await createContact({
      first_name: 'Dismissed',
      last_name: 'Survivor',
      email: '',
      owner_id: ownerId,
    });
    await createActivity({
      type: 'Call',
      direction: 'Outbound',
      subject: 'Intro call',
      contact_id: contact.id,
      owner_id: ownerId,
    });

    await runDataHygieneScan();
    const open = (await listHygieneFindings(ownerId)).find(
      (f) => f.entity_id === contact.id && f.issue_type === 'contact_missing_contact_info',
    );
    expect(open).toBeDefined();
    await dismissHygieneFinding(open!.id, 'Known placeholder record', ACTOR, true);

    // Resolve the issue so the next scan stops detecting it.
    const before = await findContactById(contact.id);
    await updateContact(
      contact.id,
      {
        email: `${FILE_PREFIX}-${uid()}-dismissed@example.com`,
        phone: '+1-555-0142',
        version: before!.version,
      },
      ACTOR,
      before!,
    );
    await runDataHygieneScan();

    const row = await pool.query(`SELECT status FROM data_hygiene_findings WHERE id = $1`, [
      open!.id,
    ]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].status).toBe('dismissed');
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

    await dismissHygieneFinding(
      finding.id,
      'Will fix later',
      {
        id: ownerId,
        name: 'Hygiene Owner',
      },
      false,
    );

    const afterDismiss = await listHygieneFindings(ownerId);
    expect(afterDismiss.some((f) => f.id === finding.id)).toBe(false);
  });

  it('throws NOT_FOUND for a non-existent finding', async () => {
    await expect(
      dismissHygieneFinding(
        '00000000-0000-0000-0000-000000000000',
        'reason',
        {
          id: ownerId,
          name: 'Hygiene Owner',
        },
        false,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws NOT_FOUND when a non-admin caller does not own the finding (IDOR guard)', async () => {
    const contact = await createContact({
      first_name: 'Someone',
      last_name: 'Elses',
      email: '',
      owner_id: ownerId,
    });
    await runDataHygieneScan();

    const findings = await listHygieneFindings(ownerId);
    const finding = findings.find((f) => f.entity_id === contact.id)!;
    expect(finding).toBeDefined();

    await expect(
      dismissHygieneFinding(
        finding.id,
        'Not mine to dismiss',
        { id: otherOwnerId, name: 'Other Owner' },
        false,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Confirm it's still visible/open for the actual owner — the non-owner's
    // attempt must not have silently succeeded.
    const stillThere = await listHygieneFindings(ownerId);
    expect(stillThere.some((f) => f.id === finding.id)).toBe(true);
  });

  it('allows an admin to dismiss a finding they do not own', async () => {
    const contact = await createContact({
      first_name: 'Admin',
      last_name: 'Dismissible',
      email: '',
      owner_id: ownerId,
    });
    await runDataHygieneScan();

    const findings = await listHygieneFindings(ownerId);
    const finding = findings.find((f) => f.entity_id === contact.id)!;

    await dismissHygieneFinding(
      finding.id,
      'Admin override',
      { id: otherOwnerId, name: 'Admin User' },
      true,
    );

    const afterDismiss = await listHygieneFindings(ownerId);
    expect(afterDismiss.some((f) => f.id === finding.id)).toBe(false);
  });
});

describe('clearFindingsForEntity', () => {
  it('removes all findings for a given entity when the caller owns it', async () => {
    const contact = await createContact({
      first_name: 'Clear',
      last_name: 'Me',
      email: '',
      owner_id: ownerId,
    });
    await runDataHygieneScan();

    let findings = await listHygieneFindings(ownerId);
    expect(findings.some((f) => f.entity_id === contact.id)).toBe(true);

    await clearFindingsForEntity('contact', contact.id, ownerId, false);

    findings = await listHygieneFindings(ownerId);
    expect(findings.some((f) => f.entity_id === contact.id)).toBe(false);
  });

  it('throws FORBIDDEN when a non-admin caller does not own the entity (IDOR guard)', async () => {
    const contact = await createContact({
      first_name: 'NotYours',
      last_name: 'ToClear',
      email: '',
      owner_id: ownerId,
    });
    await runDataHygieneScan();

    let findings = await listHygieneFindings(ownerId);
    expect(findings.some((f) => f.entity_id === contact.id)).toBe(true);

    await expect(
      clearFindingsForEntity('contact', contact.id, otherOwnerId, false),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    findings = await listHygieneFindings(ownerId);
    expect(findings.some((f) => f.entity_id === contact.id)).toBe(true);
  });

  it('throws NOT_FOUND when no findings exist for the entity', async () => {
    await expect(
      clearFindingsForEntity('contact', '00000000-0000-0000-0000-000000000000', ownerId, false),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('allows an admin to clear findings they do not own', async () => {
    const contact = await createContact({
      first_name: 'Admin',
      last_name: 'Clearable',
      email: '',
      owner_id: ownerId,
    });
    await runDataHygieneScan();

    await clearFindingsForEntity('contact', contact.id, otherOwnerId, true);

    const findings = await listHygieneFindings(ownerId);
    expect(findings.some((f) => f.entity_id === contact.id)).toBe(false);
  });
});

describe('mergeDuplicateContactFindings', () => {
  async function createFlaggedDuplicatePair(): Promise<{ winnerId: string; loserId: string }> {
    const account = await createAccount({ name: `${FILE_PREFIX} Merge Co`, owner_id: ownerId });
    const contactA = await createContact({
      first_name: 'Dana',
      last_name: 'Okafor',
      email: `${FILE_PREFIX}-${uid()}-dana-a@example.com`,
      account_id: account.id,
      owner_id: ownerId,
    });
    const contactB = await createContact({
      first_name: 'Dana',
      last_name: 'Okafor',
      email: `${FILE_PREFIX}-${uid()}-dana-b@example.com`,
      account_id: account.id,
      owner_id: ownerId,
    });
    await runDataHygieneScan();
    return { winnerId: contactA.id, loserId: contactB.id };
  }

  it('merges a flagged duplicate pair when the caller owns the finding', async () => {
    const { winnerId, loserId } = await createFlaggedDuplicatePair();

    await mergeDuplicateContactFindings(
      winnerId,
      loserId,
      { id: ownerId, name: 'Hygiene Owner' },
      false,
    );

    const winner = await findContactById(winnerId);
    expect(winner).not.toBeNull();
    const loser = await findContactById(loserId);
    expect(loser).toBeNull();
  });

  it('throws FORBIDDEN when a non-admin caller does not own the flagged pair (IDOR guard)', async () => {
    const { winnerId, loserId } = await createFlaggedDuplicatePair();

    await expect(
      mergeDuplicateContactFindings(
        winnerId,
        loserId,
        { id: otherOwnerId, name: 'Other Owner' },
        false,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // Neither contact should have been touched by the rejected attempt.
    expect(await findContactById(winnerId)).not.toBeNull();
    expect(await findContactById(loserId)).not.toBeNull();
  });

  it('throws FORBIDDEN for an arbitrary contact pair with no matching finding at all', async () => {
    const contactA = await createContact({
      first_name: 'Unrelated',
      last_name: 'One',
      email: `${FILE_PREFIX}-${uid()}-unrelated-a@example.com`,
      owner_id: ownerId,
    });
    const contactB = await createContact({
      first_name: 'Unrelated',
      last_name: 'Two',
      email: `${FILE_PREFIX}-${uid()}-unrelated-b@example.com`,
      owner_id: ownerId,
    });

    await expect(
      mergeDuplicateContactFindings(
        contactA.id,
        contactB.id,
        { id: ownerId, name: 'Hygiene Owner' },
        false,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows an admin to merge a pair they do not own', async () => {
    const { winnerId, loserId } = await createFlaggedDuplicatePair();

    await mergeDuplicateContactFindings(
      winnerId,
      loserId,
      { id: otherOwnerId, name: 'Admin User' },
      true,
    );

    expect(await findContactById(winnerId)).not.toBeNull();
    expect(await findContactById(loserId)).toBeNull();
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
    // Scoped by changed_by_id, not by a time window. audit_log is a shared table
    // and dataHygieneController.test.ts writes rows under the IDENTICAL
    // record_type + record_name, so those two dimensions cannot isolate
    // anything — a window only narrows the race, it never closes it. (Both
    // files are in SERIAL_FILES, so they don't run concurrently with each
    // other; the exposure is to the parallel project, which runs alongside the
    // serial one.) That file's writes also go through
    // writeAuditEntryBestEffort (void, unawaited), so a row can land after its
    // own test finished and fall inside any window chosen here.
    //
    // ownerId is created in beforeAll with this file's own email prefix, so no
    // concurrently running file can write a row carrying it. Compare before vs
    // after rather than asserting an absolute '0'.
    const before = await countConfigAuditRows(ownerId);

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

    expect(await countConfigAuditRows(ownerId)).toBe(before);
  });

  it("counts this file's real config writes while ignoring another actor's", async () => {
    // Demonstrates the fix holds rather than merely observing it pass once
    //. Both halves matter: a REAL setDataHygieneConfig write
    // under this file's actor IS counted (so the scoping cannot pass by matching
    // nothing), and a row under a different actor carrying the identical
    // record_type and record_name a concurrent controller test writes is NOT.
    const before = await countConfigAuditRows(ownerId);

    // A real changed field, so the service actually writes an audit row.
    await setDataHygieneConfig(
      {
        contact_inactivity_days: 200,
        account_inactivity_days: 365,
        title_staleness_days: 1095,
        opportunity_inactivity_days: 30,
        dismiss_suppression_days: 90,
        weekly_digest_enabled: false,
      },
      { id: ownerId, name: 'Hygiene Owner' },
    );
    expect(await countConfigAuditRows(ownerId)).toBeGreaterThan(before);

    // Now a row from a different actor carrying the identical record_type and
    // record_name a concurrent controller test writes. randomUUID rather than
    // this file's own otherOwnerId: the point is a foreign writer, and
    // changed_by_id has no FK, so an arbitrary UUID models it exactly.
    await expectActorScopingIsolatesForeignRows(
      {
        recordType: 'ai_settings',
        recordName: DATA_HYGIENE_CONFIG_RECORD_NAME,
        actorId: ownerId,
        fieldName: 'contact_inactivity_days',
      },
      randomUUID(),
      expect,
    );
  });
});
