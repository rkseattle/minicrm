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
  claimAccountsDueForSync,
  createImapAccount,
  deleteConnectedAccount,
  getAccountAuthForSync,
  getConnectedAccountInternal,
  getUsableAccessToken,
  IMPLEMENTED_SYNC_PROVIDERS,
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

describe('access token refresh', () => {
  const EXPIRED = Date.now() - 60_000;
  const FUTURE = Date.now() + 3_600_000;

  async function seedOAuthAccount(expiresAt: number | null, refreshToken: string | null) {
    const account = await upsertOAuthAccount(
      {
        userId: REP_A_ACTOR.id,
        provider: 'google',
        emailAddress: `${FILE_PREFIX}-refresh@example.com`,
        auth: {
          kind: 'oauth',
          access_token: 'old-access',
          refresh_token: refreshToken,
          expires_at: expiresAt,
        },
        grantedScopes: [],
      },
      REP_A_ACTOR,
    );
    return account.id;
  }

  it('returns the stored token without refreshing when it is still valid', async () => {
    const id = await seedOAuthAccount(FUTURE, 'refresh-one');
    let calls = 0;

    const token = await getUsableAccessToken(id, REP_A_ACTOR.id, REP_A_ACTOR, async () => {
      calls += 1;
      return { accessToken: 'new-access', refreshToken: 'refresh-two', expiresAt: FUTURE };
    });

    expect(token).toBe('old-access');
    expect(calls).toBe(0);
  });

  it('refreshes an expired token and persists the rotated refresh token', async () => {
    const id = await seedOAuthAccount(EXPIRED, 'refresh-one');

    const token = await getUsableAccessToken(id, REP_A_ACTOR.id, REP_A_ACTOR, async () => ({
      accessToken: 'new-access',
      refreshToken: 'refresh-two',
      expiresAt: FUTURE,
    }));

    expect(token).toBe('new-access');

    const internal = await getConnectedAccountInternal(id, REP_A_ACTOR.id);
    expect(internal!.auth).toMatchObject({
      access_token: 'new-access',
      refresh_token: 'refresh-two',
    });
  });

  it('marks the account in error when the provider refuses the refresh', async () => {
    const id = await seedOAuthAccount(EXPIRED, 'refresh-one');

    const token = await getUsableAccessToken(id, REP_A_ACTOR.id, REP_A_ACTOR, () => {
      throw new Error('invalid_grant');
    });

    expect(token).toBeNull();

    const [account] = await listConnectedAccounts(REP_A_ACTOR.id);
    expect(account.status).toBe('error');
    expect(account.status_detail).toBe('PROVIDER_AUTH_EXPIRED');
  });

  it('marks the account in error when no refresh token was ever stored', async () => {
    const id = await seedOAuthAccount(EXPIRED, null);

    await expect(
      getUsableAccessToken(id, REP_A_ACTOR.id, REP_A_ACTOR, async () => ({
        accessToken: 'unused',
        refreshToken: null,
        expiresAt: FUTURE,
      })),
    ).resolves.toBeNull();

    const [account] = await listConnectedAccounts(REP_A_ACTOR.id);
    expect(account.status).toBe('error');
  });

  /*
   * The row lock is the whole point: without FOR UPDATE both callers see the expired
   * token and both spend the refresh token, and Microsoft rotates it — so the loser
   * persists one the provider has already invalidated.
   */
  it('spends the refresh token exactly once under concurrent callers', async () => {
    const id = await seedOAuthAccount(EXPIRED, 'refresh-one');
    let calls = 0;

    const refresh = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { accessToken: `new-access-${calls}`, refreshToken: 'refresh-two', expiresAt: FUTURE };
    };

    const [first, second] = await Promise.all([
      getUsableAccessToken(id, REP_A_ACTOR.id, REP_A_ACTOR, refresh),
      getUsableAccessToken(id, REP_A_ACTOR.id, REP_A_ACTOR, refresh),
    ]);

    expect(calls).toBe(1);
    expect(first).toBe(second);
  });

  it("returns null for another user's account", async () => {
    const id = await seedOAuthAccount(FUTURE, 'refresh-one');

    await expect(
      getUsableAccessToken(id, REP_B_ACTOR.id, REP_B_ACTOR, async () => ({
        accessToken: 'nope',
        refreshToken: null,
        expiresAt: FUTURE,
      })),
    ).resolves.toBeNull();
  });
});

