/**
 * Excluded-domain contracts: the Zod rules both lists share, the settings and mailbox
 * bodies built on them, and the database CHECK that bounds a mailbox's list.
 */

import 'dotenv/config';

import pool from '../db.js';
import { createUser } from '../services/userService.js';
import {
  MAX_EXCLUDED_DOMAINS,
  excludedDomainListSchema,
  excludedDomainSchema,
  parseExcludedDomainLines,
} from '@minicrm/shared/schemas/emailDomainSchema.js';
import { updateConnectedAccountSchema } from '@minicrm/shared/schemas/connectedAccountSchema.js';
import { threadPrivacySchema } from '@minicrm/shared/schemas/emailMessageSchema.js';
import {
  EMAIL_SYNC_BACKFILL_DAYS_MAX,
  EMAIL_SYNC_BACKFILL_DAYS_MIN,
  emailSyncBackfillDaysSchema,
  emailSyncExcludedDomainsSchema,
} from '@minicrm/shared/schemas/settingsSchema.js';
import { insertParkedMailbox, purgeFixtureUsers } from './testUtils.js';

const FILE_PREFIX = 'emdomschema';

function domains(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `d${index}.example.com`);
}

describe('excludedDomainSchema', () => {
  it.each(['example.com', 'mail.example.co.uk', 'a-b.example.org', 'x1.io'])(
    'accepts %s',
    (domain) => {
      expect(excludedDomainSchema.safeParse(domain).success).toBe(true);
    },
  );

  it('folds case and trims whitespace', () => {
    expect(excludedDomainSchema.parse('  Example.COM ')).toBe('example.com');
  });

  it.each([
    ['an address', 'someone@example.com'],
    ['a wildcard', '*.example.com'],
    ['the @domain form', '@example.com'],
    ['a bare TLD', 'com'],
    ['a leading hyphen', '-bad.example.com'],
    ['a trailing hyphen', 'bad-.example.com'],
    ['a punycode TLD ending in a hyphen', 'example.xn---'],
    ['a numeric TLD', 'example.123'],
    ['an empty string', ''],
    ['a scheme', 'https://example.com'],
  ])('rejects %s', (_label, domain) => {
    expect(excludedDomainSchema.safeParse(domain).success).toBe(false);
  });
});

describe('excludedDomainSchema length and IDN limits', () => {
  const label = (length: number): string => 'a'.repeat(length);

  it('accepts a 63-character label and rejects a 64-character one', () => {
    expect(excludedDomainSchema.safeParse(`${label(63)}.com`).success).toBe(true);
    expect(excludedDomainSchema.safeParse(`${label(64)}.com`).success).toBe(false);
  });

  it('accepts a 63-character TLD and rejects a 64-character one', () => {
    expect(excludedDomainSchema.safeParse(`example.${label(63)}`).success).toBe(true);
    expect(excludedDomainSchema.safeParse(`example.${label(64)}`).success).toBe(false);
  });

  it('accepts a 253-character domain and rejects a 254-character one', () => {
    // Four 61-character labels and four dots take 248; the TLD supplies the remainder.
    const base = Array.from({ length: 4 }, () => label(61)).join('.');
    expect(excludedDomainSchema.safeParse(`${base}.abcde`).success).toBe(true);
    expect(excludedDomainSchema.safeParse(`${base}.abcdef`).success).toBe(false);
  });

  it('accepts a punycode label and a punycode TLD', () => {
    expect(excludedDomainSchema.safeParse('xn--bcher-kva.de').success).toBe(true);
    expect(excludedDomainSchema.safeParse('example.xn--p1ai').success).toBe(true);
  });

  it('rejects a Unicode spelling, which providers never deliver', () => {
    expect(excludedDomainSchema.safeParse('bücher.de').success).toBe(false);
  });

  it('rejects a fully qualified trailing dot, which no address carries', () => {
    expect(excludedDomainSchema.safeParse('example.com.').success).toBe(false);
  });
});

describe('parseExcludedDomainLines', () => {
  it('splits on any line ending, trims, and drops blank lines', () => {
    expect(parseExcludedDomainLines(' a.com \r\n\nb.com\n   \nc.com')).toEqual([
      'a.com',
      'b.com',
      'c.com',
    ]);
  });

  it('reads empty text as an empty list', () => {
    expect(parseExcludedDomainLines('')).toEqual([]);
  });
});

