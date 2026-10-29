/**
 * Connected account service — per-user linked mailboxes and their credentials.
 *
 * Credentials are stored as AES-256-GCM ciphertext via cryptoService's versioned API,
 * with the key version alongside so a rotated keyring can still read old rows. OAuth
 * token sets and IMAP credentials both serialize to JSON before encryption, so one
 * opaque column serves every provider.
 *
 * The row type is deliberately private and the response type has no ciphertext field at
 * all: the only way out of this module is through toConnectedAccountResponse, so there is
 * no shape a caller could accidentally serialize a credential from.
 *
 * Ownership is a WHERE clause rather than a post-fetch check. No one — admin included —
 * may read or delete another user's mailbox credentials, so scoping every query by
 * user_id is both stricter and impossible for a caller to forget.
 */

import type { PoolClient } from 'pg';

import type {
  ConnectedAccountProvider,
  ConnectedAccountResponse,
  ConnectedAccountStatus,
  ConnectedAccountStatusDetail,
  ImapCredentialsInput,
  OAuthProvider,
} from '@minicrm/shared/schemas/connectedAccountSchema.js';

import pool from '../db.js';
import { canSendFrom } from './mail/sendGrants.js';
import logger from '../logger.js';

import type { AuditActor } from './auditService.js';
import { SYSTEM_ACTOR, diffFields, writeAuditEntries, writeAuditEntry } from './auditService.js';
import { decryptVersioned, encryptVersioned } from './cryptoService.js';
import { PROVIDER_AUTH_EXPIRED } from './imapConnectionService.js';
import { isDeadGrantError } from './oauthProviderService.js';
import type { RefreshedTokens } from './oauthProviderService.js';

// ── Row type ──────────────────────────────────────────────────────────────────

interface ConnectedAccountRow {
  id: string;
  user_id: string;
  provider: ConnectedAccountProvider;
  email_address: string;
  auth_encrypted: string;
  granted_scopes: string[];
  status: ConnectedAccountStatus;
  status_detail: string | null;
  last_sync_at: Date | null;
  sync_cursor: string | null;
  sync_failure_count: number;
  sync_next_attempt_at: Date | null;
  excluded_domains: string[];
  sync_paused_at: Date | null;
  key_version: number;
  created_at: Date;
  updated_at: Date;
}

/** Every column except the credential material, for queries that never decrypt. */
const PUBLIC_COLUMNS =
  'id, user_id, provider, email_address, granted_scopes, status, status_detail, last_sync_at, excluded_domains, sync_paused_at, created_at, updated_at';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Decrypted IMAP credentials. Never returned to a client. */
export interface ImapAuthPayload {
  kind: 'imap';
  host: string;
  port: number;
  username: string;
  password: string;
  secure: boolean;
}

/** Decrypted OAuth token set. Never returned to a client. */
export interface OAuthAuthPayload {
  kind: 'oauth';
  access_token: string;
  refresh_token: string | null;
  /** Epoch milliseconds at which access_token stops being usable. */
  expires_at: number | null;
}

export type ConnectedAccountAuth = ImapAuthPayload | OAuthAuthPayload;

/**
 * Providers with a working sync driver.
 *
 * The single source of truth for what the scheduler may claim. A provider absent from
 * this list is never picked up and so never marked failed for lacking a driver — it
 * simply does not sync, which is what a mailbox connected before its provider shipped
 * should do.
 */
export const IMPLEMENTED_SYNC_PROVIDERS: readonly ConnectedAccountProvider[] = [
  'imap',
  'google',
  'microsoft',
];

/**
 * How long a claimed mailbox is withheld from other ticks.
 *
 * Long enough that a normal sync finishes inside it, short enough that a mailbox orphaned
 * by a crashed process comes back on its own. Retrying an interrupted sync is safe: the
 * cursor only advances on a completed page and the message ingest is idempotent.
 */
export const SYNC_CLAIM_LEASE_MS = 15 * 60 * 1000;

/**
 * Consecutive failures after which a mailbox stops being retried until a user acts.
 *
 * Lives here, not in the sync engine, because the claim query is what has to enforce it.
 * A retired mailbox is parked with a null sync_next_attempt_at, which the due predicate
 * below reads as "due now" — the same value a recovered account carries. The counter is
 * the only field that separates the two, so both sides must read one constant.
 */
export const MAX_SYNC_FAILURES = 8;

