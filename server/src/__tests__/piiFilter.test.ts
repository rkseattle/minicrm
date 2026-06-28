/**
 * Unit tests for the PII data minimization layer. (MINCRM-445)
 *
 * Verifies that applyPiiFilter correctly strips always-excluded fields and
 * custom field values with pii_excluded=true across each entity type.
 *
 * These are pure unit tests — no DB access, no fixtures.
 */

import { describe, it, expect } from 'vitest';
import { applyPiiFilter, ALWAYS_EXCLUDED_FIELDS } from '../ai/piiFilter.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Builds a minimal contact payload that mirrors what the tool executor returns. */
function makeContact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'c-1',
    first_name: 'Alice',
    last_name: 'Smith',
    email: 'alice@example.com',
    phone: '+1-555-0100',
    owner_id: 'u-1',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Builds a minimal custom field entry. */
function makeCustomField(
  name: string,
  value: string,
  piiExcluded: boolean,
): Record<string, unknown> {
  return {
    definition_id: 'd-1',
    name,
    value,
    definition: {
      id: 'd-1',
      name,
      field_type: 'text',
      pii_excluded: piiExcluded,
    },
  };
}

// ── ALWAYS_EXCLUDED_FIELDS ─────────────────────────────────────────────────────

describe('ALWAYS_EXCLUDED_FIELDS', () => {
  it('contains password_hash', () => {
    expect(ALWAYS_EXCLUDED_FIELDS.has('password_hash')).toBe(true);
  });

  it('contains mfa_secret', () => {
    expect(ALWAYS_EXCLUDED_FIELDS.has('mfa_secret')).toBe(true);
  });

  it('contains api_key_encrypted', () => {
    expect(ALWAYS_EXCLUDED_FIELDS.has('api_key_encrypted')).toBe(true);
  });

  it('contains ssn', () => {
    expect(ALWAYS_EXCLUDED_FIELDS.has('ssn')).toBe(true);
  });

  it('contains tax_id', () => {
    expect(ALWAYS_EXCLUDED_FIELDS.has('tax_id')).toBe(true);
  });

  it('contains bank_account', () => {
    expect(ALWAYS_EXCLUDED_FIELDS.has('bank_account')).toBe(true);
  });

  it('contains secret_hash (webhook signing secret)', () => {
    expect(ALWAYS_EXCLUDED_FIELDS.has('secret_hash')).toBe(true);
  });
});

// ── applyPiiFilter: primitives ─────────────────────────────────────────────────

describe('applyPiiFilter — primitives', () => {
  it('passes through null', () => {
    const { sanitised, strippedFields } = applyPiiFilter(null);
    expect(sanitised).toBeNull();
    expect(strippedFields).toHaveLength(0);
  });

  it('passes through a string', () => {
    const { sanitised } = applyPiiFilter('hello');
    expect(sanitised).toBe('hello');
  });

  it('passes through a number', () => {
    const { sanitised } = applyPiiFilter(42);
    expect(sanitised).toBe(42);
  });

  it('passes through an error object without sensitive keys', () => {
    const { sanitised } = applyPiiFilter({ error: 'Not found' });
    expect(sanitised).toEqual({ error: 'Not found' });
  });
});

// ── applyPiiFilter: ALWAYS_EXCLUDED_FIELDS stripping ─────────────────────────

describe('applyPiiFilter — always-excluded field stripping', () => {
  it('strips password_hash from a flat object', () => {
    const input = makeContact({ password_hash: '$2b$10$abc' });
    const { sanitised, strippedFields } = applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    expect(s['password_hash']).toBeUndefined();
    expect(s['email']).toBe('alice@example.com');
    expect(strippedFields).toContain('password_hash');
  });

  it('strips mfa_secret', () => {
    const input = { id: 'u-1', mfa_secret: 'TOTP_SECRET', email: 'bob@example.com' };
    const { sanitised, strippedFields } = applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    expect(s['mfa_secret']).toBeUndefined();
    expect(strippedFields).toContain('mfa_secret');
  });

  it('strips ssn and tax_id', () => {
    const input = { id: 'c-1', ssn: '123-45-6789', tax_id: 'TIN123', name: 'Corp' };
    const { sanitised, strippedFields } = applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    expect(s['ssn']).toBeUndefined();
    expect(s['tax_id']).toBeUndefined();
    expect(s['name']).toBe('Corp');
    expect(strippedFields).toContain('ssn');
    expect(strippedFields).toContain('tax_id');
  });

  it('strips bank_account and credit_card_number', () => {
    const input = { bank_account: '0001234', credit_card_number: '4111111111111111', id: 'c-1' };
    const { sanitised, strippedFields } = applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    expect(s['bank_account']).toBeUndefined();
    expect(s['credit_card_number']).toBeUndefined();
    expect(strippedFields).toContain('bank_account');
    expect(strippedFields).toContain('credit_card_number');
  });

  it('strips api_key_encrypted and api_key_key_version', () => {
    const input = {
      id: 'cfg-1',
      model: 'claude-sonnet-4-6',
      api_key_encrypted: 'enc:abc123',
      api_key_key_version: 1,
    };
    const { sanitised, strippedFields } = applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    expect(s['api_key_encrypted']).toBeUndefined();
    expect(s['api_key_key_version']).toBeUndefined();
    expect(s['model']).toBe('claude-sonnet-4-6');
    expect(strippedFields).toContain('api_key_encrypted');
    expect(strippedFields).toContain('api_key_key_version');
  });

  it('strips nested always-excluded fields inside paginated results', () => {
    const input = {
      rows: [makeContact({ password_hash: 'hash1' }), makeContact({ password_hash: 'hash2' })],
      total: 2,
    };
    const { sanitised, strippedFields } = applyPiiFilter(input);
    const s = sanitised as { rows: Record<string, unknown>[] };
    expect(s.rows[0]['password_hash']).toBeUndefined();
    expect(s.rows[1]['password_hash']).toBeUndefined();
    expect(strippedFields).toContain('password_hash');
  });

  it('does not mutate the original input', () => {
    const input = makeContact({ password_hash: 'secret' });
    applyPiiFilter(input);
    expect(input['password_hash']).toBe('secret');
  });
});

