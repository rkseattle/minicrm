/**
 * PII data minimization layer for NLI tool call results.
 *
 * Sits between the tool executor and the AI API call. Every tool result is
 * passed through applyPiiFilter() before being JSON-serialised into the
 * tool_result message sent to Claude.
 *
 * Three complementary mechanisms:
 *
 *   1. ALWAYS_EXCLUDED_FIELDS — a static set of field names that are stripped
 *      from every object in the payload unconditionally (password hashes,
 *      encrypted keys, MFA secrets, SSN, tax ID, bank account numbers, etc.).
 *      This set is immutable — never admin-configurable.
 *
 *   2. Admin-configurable standard-field exclusions — additional
 *      field names an admin has excluded via ai_field_exclusions, loaded and
 *      cached in-memory (see loadAdminExcludedFields/invalidateFieldExclusionCache
 *      below). Applied in ADDITION to, never instead of, ALWAYS_EXCLUDED_FIELDS.
 *      Since standard field names can collide across entities (e.g. `name` on
 *      both accounts and deals), callers may pass an `entityTypeHint` to
 *      applyPiiFilter so exclusions are matched entity-qualified; without a
 *      hint, matching falls back to unqualified field name (conservative:
 *      excluding `name` for one entity type would also strip it for others
 *      sharing that field name until a hint is supplied).
 *
 *   3. Custom-field PII exclusion — if the tool result contains a
 *      `custom_fields` array, entries where `pii_excluded === true` on the
 *      embedded `definition` have their `value` nulled out. The definition
 *      metadata (name, field_type) remains so Claude understands the field
 *      exists but cannot read its content.
 *
 * applyPiiFilter() is idempotent and non-destructive: it deep-clones the
 * input before mutating so the original in-memory object is never modified.
 * Stripping fields from the AI payload does NOT affect the data stored in the
 * CRM database.
 *
 * An audit manifest of stripped field names (never values) is returned
 * alongside the sanitised result so the caller can emit a structured log entry.
 */

import pool from '../db.js';
import type { EntityType } from '@minicrm/shared/schemas/customFieldSchema.js';

// ── Always-excluded field names ────────────────────────────────────────────────

/**
 * Field names that are always stripped from AI payloads regardless of admin
 * configuration. These cover internal system fields and sensitive PII that
 * has no business value for Claude.
 */
export const ALWAYS_EXCLUDED_FIELDS: ReadonlySet<string> = new Set([
  // Internal system secrets
  'password_hash',
  'password_reset_token',
  'password_reset_expires',
  'api_key_encrypted',
  'api_key_key_version',
  'mfa_secret',
  'otp_backup_codes',
  'secret_hash', // webhook signing secret hash
  'auth_encrypted', // connected mailbox credentials (OAuth tokens or IMAP password)
  'service_account_token',
  'refresh_token',
  'access_token',
  'id_token',
  'sso_provider_config',

  // Financial / government identifiers
  'ssn',
  'social_security_number',
  'tax_id',
  'tax_identification_number',
  'ein',
  'vat_number',
  'bank_account',
  'bank_account_number',
  'routing_number',
  'credit_card_number',
  'card_number',
  'cvv',
  'account_number',
]);

// ── Admin-configurable exclusion cache ────────────────────────────

/**
 * Defensive TTL for the admin-excluded-fields cache. Invalidation is triggered
 * synchronously by aiFieldExclusionService on every write, so this TTL only
 * matters as a fallback in case of multi-instance deployment (where a write on
 * one instance cannot invalidate another instance's in-memory cache).
 */
const ADMIN_EXCLUSION_CACHE_TTL_MS = 60_000;

let adminExclusionCache: { rows: FieldExclusionCacheRow[]; loadedAt: number } | null = null;

interface FieldExclusionCacheRow {
  entity_type: string;
  field_name: string;
}

/** Clears the in-memory admin-exclusion cache, forcing the next read to hit the DB. */
export function invalidateFieldExclusionCache(): void {
  adminExclusionCache = null;
}

async function loadAdminExcludedFields(): Promise<FieldExclusionCacheRow[]> {
  const isFresh =
    adminExclusionCache !== null &&
    Date.now() - adminExclusionCache.loadedAt < ADMIN_EXCLUSION_CACHE_TTL_MS;
  if (isFresh) {
    return adminExclusionCache!.rows;
  }

  const result = await pool.query<FieldExclusionCacheRow>(
    `SELECT entity_type, field_name FROM ai_field_exclusions WHERE excluded = true`,
  );
  adminExclusionCache = { rows: result.rows, loadedAt: Date.now() };
  return result.rows;
}

// ── Types ──────────────────────────────────────────────────────────────────────

