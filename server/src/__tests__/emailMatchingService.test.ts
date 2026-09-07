/**
 * Integration tests for the email matching engine.
 *
 * Against the real test database: every rule here is a set-based SQL statement, so a
 * mocked client would test the mock rather than the precedence, the fan-out, or the
 * terminal-stage exclusion that the statements actually encode.
 *
 * Drives matchMessagesToRecords directly rather than through a sync tick. The engine's own
 * suite covers the wiring; this one covers what the statements match.
 */

import 'dotenv/config';

import pool from '../db.js';
import type { PoolClient } from 'pg';
import { createUser } from '../services/userService.js';
import {
  clearDerivedLinkSuppression,
  deleteLinksForDeletedEntities,
  deleteLinksForDeletedEntity,
  matchMessagesToRecords,
  messagesLinkedToContacts,
  messagesLinkedToDeals,
  reconcileDerivedLinks,
  suppressDerivedLink,
  relinkLinksToConvertedLead,
  relinkLinksToMergedContact,
  type MatchableMessage,
} from '../services/emailMatchingService.js';
import { insertParkedMailbox } from './testUtils.js';

const FILE_PREFIX = 'emailmatch';

let ownerId: string;
let accountId: string;
let pipelineId: string;
let openStageId: string;
let terminalStageId: string;

/** Reads the source of every link on a message, keyed by record type. */
async function sourcesFor(messageId: string): Promise<Record<string, string | null>> {
  const result = await pool.query<{ record_type: string; source: string | null }>(
    `SELECT record_type, source FROM email_message_links WHERE email_message_id = $1`,
    [messageId],
  );
  return Object.fromEntries(result.rows.map((row) => [row.record_type, row.source]));
}

/** Reads the links a message ended up with, as `type:id` pairs for readable assertions. */
async function linksFor(messageId: string): Promise<string[]> {
  const result = await pool.query<{ record_type: string; record_id: string }>(
    `SELECT record_type, record_id FROM email_message_links
      WHERE email_message_id = $1 ORDER BY record_type`,
    [messageId],
  );
  return result.rows.map((row) => `${row.record_type}:${row.record_id}`);
}

async function insertMessage(suffix: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO email_messages
       (connected_account_id, provider_message_id, thread_id, direction, from_address)
     VALUES ($1, $2, $3, 'inbound', 'someone@example.net')
     RETURNING id`,
    [accountId, `INBOX:${suffix}`, `thread-${suffix}`],
  );
  return result.rows[0]!.id;
}

/** Runs the matcher in its own transaction, the way commitPage does. */
async function match(messages: MatchableMessage[], dealAutoLink = true): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await matchMessagesToRecords(client, messages, dealAutoLink);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function message(id: string, overrides: Partial<MatchableMessage> = {}): MatchableMessage {
  return {
    id,
    fromAddress: 'nobody@example.net',
    toAddresses: [],
    ccAddresses: [],
    ...overrides,
  };
}

async function createContact(local: string, accountFk: string | null = null): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id, account_id)
     VALUES ('Match', 'Target', $1, $2, $3) RETURNING id`,
    [`${FILE_PREFIX}-${local}@example.com`, ownerId, accountFk],
  );
  return result.rows[0]!.id;
}

async function createLead(local: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO leads (first_name, last_name, email, owner_id, status)
     VALUES ('Match', 'Lead', $1, $2, 'New') RETURNING id`,
    [`${FILE_PREFIX}-${local}@example.com`, ownerId],
  );
  return result.rows[0]!.id;
}

async function createAccountRecord(name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
    [`${FILE_PREFIX}-${name}`, ownerId],
  );
  return result.rows[0]!.id;
}

async function createDeal(name: string, stageId: string, contactId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO deals (name, stage, owner_id, pipeline_id, pipeline_stage_id)
     VALUES ($1, 'Prospecting', $2, $3, $4) RETURNING id`,
    [`${FILE_PREFIX}-${name}`, ownerId, pipelineId, stageId],
  );
  const dealId = result.rows[0]!.id;
  await pool.query('INSERT INTO deal_contacts (deal_id, contact_id) VALUES ($1, $2)', [
    dealId,
    contactId,
  ]);
  return dealId;
}

