/**
 * Unit tests for the PII data minimization layer.
 *
 * Verifies that applyPiiFilter correctly strips always-excluded fields,
 * admin-configured standard-field exclusions, and custom field values with
 * pii_excluded=true across each entity type.
 *
 * applyPiiFilter reads admin-configured exclusions from ai_field_exclusions,
 * so these tests run against the real minicrm_test DB (not pure unit tests).
 */

import 'dotenv/config';
import { describe, it, expect, beforeEach } from 'vitest';
import pool from '../db.js';
import {
  applyPiiFilter,
  ALWAYS_EXCLUDED_FIELDS,
  invalidateFieldExclusionCache,
} from '../ai/piiFilter.js';
import { setFieldExclusion } from '../services/aiFieldExclusionService.js';

const SYSTEM_ACTOR = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

beforeEach(async () => {
  await pool.query('DELETE FROM ai_field_exclusions');
  invalidateFieldExclusionCache();
});

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

  it('contains auth_encrypted', () => {
    expect(ALWAYS_EXCLUDED_FIELDS.has('auth_encrypted')).toBe(true);
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

  it('contains message_body_text', () => {
    expect(ALWAYS_EXCLUDED_FIELDS.has('message_body_text')).toBe(true);
  });

  it('contains message_body_html', () => {
    expect(ALWAYS_EXCLUDED_FIELDS.has('message_body_html')).toBe(true);
  });

  it('contains message_snippet', () => {
    expect(ALWAYS_EXCLUDED_FIELDS.has('message_snippet')).toBe(true);
  });

  it('does not contain bare body_text, which notes return to the model', () => {
    expect(ALWAYS_EXCLUDED_FIELDS.has('body_text')).toBe(false);
  });
});

// ── applyPiiFilter: primitives ─────────────────────────────────────────────────

describe('applyPiiFilter — primitives', () => {
  it('passes through null', async () => {
    const { sanitised, strippedFields } = await applyPiiFilter(null);
    expect(sanitised).toBeNull();
    expect(strippedFields).toHaveLength(0);
  });

  it('passes through a string', async () => {
    const { sanitised } = await applyPiiFilter('hello');
    expect(sanitised).toBe('hello');
  });

  it('passes through a number', async () => {
    const { sanitised } = await applyPiiFilter(42);
    expect(sanitised).toBe(42);
  });

  it('passes through an error object without sensitive keys', async () => {
    const { sanitised } = await applyPiiFilter({ error: 'Not found' });
    expect(sanitised).toEqual({ error: 'Not found' });
  });

  it('serialises Date values as ISO strings rather than collapsing them to {}', async () => {
    // Object.entries(new Date()) yields no own-enumerable properties, so without
    // an instanceof Date guard the walker would produce {} for every Date field.
    const date = new Date('2026-01-15T10:00:00.000Z');
    const input = { id: 'c-1', created_at: date, name: 'Alice' };
    const { sanitised, strippedFields } = await applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    expect(s['created_at']).toBe('2026-01-15T10:00:00.000Z');
    expect(s['name']).toBe('Alice');
    expect(strippedFields).toHaveLength(0);
  });

  it('serialises nested Date values inside arrays', async () => {
    const date = new Date('2026-03-01T00:00:00.000Z');
    const input = { rows: [{ id: 'c-1', updated_at: date }] };
    const { sanitised } = await applyPiiFilter(input);
    const s = sanitised as { rows: Record<string, unknown>[] };
    expect(s.rows[0]['updated_at']).toBe('2026-03-01T00:00:00.000Z');
  });
});

// ── applyPiiFilter: ALWAYS_EXCLUDED_FIELDS stripping ─────────────────────────

