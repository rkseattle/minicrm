/**
 * Unit tests for csvUtils and userUtils. (MINCRM-295)
 */

import { describe, it, expect } from 'vitest';
import { serializeToCsv, csvFilename } from '../utils/csvUtils.js';
import { sanitizeUser } from '../utils/userUtils.js';

// ── serializeToCsv ────────────────────────────────────────────────────────────

describe('serializeToCsv', () => {
  it('produces a BOM-prefixed CSV with header and data rows', () => {
    const csv = serializeToCsv(['name', 'email'], [{ name: 'Alice', email: 'alice@example.com' }]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('name,email');
    expect(csv).toContain('Alice,alice@example.com');
  });

  it('wraps fields containing commas in double-quotes', () => {
    const csv = serializeToCsv(['val'], [{ val: 'a,b' }]);
    expect(csv).toContain('"a,b"');
  });

  it('escapes embedded double-quotes by doubling them', () => {
    const csv = serializeToCsv(['val'], [{ val: 'say "hello"' }]);
    expect(csv).toContain('"say ""hello"""');
  });

  it('wraps fields containing newlines in double-quotes', () => {
    const csv = serializeToCsv(['val'], [{ val: 'line1\nline2' }]);
    expect(csv).toContain('"line1\nline2"');
  });

  it('prefixes formula-trigger characters with a single quote', () => {
    for (const char of ['=', '+', '-', '@']) {
      const csv = serializeToCsv(['val'], [{ val: `${char}CMD` }]);
      expect(csv).toContain(`'${char}CMD`);
    }
  });

  it('renders null and undefined as empty strings', () => {
    const csv = serializeToCsv(['a', 'b'], [{ a: null, b: undefined }]);
    const dataLine = csv.split('\r\n')[1];
    expect(dataLine).toBe(',');
  });

  it('formats Date values as ISO-like UTC strings', () => {
    const csv = serializeToCsv(['d'], [{ d: new Date('2025-06-01T12:00:00.000Z') }]);
    expect(csv).toContain('2025-06-01 12:00:00 UTC');
  });

  it('handles numeric values without quoting', () => {
    const csv = serializeToCsv(['n'], [{ n: 42 }]);
    expect(csv).toContain('42');
  });

  it('produces only a header row when rows array is empty', () => {
    const csv = serializeToCsv(['name', 'email'], []);
    const lines = csv.replace('﻿', '').split('\r\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('name,email');
  });

  it('uses CRLF line endings between rows', () => {
    const csv = serializeToCsv(['x'], [{ x: '1' }, { x: '2' }]);
    expect(csv).toContain('\r\n');
  });
});

// ── csvFilename ───────────────────────────────────────────────────────────────

describe('csvFilename', () => {
  it('returns a filename in the pattern minicrm-<entity>-YYYY-MM-DD.csv', () => {
    const name = csvFilename('contacts');
    expect(name).toMatch(/^minicrm-contacts-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('includes todays date', () => {
    const today = new Date().toISOString().split('T')[0];
    expect(csvFilename('deals')).toContain(today);
  });
});

// ── sanitizeUser ──────────────────────────────────────────────────────────────

describe('sanitizeUser', () => {
  it('strips password_hash from the returned object', () => {
    const row = {
      id: '1',
      email: 'a@b.com',
      name: 'A',
      role: 'rep' as const,
      status: 'active' as const,
      password_hash: 'secret',
      must_change_password: false,
      preferred_language: 'en',
      notify_overdue_tasks: true,
      notify_assignments: true,
      notify_deal_stage_changes: true,
      password_reset_token: null,
      password_reset_expires: null,
      password_changed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const safe = sanitizeUser(row);
    expect(safe).not.toHaveProperty('password_hash');
    expect(safe.email).toBe('a@b.com');
  });
});