async function deleteFixtures(): Promise<void> {
  await pool.query(
    `DELETE FROM deals WHERE name LIKE '${FILE_PREFIX}-%' OR owner_id IN
       (SELECT id FROM users WHERE email LIKE '${FILE_PREFIX}-%@example.com')`,
  );
  // ILIKE, not LIKE: one fixture deliberately stores a mixed-case address, and a
  // case-sensitive match would leave it behind to block the user delete below.
  await pool.query(`DELETE FROM contacts WHERE email ILIKE '${FILE_PREFIX}-%@example.com'`);
  await pool.query(`DELETE FROM leads WHERE email ILIKE '${FILE_PREFIX}-%@example.com'`);
  await pool.query(`DELETE FROM accounts WHERE name LIKE '${FILE_PREFIX}-%'`);
  // Stages cascade with the pipeline; both go after the deals that reference them.
  await pool.query(`DELETE FROM pipelines WHERE name = '${FILE_PREFIX}-pipeline'`);
  await pool.query(`DELETE FROM users WHERE email LIKE '${FILE_PREFIX}-%@example.com'`);
}

beforeAll(async () => {
  await deleteFixtures();
  const rep = await createUser({
    email: `${FILE_PREFIX}-owner@example.com`,
    name: 'Match Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  ownerId = rep.id;

  accountId = await insertParkedMailbox(ownerId, `${FILE_PREFIX}-owner@example.com`);

  // Its own pipeline and stages rather than the default ones: pipelineStageService's
  // suite deletes and re-seeds the default pipeline's stages, which is why dealService
  // runs serial. Owning them keeps this file parallel-safe and immune to that.
  const pipeline = await pool.query<{ id: string }>(
    `INSERT INTO pipelines (name, is_default) VALUES ($1, false) RETURNING id`,
    [`${FILE_PREFIX}-pipeline`],
  );
  pipelineId = pipeline.rows[0]!.id;

  const stages = await pool.query<{ id: string; is_terminal: boolean }>(
    `INSERT INTO pipeline_stages (name, sort_order, probability, is_terminal, pipeline_id)
     VALUES ($2, 10, 25, false, $1), ($3, 20, 100, true, $1)
     RETURNING id, is_terminal`,
    [pipelineId, `${FILE_PREFIX}-open`, `${FILE_PREFIX}-closed`],
  );
  openStageId = stages.rows.find((row) => !row.is_terminal)!.id;
  terminalStageId = stages.rows.find((row) => row.is_terminal)!.id;
});

beforeEach(async () => {
  await pool.query('DELETE FROM email_messages WHERE connected_account_id = $1', [accountId]);
  await pool.query(`DELETE FROM deals WHERE name LIKE '${FILE_PREFIX}-%' OR owner_id = $1`, [
    ownerId,
  ]);
  await pool.query(`DELETE FROM contacts WHERE email ILIKE '${FILE_PREFIX}-%@example.com'`);
  await pool.query(`DELETE FROM leads WHERE email ILIKE '${FILE_PREFIX}-%@example.com'`);
  await pool.query(`DELETE FROM accounts WHERE name LIKE '${FILE_PREFIX}-%'`);
});

afterAll(async () => {
  await deleteFixtures();
  await pool.end();
});

describe('matchMessagesToRecords', () => {
  it('links a contact whose address the message names', async () => {
    const contactId = await createContact('alice');
    const messageId = await insertMessage('1');

    await match([message(messageId, { toAddresses: [`${FILE_PREFIX}-alice@example.com`] })]);

    expect(await linksFor(messageId)).toEqual([`contact:${contactId}`]);
  });

  it('matches the from address as well as to and cc', async () => {
    const fromContact = await createContact('sender');
    const ccContact = await createContact('copied');
    const messageId = await insertMessage('1');

    await match([
      message(messageId, {
        fromAddress: `${FILE_PREFIX}-sender@example.com`,
        ccAddresses: [`${FILE_PREFIX}-copied@example.com`],
      }),
    ]);

    expect((await linksFor(messageId)).sort()).toEqual(
      [`contact:${fromContact}`, `contact:${ccContact}`].sort(),
    );
  });

  it('fans out to every recipient on a multi-recipient message', async () => {
    const first = await createContact('one');
    const second = await createContact('two');
    const third = await createContact('three');
    const messageId = await insertMessage('1');

    await match([
      message(messageId, {
        toAddresses: [`${FILE_PREFIX}-one@example.com`, `${FILE_PREFIX}-two@example.com`],
        ccAddresses: [`${FILE_PREFIX}-three@example.com`],
      }),
    ]);

    expect((await linksFor(messageId)).sort()).toEqual(
      [`contact:${first}`, `contact:${second}`, `contact:${third}`].sort(),
    );
  });

  it('matches case-insensitively, so a contact stored with capitals still links', async () => {
    // Written straight to the column: the Zod boundary lowercases, so a row like this can
    // only predate that normalization. Strip LOWER() from the matcher and this fails.
    const stored = await pool.query<{ id: string }>(
      `INSERT INTO contacts (first_name, last_name, email, owner_id)
       VALUES ('Match', 'Target', $1, $2) RETURNING id`,
      [`${FILE_PREFIX}-Mixed@Example.com`, ownerId],
    );
    const messageId = await insertMessage('1');

    await match([message(messageId, { toAddresses: [`${FILE_PREFIX}-mixed@example.com`] })]);

    expect(await linksFor(messageId)).toEqual([`contact:${stored.rows[0]!.id}`]);
  });

  it('links a lead when no contact holds the address', async () => {
    const leadId = await createLead('prospect');
    const messageId = await insertMessage('1');

    await match([message(messageId, { toAddresses: [`${FILE_PREFIX}-prospect@example.com`] })]);

    expect(await linksFor(messageId)).toEqual([`lead:${leadId}`]);
  });

  it('prefers the contact over a lead sharing the address', async () => {
    const contactId = await createContact('both');
    await createLead('both');
    const messageId = await insertMessage('1');

    await match([message(messageId, { toAddresses: [`${FILE_PREFIX}-both@example.com`] })]);

    expect(await linksFor(messageId)).toEqual([`contact:${contactId}`]);
  });

  it('leaves a converted lead alone, even when no contact holds its address', async () => {
    // Conversion writes the contact's address from the request body, so a rep who corrects
    // it leaves the lead holding the old one — precedence would never fire for it.
    const leadId = await createLead('converted');
    await pool.query(`UPDATE leads SET converted_at = now() WHERE id = $1`, [leadId]);
    const messageId = await insertMessage('1');

    await match([message(messageId, { toAddresses: [`${FILE_PREFIX}-converted@example.com`] })]);

    expect(await linksFor(messageId)).toEqual([]);
  });

  it('links both leads when two share one address', async () => {
    // leads.email carries no unique index, unlike contacts.email — so this is reachable,
    // and suppressing one would hide a real association.
    const first = await createLead('dupe');
    const second = await createLead('dupe');
    const messageId = await insertMessage('1');

    await match([message(messageId, { toAddresses: [`${FILE_PREFIX}-dupe@example.com`] })]);

    expect((await linksFor(messageId)).sort()).toEqual([`lead:${first}`, `lead:${second}`].sort());
  });

  it("links the matched contact's account", async () => {
    const accountRecordId = await createAccountRecord('acme');
    const contactId = await createContact('employee', accountRecordId);
    const messageId = await insertMessage('1');

    await match([message(messageId, { toAddresses: [`${FILE_PREFIX}-employee@example.com`] })]);

    expect((await linksFor(messageId)).sort()).toEqual(
      [`account:${accountRecordId}`, `contact:${contactId}`].sort(),
    );
  });

  it('links an open deal the matched contact participates in', async () => {
    const contactId = await createContact('buyer');
    const dealId = await createDeal('open-deal', openStageId, contactId);
    const messageId = await insertMessage('1');

    await match([message(messageId, { toAddresses: [`${FILE_PREFIX}-buyer@example.com`] })]);

    expect((await linksFor(messageId)).sort()).toEqual(
      [`contact:${contactId}`, `deal:${dealId}`].sort(),
    );
  });

  it('leaves a closed deal alone', async () => {
    const contactId = await createContact('closed');
    await createDeal('won-deal', terminalStageId, contactId);
    const messageId = await insertMessage('1');

    await match([message(messageId, { toAddresses: [`${FILE_PREFIX}-closed@example.com`] })]);

    expect(await linksFor(messageId)).toEqual([`contact:${contactId}`]);
  });

  it('links no deal when deal_auto_link is off', async () => {
    const contactId = await createContact('nodeal');
    await createDeal('suppressed', openStageId, contactId);
    const messageId = await insertMessage('1');

    await match(
      [message(messageId, { toAddresses: [`${FILE_PREFIX}-nodeal@example.com`] })],
      false,
    );

    expect(await linksFor(messageId)).toEqual([`contact:${contactId}`]);
  });

  it('links nothing when no address matches a record', async () => {
    await createContact('somebody');
    const messageId = await insertMessage('1');

    await match([message(messageId, { toAddresses: ['stranger@elsewhere.example'] })]);

    expect(await linksFor(messageId)).toEqual([]);
  });

  it('skips an address the message left empty without skipping the rest', async () => {
    const contactId = await createContact('present');
    const messageId = await insertMessage('1');

    // An empty from is what a provider yields for a message with no usable sender; it must
    // not suppress the recipients alongside it.
    await match([
      message(messageId, {
        fromAddress: '',
        toAddresses: ['', `${FILE_PREFIX}-present@example.com`],
      }),
    ]);

    expect(await linksFor(messageId)).toEqual([`contact:${contactId}`]);
  });

  it('is idempotent — matching the same message twice adds no duplicate', async () => {
    const contactId = await createContact('twice');
    const messageId = await insertMessage('1');
    const named = message(messageId, { toAddresses: [`${FILE_PREFIX}-twice@example.com`] });

    await match([named]);
    await match([named]);

    expect(await linksFor(messageId)).toEqual([`contact:${contactId}`]);
  });

  it('matches every message in a page independently', async () => {
    const alice = await createContact('page-a');
    const bob = await createContact('page-b');
    const first = await insertMessage('1');
    const second = await insertMessage('2');

    await match([
      message(first, { toAddresses: [`${FILE_PREFIX}-page-a@example.com`] }),
      message(second, { toAddresses: [`${FILE_PREFIX}-page-b@example.com`] }),
    ]);

    expect(await linksFor(first)).toEqual([`contact:${alice}`]);
    expect(await linksFor(second)).toEqual([`contact:${bob}`]);
  });

  it('records every automatic link as match_type auto', async () => {
    const accountRecordId = await createAccountRecord('typed');
    const contactId = await createContact('typed', accountRecordId);
    await createDeal('typed-deal', openStageId, contactId);
    const messageId = await insertMessage('1');

    await match([message(messageId, { toAddresses: [`${FILE_PREFIX}-typed@example.com`] })]);

    const types = await pool.query<{ match_type: string }>(
      'SELECT DISTINCT match_type FROM email_message_links WHERE email_message_id = $1',
      [messageId],
    );
    expect(types.rows).toEqual([{ match_type: 'auto' }]);
  });
});

describe('cleanup on delete', () => {
  it('removes the links pointing at a deleted record, and only those', async () => {
    const doomed = await createContact('doomed');
    const survivor = await createContact('survivor');
    const messageId = await insertMessage('1');
    await match([
      message(messageId, {
        toAddresses: [`${FILE_PREFIX}-doomed@example.com`, `${FILE_PREFIX}-survivor@example.com`],
      }),
    ]);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await deleteLinksForDeletedEntity(client, 'contact', doomed);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    expect(await linksFor(messageId)).toEqual([`contact:${survivor}`]);
  });

  it('removes links for a whole set, the way a bulk delete does', async () => {
    const first = await createContact('bulk-a');
    const second = await createContact('bulk-b');
    const kept = await createContact('bulk-keep');
    const messageId = await insertMessage('1');
    await match([
      message(messageId, {
        toAddresses: [
          `${FILE_PREFIX}-bulk-a@example.com`,
          `${FILE_PREFIX}-bulk-b@example.com`,
          `${FILE_PREFIX}-bulk-keep@example.com`,
        ],
      }),
    ]);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await deleteLinksForDeletedEntities(client, 'contact', [first, second]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    expect(await linksFor(messageId)).toEqual([`contact:${kept}`]);
  });

  it('is a no-op for an empty id set', async () => {
    const contactId = await createContact('untouched');
    const messageId = await insertMessage('1');
    await match([message(messageId, { toAddresses: [`${FILE_PREFIX}-untouched@example.com`] })]);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await deleteLinksForDeletedEntities(client, 'contact', []);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    expect(await linksFor(messageId)).toEqual([`contact:${contactId}`]);
  });
});

describe('re-pointing on contact merge', () => {
  async function merge(winnerId: string, loserId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await relinkLinksToMergedContact(client, winnerId, loserId);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  it("moves the loser's links to the winner", async () => {
    const winner = await createContact('winner');
    const loser = await createContact('loser');
    const messageId = await insertMessage('1');
    await match([message(messageId, { toAddresses: [`${FILE_PREFIX}-loser@example.com`] })]);

    await merge(winner, loser);

    expect(await linksFor(messageId)).toEqual([`contact:${winner}`]);
  });

  it('collapses to one link when a message named both contacts', async () => {
    // The UNIQUE constraint makes this the case a bare UPDATE would fail on, rolling the
    // whole merge back — which is why the move is guarded.
    const winner = await createContact('both-winner');
    const loser = await createContact('both-loser');
    const messageId = await insertMessage('1');
    await match([
      message(messageId, {
        toAddresses: [
          `${FILE_PREFIX}-both-winner@example.com`,
          `${FILE_PREFIX}-both-loser@example.com`,
        ],
      }),
    ]);

    await merge(winner, loser);

    expect(await linksFor(messageId)).toEqual([`contact:${winner}`]);
  });

  it("leaves another contact's links alone", async () => {
    const winner = await createContact('m-winner');
    const loser = await createContact('m-loser');
    const bystander = await createContact('m-bystander');
    const messageId = await insertMessage('1');
    await match([
      message(messageId, {
        toAddresses: [
          `${FILE_PREFIX}-m-loser@example.com`,
          `${FILE_PREFIX}-m-bystander@example.com`,
        ],
      }),
    ]);

    await merge(winner, loser);

    expect((await linksFor(messageId)).sort()).toEqual(
      [`contact:${winner}`, `contact:${bystander}`].sort(),
    );
  });
});

describe('re-pointing on lead conversion', () => {
  async function convert(leadId: string, contactId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await relinkLinksToConvertedLead(client, leadId, contactId);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  it("moves the lead's history to the contact it became", async () => {
    const leadId = await createLead('converting');
    const messageId = await insertMessage('1');
    await match([message(messageId, { toAddresses: [`${FILE_PREFIX}-converting@example.com`] })]);
    const contactId = await createContact('converting-contact');

    await convert(leadId, contactId);

    expect(await linksFor(messageId)).toEqual([`contact:${contactId}`]);
  });

  it('collapses to one link when the message already named the new contact', async () => {
    const leadId = await createLead('dual');
    const contactId = await createContact('dual-contact');
    const messageId = await insertMessage('1');
    await match([
      message(messageId, {
        toAddresses: [`${FILE_PREFIX}-dual@example.com`, `${FILE_PREFIX}-dual-contact@example.com`],
      }),
    ]);

    await convert(leadId, contactId);

    expect(await linksFor(messageId)).toEqual([`contact:${contactId}`]);
  });
});

describe('reconciling account links when a contact changes employer', () => {
  /** Applies a change to the contacts, then reconciles what their messages now justify. */
  async function relink(contactIds: string[], change: () => Promise<void>): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const affected = await messagesLinkedToContacts(client, contactIds);
      await change();
      await reconcileDerivedLinks(client, affected, true);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  it('moves the link to the new account', async () => {
    const oldAccountId = await createAccountRecord('Old Employer');
    const newAccountId = await createAccountRecord('New Employer');
    const contactId = await createContact('mover', oldAccountId);
    const messageId = await insertMessage('1');
    await match([message(messageId, { toAddresses: [`${FILE_PREFIX}-mover@example.com`] })]);
    expect(await linksFor(messageId)).toContain(`account:${oldAccountId}`);

    await relink([contactId], async () => {
      await pool.query('UPDATE contacts SET account_id = $1 WHERE id = $2', [
        newAccountId,
        contactId,
      ]);
    });

    const links = await linksFor(messageId);
    expect(links).toContain(`account:${newAccountId}`);
    expect(links).not.toContain(`account:${oldAccountId}`);
  });

  it('drops the link when the contact now belongs to no account', async () => {
    const oldAccountId = await createAccountRecord('Former Employer');
    const contactId = await createContact('leaver', oldAccountId);
    const messageId = await insertMessage('1');
    await match([message(messageId, { toAddresses: [`${FILE_PREFIX}-leaver@example.com`] })]);

    await relink([contactId], async () => {
      await pool.query('UPDATE contacts SET account_id = NULL WHERE id = $1', [contactId]);
    });

    expect(await linksFor(messageId)).toEqual([`contact:${contactId}`]);
  });

  it('keeps an account another contact on the same message still justifies', async () => {
    const sharedAccountId = await createAccountRecord('Shared Employer');
    const moverId = await createContact('shared-mover', sharedAccountId);
    const stayerId = await createContact('shared-stayer', sharedAccountId);
    const messageId = await insertMessage('1');
    await match([
      message(messageId, {
        toAddresses: [
          `${FILE_PREFIX}-shared-mover@example.com`,
          `${FILE_PREFIX}-shared-stayer@example.com`,
        ],
      }),
    ]);

    await relink([moverId], async () => {
      await pool.query('UPDATE contacts SET account_id = NULL WHERE id = $1', [moverId]);
    });

    // The stayer still works there, so the message still belongs on that timeline.
    const links = await linksFor(messageId);
    expect(links).toContain(`account:${sharedAccountId}`);
    expect(links).toContain(`contact:${stayerId}`);
  });

  it('leaves a manual link alone', async () => {
    const oldAccountId = await createAccountRecord('Manual Employer');
    const contactId = await createContact('manual-mover', oldAccountId);
    const messageId = await insertMessage('1');
    await match([message(messageId, { toAddresses: [`${FILE_PREFIX}-manual-mover@example.com`] })]);
    await pool.query(
      `UPDATE email_message_links SET match_type = 'manual'
        WHERE email_message_id = $1 AND record_type = 'account'`,
      [messageId],
    );

    await relink([contactId], async () => {
      await pool.query('UPDATE contacts SET account_id = NULL WHERE id = $1', [contactId]);
    });

    // Somebody filed this deliberately; the engine does not overrule them.
    expect(await linksFor(messageId)).toContain(`account:${oldAccountId}`);
  });
});

describe('reconciling deal links when a participant is removed', () => {
  async function removeParticipant(dealId: string, contactId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const affected = await messagesLinkedToContacts(client, [contactId]);
      await client.query('DELETE FROM deal_contacts WHERE deal_id = $1 AND contact_id = $2', [
        dealId,
        contactId,
      ]);
      await reconcileDerivedLinks(client, affected, true);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  it('drops the deal link the departing contact justified', async () => {
    const contactId = await createContact('participant');
    const dealId = await createDeal('Participant Deal', openStageId, contactId);
    const messageId = await insertMessage('1');
    await match([message(messageId, { toAddresses: [`${FILE_PREFIX}-participant@example.com`] })]);
    expect(await linksFor(messageId)).toContain(`deal:${dealId}`);

    await removeParticipant(dealId, contactId);

    expect(await linksFor(messageId)).not.toContain(`deal:${dealId}`);
  });

  it('keeps the deal link another participant on the same message still justifies', async () => {
    const leavingId = await createContact('deal-leaver');
    const stayingId = await createContact('deal-stayer');
    const dealId = await createDeal('Two Participant Deal', openStageId, leavingId);
    await pool.query('INSERT INTO deal_contacts (deal_id, contact_id) VALUES ($1, $2)', [
      dealId,
      stayingId,
    ]);
    const messageId = await insertMessage('1');
    await match([
      message(messageId, {
        toAddresses: [
          `${FILE_PREFIX}-deal-leaver@example.com`,
          `${FILE_PREFIX}-deal-stayer@example.com`,
        ],
      }),
    ]);

    await removeParticipant(dealId, leavingId);

    expect(await linksFor(messageId)).toContain(`deal:${dealId}`);
  });

  it('leaves a manual deal link alone', async () => {
    const contactId = await createContact('manual-participant');
    const dealId = await createDeal('Manual Deal', openStageId, contactId);
    const messageId = await insertMessage('1');
    await match([
      message(messageId, { toAddresses: [`${FILE_PREFIX}-manual-participant@example.com`] }),
    ]);
    await pool.query(
      `UPDATE email_message_links SET match_type = 'manual'
        WHERE email_message_id = $1 AND record_type = 'deal'`,
      [messageId],
    );

    await removeParticipant(dealId, contactId);

    expect(await linksFor(messageId)).toContain(`deal:${dealId}`);
  });
});

describe('reconciling when a contact is deleted', () => {
  it('drops the account and deal links the deleted contact justified', async () => {
    const accountRecordId = await createAccountRecord('Doomed Employer');
    const contactId = await createContact('doomed', accountRecordId);
    const dealId = await createDeal('Doomed Deal', openStageId, contactId);
    const messageId = await insertMessage('1');
    await match([message(messageId, { toAddresses: [`${FILE_PREFIX}-doomed@example.com`] })]);
    expect(await linksFor(messageId)).toHaveLength(3);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Read before the delete, as deleteContact does: the lookup joins through the very
      // links the delete removes.
      const affected = await messagesLinkedToContacts(client, [contactId]);
      await deleteLinksForDeletedEntity(client, 'contact', contactId);
      await client.query('DELETE FROM contacts WHERE id = $1', [contactId]);
      await reconcileDerivedLinks(client, affected, true);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Nothing on this message relates to that account or deal any more.
    expect(await linksFor(messageId)).toEqual([]);
    expect(await pool.query('SELECT 1 FROM deals WHERE id = $1', [dealId])).toHaveProperty(
      'rowCount',
      1,
    );
  });

  it('keeps an account a surviving contact on the same message still justifies', async () => {
    const accountRecordId = await createAccountRecord('Shared Surviving Employer');
    const doomedId = await createContact('doomed-shared', accountRecordId);
    const survivorId = await createContact('survivor-shared', accountRecordId);
    const messageId = await insertMessage('1');
    await match([
      message(messageId, {
        toAddresses: [
          `${FILE_PREFIX}-doomed-shared@example.com`,
          `${FILE_PREFIX}-survivor-shared@example.com`,
        ],
      }),
    ]);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const affected = await messagesLinkedToContacts(client, [doomedId]);
      await deleteLinksForDeletedEntity(client, 'contact', doomedId);
      await client.query('DELETE FROM contacts WHERE id = $1', [doomedId]);
      await reconcileDerivedLinks(client, affected, true);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const links = await linksFor(messageId);
    expect(links).toContain(`account:${accountRecordId}`);
    expect(links).toContain(`contact:${survivorId}`);
  });
});

describe('reconciling a merge that changes which account a message names', () => {
  /** Merges the way mergeContacts does: move the links first, then reconcile. */
  async function mergeAndReconcile(winnerId: string, loserId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await relinkLinksToMergedContact(client, winnerId, loserId);
      await reconcileDerivedLinks(client, await messagesLinkedToContacts(client, [winnerId]), true);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  it('re-derives the account for a message that only named the loser', async () => {
    // The loser's messages reach the winner only during the merge, so a reconciliation
    // that ran before it would find no messages at all and return early.
    const winnerAccountId = await createAccountRecord('Winner Employer');
    const loserAccountId = await createAccountRecord('Loser Employer');
    const winnerId = await createContact('merge-winner', winnerAccountId);
    const loserId = await createContact('merge-loser', loserAccountId);
    const messageId = await insertMessage('1');
    await match([message(messageId, { toAddresses: [`${FILE_PREFIX}-merge-loser@example.com`] })]);
    expect(await linksFor(messageId)).toContain(`account:${loserAccountId}`);

    await mergeAndReconcile(winnerId, loserId);

    const links = await linksFor(messageId);
    expect(links).toContain(`contact:${winnerId}`);
    expect(links).toContain(`account:${winnerAccountId}`);
    expect(links).not.toContain(`account:${loserAccountId}`);
  });

  it("drops the loser's account even when the winner's own account never changed", async () => {
    // The guard that only reconciled on an account_id change missed this: the winner
    // keeps its account, so nothing about the winner changed — but the message's contact
    // set did.
    const winnerAccountId = await createAccountRecord('Unchanged Employer');
    const loserAccountId = await createAccountRecord('Departing Employer');
    const winnerId = await createContact('keep-winner', winnerAccountId);
    const loserId = await createContact('keep-loser', loserAccountId);
    const messageId = await insertMessage('1');
    await match([
      message(messageId, {
        toAddresses: [
          `${FILE_PREFIX}-keep-winner@example.com`,
          `${FILE_PREFIX}-keep-loser@example.com`,
        ],
      }),
    ]);
    expect(await linksFor(messageId)).toContain(`account:${loserAccountId}`);

    await mergeAndReconcile(winnerId, loserId);

    const links = await linksFor(messageId);
    expect(links).toContain(`account:${winnerAccountId}`);
    expect(links).not.toContain(`account:${loserAccountId}`);
  });
});

describe('recording who created a link', () => {
  it("stamps every auto-linked rule with source 'system'", async () => {
    // Auto-links are deliberately never audited, so this column is the only record that
    // the engine rather than a person filed the mail.
    const accountRecordId = await createAccountRecord('Source Employer');
    const contactId = await createContact('sourced', accountRecordId);
    await createDeal('Source Deal', openStageId, contactId);
    const leadId = await createLead('sourced-lead');
    const messageId = await insertMessage('1');

    await match([
      message(messageId, {
        toAddresses: [
          `${FILE_PREFIX}-sourced@example.com`,
          `${FILE_PREFIX}-sourced-lead@example.com`,
        ],
      }),
    ]);

    expect(await sourcesFor(messageId)).toEqual({
      contact: 'system',
      account: 'system',
      deal: 'system',
      lead: 'system',
    });
    expect(leadId).toBeTruthy();
  });

  it('leaves source null on a link a person filed', async () => {
    const contactId = await createContact('hand-filed');
    const messageId = await insertMessage('1');
    await pool.query(
      `INSERT INTO email_message_links (email_message_id, record_type, record_id, match_type)
       VALUES ($1, 'contact', $2, 'manual')`,
      [messageId, contactId],
    );

    expect(await sourcesFor(messageId)).toEqual({ contact: null });
  });
});

describe('reconciling when a participant joins a deal', () => {
  /** Adds a participant the way linkContactToDeal does, then reconciles. */
  async function addParticipant(dealId: string, contactId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO deal_contacts (deal_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [dealId, contactId],
      );
      await reconcileDerivedLinks(
        client,
        await messagesLinkedToContacts(client, [contactId]),
        true,
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  it('files the contact’s existing mail against the deal they just joined', async () => {
    // Nothing re-matches a stored message, so a deal the contact joins after the mail
    // arrived would never see it.
    const contactId = await createContact('joiner');
    const messageId = await insertMessage('1');
    await match([message(messageId, { toAddresses: [`${FILE_PREFIX}-joiner@example.com`] })]);
    const dealId = await createDeal('Joined Deal', openStageId, contactId);
    // createDeal already links the participant, so start from a message that predates it.
    await pool.query(`DELETE FROM email_message_links WHERE record_type = 'deal'`);

    await addParticipant(dealId, contactId);

    expect(await linksFor(messageId)).toContain(`deal:${dealId}`);
  });

  it('leaves a closed deal alone when a participant joins it', async () => {
    const contactId = await createContact('closed-joiner');
    const messageId = await insertMessage('1');
    await match([
      message(messageId, { toAddresses: [`${FILE_PREFIX}-closed-joiner@example.com`] }),
    ]);
    const dealId = await createDeal('Closed Joined Deal', terminalStageId, contactId);
    await pool.query(`DELETE FROM email_message_links WHERE record_type = 'deal'`);

    await addParticipant(dealId, contactId);

    // Rule 4 is open deals only, on the reconcile path as much as on the sync path.
    expect(await linksFor(messageId)).not.toContain(`deal:${dealId}`);
  });

  it('honours deal_auto_link being off on the reconcile path', async () => {
    const contactId = await createContact('gated-joiner');
    const messageId = await insertMessage('1');
    await match([message(messageId, { toAddresses: [`${FILE_PREFIX}-gated-joiner@example.com`] })]);
    const dealId = await createDeal('Gated Joined Deal', openStageId, contactId);
    await pool.query(`DELETE FROM email_message_links WHERE record_type = 'deal'`);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO deal_contacts (deal_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [dealId, contactId],
      );
      // An admin who switched auto-linking off must not have it reappear by the back door.
      await reconcileDerivedLinks(
        client,
        await messagesLinkedToContacts(client, [contactId]),
        false,
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    expect(await linksFor(messageId)).not.toContain(`deal:${dealId}`);
  });
});

describe('a deal that closes after its mail was filed', () => {
  it('drops the derived link once the deal reaches a terminal stage', async () => {
    // The insert only ever grants open deals a link, so the delete has to withdraw one
    // the deal has stopped earning — otherwise mail stays filed against closed business.
    const contactId = await createContact('closer');
    const messageId = await insertMessage('1');
    await match([message(messageId, { toAddresses: [`${FILE_PREFIX}-closer@example.com`] })]);
    const dealId = await createDeal('Closing Deal', openStageId, contactId);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await reconcileDerivedLinks(
        client,
        await messagesLinkedToContacts(client, [contactId]),
        true,
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(await linksFor(messageId)).toContain(`deal:${dealId}`);

    await pool.query(`UPDATE deals SET pipeline_stage_id = $1 WHERE id = $2`, [
      terminalStageId,
      dealId,
    ]);

    const after = await pool.connect();
    try {
      await after.query('BEGIN');
      await reconcileDerivedLinks(after, await messagesLinkedToDeals(after, [dealId]), true);
      await after.query('COMMIT');
    } finally {
      after.release();
    }

    expect(await linksFor(messageId)).not.toContain(`deal:${dealId}`);
  });
});

describe('a link the user removed', () => {
  it('does not come back when the relationship is re-derived', async () => {
    // The endpoint promises a removed automatic link stays removed; re-derivation would
    // otherwise undo it on the next employer change, merge or stage move.
    const accountFk = await createAccountRecord('unlinker-co');
    const contactId = await createContact('unlinker', accountFk);
    const messageId = await insertMessage('1');
    await match([message(messageId, { toAddresses: [`${FILE_PREFIX}-unlinker@example.com`] })]);
    expect(await linksFor(messageId)).toContain(`account:${accountFk}`);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM email_message_links WHERE email_message_id = $1 AND record_type = 'account'`,
        [messageId],
      );
      await suppressDerivedLink(client, messageId, 'account', accountFk);
      await reconcileDerivedLinks(
        client,
        await messagesLinkedToContacts(client, [contactId]),
        true,
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    expect(await linksFor(messageId)).not.toContain(`account:${accountFk}`);
  });

  it('is derived again once the user files it by hand', async () => {
    const accountFk = await createAccountRecord('refiler-co');
    const contactId = await createContact('refiler', accountFk);
    const messageId = await insertMessage('1');
    await match([message(messageId, { toAddresses: [`${FILE_PREFIX}-refiler@example.com`] })]);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM email_message_links WHERE email_message_id = $1 AND record_type = 'account'`,
        [messageId],
      );
      await suppressDerivedLink(client, messageId, 'account', accountFk);
      await clearDerivedLinkSuppression(client, messageId, 'account', accountFk);
      await reconcileDerivedLinks(
        client,
        await messagesLinkedToContacts(client, [contactId]),
        true,
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    expect(await linksFor(messageId)).toContain(`account:${accountFk}`);
  });
});