/** One mailbox the scheduler has claimed. Carries no credential material. */
export interface ClaimedSyncAccount {
  id: string;
  userId: string;
  /** The owner's role, joined here because the feature-flag check needs it. */
  userRole: string;
  provider: ConnectedAccountProvider;
  emailAddress: string;
  syncCursor: string | null;
  syncFailureCount: number;
  /**
   * What the provider actually granted, joined here for the same reason userRole is: the
   * driver has to check it before reading a mailbox and the scheduler has nowhere else to
   * read it from.
   */
  grantedScopes: string[];
  /** The owner's own never-sync list; the sync engine merges it with the org list. */
  excludedDomains: string[];
}

/** A connected account with its credentials decrypted, for internal use only. */
export interface ConnectedAccountInternal {
  id: string;
  userId: string;
  provider: ConnectedAccountProvider;
  emailAddress: string;
  auth: ConnectedAccountAuth;
  keyVersion: number;
  /** What the provider granted. A connection test checks it alongside the token. */
  grantedScopes: string[];
}

/** Fields an OAuth callback persists for a newly connected or re-connected mailbox. */
export interface OAuthAccountUpsert {
  userId: string;
  provider: ConnectedAccountProvider;
  emailAddress: string;
  auth: OAuthAuthPayload;
  grantedScopes: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Narrows a stored provider to one that has OAuth configuration.
 *
 * Without this an `imap` row carrying an OAuth payload reaches refreshAccessToken, where
 * the provider table has no entry and the thunk throws a TypeError the caller's catch
 * silently converts into a permanent auth failure.
 */
function isOAuthProvider(provider: ConnectedAccountProvider): provider is OAuthProvider {
  return provider === 'google' || provider === 'microsoft';
}

/**
 * Decrypts one row's stored credentials.
 *
 * Returns null rather than throwing: every caller's answer to unreadable ciphertext is
 * the same — treat the account as unusable — and a key that has been retired from the
 * environment makes this the expected outcome, not an exception.
 */
function decryptAuth(row: ConnectedAccountRow, context: string): ConnectedAccountAuth | null {
  try {
    return JSON.parse(
      decryptVersioned(row.auth_encrypted, row.key_version),
    ) as ConnectedAccountAuth;
  } catch (err) {
    logger.error({ err, accountId: row.id, context }, 'connectedAccountService: decrypt failed');
    return null;
  }
}

/** Maps a row to the shape the API returns. The only exit from this module. */
function toConnectedAccountResponse(
  row: Omit<ConnectedAccountRow, 'auth_encrypted' | 'key_version' | 'user_id' | 'sync_cursor'>,
): ConnectedAccountResponse {
  return {
    id: row.id,
    provider: row.provider,
    email_address: row.email_address,
    granted_scopes: row.granted_scopes,
    can_send: canSendFrom(row.provider, row.granted_scopes),
    status: row.status,
    status_detail: row.status_detail,
    last_sync_at: row.last_sync_at ? row.last_sync_at.toISOString() : null,
    sync_paused: row.sync_paused_at !== null,
    excluded_domains: row.excluded_domains,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/** Wraps a PG unique violation on the mailbox key as a domain error. */
function asDuplicateError(err: unknown): Error | null {
  if ((err as { code?: string }).code !== '23505') return null;
  return Object.assign(new Error('That mailbox is already connected to your account'), {
    code: 'CONNECTED_ACCOUNT_DUPLICATE',
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Returns the caller's own connected accounts, newest first. */
export async function listConnectedAccounts(userId: string): Promise<ConnectedAccountResponse[]> {
  const result = await pool.query<ConnectedAccountRow>(
    `SELECT ${PUBLIC_COLUMNS} FROM connected_accounts WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows.map(toConnectedAccountResponse);
}

/** Fields an owner may change on their own mailbox; absent fields are left as they are. */
export interface ConnectedAccountSettingsPatch {
  syncPaused?: boolean;
  excludedDomains?: string[];
}

/**
 * Applies the owner's own sync controls to one mailbox, audited in the same transaction.
 *
 * Pausing records when, and resuming clears it; re-sending the current state writes
 * nothing and no audit entry. Resuming leaves `sync_next_attempt_at` alone: it is also the
 * claim lease and the failure backoff, so a resume never shortens either, and a mailbox
 * whose due time passed while paused is claimed oldest-due-first like any other.
 *
 * @returns null when no such account belongs to this user.
 */
export async function updateConnectedAccountSettings(
  accountId: string,
  userId: string,
  patch: ConnectedAccountSettingsPatch,
  actor: AuditActor,
): Promise<ConnectedAccountResponse | null> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query<ConnectedAccountRow>(
      `SELECT ${PUBLIC_COLUMNS} FROM connected_accounts
        WHERE id = $1 AND user_id = $2
          FOR UPDATE`,
      [accountId, userId],
    );
    const before = current.rows[0];
    if (!before) {
      await client.query('ROLLBACK');
      return null;
    }

    const wasPaused = before.sync_paused_at !== null;
    const pausedChanged = patch.syncPaused !== undefined && patch.syncPaused !== wasPaused;
    const domainsChanged =
      patch.excludedDomains !== undefined &&
      [...patch.excludedDomains].sort().join(',') !== [...before.excluded_domains].sort().join(',');
    if (!pausedChanged && !domainsChanged) {
      await client.query('COMMIT');
      return toConnectedAccountResponse(before);
    }

    const updated = await client.query<ConnectedAccountRow>(
      `UPDATE connected_accounts
          SET sync_paused_at = CASE WHEN $3::boolean THEN
                                 CASE WHEN $4::boolean THEN NOW() ELSE NULL END
                               ELSE sync_paused_at END,
              excluded_domains = COALESCE($5::text[], excluded_domains),
              updated_at = NOW()
        WHERE id = $1 AND user_id = $2
    RETURNING ${PUBLIC_COLUMNS}`,
      [accountId, userId, pausedChanged, patch.syncPaused ?? false, patch.excludedDomains ?? null],
    );
    // The row was locked above and the WHERE is unchanged, so the update always matches.
    const after = updated.rows[0]!;

    const entries = diffFields(
      { sync_paused: wasPaused, excluded_domains: before.excluded_domains.join(', ') },
      {
        sync_paused: after.sync_paused_at !== null,
        excluded_domains: after.excluded_domains.join(', '),
      },
      {
        recordType: 'connected_account',
        recordId: after.id,
        recordName: after.email_address,
        changedById: actor.id,
        changedByName: actor.name,
      },
    );
    await writeAuditEntries(client, entries);

    await client.query('COMMIT');
    return toConnectedAccountResponse(after);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Whether the owner has paused this mailbox since it was claimed.
 *
 * The claim query skips paused mailboxes, but a backfill reads several pages per tick;
 * checked between pages, a pause stops it at the next page instead of the next tick.
 */
export async function isSyncPaused(accountId: string): Promise<boolean> {
  const result = await pool.query<{ paused: boolean }>(
    `SELECT sync_paused_at IS NOT NULL AS paused FROM connected_accounts WHERE id = $1`,
    [accountId],
  );
  // A mailbox deleted mid-backfill has nothing left to sync, which pausing also means.
  return result.rows[0]?.paused ?? true;
}

/**
 * Returns one account with its credentials decrypted.
 * For internal callers only — the connection test and the sync work. Never return the
 * `auth` field to a client.
 *
 * @returns null when no such account belongs to this user, or when its ciphertext cannot
 *   be decrypted — a corrupt row is indistinguishable from an absent one to every caller.
 */
export async function getConnectedAccountInternal(
  accountId: string,
  userId: string,
): Promise<ConnectedAccountInternal | null> {
  const result = await pool.query<ConnectedAccountRow>(
    `SELECT id, user_id, provider, email_address, auth_encrypted, key_version,
            granted_scopes
       FROM connected_accounts WHERE id = $1 AND user_id = $2`,
    [accountId, userId],
  );
  const row = result.rows[0];
  if (!row) return null;

  const auth = decryptAuth(row, 'internal-read');
  if (auth === null) return null;

  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    emailAddress: row.email_address,
    auth,
    keyVersion: row.key_version,
    grantedScopes: row.granted_scopes,
  };
}

/**
 * Persists a mailbox connected with IMAP credentials.
 * The caller must have already tested the connection — this function stores what it is
 * given.
 */
export async function createImapAccount(
  userId: string,
  input: ImapCredentialsInput,
  actor: AuditActor,
): Promise<ConnectedAccountResponse> {
  const payload: ImapAuthPayload = {
    kind: 'imap',
    host: input.host,
    port: input.port,
    username: input.username,
    password: input.password,
    secure: input.secure,
  };
  const encrypted = encryptVersioned(JSON.stringify(payload));

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<ConnectedAccountRow>(
      `INSERT INTO connected_accounts
         (user_id, provider, email_address, auth_encrypted, key_version)
       VALUES ($1, 'imap', $2, $3, $4)
       RETURNING ${PUBLIC_COLUMNS}`,
      [userId, input.email_address, encrypted.ciphertext, encrypted.keyVersion],
    );

    const created = result.rows[0];
    await writeAuditEntry(client, {
      recordType: 'connected_account',
      recordId: created.id,
      recordName: created.email_address,
      eventType: 'connected_account_connected',
      newValue: 'imap',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    return toConnectedAccountResponse(created);
  } catch (err) {
    await client.query('ROLLBACK');
    const duplicate = asDuplicateError(err);
    if (duplicate) throw duplicate;
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Creates or refreshes the mailbox an OAuth callback just authorized.
 *
 * Re-connecting an already-linked mailbox is the ordinary path — a token revoked at the
 * provider, a scope change, a re-consent — so this upserts rather than failing on the
 * unique key. `sync_cursor` and `last_sync_at` are preserved: re-authorizing is not a
 * reason to re-read a mailbox from the beginning.
 */
export async function upsertOAuthAccount(
  params: OAuthAccountUpsert,
  actor: AuditActor,
): Promise<ConnectedAccountResponse> {
  const encrypted = encryptVersioned(JSON.stringify(params.auth));

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<ConnectedAccountRow>(
      `INSERT INTO connected_accounts
         (user_id, provider, email_address, auth_encrypted, key_version, granted_scopes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, provider, email_address) DO UPDATE SET
         auth_encrypted = EXCLUDED.auth_encrypted,
         key_version    = EXCLUDED.key_version,
         granted_scopes = EXCLUDED.granted_scopes,
         status         = 'active',
         status_detail  = NULL,
         -- Re-consenting is the ordinary way back for a retired mailbox, so it has to
         -- clear the counter the claim query gates on; status alone would restore the
         -- account without returning it to the schedule.
         sync_failure_count = 0,
         sync_next_attempt_at = NULL
       RETURNING ${PUBLIC_COLUMNS}`,
      [
        params.userId,
        params.provider,
        params.emailAddress,
        encrypted.ciphertext,
        encrypted.keyVersion,
        params.grantedScopes,
      ],
    );

    const saved = result.rows[0];
    await writeAuditEntry(client, {
      recordType: 'connected_account',
      recordId: saved.id,
      recordName: saved.email_address,
      eventType: 'connected_account_connected',
      newValue: params.provider,
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    return toConnectedAccountResponse(saved);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Deletes one of the caller's own accounts.
 *
 * Returns the decrypted credentials of the deleted row so the caller can revoke them at
 * the provider after the transaction commits — a third-party HTTP call must never run
 * inside a transaction holding row locks.
 *
 * @returns null when no such account belongs to this user.
 */
export async function deleteConnectedAccount(
  accountId: string,
  userId: string,
  actor: AuditActor,
): Promise<{ provider: ConnectedAccountProvider; auth: ConnectedAccountAuth | null } | null> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<ConnectedAccountRow>(
      `DELETE FROM connected_accounts WHERE id = $1 AND user_id = $2
       RETURNING id, provider, email_address, auth_encrypted, key_version`,
      [accountId, userId],
    );

    const row = result.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return null;
    }

    await writeAuditEntry(client, {
      recordType: 'connected_account',
      recordId: row.id,
      recordName: row.email_address,
      eventType: 'connected_account_disconnected',
      oldValue: row.provider,
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');

    // The row is already gone and the disconnect succeeded; a null here costs only the
    // provider-side revocation, which is best-effort anyway.
    const auth = decryptAuth(row, 'revocation');

    return { provider: row.provider, auth };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** How close to expiry an access token is refreshed rather than used. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

/**
 * Marks a mailbox unusable because the provider refused its refresh token.
 *
 * Audited, unlike the transient probe result `updateAccountStatus` records: this is the
 * end of the account's working life until the user re-consents, which is exactly the
 * lifecycle event the connect and disconnect entries exist to sit alongside.
 *
 * The mailbox is parked at the same time, and that is not decoration: a refused refresh
 * token is not a transient failure, so leaving the row claimable means the scheduler asks
 * the provider the same dead question every lease and writes one of these entries each
 * time. `sync_failure_count` is what the claim query filters on, so it is the field that
 * has to move; the way back is a connection test, which clears it.
 */
async function markAuthExpired(
  client: PoolClient,
  account: { id: string; email_address: string },
  actor: AuditActor,
): Promise<void> {
  await client.query(
    `UPDATE connected_accounts
        SET status = 'error',
            status_detail = $1,
            sync_failure_count = $3,
            sync_next_attempt_at = NULL
      WHERE id = $2`,
    [PROVIDER_AUTH_EXPIRED, account.id, MAX_SYNC_FAILURES],
  );
  await writeAuditEntry(client, {
    recordType: 'connected_account',
    recordId: account.id,
    recordName: account.email_address,
    eventType: 'connected_account_disconnected',
    oldValue: PROVIDER_AUTH_EXPIRED,
    changedById: actor.id,
    changedByName: actor.name,
  });
}

/**
 * The locked check-and-refresh, over a row the caller has already selected FOR UPDATE.
 *
 * Shared by both entry points because the rule is the same and the reasoning is subtle:
 * without the lock, two concurrent callers both see an expired token and both spend the
 * refresh token — and Microsoft rotates it, so the loser persists one the provider has
 * already invalidated. The expiry is read after the lock is granted, so the loser sees the
 * winner's refreshed row rather than the stale one it queued on.
 *
 * This deliberately holds the lock across a third-party call, which deleteConnectedAccount
 * avoids doing. The difference is that revocation is fire-and-forget — losing it costs
 * nothing — whereas the refresh result must be written atomically with the check that
 * decided to refresh. refreshAccessToken carries its own timeout so a hung provider
 * cannot hold the lock indefinitely.
 *
 * @returns the OAuth payload carrying a usable access token, or null when the row is not
 *   OAuth, will not decrypt, or the provider refused the refresh — the row is then marked
 *   `error` and the caller's transaction is left to commit that.
 */
async function refreshLockedRow(
  client: PoolClient,
  row: ConnectedAccountRow,
  actor: AuditActor,
  refresh: (provider: OAuthProvider, refreshToken: string) => Promise<RefreshedTokens>,
  isDeadGrant: (err: unknown) => boolean = isDeadGrantError,
): Promise<OAuthAuthPayload | null> {
  const auth = decryptAuth(row, 'refresh');
  if (auth === null) return null;

  if (auth.kind !== 'oauth') {
    logger.warn(
      { accountId: row.id, provider: row.provider },
      'connectedAccountService: refusing to refresh an account whose payload is not OAuth',
    );
    return null;
  }

  const stillValid =
    auth.expires_at === null || auth.expires_at - TOKEN_EXPIRY_MARGIN_MS > Date.now();
  if (stillValid) return auth;

  if (!auth.refresh_token) {
    await markAuthExpired(client, row, actor);
    return null;
  }

  if (!isOAuthProvider(row.provider)) {
    // Not marked expired: that message names an OAuth failure, and a password mailbox
    // reaching here has a bug upstream rather than a credential a user must re-grant.
    logger.warn(
      { accountId: row.id, provider: row.provider },
      'connectedAccountService: refusing to refresh a provider that has no OAuth config',
    );
    return null;
  }

  let refreshed: RefreshedTokens;
  try {
    refreshed = await refresh(row.provider, auth.refresh_token);
  } catch (err) {
    // Only a provider that ANSWERED that the grant is gone retires the mailbox. A timeout
    // or a 5xx says nothing about the credential, and markAuthExpired is not reversible
    // without re-consent — so treating an outage as a revocation would let one blip
    // permanently disconnect a working mailbox, including from the Test button a user
    // presses to recover.
    if (isDeadGrant(err)) {
      await markAuthExpired(client, row, actor);
      return null;
    }
    logger.warn(
      { err, accountId: row.id },
      'connectedAccountService: refresh failed without a verdict on the grant',
    );
    throw err;
  }

  const rotated: OAuthAuthPayload = {
    kind: 'oauth',
    access_token: refreshed.accessToken,
    refresh_token: refreshed.refreshToken,
    expires_at: refreshed.expiresAt,
  };
  const encrypted = encryptVersioned(JSON.stringify(rotated));

  // Deliberately leaves sync_failure_count alone, unlike the connect-test and
  // re-consent paths. A refreshed token proves the credential is valid, not that the
  // mailbox syncs — the failures that retire an account are usually fetch failures, and
  // rearming here would let a background refresh silently defeat the ceiling.
  await client.query(
    `UPDATE connected_accounts
       SET auth_encrypted = $1, key_version = $2, status = 'active', status_detail = NULL
     WHERE id = $3`,
    [encrypted.ciphertext, encrypted.keyVersion, row.id],
  );

  return rotated;
}

/**
 * Returns a usable access token for an OAuth account, refreshing it if it has expired.
 *
 * Scoped by user_id: this serves a request made by a person, so the account must be
 * theirs. The sync path deliberately is not — see getAccountAuthForSync.
 *
 * @param refresh - Injected so the seam is explicit and testable; there is no in-repo
 *   precedent for mocking openid-client.
 * @returns the access token, or null when the account is absent, not OAuth, or the
 *   provider refused the refresh — in which case the row is marked `error`.
 */
export async function getUsableAccessToken(
  accountId: string,
  userId: string,
  actor: AuditActor,
  refresh: (provider: OAuthProvider, refreshToken: string) => Promise<RefreshedTokens>,
): Promise<string | null> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<ConnectedAccountRow>(
      `SELECT id, provider, email_address, auth_encrypted, key_version FROM connected_accounts
       WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [accountId, userId],
    );
    const row = result.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return null;
    }

    const auth = await refreshLockedRow(client, row, actor, refresh);
    await client.query('COMMIT');
    return auth?.access_token ?? null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** A started OAuth flow, as read back by the callback. */
export interface OAuthFlowState {
  userId: string;
  provider: ConnectedAccountProvider;
  pkceVerifier: string;
}

/**
 * Records a started OAuth flow and sweeps abandoned ones.
 *
 * The sweep rides the insert because this table is written only at flow start: bounding
 * its growth on the write path costs one predicate and needs no scheduler.
 */
export async function createOAuthFlowState(params: {
  state: string;
  userId: string;
  provider: ConnectedAccountProvider;
  pkceVerifier: string;
  expiresAt: Date;
}): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM connected_account_oauth_states WHERE expires_at < now()`);
    await client.query(
      `INSERT INTO connected_account_oauth_states (state, user_id, provider, pkce_verifier, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [params.state, params.userId, params.provider, params.pkceVerifier, params.expiresAt],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Consumes a started OAuth flow.
 *
 * The row is deleted whether or not it had expired, which is what makes the state
 * single-use: a replayed callback finds nothing.
 *
 * @returns the flow when the state was valid and unexpired, otherwise null.
 */
export async function consumeOAuthFlowState(state: string): Promise<OAuthFlowState | null> {
  const result = await pool.query<{
    user_id: string;
    provider: ConnectedAccountProvider;
    pkce_verifier: string;
    expires_at: Date;
  }>(
    `DELETE FROM connected_account_oauth_states WHERE state = $1
     RETURNING user_id, provider, pkce_verifier, expires_at`,
    [state],
  );

  const row = result.rows[0];
  if (!row) return null;
  if (row.expires_at.getTime() < Date.now()) return null;

  return { userId: row.user_id, provider: row.provider, pkceVerifier: row.pkce_verifier };
}

/**
 * Records the outcome of a connection attempt against one of the caller's accounts.
 *
 * Unaudited, unlike every other write here: this records what a remote mail server
 * answered, not a change anyone made. Auditing it would file an entry every time a
 * mailbox went briefly unreachable, burying the connect and disconnect events that are
 * the actual account history.
 */
export async function updateAccountStatus(
  accountId: string,
  userId: string,
  status: ConnectedAccountStatus,
  // The closed set, not a string: this column is rendered by translating it, so prose
  // reaches a user as a key no locale matches and degrades to the generic reason.
  statusDetail: ConnectedAccountStatusDetail | null,
): Promise<void> {
  // Going active clears the backoff. Without this a mailbox past MAX_SYNC_FAILURES could
  // never be claimed again: POST /:id/test is the documented way back, and it would fix
  // the status while leaving the counter that stopped the scheduler untouched, so a
  // transient outage would retire a mailbox permanently.
  await pool.query(
    `UPDATE connected_accounts
        SET status = $1::text,
            status_detail = $2,
            sync_failure_count = CASE WHEN $1::text = 'active' THEN 0 ELSE sync_failure_count END,
            sync_next_attempt_at = CASE WHEN $1::text = 'active' THEN NULL ELSE sync_next_attempt_at END
      WHERE id = $3 AND user_id = $4`,
    [status, statusDetail, accountId, userId],
  );
}

// ── Scheduler-facing API ──────────────────────────────────────────────────────
//
// claimAccountsDueForSync and getAccountAuthForSync are this module's only queries not
// scoped by user_id, and the exception is deliberate: the scheduler acts for no user.
// Neither returns credential material to a route. The one route that reaches them, the
// test-only run-now, first claims through claimAccountByIdForSync, which is user-scoped.

/**
 * Claims a batch of mailboxes that are due to sync.
 *
 * The claim is a WRITE, not a lock: the selected rows have their `sync_next_attempt_at`
 * pushed forward in the same statement that returns them. A row lock cannot serve here
 * the way it does in `advanceRolloutStages` — that holds its lock across a few
 * milliseconds of stage arithmetic, whereas a mailbox sync is network-bound and can run
 * for minutes, and a lock held that long blocks the next tick rather than protecting it.
 * Pushing the timestamp makes the claim survive the transaction ending, which is what
 * stops a second instance from picking up the same mailbox mid-sync.
 *
 * `FOR UPDATE SKIP LOCKED` on the inner select still matters: it is what keeps two
 * instances racing on the same batch from serializing behind each other.
 *
 * The batch is a MATERIALIZED CTE, never a subquery in the FROM list. Given a low row
 * estimate the planner may put that subquery on the inner side of a nested loop and run
 * it once per outer row; each rerun skips the rows this statement already claimed and
 * locks the next ones, so the statement claims past its LIMIT. A materialized CTE is
 * evaluated exactly once whatever the plan.
 *
 * The lease is deliberately short. A process that dies mid-sync leaves the mailbox
 * claimed until the lease expires, and then it is simply retried — the ingestion is
 * idempotent, so a duplicated tick costs work, not correctness.
 *
 * `status IN ('active', 'error')` is what makes the backoff live rather than write-only.
 * A failing mailbox is marked `error` for the UI's benefit, but it is
 * `sync_next_attempt_at` that decides whether to retry, so excluding `error` here would
 * mean a single failure retired an account for good. `disconnected` is excluded: that is
 * a user's explicit decision, not a transient fault. A paused mailbox is excluded for the
 * same reason, by its own column so pausing never touches the health `status` reports.
 *
 * The owner's role is joined rather than looked up per account, because the caller needs
 * it for the feature-flag check and a lookup per row would be an N+1 on every tick. Their
 * status is filtered on for the same reason auth.ts:78 refuses a non-active user's
 * request: a deactivated employee's mailbox must stop syncing.
 *
 * @param limit - Maximum mailboxes to claim this tick.
 */
export async function claimAccountsDueForSync(limit: number): Promise<ClaimedSyncAccount[]> {
  const result = await pool.query<ConnectedAccountRow & { user_role: string }>(
    `WITH due AS MATERIALIZED (
       SELECT ca2.id, u.role AS user_role
         FROM connected_accounts ca2
         JOIN users u ON u.id = ca2.user_id
        WHERE ca2.status IN ('active', 'error')
          AND ca2.provider = ANY($1)
          AND u.status = 'active'
          AND (ca2.sync_next_attempt_at IS NULL OR ca2.sync_next_attempt_at <= NOW())
          AND ca2.sync_failure_count < $4
          AND ca2.sync_paused_at IS NULL
        ORDER BY ca2.sync_next_attempt_at ASC NULLS FIRST
        LIMIT $2
          FOR UPDATE OF ca2 SKIP LOCKED
     )
     UPDATE connected_accounts ca
        SET sync_next_attempt_at = NOW() + ($3 || ' milliseconds')::interval
       FROM due
      WHERE ca.id = due.id
  RETURNING ca.id, ca.user_id, ca.provider, ca.email_address, ca.sync_cursor,
            ca.sync_failure_count, ca.granted_scopes, ca.excluded_domains, due.user_role`,
    [IMPLEMENTED_SYNC_PROVIDERS, limit, SYNC_CLAIM_LEASE_MS, MAX_SYNC_FAILURES],
  );

  return result.rows.map(toClaimedSyncAccount);
}

/**
 * Claims one owned mailbox for an immediate sync, whatever its due time.
 *
 * Every predicate of claimAccountsDueForSync applies but `sync_next_attempt_at`. That
 * column is both the due time and the scheduler's lease, and each committed page pushes it
 * forward, so honoring it would refuse a second sync minutes after the first. The lease is
 * still taken, so a scheduler that is running skips the mailbox; callers serialize their
 * own runs.
 *
 * @returns the claimed account, or null when it is missing, not this user's, paused,
 *   retired by failures, or in a status that does not sync.
 */
export async function claimAccountByIdForSync(
  accountId: string,
  userId: string,
): Promise<ClaimedSyncAccount | null> {
  const result = await pool.query<ConnectedAccountRow & { user_role: string }>(
    `UPDATE connected_accounts ca
        SET sync_next_attempt_at = NOW() + ($4 || ' milliseconds')::interval
       FROM users u
      WHERE ca.id = $1
        AND ca.user_id = $2
        AND u.id = ca.user_id
        AND u.status = 'active'
        AND ca.status IN ('active', 'error')
        AND ca.provider = ANY($3)
        AND ca.sync_failure_count < $5
        AND ca.sync_paused_at IS NULL
  RETURNING ca.id, ca.user_id, ca.provider, ca.email_address, ca.sync_cursor,
            ca.sync_failure_count, ca.granted_scopes, ca.excluded_domains, u.role AS user_role`,
    [accountId, userId, IMPLEMENTED_SYNC_PROVIDERS, SYNC_CLAIM_LEASE_MS, MAX_SYNC_FAILURES],
  );
  const row = result.rows[0];
  return row ? toClaimedSyncAccount(row) : null;
}

function toClaimedSyncAccount(
  row: ConnectedAccountRow & { user_role: string },
): ClaimedSyncAccount {
  return {
    id: row.id,
    userId: row.user_id,
    userRole: row.user_role,
    provider: row.provider,
    emailAddress: row.email_address,
    syncCursor: row.sync_cursor,
    syncFailureCount: row.sync_failure_count,
    grantedScopes: row.granted_scopes,
    excludedDomains: row.excluded_domains,
  };
}

/**
 * Decrypts one already-claimed mailbox's credentials, refreshing an OAuth token that has
 * expired.
 *
 * Not scoped by user_id, because the scheduler has no user — the account id comes from
 * claimAccountsDueForSync or claimAccountByIdForSync, which have already applied every
 * ownership and status rule.
 *
 * An OAuth account takes the same locked check-and-refresh a person's request does, for
 * the same reason: a sync and a user action can race for one rotating refresh token. The
 * actor is SYSTEM_ACTOR because no human initiates a sync, and the audit entry a refused
 * refresh writes has to be attributable to something.
 *
 * @param refresh - Injected rather than defaulted so this module keeps its type-only
 *   import of oauthProviderService; a runtime one would pull openid-client into every
 *   consumer of connectedAccountService.
 * @returns the decrypted credentials, or null when the account is gone, has no driver,
 *   will not decrypt, or its OAuth token could not be refreshed.
 */
export async function getAccountAuthForSync(
  accountId: string,
  refresh: (provider: OAuthProvider, refreshToken: string) => Promise<RefreshedTokens>,
): Promise<ConnectedAccountAuth | null> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<ConnectedAccountRow>(
      `SELECT id, provider, email_address, auth_encrypted, key_version FROM connected_accounts
       WHERE id = $1 FOR UPDATE`,
      [accountId],
    );
    const row = result.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return null;
    }

    // The provider column decides which payload is acceptable, never the ciphertext's
    // own shape: a row whose credentials happen to look like IMAP's must not reach the
    // IMAP driver when its provider says otherwise. Which providers the scheduler may
    // claim is IMPLEMENTED_SYNC_PROVIDERS' job, applied by the claim query — repeating it
    // here would leave this seam untestable for a driver that has not shipped yet.
    if (row.provider === 'imap') {
      const auth = decryptAuth(row, 'sync');
      await client.query('COMMIT');
      return auth?.kind === 'imap' ? auth : null;
    }

    const auth = await refreshLockedRow(client, row, SYSTEM_ACTOR, refresh);
    await client.query('COMMIT');
    return auth;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