describe('excludedDomainListSchema', () => {
  it('removes duplicates after normalizing case', () => {
    expect(excludedDomainListSchema.parse(['a.com', 'A.com', 'b.com'])).toEqual(['a.com', 'b.com']);
  });

  it(`accepts ${MAX_EXCLUDED_DOMAINS} domains and rejects one more`, () => {
    expect(excludedDomainListSchema.safeParse(domains(MAX_EXCLUDED_DOMAINS)).success).toBe(true);
    expect(excludedDomainListSchema.safeParse(domains(MAX_EXCLUDED_DOMAINS + 1)).success).toBe(
      false,
    );
  });

  it('refuses a raw list more than twice the limit, before removing duplicates', () => {
    const list = Array.from({ length: MAX_EXCLUDED_DOMAINS * 2 + 1 }, () => 'a.com');
    expect(excludedDomainListSchema.safeParse(list).success).toBe(false);
  });

  it('counts the limit after duplicates are removed', () => {
    const list = [...domains(MAX_EXCLUDED_DOMAINS), 'd0.example.com'];
    expect(excludedDomainListSchema.safeParse(list).success).toBe(true);
  });

  it('accepts an empty list, which clears it', () => {
    expect(excludedDomainListSchema.parse([])).toEqual([]);
  });
});

describe('request bodies built on the domain rules', () => {
  it('updateConnectedAccountSchema needs at least one field', () => {
    expect(updateConnectedAccountSchema.safeParse({}).success).toBe(false);
    expect(updateConnectedAccountSchema.safeParse({ sync_paused: true }).success).toBe(true);
    expect(updateConnectedAccountSchema.safeParse({ excluded_domains: [] }).success).toBe(true);
  });

  it('updateConnectedAccountSchema refuses unknown fields', () => {
    expect(
      updateConnectedAccountSchema.safeParse({ sync_paused: true, user_id: 'x' }).success,
    ).toBe(false);
  });

  it('threadPrivacySchema needs a boolean', () => {
    expect(threadPrivacySchema.safeParse({ is_private: true }).success).toBe(true);
    expect(threadPrivacySchema.safeParse({ is_private: 'yes' }).success).toBe(false);
    expect(threadPrivacySchema.safeParse({}).success).toBe(false);
  });

  it('emailSyncBackfillDaysSchema holds the window to whole days within bounds', () => {
    const parse = (days: unknown): boolean =>
      emailSyncBackfillDaysSchema.safeParse({ days }).success;
    expect(parse(EMAIL_SYNC_BACKFILL_DAYS_MIN)).toBe(true);
    expect(parse(EMAIL_SYNC_BACKFILL_DAYS_MAX)).toBe(true);
    expect(parse(EMAIL_SYNC_BACKFILL_DAYS_MIN - 1)).toBe(false);
    expect(parse(EMAIL_SYNC_BACKFILL_DAYS_MAX + 1)).toBe(false);
    expect(parse(1.5)).toBe(false);
    expect(parse('90')).toBe(false);
  });

  it('emailSyncExcludedDomainsSchema normalizes its list', () => {
    expect(emailSyncExcludedDomainsSchema.parse({ domains: ['X.com', 'x.com'] })).toEqual({
      domains: ['x.com'],
    });
  });
});

describe("the database limit on a mailbox's excluded domains", () => {
  it('is the same MAX_EXCLUDED_DOMAINS the schema enforces', async () => {
    const check = await pool.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conname = 'connected_accounts_excluded_domains_max_check'`,
    );

    expect(check.rows[0]?.definition).toMatch(new RegExp(`<= ${MAX_EXCLUDED_DOMAINS}\\)`));
  });
});

describe('connected_accounts.excluded_domains in the database', () => {
  let accountId: string;

  beforeAll(async () => {
    await purgeFixtureUsers({ emailLike: `${FILE_PREFIX}-%@example.com` });
    const rep = await createUser({
      email: `${FILE_PREFIX}-owner@example.com`,
      name: 'Domain Schema Rep',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    accountId = await insertParkedMailbox(rep.id, `${FILE_PREFIX}-owner@example.com`);
  });

  afterAll(async () => {
    await purgeFixtureUsers({ emailLike: `${FILE_PREFIX}-%@example.com` });
    await pool.end();
  });

  it('defaults to an empty list and an unpaused mailbox', async () => {
    const row = await pool.query<{ excluded_domains: string[]; sync_paused_at: Date | null }>(
      `SELECT excluded_domains, sync_paused_at FROM connected_accounts WHERE id = $1`,
      [accountId],
    );
    expect(row.rows[0]).toEqual({ excluded_domains: [], sync_paused_at: null });
  });

  it(`refuses more than ${MAX_EXCLUDED_DOMAINS} domains, matching the shared schema`, async () => {
    await expect(
      pool.query(`UPDATE connected_accounts SET excluded_domains = $2 WHERE id = $1`, [
        accountId,
        domains(MAX_EXCLUDED_DOMAINS + 1),
      ]),
    ).rejects.toMatchObject({ code: '23514' });

    await pool.query(`UPDATE connected_accounts SET excluded_domains = $2 WHERE id = $1`, [
      accountId,
      domains(MAX_EXCLUDED_DOMAINS),
    ]);
  });
});
