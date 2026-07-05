/**
 * Integration tests for contactEnrichmentService. (MINCRM-439)
 *
 * Runs against a real PostgreSQL test database for account matching. The
 * Anthropic SDK is mocked so no real API calls are made and token usage
 * recording is deterministic.
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import { vi } from 'vitest';

const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: mockCreate };
  }
  class AuthenticationError extends Error {}
  class APIConnectionError extends Error {}
  class APIError extends Error {}
  return {
    default: Object.assign(MockAnthropic, { AuthenticationError, APIConnectionError, APIError }),
  };
});

import pool from '../db.js';
import { createUser } from '../services/userService.js';
import { createAccount } from '../services/accountService.js';
import { enrichContactFromText } from '../services/contactEnrichmentService.js';
import { encryptVersioned } from '../services/cryptoService.js';

const FILE_PREFIX = 'contact-enrichment-svc';

let ownerId: string;

beforeAll(async () => {
  await pool.query('DELETE FROM accounts WHERE name LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const owner = await createUser({
    email: `${FILE_PREFIX}-owner@example.com`,
    name: 'Contact Enrichment Owner',
    role: 'rep',
    passwordHash: '$2b$12$placeholder_hash',
    status: 'active',
  });
  ownerId = owner.id;
});

beforeEach(async () => {
  vi.clearAllMocks();
  const { ciphertext, keyVersion } = encryptVersioned('sk-ant-mock-key-for-tests');
  await pool.query(
    `UPDATE ai_configuration SET enabled = true, api_key_encrypted = $1, api_key_key_version = $2, model = 'claude-sonnet-4-20250514'`,
    [ciphertext, keyVersion],
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM accounts WHERE name LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(`UPDATE ai_configuration SET enabled = false, api_key_encrypted = ''`);
});

describe('enrichContactFromText', () => {
  it('extracts fields via a forced tool call and matches an existing account by exact name', async () => {
    const account = await createAccount(
      { name: `${FILE_PREFIX}-Acme Corp`, owner_id: ownerId },
      { id: ownerId, name: 'Contact Enrichment Owner' },
    );

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 50, output_tokens: 20 },
      content: [
        {
          type: 'tool_use',
          name: 'report_contact_enrichment',
          input: {
            first_name: 'Jane',
            last_name: 'Doe',
            title: 'VP Sales',
            company_name: `${FILE_PREFIX}-Acme Corp`,
            email: 'jane@acme.com',
            phone: null,
            linkedin_url: null,
            location: null,
            insufficient_data: false,
          },
        },
      ],
    });

    const result = await enrichContactFromText('Jane Doe, VP Sales at Acme Corp', ownerId);

    expect(result.fields.first_name).toBe('Jane');
    expect(result.fields.company_name).toBe(`${FILE_PREFIX}-Acme Corp`);
    expect(result.matched_account_id).toBe(account.id);
    expect(result.insufficient_data).toBe(false);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('returns insufficient_data true and no account match when extraction yields nothing useful', async () => {
    mockCreate.mockResolvedValue({
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [
        {
          type: 'tool_use',
          name: 'report_contact_enrichment',
          input: {
            first_name: null,
            last_name: null,
            title: null,
            company_name: null,
            email: null,
            phone: null,
            linkedin_url: null,
            location: null,
            insufficient_data: true,
          },
        },
      ],
    });

    const result = await enrichContactFromText('asdf jkl;', ownerId);

    expect(result.insufficient_data).toBe(true);
    expect(result.matched_account_id).toBeNull();
  });

  it('throws a 503 when AI is not enabled', async () => {
    await pool.query(`UPDATE ai_configuration SET enabled = false`);

    await expect(enrichContactFromText('Some text', ownerId)).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it('throws a 502 when Claude does not return the expected tool call', async () => {
    await pool.query(`UPDATE ai_configuration SET enabled = true`);

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'text', text: 'I could not extract this.' }],
    });

    await expect(enrichContactFromText('Some text', ownerId)).rejects.toMatchObject({
      statusCode: 502,
    });
  });
});
