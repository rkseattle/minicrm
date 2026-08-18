/**
 * Integration tests for emailDraftService.
 *
 * Runs against a real PostgreSQL test database for contact/account/activity
 * data. The Anthropic SDK is mocked so no real API calls are made and token
 * usage recording is deterministic.
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
import { createContact } from '../services/contactService.js';
import { createAccount } from '../services/accountService.js';
import { generateEmailDraft } from '../services/emailDraftService.js';
import { encryptVersioned } from '../services/cryptoService.js';

const FILE_PREFIX = 'email-draft-svc';

let ownerId: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM accounts WHERE name LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const owner = await createUser({
    email: `${FILE_PREFIX}-owner@example.com`,
    name: 'Email Draft Owner',
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
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM accounts WHERE name LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(`UPDATE ai_configuration SET enabled = false, api_key_encrypted = ''`);
});

describe('generateEmailDraft', () => {
  it('returns null when the contact does not exist', async () => {
    const result = await generateEmailDraft(
      '00000000-0000-0000-0000-000000000000',
      'Professional',
      ownerId,
    );
    expect(result).toBeNull();
  });

  it('gathers contact context, calls Claude via a forced tool call, and returns the structured draft', async () => {
    const account = await createAccount(
      { name: `${FILE_PREFIX}-Acme Corp`, owner_id: ownerId },
      { id: ownerId, name: 'Email Draft Owner' },
    );
    const contact = await createContact(
      {
        first_name: 'Jane',
        last_name: 'Doe',
        email: `${FILE_PREFIX}-jane@example.com`,
        title: 'VP Sales',
        account_id: account.id,
        owner_id: ownerId,
      },
      { id: ownerId, name: 'Email Draft Owner' },
    );

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 90, output_tokens: 35 },
      content: [
        {
          type: 'tool_use',
          name: 'report_email_draft',
          input: {
            subject: 'Following up on our conversation',
            body: 'Hi Jane, following up on our last call...',
          },
        },
      ],
    });

    const result = await generateEmailDraft(contact.id, 'Professional', ownerId);

    expect(result).not.toBeNull();
    expect(result?.subject).toBe('Following up on our conversation');
    expect(result?.body).toContain('Hi Jane');
    expect(result?.tone).toBe('Professional');
    expect(mockCreate).toHaveBeenCalledTimes(1);

    const callArgs = mockCreate.mock.calls[0][0];
    const sentPayload = JSON.parse(callArgs.messages[0].content);
    expect(sentPayload.first_name).toBe('Jane');
    expect(sentPayload.company_name).toBe(`${FILE_PREFIX}-Acme Corp`);
    expect(sentPayload).not.toHaveProperty('email');
  });

  it('throws a 503 when AI is not enabled', async () => {
    await pool.query(`UPDATE ai_configuration SET enabled = false`);

    const contact = await createContact(
      {
        first_name: 'Disabled',
        last_name: 'AI',
        email: `${FILE_PREFIX}-disabled@example.com`,
        owner_id: ownerId,
      },
      { id: ownerId, name: 'Email Draft Owner' },
    );

    await expect(generateEmailDraft(contact.id, 'Professional', ownerId)).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it('throws a 502 when Claude does not return the expected tool call', async () => {
    await pool.query(`UPDATE ai_configuration SET enabled = true`);

    const contact = await createContact(
      {
        first_name: 'No',
        last_name: 'ToolCall',
        email: `${FILE_PREFIX}-notool@example.com`,
        owner_id: ownerId,
      },
      { id: ownerId, name: 'Email Draft Owner' },
    );

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'text', text: 'I could not draft this email.' }],
    });

    await expect(generateEmailDraft(contact.id, 'Professional', ownerId)).rejects.toMatchObject({
      statusCode: 502,
    });
  });
});
