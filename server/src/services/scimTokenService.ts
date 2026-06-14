/**
 * Service for SCIM bearer token management (MINCRM-541).
 * Only one SCIM token is active at a time (rotate replaces the existing one).
 *
 * The raw token is a 32-byte cryptographically random hex string. Only the
 * SHA-256 digest is stored — the plaintext is returned exactly once, at
 * generation time, and never persisted.
 */

import crypto from 'crypto';
import pool from '../db.js';
import { writeAuditEntry } from './auditService.js';
import type { AuditActor } from './auditService.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Result returned when a new SCIM token is generated. */
export interface ScimTokenGenerated {
  id: string;
  /** Raw bearer token — only available at generation time; never stored in plaintext. */
  rawToken: string;
  createdAt: Date;
}

/** Metadata about the currently active SCIM token (no plaintext token). */
export interface ScimTokenMeta {
  id: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Computes the SHA-256 hex digest of a raw SCIM bearer token. */
function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generates a new SCIM bearer token, replacing any existing one atomically.
 * Writes an audit entry inside the same transaction.
 *
 * Returns the generated token metadata including the plaintext token — this is
 * the only time the raw token is available. Callers must relay it to the user
 * immediately; it cannot be recovered later.
 */
export async function generateScimToken(actor: AuditActor): Promise<ScimTokenGenerated> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete any existing token — only one active token allowed at a time.
    await client.query('DELETE FROM public.scim_tokens');

    const result = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO public.scim_tokens (token_hash, created_by)
       VALUES ($1, $2)
       RETURNING id, created_at`,
      [tokenHash, actor.id],
    );

    // Safe: INSERT ... RETURNING always produces exactly one row.
    const row = result.rows[0]!;

    await writeAuditEntry(client, {
      recordType: 'scim_token',
      recordId: row.id,
      eventType: 'created',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');

    return {
      id: row.id,
      rawToken,
      createdAt: row.created_at,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Returns metadata about the currently active SCIM token, or null if no token
 * has been issued. Never returns the token hash or plaintext.
 */
export async function getScimTokenMeta(): Promise<ScimTokenMeta | null> {
  const result = await pool.query<{ id: string; created_at: Date; last_used_at: Date | null }>(
    'SELECT id, created_at, last_used_at FROM public.scim_tokens LIMIT 1',
  );

  if (result.rows.length === 0) {
    return null;
  }

  // Safe: length check above guarantees the row exists.
  const row = result.rows[0]!;
  return {
    id: row.id,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

/**
 * Revokes the currently active SCIM token.
 * Returns true if a token was deleted, false if no token existed.
 * Writes an audit entry inside the same transaction.
 */
export async function revokeScimToken(actor: AuditActor): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<{ id: string }>(
      'DELETE FROM public.scim_tokens RETURNING id',
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    // Safe: DELETE RETURNING with rowCount > 0 guarantees at least one row.
    const deletedId = result.rows[0]!.id;

    await writeAuditEntry(client, {
      recordType: 'scim_token',
      recordId: deletedId,
      eventType: 'deleted',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Validates a raw SCIM bearer token against the stored hash.
 *
 * The SELECT is awaited synchronously to return a boolean result. The
 * last_used_at UPDATE is fire-and-forget — it does not block the request and
 * its failure does not affect authentication decisions.
 *
 * Returns true if the token matches the stored hash, false otherwise.
 */
export async function validateScimToken(rawToken: string): Promise<boolean> {
  const tokenHash = hashToken(rawToken);

  const result = await pool.query<{ id: string }>(
    'SELECT id FROM public.scim_tokens WHERE token_hash = $1',
    [tokenHash],
  );

  if (result.rows.length === 0) {
    return false;
  }

  // Fire-and-forget: update last_used_at without blocking the auth check.
  void pool.query('UPDATE public.scim_tokens SET last_used_at = now() WHERE token_hash = $1', [
    tokenHash,
  ]);

  return true;
}
