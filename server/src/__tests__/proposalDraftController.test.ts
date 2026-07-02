/**
 * HTTP contract tests for proposal draft endpoints. (MINCRM-473)
 */

import 'dotenv/config';
import { vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        usage: { input_tokens: 100, output_tokens: 50 },
        content: [
          {
            type: 'tool_use',
            name: 'draft_proposal',
            input: {
              executive_summary: 'Summary.',
              problem_statement: 'Problem.',
              proposed_solution: 'Solution.',
              pricing_line_items: [{ description: 'Core package', amount: 25000 }],
              next_steps: 'Next steps.',
              prepared_for: 'Jane Doe',
            },
          },
        ],
      }),
    };
  }
  class AuthenticationError extends Error {}
  class APIConnectionError extends Error {}
  class APIError extends Error {}
  return {
    default: Object.assign(MockAnthropic, { AuthenticationError, APIConnectionError, APIError }),
  };
});

import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import { createDeal } from '../services/dealService.js';
import { getDefaultPipelineId } from '../services/pipelineService.js';
import { encryptVersioned } from '../services/cryptoService.js';
import { __clearCacheForTest } from '../services/featureFlagService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'proposal-draft-ctrl';
const REP_EMAIL = `${FILE_PREFIX}-rep@example.com`;

let repCookie: string;
let repId: string;
let defaultPipelineId: string;
let dealId: string;

const SAMPLE_DRAFT = {
  executive_summary: 'Summary.',
  problem_statement: 'Problem.',
  proposed_solution: 'Solution.',
  pricing_line_items: [{ description: 'Core package', amount: 25000 }],
  pricing_currency: 'USD',
  next_steps: 'Next steps.',
  prepared_for: 'Jane Doe',
  prepared_by: 'Test Rep',
};

/**
 * Guards against the ai_features master toggle being left disabled by another
 * serial-project test file's in-flight PATCH — see objectionMatchingController.test.ts.
 */
async function ensureAiFeaturesEnabled(): Promise<void> {
  await pool.query(`UPDATE feature_flags SET enabled = true WHERE flag_key = 'ai_features'`);
  __clearCacheForTest();
}

beforeAll(async () => {
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const rep = await createUser({
    email: REP_EMAIL,
    name: 'Proposal Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, role: rep.role, name: rep.name });
  defaultPipelineId = await getDefaultPipelineId();

  const { ciphertext, keyVersion } = encryptVersioned('sk-ant-mock-key-for-tests');
  await pool.query(
    `UPDATE ai_configuration
     SET enabled = true, api_key_encrypted = $1, api_key_key_version = $2,
         model = 'claude-sonnet-4-20250514'`,
    [ciphertext, keyVersion],
  );
});

beforeEach(async () => {
  await ensureAiFeaturesEnabled();
  const deal = await createDeal(
    {
      name: `Ctrl Deal ${Date.now()}`,
      stage: 'Proposal',
      pipeline_id: defaultPipelineId,
      owner_id: repId,
    },
    { id: repId, name: 'Proposal Rep' },
  );
  dealId = deal.id;
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(`UPDATE ai_configuration SET enabled = false, api_key_encrypted = ''`);
});

describe('POST /api/v1/deals/:id/proposal-draft', () => {
  it('returns 401 without authentication', async () => {
    await request(app).post(`/api/v1/deals/${dealId}/proposal-draft`).expect(401);
  });

  it('returns 404 for a non-existent deal', async () => {
    await request(app)
      .post('/api/v1/deals/00000000-0000-0000-0000-000000000000/proposal-draft')
      .set('Cookie', repCookie)
      .expect(404);
  });

  it('generates a proposal draft', async () => {
    const res = await request(app)
      .post(`/api/v1/deals/${dealId}/proposal-draft`)
      .set('Cookie', repCookie)
      .expect(200);

    expect(res.body.draft.executive_summary).toBe('Summary.');
    expect(res.body.draft.prepared_by).toBe('Proposal Rep');
  });

  it('accepts optional focus_notes', async () => {
    await request(app)
      .post(`/api/v1/deals/${dealId}/proposal-draft`)
      .set('Cookie', repCookie)
      .send({ focus_notes: 'Focus on ROI' })
      .expect(200);
  });

  it('returns 400 for an empty focus_notes string', async () => {
    await request(app)
      .post(`/api/v1/deals/${dealId}/proposal-draft`)
      .set('Cookie', repCookie)
      .send({ focus_notes: '' })
      .expect(400);
  });
});

describe('POST /api/v1/deals/:id/proposal-draft/export-docx', () => {
  it('returns 401 without authentication', async () => {
    await request(app)
      .post(`/api/v1/deals/${dealId}/proposal-draft/export-docx`)
      .send({ draft: SAMPLE_DRAFT })
      .expect(401);
  });

  it('returns 404 for a non-existent deal', async () => {
    await request(app)
      .post('/api/v1/deals/00000000-0000-0000-0000-000000000000/proposal-draft/export-docx')
      .set('Cookie', repCookie)
      .send({ draft: SAMPLE_DRAFT })
      .expect(404);
  });

  it('returns 400 for a malformed draft body', async () => {
    await request(app)
      .post(`/api/v1/deals/${dealId}/proposal-draft/export-docx`)
      .set('Cookie', repCookie)
      .send({ draft: { executive_summary: 'Only one field' } })
      .expect(400);
  });

  it('returns a DOCX file for a valid draft', async () => {
    const res = await request(app)
      .post(`/api/v1/deals/${dealId}/proposal-draft/export-docx`)
      .set('Cookie', repCookie)
      .send({ draft: SAMPLE_DRAFT })
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(res.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect((res.body as Buffer).length).toBeGreaterThan(0);
  });
});