describe('applyPiiFilter — always-excluded field stripping', () => {
  it('strips password_hash from a flat object', async () => {
    const input = makeContact({ password_hash: '$2b$10$abc' });
    const { sanitised, strippedFields } = await applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    expect(s['password_hash']).toBeUndefined();
    expect(s['email']).toBe('alice@example.com');
    expect(strippedFields).toContain('password_hash');
  });

  it('strips mfa_secret', async () => {
    const input = { id: 'u-1', mfa_secret: 'TOTP_SECRET', email: 'bob@example.com' };
    const { sanitised, strippedFields } = await applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    expect(s['mfa_secret']).toBeUndefined();
    expect(strippedFields).toContain('mfa_secret');
  });

  it('strips synced message bodies from a nested payload', async () => {
    const input = {
      id: 'acct-1',
      email_address: 'rep@example.com',
      messages: [
        {
          id: 'm-1',
          subject: 'Q3 pricing',
          message_body_text: 'Our floor is $42k, do not go below.',
          message_body_html: '<p>Our floor is $42k, do not go below.</p>',
          message_snippet: 'Our floor is $42k, do not go below.',
        },
      ],
    };
    const { sanitised, strippedFields } = await applyPiiFilter(input);
    const s = sanitised as { messages: Record<string, unknown>[] };
    expect(s.messages[0]['message_body_text']).toBeUndefined();
    expect(s.messages[0]['message_body_html']).toBeUndefined();
    expect(s.messages[0]['message_snippet']).toBeUndefined();
    expect(s.messages[0]['subject']).toBe('Q3 pricing');
    expect(strippedFields).toContain('message_body_text');
  });

  it('keeps a note body, which shares the unprefixed name', async () => {
    const input = { id: 'n-1', body_text: 'Call notes: agreed to a pilot.' };
    const { sanitised, strippedFields } = await applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    expect(s['body_text']).toBe('Call notes: agreed to a pilot.');
    expect(strippedFields).not.toContain('body_text');
  });

  it('strips ssn and tax_id', async () => {
    const input = { id: 'c-1', ssn: '123-45-6789', tax_id: 'TIN123', name: 'Corp' };
    const { sanitised, strippedFields } = await applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    expect(s['ssn']).toBeUndefined();
    expect(s['tax_id']).toBeUndefined();
    expect(s['name']).toBe('Corp');
    expect(strippedFields).toContain('ssn');
    expect(strippedFields).toContain('tax_id');
  });

  it('strips bank_account and credit_card_number', async () => {
    const input = { bank_account: '0001234', credit_card_number: '4111111111111111', id: 'c-1' };
    const { sanitised, strippedFields } = await applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    expect(s['bank_account']).toBeUndefined();
    expect(s['credit_card_number']).toBeUndefined();
    expect(strippedFields).toContain('bank_account');
    expect(strippedFields).toContain('credit_card_number');
  });

  it('strips api_key_encrypted and api_key_key_version', async () => {
    const input = {
      id: 'cfg-1',
      model: 'claude-sonnet-4-6',
      api_key_encrypted: 'enc:abc123',
      api_key_key_version: 1,
    };
    const { sanitised, strippedFields } = await applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    expect(s['api_key_encrypted']).toBeUndefined();
    expect(s['api_key_key_version']).toBeUndefined();
    expect(s['model']).toBe('claude-sonnet-4-6');
    expect(strippedFields).toContain('api_key_encrypted');
    expect(strippedFields).toContain('api_key_key_version');
  });

  it('strips nested always-excluded fields inside paginated results', async () => {
    const input = {
      rows: [makeContact({ password_hash: 'hash1' }), makeContact({ password_hash: 'hash2' })],
      total: 2,
    };
    const { sanitised, strippedFields } = await applyPiiFilter(input);
    const s = sanitised as { rows: Record<string, unknown>[] };
    expect(s.rows[0]['password_hash']).toBeUndefined();
    expect(s.rows[1]['password_hash']).toBeUndefined();
    expect(strippedFields).toContain('password_hash');
  });

  it('does not mutate the original input', async () => {
    const input = makeContact({ password_hash: 'secret' });
    await applyPiiFilter(input);
    expect(input['password_hash']).toBe('secret');
  });
});

// ── applyPiiFilter: custom field PII exclusion ────────────────────────────────

describe('applyPiiFilter — custom field PII exclusion', () => {
  it('nulls out value for pii_excluded=true custom fields on a contact', async () => {
    const input = {
      ...makeContact(),
      custom_fields: [
        makeCustomField('SSN', '123-45-6789', true),
        makeCustomField('Notes', 'Public notes', false),
      ],
    };
    const { sanitised, strippedFields } = await applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    const fields = s['custom_fields'] as Record<string, unknown>[];
    expect(fields[0]['value']).toBeNull();
    expect(fields[1]['value']).toBe('Public notes');
    expect(strippedFields).toContain('custom_fields.SSN');
    expect(strippedFields).not.toContain('custom_fields.Notes');
  });

  it('retains definition metadata on stripped custom fields', async () => {
    const input = {
      ...makeContact(),
      custom_fields: [makeCustomField('BankAccount', '0001234567', true)],
    };
    const { sanitised } = await applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    const fields = s['custom_fields'] as Record<string, unknown>[];
    const def = fields[0]['definition'] as Record<string, unknown>;
    expect(def['name']).toBe('BankAccount');
    expect(def['field_type']).toBe('text');
    expect(def['pii_excluded']).toBe(true);
  });

  it('leaves non-pii-excluded custom fields with their values', async () => {
    const input = {
      custom_fields: [makeCustomField('Department', 'Sales', false)],
    };
    const { sanitised, strippedFields } = await applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    const fields = s['custom_fields'] as Record<string, unknown>[];
    expect(fields[0]['value']).toBe('Sales');
    expect(strippedFields).toHaveLength(0);
  });

  it('handles accounts with pii_excluded custom fields', async () => {
    const input = {
      id: 'a-1',
      name: 'Acme Corp',
      custom_fields: [
        makeCustomField('TaxID', '12-3456789', true),
        makeCustomField('Industry', 'Tech', false),
      ],
    };
    const { sanitised, strippedFields } = await applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    const fields = s['custom_fields'] as Record<string, unknown>[];
    expect(fields[0]['value']).toBeNull();
    expect(fields[1]['value']).toBe('Tech');
    expect(strippedFields).toContain('custom_fields.TaxID');
  });

  it('handles deals with pii_excluded custom fields', async () => {
    const input = {
      id: 'd-1',
      name: 'Enterprise Deal',
      custom_fields: [makeCustomField('BankRef', 'ACCT-9999', true)],
    };
    const { sanitised, strippedFields } = await applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    const fields = s['custom_fields'] as Record<string, unknown>[];
    expect(fields[0]['value']).toBeNull();
    expect(strippedFields).toContain('custom_fields.BankRef');
  });

  it('handles empty custom_fields array', async () => {
    const input = { ...makeContact(), custom_fields: [] };
    const { sanitised, strippedFields } = await applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    expect(s['custom_fields']).toEqual([]);
    expect(strippedFields).toHaveLength(0);
  });

  it('strips ALWAYS_EXCLUDED_FIELDS sibling properties on pii_excluded custom field entries', async () => {
    // A custom field entry that is pii_excluded AND has a sibling field in
    // ALWAYS_EXCLUDED_FIELDS — both must be stripped.
    const field = {
      definition_id: 'd-1',
      name: 'SSNField',
      value: '111-22-3333',
      password_hash: 'should-be-stripped', // sibling in ALWAYS_EXCLUDED_FIELDS
      definition: { id: 'd-1', name: 'SSNField', field_type: 'text', pii_excluded: true },
    };
    const input = { id: 'c-1', custom_fields: [field] };
    const { sanitised, strippedFields } = await applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    const fields = s['custom_fields'] as Record<string, unknown>[];
    expect(fields[0]['value']).toBeNull();
    expect(fields[0]['password_hash']).toBeUndefined();
    expect(strippedFields).toContain('custom_fields.SSNField');
    expect(strippedFields).toContain('password_hash');
  });
});

