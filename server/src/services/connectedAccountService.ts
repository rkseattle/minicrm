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
  ImapCredentialsInput,
} from '@minicrm/shared/schemas/connectedAccountSchema.js';

import pool from '../db.js';
import logger from '../logger.js';

import type { AuditActor } from './auditService.js';
import { writeAuditEntry } from './auditService.js';
import { decryptVersioned, encryptVersioned } from './cryptoService.js';

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
  key_version: number;
  created_at: Date;
  updated_at: Date;
}

/** Every column except the credential material, for queries that never decrypt. */
const PUBLIC_COLUMNS =
  'id, user_id, provider, email_address, granted_scopes, status, status_detail, last_sync_at, created_at, updated_at';

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

/** A connected account with its credentials decrypted, for internal use only. */
export interface ConnectedAccountInternal {
  id: string;
  userId: string;
  provider: ConnectedAccountProvider;
  emailAddress: string;
  auth: ConnectedAccountAuth;
  keyVersion: number;
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

/** Maps a row to the shape the API returns. The only exit from this module. */
function toConnectedAccountResponse(
  row: Omit<ConnectedAccountRow, 'auth_encrypted' | 'key_version' | 'user_id' | 'sync_cursor'>,
): ConnectedAccountResponse {
  return {
    id: row.id,
    provider: row.provider,
    email_address: row.email_address,
    granted_scopes: row.granted_scopes,
    status: row.status,
    status_detail: row.status_detail,
    last_sync_at: row.last_sync_at ? row.last_sync_at.toISOString() : null,
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
    `SELECT id, user_id, provider, email_address, auth_encrypted, key_version
       FROM connected_accounts WHERE id = $1 AND user_id = $2`,
    [accountId, userId],
  );
  const row = result.rows[0];
  if (!row) return null;

  let auth: ConnectedAccountAuth;
  try {
    auth = JSON.parse(
      decryptVersioned(row.auth_encrypted, row.key_version ?? 1),
    ) as ConnectedAccountAuth;
  } catch (err) {
    logger.error(
      { err, accountId },
      'connectedAccountService: failed to decrypt auth_encrypted — treating as unset',
    );
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    emailAddress: row.email_address,
    auth,
    keyVersion: row.key_version,
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
         status_detail  = NULL
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

    let auth: ConnectedAccountAuth | null = null;
    try {
      auth = JSON.parse(
        decryptVersioned(row.auth_encrypted, row.key_version ?? 1),
      ) as ConnectedAccountAuth;
    } catch (err) {
      // The row is already gone and the disconnect succeeded; only revocation is lost.
      logger.warn({ err, accountId }, 'connectedAccountService: could not decrypt for revocation');
    }

    return { provider: row.provider, auth };
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
  statusDetail: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE connected_accounts SET status = $1, status_detail = $2 WHERE id = $3 AND user_id = $4`,
    [status, statusDetail, accountId, userId],
  );
}
