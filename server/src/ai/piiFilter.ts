/**
 * PII data minimization layer for NLI tool call results. (MINCRM-445)
 *
 * Sits between the tool executor and the AI API call. Every tool result is
 * passed through applyPiiFilter() before being JSON-serialised into the
 * tool_result message sent to Claude.
 *
 * Two complementary mechanisms:
 *
 *   1. ALWAYS_EXCLUDED_FIELDS — a static set of field names that are stripped
 *      from every object in the payload unconditionally (password hashes,
 *      encrypted keys, MFA secrets, SSN, tax ID, bank account numbers, etc.).
 *
 *   2. Custom-field PII exclusion — if the tool result contains a
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
 * Returns a deep copy of the input with always-excluded fields removed and
 * any custom field values with pii_excluded=true set to null.
 *
 * Non-object primitives are returned as-is (no stripping possible).
 */
export function applyPiiFilter(result: unknown): PiiFilterResult {
  const stripped: string[] = [];
  const sanitised = filterValue(result, stripped);
  return { sanitised, strippedFields: stripped };
}

// ── Private helpers ────────────────────────────────────────────────────────────

function filterValue(value: unknown, stripped: string[]): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => filterValue(item, stripped));
  }

  return filterObject(value as Record<string, unknown>, stripped);
}

function filterObject(obj: Record<string, unknown>, stripped: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(obj)) {
    if (ALWAYS_EXCLUDED_FIELDS.has(key)) {
      // Omit the field entirely — do not include the key at all.
      if (!stripped.includes(key)) {
        stripped.push(key);
      }
      continue;
    }

    // Recurse into nested objects and arrays, EXCEPT for custom_fields which
    // gets special handling below.
    if (key === 'custom_fields' && Array.isArray(val)) {
      result[key] = filterCustomFields(val, stripped);
    } else {
      result[key] = filterValue(val, stripped);
    }
  }

  return result;
}

/**
 * Handles the `custom_fields` array shape:
 *   [{ definition_id, name, value, definition: { pii_excluded, ... } }, ...]
 *
 * Entries with pii_excluded === true on the definition have their `value`
 * replaced with null. The definition object itself and all other keys are
 * passed through unchanged so Claude knows the field exists.
 */
function filterCustomFields(fields: unknown[], stripped: string[]): unknown[] {
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
      const auditKey = `custom_fields.${fieldName}`;
      if (!stripped.includes(auditKey)) {
        stripped.push(auditKey);
      }
      // Clone with value nulled out; recurse into the definition normally.
      return {
        ...f,
        value: null,
        definition: filterValue(definition, stripped),
      };
    }

    return filterObject(f, stripped);
  });
}
