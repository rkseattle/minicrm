/**
 * Integration tests for stageAdvancementService. (MINCRM-443)
 *
 * Runs against a real PostgreSQL test database for all deal/pipeline/activity
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
import { createDeal } from '../services/dealService.js';
import { createActivity } from '../services/activityService.js';
import { createPipeline } from '../services/pipelineService.js';
import { createPipelineStage } from '../services/pipelineStageService.js';
import { checkStageAdvancement } from '../services/stageAdvancementService.js';
import { encryptVersioned } from '../services/cryptoService.js';
import { invalidateFeatureFlagCache } from '../services/featureFlagService.js';

const FILE_PREFIX = 'stage-adv-svc';

const OWNER_USER = {
  email: `${FILE_PREFIX}-owner@example.com`,
  name: 'Stage Advancement Owner',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let ownerId: string;
let pipelineId: string;
/** Non-terminal stage with a next stage available. */
let prospectingStageName: string;
/** Non-terminal stage that is the last non-terminal stage (has only a terminal stage after it). */
let proposalStageName: string;
/** Terminal stage — the last stage in the pipeline. */
let closedWonStageName: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const owner = await createUser(OWNER_USER);
  ownerId = owner.id;

  const pipeline = await createPipeline({ name: `${FILE_PREFIX}-pipeline-${Date.now()}` });
  pipelineId = pipeline.id;

  const prospecting = await createPipelineStage({
    name: 'Prospecting',
    probability: 10,
    pipeline_id: pipelineId,
  });
  prospectingStageName = prospecting.name;

  const proposal = await createPipelineStage({
    name: 'Proposal',
    probability: 50,
    pipeline_id: pipelineId,
  });
  proposalStageName = proposal.name;

  const closedWon = await createPipelineStage({
    name: 'Closed Won',
    probability: 100,
    pipeline_id: pipelineId,
  });
  closedWonStageName = closedWon.name;
  await pool.query(`UPDATE pipeline_stages SET is_terminal = true WHERE id = $1`, [closedWon.id]);
});

beforeEach(async () => {
  vi.clearAllMocks();
  const { ciphertext, keyVersion } = encryptVersioned('sk-ant-mock-key-for-tests');
  await pool.query(
    `UPDATE ai_configuration SET enabled = true, api_key_encrypted = $1, api_key_key_version = $2, model = 'claude-sonnet-4-20250514'`,
    [ciphertext, keyVersion],
  );
  // This file calls the real createActivity(), which fires scoreActivitySentiment
  // fire-and-forget after every insert. With ai_configuration.enabled=true above, that
  // background hook would otherwise call the same mocked Anthropic client and pollute
  // mockCreate's call count/args for this file's own assertions. (MINCRM-472)
  await pool.query(
    `UPDATE feature_flags SET enabled = false WHERE flag_key = 'ai_sentiment_tracking'`,
  );
  invalidateFeatureFlagCache();
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query('DELETE FROM pipeline_stages WHERE pipeline_id = $1', [pipelineId]);
  await pool.query('DELETE FROM pipelines WHERE id = $1', [pipelineId]);
  await pool.query(`UPDATE ai_configuration SET enabled = false, api_key_encrypted = ''`);
  // Restore the flag disabled in beforeEach — feature_flags is a shared global table and
  // this file runs serially alongside every other test file, so leaving it disabled would
  // break unrelated later suites (e.g. championBlockerService/-Controller). (MINCRM-472)
  await pool.query(
    `UPDATE feature_flags SET enabled = true WHERE flag_key = 'ai_sentiment_tracking'`,
  );
  invalidateFeatureFlagCache();
});

describe('checkStageAdvancement', () => {
  it('returns null when the deal does not exist', async () => {
    const result = await checkStageAdvancement('00000000-0000-0000-0000-000000000000', ownerId);
    expect(result).toBeNull();
  });

  it('returns { ready: false } without calling the AI when the deal is already in a terminal stage', async () => {
    const deal = await createDeal(
      {
        name: 'Already Won Deal',
        stage: closedWonStageName,
        pipeline_id: pipelineId,
        owner_id: ownerId,
      },
      { id: ownerId, name: OWNER_USER.name },
    );

    const result = await checkStageAdvancement(deal.id, ownerId);
    expect(result).toEqual({ ready: false });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('calls Claude via a forced tool call and returns the suggested next stage when ready', async () => {
    const deal = await createDeal(
      {
        name: 'Ready To Advance Deal',
        stage: prospectingStageName,
        pipeline_id: pipelineId,
        owner_id: ownerId,
      },
      { id: ownerId, name: OWNER_USER.name },
    );
    await createActivity(
      {
        type: 'Call',
        subject: 'Proposal sent and acknowledged',
        deal_id: deal.id,
        owner_id: ownerId,
      },
      { id: ownerId, name: OWNER_USER.name },
    );

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 90, output_tokens: 30 },
      content: [
        {
          type: 'tool_use',
          name: 'report_stage_advancement',
          input: {
            ready: true,
            rationale: 'Proposal was sent and the contact confirmed receipt.',
          },
        },
      ],
    });

    const result = await checkStageAdvancement(deal.id, ownerId);

    expect(result).toMatchObject({
      ready: true,
      next_stage_name: proposalStageName,
      rationale: 'Proposal was sent and the contact confirmed receipt.',
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('returns { ready: false } when the AI is not confident', async () => {
    const deal = await createDeal(
      {
        name: 'Weak Signal Deal',
        stage: prospectingStageName,
        pipeline_id: pipelineId,
        owner_id: ownerId,
      },
      { id: ownerId, name: OWNER_USER.name },
    );

    mockCreate.mockResolvedValue({
      usage: { input_tokens: 40, output_tokens: 10 },
      content: [{ type: 'tool_use', name: 'report_stage_advancement', input: { ready: false } }],
    });

    const result = await checkStageAdvancement(deal.id, ownerId);
    expect(result).toEqual({ ready: false });
  });

  it('returns { ready: false } without calling the AI when the current stage has no next stage', async () => {
    // A pipeline with exactly one non-terminal stage: there is nothing to advance to.
    const singleStagePipeline = await createPipeline({
      name: `${FILE_PREFIX}-single-stage-${Date.now()}`,
    });
    const onlyStage = await createPipelineStage({
      name: 'Only Stage',
      probability: 10,
      pipeline_id: singleStagePipeline.id,
    });
    const deal = await createDeal(
      {
        name: 'No Next Stage Deal',
        stage: onlyStage.name,
        pipeline_id: singleStagePipeline.id,
        owner_id: ownerId,
      },
      { id: ownerId, name: OWNER_USER.name },
    );

    const result = await checkStageAdvancement(deal.id, ownerId);
    expect(result).toEqual({ ready: false });
    expect(mockCreate).not.toHaveBeenCalled();

    await pool.query('DELETE FROM deals WHERE id = $1', [deal.id]);
    await pool.query('DELETE FROM pipeline_stages WHERE id = $1', [onlyStage.id]);
    await pool.query('DELETE FROM pipelines WHERE id = $1', [singleStagePipeline.id]);
  });

  it('throws a 503 when AI is not enabled', async () => {
    await pool.query(`UPDATE ai_configuration SET enabled = false`);

    const deal = await createDeal(
      {
        name: 'Disabled AI Stage Deal',
        stage: prospectingStageName,
        pipeline_id: pipelineId,
        owner_id: ownerId,
      },
      { id: ownerId, name: OWNER_USER.name },
    );

    await expect(checkStageAdvancement(deal.id, ownerId)).rejects.toMatchObject({
      statusCode: 503,
    });
  });
});