// ── applyPiiFilter: custom field PII exclusion ────────────────────────────────

describe('applyPiiFilter — custom field PII exclusion', () => {
  it('nulls out value for pii_excluded=true custom fields on a contact', () => {
    const input = {
      ...makeContact(),
      custom_fields: [
        makeCustomField('SSN', '123-45-6789', true),
        makeCustomField('Notes', 'Public notes', false),
      ],
    };
    const { sanitised, strippedFields } = applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    const fields = s['custom_fields'] as Record<string, unknown>[];
    expect(fields[0]['value']).toBeNull();
    expect(fields[1]['value']).toBe('Public notes');
    expect(strippedFields).toContain('custom_fields.SSN');
    expect(strippedFields).not.toContain('custom_fields.Notes');
  });

  it('retains definition metadata on stripped custom fields', () => {
    const input = {
      ...makeContact(),
      custom_fields: [makeCustomField('BankAccount', '0001234567', true)],
    };
    const { sanitised } = applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    const fields = s['custom_fields'] as Record<string, unknown>[];
    const def = fields[0]['definition'] as Record<string, unknown>;
    expect(def['name']).toBe('BankAccount');
    expect(def['field_type']).toBe('text');
    expect(def['pii_excluded']).toBe(true);
  });

  it('leaves non-pii-excluded custom fields with their values', () => {
    const input = {
      custom_fields: [makeCustomField('Department', 'Sales', false)],
    };
    const { sanitised, strippedFields } = applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    const fields = s['custom_fields'] as Record<string, unknown>[];
    expect(fields[0]['value']).toBe('Sales');
    expect(strippedFields).toHaveLength(0);
  });

  it('handles accounts with pii_excluded custom fields', () => {
    const input = {
      id: 'a-1',
      name: 'Acme Corp',
      custom_fields: [
        makeCustomField('TaxID', '12-3456789', true),
        makeCustomField('Industry', 'Tech', false),
      ],
    };
    const { sanitised, strippedFields } = applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    const fields = s['custom_fields'] as Record<string, unknown>[];
    expect(fields[0]['value']).toBeNull();
    expect(fields[1]['value']).toBe('Tech');
    expect(strippedFields).toContain('custom_fields.TaxID');
  });

  it('handles deals with pii_excluded custom fields', () => {
    const input = {
      id: 'd-1',
      name: 'Enterprise Deal',
      custom_fields: [makeCustomField('BankRef', 'ACCT-9999', true)],
    };
    const { sanitised, strippedFields } = applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    const fields = s['custom_fields'] as Record<string, unknown>[];
    expect(fields[0]['value']).toBeNull();
    expect(strippedFields).toContain('custom_fields.BankRef');
  });

  it('handles empty custom_fields array', () => {
    const input = { ...makeContact(), custom_fields: [] };
    const { sanitised, strippedFields } = applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    expect(s['custom_fields']).toEqual([]);
    expect(strippedFields).toHaveLength(0);
  });
});

// ── applyPiiFilter: paginated list results ────────────────────────────────────

describe('applyPiiFilter — paginated search results', () => {
  it('strips pii fields from all rows in a paginated response', () => {
    const input = {
      rows: [
        {
          ...makeContact({ password_hash: 'h1' }),
          custom_fields: [makeCustomField('SSN', '111', true)],
        },
        {
          ...makeContact({ password_hash: 'h2' }),
          custom_fields: [makeCustomField('SSN', '222', true)],
        },
      ],
      total: 2,
      page: 1,
      limit: 20,
    };
    const { sanitised, strippedFields } = applyPiiFilter(input);
    const s = sanitised as { rows: Record<string, unknown>[] };
    for (const row of s.rows) {
      expect(row['password_hash']).toBeUndefined();
      const fields = row['custom_fields'] as Record<string, unknown>[];
      expect(fields[0]['value']).toBeNull();
    }
    expect(strippedFields).toContain('password_hash');
    expect(strippedFields).toContain('custom_fields.SSN');
    // Each field name appears only once in the manifest even when stripped from multiple rows.
    expect(strippedFields.filter((f) => f === 'password_hash')).toHaveLength(1);
  });
});

// ── applyPiiFilter: strippedFields deduplication ──────────────────────────────

describe('applyPiiFilter — strippedFields deduplication', () => {
  it('reports each stripped field name only once across the entire result', () => {
    const input = {
      rows: [makeContact({ ssn: '111-22-3333' }), makeContact({ ssn: '444-55-6666' })],
    };
    const { strippedFields } = applyPiiFilter(input);
    const ssnCount = strippedFields.filter((f) => f === 'ssn').length;
    expect(ssnCount).toBe(1);
  });
});