describe('deleting an OAuth account returns its tokens for revocation', () => {
  it('hands back the refresh token so the caller can revoke it upstream', async () => {
    const account = await upsertOAuthAccount(
      {
        userId: REP_A_ACTOR.id,
        provider: 'google',
        emailAddress: `${FILE_PREFIX}-revoke@example.com`,
        auth: {
          kind: 'oauth',
          access_token: 'access-to-revoke',
          refresh_token: 'refresh-to-revoke',
          expires_at: null,
        },
        grantedScopes: [],
      },
      REP_A_ACTOR,
    );

    const deleted = await deleteConnectedAccount(account.id, REP_A_ACTOR.id, REP_A_ACTOR);

    expect(deleted).not.toBeNull();
    expect(deleted!.provider).toBe('google');
    expect(deleted!.auth).toMatchObject({
      kind: 'oauth',
      refresh_token: 'refresh-to-revoke',
    });
  });
});

describe('audit entries for an expired refresh token', () => {
  it('records the mailbox as disconnected when the provider refuses the refresh', async () => {
    const account = await upsertOAuthAccount(
      {
        userId: REP_A_ACTOR.id,
        provider: 'google',
        emailAddress: `${FILE_PREFIX}-expired@example.com`,
        auth: {
          kind: 'oauth',
          access_token: 'stale',
          refresh_token: 'refresh-one',
          expires_at: Date.now() - 3_600_000,
        },
        grantedScopes: [],
      },
      REP_A_ACTOR,
    );
    await clearAuditLogFor(REP_A_ACTOR.id);

    await getUsableAccessToken(account.id, REP_A_ACTOR.id, REP_A_ACTOR, () => {
      throw new Error('invalid_grant');
    });

    const entries = await pool.query<{ event_type: string; old_value: string }>(
      `SELECT event_type, old_value FROM audit_log WHERE changed_by_id = $1`,
      [REP_A_ACTOR.id],
    );
    expect(entries.rows).toHaveLength(1);
    expect(entries.rows[0].event_type).toBe('connected_account_disconnected');
    expect(entries.rows[0].old_value).toBe('PROVIDER_AUTH_EXPIRED');
  });
});