// ── applyPiiFilter: paginated list results ────────────────────────────────────

describe('applyPiiFilter — paginated search results', () => {
  it('strips pii fields from all rows in a paginated response', async () => {
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
    const { sanitised, strippedFields } = await applyPiiFilter(input);
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
  it('reports each stripped field name only once across the entire result', async () => {
    const input = {
      rows: [makeContact({ ssn: '111-22-3333' }), makeContact({ ssn: '444-55-6666' })],
    };
    const { strippedFields } = await applyPiiFilter(input);
    const ssnCount = strippedFields.filter((f) => f === 'ssn').length;
    expect(ssnCount).toBe(1);
  });
});

// ── applyPiiFilter: admin-configured standard-field exclusions ──

describe('applyPiiFilter — admin-configured standard-field exclusions', () => {
  it('does not strip a field with no configured exclusion', async () => {
    const input = makeContact({ department: 'Sales' });
    const { sanitised } = await applyPiiFilter(input, 'contact');
    const s = sanitised as Record<string, unknown>;
    expect(s['department']).toBe('Sales');
  });

  it('strips a field the admin has excluded, entity-qualified', async () => {
    await setFieldExclusion('contact', 'department', true, SYSTEM_ACTOR);
    const input = makeContact({ department: 'Sales' });
    const { sanitised, strippedFields } = await applyPiiFilter(input, 'contact');
    const s = sanitised as Record<string, unknown>;
    expect(s['department']).toBeUndefined();
    expect(strippedFields).toContain('department');
  });

  it('does not strip a same-named field on a different entity type', async () => {
    // 'name' is a standard field on both 'account' and 'deal' — excluding it
    // for 'deal' must not affect an 'account' payload filtered with a hint.
    await setFieldExclusion('deal', 'name', true, SYSTEM_ACTOR);
    const accountInput = { id: 'a-1', name: 'Acme Corp' };
    const { sanitised } = await applyPiiFilter(accountInput, 'account');
    const s = sanitised as Record<string, unknown>;
    expect(s['name']).toBe('Acme Corp');
  });

  it('applies unqualified matching when no entity type hint is given', async () => {
    await setFieldExclusion('contact', 'department', true, SYSTEM_ACTOR);
    const input = makeContact({ department: 'Sales' });
    const { sanitised } = await applyPiiFilter(input);
    const s = sanitised as Record<string, unknown>;
    expect(s['department']).toBeUndefined();
  });

  it('always-excluded fields remain stripped even when not in ai_field_exclusions', async () => {
    const input = makeContact({ password_hash: 'secret' });
    const { sanitised } = await applyPiiFilter(input, 'contact');
    const s = sanitised as Record<string, unknown>;
    expect(s['password_hash']).toBeUndefined();
  });

  it('reflects a newly configured exclusion on the next call without restart', async () => {
    const input = makeContact({ department: 'Sales' });

    const before = await applyPiiFilter(input, 'contact');
    expect((before.sanitised as Record<string, unknown>)['department']).toBe('Sales');

    await setFieldExclusion('contact', 'department', true, SYSTEM_ACTOR);

    const after = await applyPiiFilter(input, 'contact');
    expect((after.sanitised as Record<string, unknown>)['department']).toBeUndefined();
  });

  it('rejects an unknown field name for a known entity type', async () => {
    await expect(
      setFieldExclusion('contact', 'not_a_real_field', true, SYSTEM_ACTOR),
    ).rejects.toThrow(/Unknown standard field/);
  });
});