/** Result returned by applyPiiFilter, pairing the clean payload with the audit log. */
export interface PiiFilterResult {
  /** The sanitised copy of the input payload. */
  sanitised: unknown;
  /**
   * Names of fields that were stripped (never their values).
   * Empty when nothing was removed.
   */
  strippedFields: string[];
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Applies the PII minimization pass to a tool call result.
 *
 * Returns a deep copy of the input with always-excluded fields removed, any
 * admin-configured standard-field exclusions applied, and any custom field
 * values with pii_excluded=true set to null.
 *
 * @param result - The raw tool call result to sanitise.
 * @param entityTypeHint - Optional entity type, restricted to the entity types
 *   ai_field_exclusions actually supports (contact/account/deal — see
 *   shared/schemas/customFieldSchema.ts ENTITY_TYPES). When provided, admin-
 *   configured exclusions are matched entity-qualified, avoiding false-positive
 *   strips of standard fields that share a name across entities (e.g. `name` on
 *   accounts and deals). Falls back to unqualified matching when omitted. For
 *   entities with no matching type (activities, leads), pick the closest valid
 *   entity type rather than passing an invalid hint — an invalid hint silently
 *   matches zero admin exclusion rows instead of failing loudly.
 *
 * Non-object primitives are returned as-is (no stripping possible).
 */
export async function applyPiiFilter(
  result: unknown,
  entityTypeHint?: EntityType,
): Promise<PiiFilterResult> {
  const adminExcludedRows = await loadAdminExcludedFields();

  // With a hint, scope matching to fields configured for THAT entity type only —
  // otherwise an exclusion set for 'deal' would also strip same-named 'account'
  // fields (e.g. `name`) when filtering an account payload. Without a hint, fall
  // back to unqualified matching across all entities (conservative: may strip
  // more broadly than intended, but never less).
  const relevantRows = entityTypeHint
    ? adminExcludedRows.filter((row) => row.entity_type === entityTypeHint)
    : adminExcludedRows;
  const scopedExcluded = new Set(relevantRows.map((row) => row.field_name));

  const strippedSet = new Set<string>();
  const sanitised = filterValue(result, strippedSet, scopedExcluded);
  return { sanitised, strippedFields: Array.from(strippedSet) };
}

// ── Private helpers ────────────────────────────────────────────────────────────

function filterValue(
  value: unknown,
  stripped: Set<string>,
  adminExcluded: ReadonlySet<string>,
): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  // Date instances are plain objects — Object.entries(new Date()) yields nothing,
  // so without this guard they would collapse to {}. Serialise as ISO string to
  // match what JSON.stringify would produce.
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => filterValue(item, stripped, adminExcluded));
  }

  return filterObject(value as Record<string, unknown>, stripped, adminExcluded);
}

function filterObject(
  obj: Record<string, unknown>,
  stripped: Set<string>,
  adminExcluded: ReadonlySet<string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(obj)) {
    if (ALWAYS_EXCLUDED_FIELDS.has(key) || adminExcluded.has(key)) {
      // Omit the field entirely — do not include the key at all.
      stripped.add(key);
      continue;
    }

    // Recurse into nested objects and arrays, EXCEPT for custom_fields which
    // gets special handling below.
    if (key === 'custom_fields' && Array.isArray(val)) {
      result[key] = filterCustomFields(val, stripped, adminExcluded);
    } else {
      result[key] = filterValue(val, stripped, adminExcluded);
    }
  }

  return result;
}

/**
 * Handles the `custom_fields` array shape:
 *   [{ definition_id, name, value, definition: { pii_excluded, ... } }, ...]
 *
 * Entries with pii_excluded === true on the definition have their `value`
 * replaced with null. filterObject is called first on the full entry so that
 * sibling properties in ALWAYS_EXCLUDED_FIELDS are also stripped.
 */
function filterCustomFields(
  fields: unknown[],
  stripped: Set<string>,
  adminExcluded: ReadonlySet<string>,
): unknown[] {
  return fields.map((field) => {
    if (field === null || typeof field !== 'object' || Array.isArray(field)) {
      return field;
    }

    const f = field as Record<string, unknown>;
    const definition = f['definition'];
    const isPiiExcluded =
      definition !== null &&
      typeof definition === 'object' &&
      !Array.isArray(definition) &&
      (definition as Record<string, unknown>)['pii_excluded'] === true;

    if (isPiiExcluded) {
      const fieldName = typeof f['name'] === 'string' ? f['name'] : 'custom_field';
      stripped.add(`custom_fields.${fieldName}`);
      // Run the full filterObject pass first so sibling fields in ALWAYS_EXCLUDED_FIELDS
      // are stripped, then override value to null.
      const filtered = filterObject(f, stripped, adminExcluded);
      filtered['value'] = null;
      return filtered;
    }

    return filterObject(f, stripped, adminExcluded);
  });
}
