/**
 * Integration tests for connectedAccountService.
 *
 * Verifies that mailbox credentials are encrypted at rest, that no response shape can
 * carry them, that ownership is enforced in the query rather than by a caller's check,
 * and that connect/disconnect write audit entries inside the same transaction.
 */

import 'dotenv/config';

import pool from '../db.js';
import { createUser } from '../services/userService.js';
import {
  createImapAccount,
  deleteConnectedAccount,
  getConnectedAccountInternal,
  listConnectedAccounts,
  updateAccountStatus,
  upsertOAuthAccount,
} from '../services/connectedAccountService.js';

import { clearAuditLogFor } from './testUtils.js';

const FILE_PREFIX = 'connacct';
const REP_A_ACTOR = { id: '', name: 'Connected Rep A' };
const REP_B_ACTOR = { id: '', name: 'Connected Rep B' };

const IMAP_INPUT = {
  email_address: `${FILE_PREFIX}-mailbox@example.com`,
  host: 'imap.example.com',
  port: 993,
  username: `${FILE_PREFIX}-mailbox@example.com`,
  password: 'a-very-secret-password',
  secure: true,
};

async function deleteFixtureUsers(): Promise<void> {
  await pool.query(`DELETE FROM users WHERE email LIKE '${FILE_PREFIX}-%@example.com'`);
}