describe('scheduler-facing account claim', () => {
  /** Puts an account into a state the claim query should or should not pick up. */
  async function setSyncState(
    accountId: string,
    state: {
      status?: string;
      nextAttemptAt?: Date | null;
      failureCount?: number;
    },
  ): Promise<void> {
    await pool.query(
      `UPDATE connected_accounts
          SET status = COALESCE($2, status),
              sync_next_attempt_at = $3,
              sync_failure_count = COALESCE($4, sync_failure_count)
        WHERE id = $1`,
      [accountId, state.status ?? null, state.nextAttemptAt ?? null, state.failureCount ?? null],
    );
  }

  /** Only this file's fixtures, so a stray row from another suite cannot pass a test. */
  async function claimOwn(limit = 10): Promise<string[]> {
    const claimed = await claimAccountsDueForSync(limit);
    return claimed
      .filter((a) => a.userId === REP_A_ACTOR.id || a.userId === REP_B_ACTOR.id)
      .map((a) => a.id);
  }

  it('claims a mailbox that has never been synced', async () => {
    const account = await createImapAccount(REP_A_ACTOR.id, IMAP_INPUT, REP_A_ACTOR);

    expect(await claimOwn()).toContain(account.id);
  });

  it('does not claim one whose backoff has not elapsed', async () => {
    const account = await createImapAccount(REP_A_ACTOR.id, IMAP_INPUT, REP_A_ACTOR);
    await setSyncState(account.id, { nextAttemptAt: new Date(Date.now() + 60_000) });

    expect(await claimOwn()).not.toContain(account.id);
  });

  it('claims an errored mailbox once its backoff elapses, so the retry is real', async () => {
    // Excluding 'error' would make the backoff columns write-only: one failure would
    // retire the mailbox permanently.
    const account = await createImapAccount(REP_A_ACTOR.id, IMAP_INPUT, REP_A_ACTOR);
    await setSyncState(account.id, {
      status: 'error',
      failureCount: 3,
      nextAttemptAt: new Date(Date.now() - 1_000),
    });

    expect(await claimOwn()).toContain(account.id);
  });

  it('never claims a disconnected mailbox, which is a user decision not a fault', async () => {
    const account = await createImapAccount(REP_A_ACTOR.id, IMAP_INPUT, REP_A_ACTOR);
    await setSyncState(account.id, { status: 'disconnected' });

    expect(await claimOwn()).not.toContain(account.id);
  });

  it('never claims a mailbox belonging to a deactivated user', async () => {
    // auth.ts refuses any request from a non-active user; their mailbox must stop syncing
    // for the same reason.
    const account = await createImapAccount(REP_B_ACTOR.id, IMAP_INPUT, REP_B_ACTOR);
    await pool.query(`UPDATE users SET status = 'inactive' WHERE id = $1`, [REP_B_ACTOR.id]);

    try {
      expect(await claimOwn()).not.toContain(account.id);
    } finally {
      await pool.query(`UPDATE users SET status = 'active' WHERE id = $1`, [REP_B_ACTOR.id]);
    }
  });

  it('never claims a provider with no driver', async () => {
    const account = await upsertOAuthAccount(
      {
        userId: REP_A_ACTOR.id,
        provider: 'google',
        emailAddress: `${FILE_PREFIX}-google@example.com`,
        auth: { kind: 'oauth', access_token: 'token', refresh_token: 'refresh', expires_at: null },
        grantedScopes: [],
      },
      REP_A_ACTOR,
    );

    expect(IMPLEMENTED_SYNC_PROVIDERS).not.toContain('google');
    expect(await claimOwn()).not.toContain(account.id);
  });

  it('leases what it claims, so a second tick does not resync the same mailbox', async () => {
    // The claim is a write, not a held lock: a sync runs for minutes and the transaction
    // that claimed it is long gone by then.
    const account = await createImapAccount(REP_A_ACTOR.id, IMAP_INPUT, REP_A_ACTOR);

    const first = await claimOwn();
    const second = await claimOwn();

    expect(first).toContain(account.id);
    expect(second).not.toContain(account.id);
  });

  it('carries the owner role, so the tick needs no per-account lookup', async () => {
    const account = await createImapAccount(REP_A_ACTOR.id, IMAP_INPUT, REP_A_ACTOR);

    const claimed = (await claimAccountsDueForSync(10)).find((a) => a.id === account.id);

    expect(claimed?.userRole).toBe('rep');
    expect(claimed?.userId).toBe(REP_A_ACTOR.id);
  });

  it('returns no credential material', async () => {
    const account = await createImapAccount(REP_A_ACTOR.id, IMAP_INPUT, REP_A_ACTOR);

    const claimed = (await claimAccountsDueForSync(10)).find((a) => a.id === account.id);

    expect(JSON.stringify(claimed)).not.toContain(IMAP_INPUT.password);
    expect(JSON.stringify(claimed)).not.toContain(IMAP_INPUT.host);
  });

  it('honors the batch limit', async () => {
    // Asserted against the raw return, not this file's fixtures: the limit applies to the
    // whole due set, and other suites' accounts share the table.
    await createImapAccount(REP_A_ACTOR.id, IMAP_INPUT, REP_A_ACTOR);
    await createImapAccount(
      REP_A_ACTOR.id,
      { ...IMAP_INPUT, email_address: `${FILE_PREFIX}-second@example.com` },
      REP_A_ACTOR,
    );

    expect((await claimAccountsDueForSync(1)).length).toBeLessThanOrEqual(1);
    expect((await claimAccountsDueForSync(5)).length).toBeLessThanOrEqual(5);
  });
});