beforeAll(async () => {
  await deleteFixtureUsers();

  const repA = await createUser({
    email: `${FILE_PREFIX}-a@example.com`,
    name: 'Connected Rep A',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  REP_A_ACTOR.id = repA.id;

  const repB = await createUser({
    email: `${FILE_PREFIX}-b@example.com`,
    name: 'Connected Rep B',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  REP_B_ACTOR.id = repB.id;
});

beforeEach(async () => {
  await pool.query('DELETE FROM connected_accounts WHERE user_id = ANY($1::uuid[])', [
    [REP_A_ACTOR.id, REP_B_ACTOR.id],
  ]);
  await clearAuditLogFor(REP_A_ACTOR.id);
  await clearAuditLogFor(REP_B_ACTOR.id);
});

afterAll(async () => {
  await deleteFixtureUsers();
  await pool.end();
});

describe('credential encryption at rest', () => {
  it('stores the IMAP payload encrypted, not as plaintext', async () => {
    const account = await createImapAccount(REP_A_ACTOR.id, IMAP_INPUT, REP_A_ACTOR);

    const row = await pool.query<{ auth_encrypted: string; key_version: number }>(
      'SELECT auth_encrypted, key_version FROM connected_accounts WHERE id = $1',
      [account.id],
    );
    const stored = row.rows[0].auth_encrypted;

    expect(stored).not.toContain(IMAP_INPUT.password);
    expect(stored).not.toContain(IMAP_INPUT.host);
    // Encrypted format is iv:authTag:ciphertext.
    expect(stored.split(':')).toHaveLength(3);
    expect(row.rows[0].key_version).toBeGreaterThanOrEqual(1);
  });

  it('round-trips the payload through decryption', async () => {
    const account = await createImapAccount(REP_A_ACTOR.id, IMAP_INPUT, REP_A_ACTOR);

    const internal = await getConnectedAccountInternal(account.id, REP_A_ACTOR.id);

    expect(internal).not.toBeNull();
    expect(internal!.auth).toEqual({
      kind: 'imap',
      host: IMAP_INPUT.host,
      port: IMAP_INPUT.port,
      username: IMAP_INPUT.username,
      password: IMAP_INPUT.password,
      secure: true,
    });
  });

  it('treats an undecryptable row as absent rather than throwing', async () => {
    const account = await createImapAccount(REP_A_ACTOR.id, IMAP_INPUT, REP_A_ACTOR);
    await pool.query(`UPDATE connected_accounts SET auth_encrypted = 'corrupt' WHERE id = $1`, [
      account.id,
    ]);

    await expect(getConnectedAccountInternal(account.id, REP_A_ACTOR.id)).resolves.toBeNull();
  });
});

describe('credentials never reach a response shape', () => {
  it('omits the ciphertext and key version from a created account', async () => {
    const account = await createImapAccount(REP_A_ACTOR.id, IMAP_INPUT, REP_A_ACTOR);

    expect('auth_encrypted' in account).toBe(false);
    expect('key_version' in account).toBe(false);
    expect('user_id' in account).toBe(false);
    expect(JSON.stringify(account)).not.toContain(IMAP_INPUT.password);
  });

  it('omits them from a listed account', async () => {
    await createImapAccount(REP_A_ACTOR.id, IMAP_INPUT, REP_A_ACTOR);

    const accounts = await listConnectedAccounts(REP_A_ACTOR.id);

    expect(accounts).toHaveLength(1);
    expect('auth_encrypted' in accounts[0]).toBe(false);
    expect(JSON.stringify(accounts)).not.toContain(IMAP_INPUT.password);
  });
});

describe('horizontal privilege enforcement', () => {
  it("does not list rep B's accounts for rep A", async () => {
    await createImapAccount(REP_B_ACTOR.id, IMAP_INPUT, REP_B_ACTOR);

    await expect(listConnectedAccounts(REP_A_ACTOR.id)).resolves.toEqual([]);
  });

  it("returns null when rep A reads rep B's account by id", async () => {
    const account = await createImapAccount(REP_B_ACTOR.id, IMAP_INPUT, REP_B_ACTOR);

    await expect(getConnectedAccountInternal(account.id, REP_A_ACTOR.id)).resolves.toBeNull();
  });

  it("returns null when rep A deletes rep B's account, leaving it in place", async () => {
    const account = await createImapAccount(REP_B_ACTOR.id, IMAP_INPUT, REP_B_ACTOR);

    await expect(
      deleteConnectedAccount(account.id, REP_A_ACTOR.id, REP_A_ACTOR),
    ).resolves.toBeNull();

    const survivors = await listConnectedAccounts(REP_B_ACTOR.id);
    expect(survivors).toHaveLength(1);
  });

  it("does not change status on rep B's account when rep A writes it", async () => {
    const account = await createImapAccount(REP_B_ACTOR.id, IMAP_INPUT, REP_B_ACTOR);

    await updateAccountStatus(account.id, REP_A_ACTOR.id, 'error', 'attacker');

    const [survivor] = await listConnectedAccounts(REP_B_ACTOR.id);
    expect(survivor.status).toBe('active');
    expect(survivor.status_detail).toBeNull();
  });
});

describe('duplicate mailboxes', () => {
  it('rejects the same mailbox twice with CONNECTED_ACCOUNT_DUPLICATE', async () => {
    await createImapAccount(REP_A_ACTOR.id, IMAP_INPUT, REP_A_ACTOR);

    await expect(createImapAccount(REP_A_ACTOR.id, IMAP_INPUT, REP_A_ACTOR)).rejects.toMatchObject({
      code: 'CONNECTED_ACCOUNT_DUPLICATE',
    });
  });

  it('allows two users to connect the same mailbox address', async () => {
    await createImapAccount(REP_A_ACTOR.id, IMAP_INPUT, REP_A_ACTOR);

    await expect(createImapAccount(REP_B_ACTOR.id, IMAP_INPUT, REP_B_ACTOR)).resolves.toMatchObject(
      { email_address: IMAP_INPUT.email_address },
    );
  });
});

describe('OAuth upsert', () => {
  const OAUTH_UPSERT = {
    userId: '',
    provider: 'google' as const,
    emailAddress: `${FILE_PREFIX}-oauth@example.com`,
    auth: {
      kind: 'oauth' as const,
      access_token: 'access-one',
      refresh_token: 'refresh-one',
      expires_at: 1_800_000_000_000,
    },
    grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  };

  it('re-connecting updates in place and preserves the sync cursor', async () => {
    const first = await upsertOAuthAccount(
      { ...OAUTH_UPSERT, userId: REP_A_ACTOR.id },
      REP_A_ACTOR,
    );
    await pool.query(
      `UPDATE connected_accounts SET sync_cursor = 'cursor-1', status = 'error' WHERE id = $1`,
      [first.id],
    );

    const second = await upsertOAuthAccount(
      {
        ...OAUTH_UPSERT,
        userId: REP_A_ACTOR.id,
        auth: { ...OAUTH_UPSERT.auth, access_token: 'access-two' },
      },
      REP_A_ACTOR,
    );

    expect(second.id).toBe(first.id);
    expect(second.status).toBe('active');

    const row = await pool.query<{ sync_cursor: string | null }>(
      'SELECT sync_cursor FROM connected_accounts WHERE id = $1',
      [first.id],
    );
    expect(row.rows[0].sync_cursor).toBe('cursor-1');

    const internal = await getConnectedAccountInternal(first.id, REP_A_ACTOR.id);
    expect((internal!.auth as { access_token: string }).access_token).toBe('access-two');
  });

  it('persists the scopes the provider granted', async () => {
    const account = await upsertOAuthAccount(
      { ...OAUTH_UPSERT, userId: REP_A_ACTOR.id, grantedScopes: ['gmail.readonly'] },
      REP_A_ACTOR,
    );

    expect(account.granted_scopes).toEqual(['gmail.readonly']);
  });
});

describe('audit entries', () => {
  it('writes a connect entry in the same transaction as the insert', async () => {
    const account = await createImapAccount(REP_A_ACTOR.id, IMAP_INPUT, REP_A_ACTOR);

    const entries = await pool.query<{ event_type: string; record_id: string; new_value: string }>(
      `SELECT event_type, record_id, new_value FROM audit_log WHERE changed_by_id = $1`,
      [REP_A_ACTOR.id],
    );

    expect(entries.rows).toHaveLength(1);
    expect(entries.rows[0].event_type).toBe('connected_account_connected');
    expect(entries.rows[0].record_id).toBe(account.id);
    expect(entries.rows[0].new_value).toBe('imap');
  });

  it('writes a disconnect entry and returns credentials for revocation', async () => {
    const account = await createImapAccount(REP_A_ACTOR.id, IMAP_INPUT, REP_A_ACTOR);
    await clearAuditLogFor(REP_A_ACTOR.id);

    const deleted = await deleteConnectedAccount(account.id, REP_A_ACTOR.id, REP_A_ACTOR);

    expect(deleted).not.toBeNull();
    expect(deleted!.provider).toBe('imap');
    expect(deleted!.auth).toMatchObject({ kind: 'imap', password: IMAP_INPUT.password });

    const entries = await pool.query<{ event_type: string; old_value: string }>(
      `SELECT event_type, old_value FROM audit_log WHERE changed_by_id = $1`,
      [REP_A_ACTOR.id],
    );
    expect(entries.rows).toHaveLength(1);
    expect(entries.rows[0].event_type).toBe('connected_account_disconnected');
    expect(entries.rows[0].old_value).toBe('imap');
  });

  it('never writes the credential into the audit entry', async () => {
    await createImapAccount(REP_A_ACTOR.id, IMAP_INPUT, REP_A_ACTOR);

    const entries = await pool.query(`SELECT * FROM audit_log WHERE changed_by_id = $1`, [
      REP_A_ACTOR.id,
    ]);
    expect(JSON.stringify(entries.rows)).not.toContain(IMAP_INPUT.password);
  });

  it('leaves no account behind when the insert conflicts after an audit write', async () => {
    await createImapAccount(REP_A_ACTOR.id, IMAP_INPUT, REP_A_ACTOR);
    await clearAuditLogFor(REP_A_ACTOR.id);

    await expect(createImapAccount(REP_A_ACTOR.id, IMAP_INPUT, REP_A_ACTOR)).rejects.toMatchObject({
      code: 'CONNECTED_ACCOUNT_DUPLICATE',
    });

    // The rolled-back transaction must take its audit entry with it.
    const entries = await pool.query(`SELECT id FROM audit_log WHERE changed_by_id = $1`, [
      REP_A_ACTOR.id,
    ]);
    expect(entries.rows).toHaveLength(0);
    await expect(listConnectedAccounts(REP_A_ACTOR.id)).resolves.toHaveLength(1);
  });
});

describe('user deletion cascade', () => {
  it('removes accounts when the owning user is hard-deleted', async () => {
    const doomed = await createUser({
      email: `${FILE_PREFIX}-doomed@example.com`,
      name: 'Doomed Rep',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    await createImapAccount(doomed.id, IMAP_INPUT, { id: doomed.id, name: 'Doomed Rep' });

    await pool.query('DELETE FROM users WHERE id = $1', [doomed.id]);

    const remaining = await pool.query('SELECT id FROM connected_accounts WHERE user_id = $1', [
      doomed.id,
    ]);
    expect(remaining.rows).toHaveLength(0);
  });
});