describe('sync recovery', () => {
  it('clears the backoff when a connection test marks the mailbox active again', async () => {
    // POST /:id/test is the documented way back. Without this reset a mailbox past the
    // failure ceiling could never be claimed again.
    const account = await createImapAccount(REP_A_ACTOR.id, IMAP_INPUT, REP_A_ACTOR);
    await pool.query(
      `UPDATE connected_accounts
          SET status = 'error', sync_failure_count = 9,
              sync_next_attempt_at = $2
        WHERE id = $1`,
      [account.id, new Date(Date.now() + 86_400_000)],
    );

    await updateAccountStatus(account.id, REP_A_ACTOR.id, 'active', null);

    const row = await pool.query<{ sync_failure_count: number; sync_next_attempt_at: Date | null }>(
      'SELECT sync_failure_count, sync_next_attempt_at FROM connected_accounts WHERE id = $1',
      [account.id],
    );
    expect(row.rows[0].sync_failure_count).toBe(0);
    expect(row.rows[0].sync_next_attempt_at).toBeNull();

    const claimed = await claimAccountsDueForSync(10);
    expect(claimed.map((a) => a.id)).toContain(account.id);
  });

  it('leaves the backoff alone when the status is not active', async () => {
    const account = await createImapAccount(REP_A_ACTOR.id, IMAP_INPUT, REP_A_ACTOR);
    const due = new Date(Date.now() + 3_600_000);
    await pool.query(
      `UPDATE connected_accounts SET sync_failure_count = 4, sync_next_attempt_at = $2 WHERE id = $1`,
      [account.id, due],
    );

    await updateAccountStatus(account.id, REP_A_ACTOR.id, 'error', 'still failing');

    const row = await pool.query<{ sync_failure_count: number; sync_next_attempt_at: Date | null }>(
      'SELECT sync_failure_count, sync_next_attempt_at FROM connected_accounts WHERE id = $1',
      [account.id],
    );
    expect(row.rows[0].sync_failure_count).toBe(4);
    expect(row.rows[0].sync_next_attempt_at?.getTime()).toBe(due.getTime());
  });
});

describe('getAccountAuthForSync', () => {
  it('round-trips IMAP credentials without a user id', async () => {
    const account = await createImapAccount(REP_A_ACTOR.id, IMAP_INPUT, REP_A_ACTOR);

    const auth = await getAccountAuthForSync(account.id);

    expect(auth).toEqual({
      kind: 'imap',
      host: IMAP_INPUT.host,
      port: IMAP_INPUT.port,
      username: IMAP_INPUT.username,
      password: IMAP_INPUT.password,
      secure: IMAP_INPUT.secure,
    });
  });

  it('refuses an OAuth account, whose refresh path this seam does not carry', async () => {
    const account = await upsertOAuthAccount(
      {
        userId: REP_A_ACTOR.id,
        provider: 'google',
        emailAddress: `${FILE_PREFIX}-oauth@example.com`,
        auth: { kind: 'oauth', access_token: 'token', refresh_token: 'refresh', expires_at: null },
        grantedScopes: [],
      },
      REP_A_ACTOR,
    );

    expect(await getAccountAuthForSync(account.id)).toBeNull();
  });

  it('refuses a non-IMAP provider even when the stored payload looks like IMAP', async () => {
    // The provider column is the gate, not the payload's shape. Checking only the payload
    // would let a Google account with IMAP-shaped credentials through to a driver whose
    // token-refresh path it needs and this seam does not carry.
    const account = await upsertOAuthAccount(
      {
        userId: REP_A_ACTOR.id,
        provider: 'microsoft',
        emailAddress: `${FILE_PREFIX}-shaped@example.com`,
        auth: { kind: 'oauth', access_token: 'token', refresh_token: null, expires_at: null },
        grantedScopes: [],
      },
      REP_A_ACTOR,
    );

    // Rewrite the ciphertext to an IMAP payload, leaving provider = 'microsoft'.
    const imapLike = await createImapAccount(
      REP_B_ACTOR.id,
      { ...IMAP_INPUT, email_address: `${FILE_PREFIX}-donor@example.com` },
      REP_B_ACTOR,
    );
    await pool.query(
      `UPDATE connected_accounts SET auth_encrypted = donor.auth_encrypted,
              key_version = donor.key_version
         FROM (SELECT auth_encrypted, key_version FROM connected_accounts WHERE id = $2) donor
        WHERE connected_accounts.id = $1`,
      [account.id, imapLike.id],
    );

    expect(await getAccountAuthForSync(account.id)).toBeNull();
  });

  it('returns null for an account that no longer exists', async () => {
    expect(await getAccountAuthForSync('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});
