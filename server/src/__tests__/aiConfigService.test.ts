/**
 * Integration tests for aiConfigService.
 *
 * Covers:
 *  - getAiConfig: default values when no rows set, populated state
 *  - setAiEnabled: toggles the master flag, records timestamp, writes audit entry
 *  - setAiConfig: persists fields, encrypts API key, resets DPA on provider change, audits
 *  - setAiDpaAcknowledgment: records and clears acknowledgment
 *  - isAiEnabled: lightweight check
 *  - deriveDpaStatus / deriveDataPosture: composite indicator logic
 *
 * Runs against the real minicrm_test PostgreSQL database.
 * (MINCRM-457, MINCRM-502)
 */

import 'dotenv/config';
import pool from '../db.js';
import { createUser } from '../services/userService.js';
import {
  getAiConfig,
  setAiEnabled,
  setAiConfig,
  setAiDpaAcknowledgment,
  isAiEnabled,
} from '../services/aiConfigService.js';
import { isFlagEnabledForUser, __clearCacheForTest } from '../services/featureFlagService.js';

// ACTOR must reference a real users row because dpa_acknowledged_by is a UUID FK.
// We create the user in beforeAll and record its generated id at runtime.
const ACTOR_EMAIL = 'ai-svc-test-admin@example.com';
const ACTOR_NAME = 'Test Admin';
let ACTOR: { id: string; name: string };

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email = $1', [ACTOR_EMAIL]);
  const user = await createUser({
    email: ACTOR_EMAIL,
    name: ACTOR_NAME,
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  ACTOR = { id: user.id, name: user.name };
});

/** Reset the singleton row to safe defaults before each test. */
async function resetAiConfig(): Promise<void> {
  await pool.query(`
    UPDATE ai_configuration SET
      provider                       = 'anthropic',
      model                          = 'claude-sonnet-4-20250514',
      api_key_encrypted              = '',
      deployment_mode                = 'cloud_api',
      base_url                       = '',
      enabled                        = false,
      enabled_updated_at             = NULL,
      dpa_acknowledged               = false,
      dpa_acknowledged_by            = NULL,
      dpa_acknowledged_at            = NULL,
      dpa_acknowledged_for_provider  = '',
      custom_dpa_url                 = '',
      updated_at                     = now(),
      updated_by                     = NULL
  `);
  // setAiEnabled syncs the ai_features flag (and role_overrides tests mutate
  // ai_nli_page directly) — reset both to their seeded defaults so tests in
  // this file don't leak state to each other or to other serial files.
  await pool.query(
    `UPDATE feature_flags SET enabled = true, role_overrides = NULL WHERE flag_key = 'ai_features'`,
  );
  await pool.query(
    `UPDATE feature_flags SET role_overrides = '{"admin": true, "rep": true}'::jsonb
     WHERE flag_key = 'ai_nli_page'`,
  );
  __clearCacheForTest();
}

beforeEach(async () => {
  await resetAiConfig();
});

afterAll(async () => {
  await resetAiConfig();
  await pool.query('DELETE FROM users WHERE email = $1', [ACTOR_EMAIL]);
  // Do NOT call pool.end() — this file runs in the parallel Vitest project
  // and pool is a shared singleton. Calling end() here terminates it for all
  // other concurrent test files and causes "Cannot use a pool after calling end".
});

// ── getAiConfig defaults ───────────────────────────────────────────────────────

describe('getAiConfig', () => {
  it('returns safe defaults when row is reset to defaults', async () => {
    const config = await getAiConfig();
    expect(config.enabled).toBe(false);
    expect(config.provider).toBe('anthropic');
    expect(config.model).toBe('claude-sonnet-4-20250514');
    expect(config.api_key_set).toBe(false);
    expect(config.deployment_mode).toBe('cloud_api');
    expect(config.base_url).toBe('');
    expect(config.dpa_acknowledged).toBe(false);
    expect(config.dpa_status).toBe('not_acknowledged');
    expect(config.data_posture).toBe('amber');
    expect(config.available_models.length).toBeGreaterThan(0);
    expect(config.provider_dpa_url).toContain('anthropic.com');
  });

  it('returns safe defaults when the singleton row is absent (null-row path)', async () => {
    await pool.query('DELETE FROM ai_configuration');
    const config = await getAiConfig();
    expect(config.enabled).toBe(false);
    expect(config.provider).toBe('anthropic');
    expect(config.model).toBe('claude-sonnet-4-20250514');
    expect(config.base_url).toBe('');
    expect(config.custom_dpa_url).toBe('');
    expect(config.dpa_acknowledged).toBe(false);
    expect(config.dpa_acknowledged_by).toBe('');
    expect(config.dpa_acknowledged_at).toBeNull();
    expect(config.enabled_updated_at).toBeNull();
    // Restore the singleton row for subsequent tests.
    await pool.query(
      'INSERT INTO ai_configuration (singleton) VALUES (TRUE) ON CONFLICT ON CONSTRAINT ai_configuration_singleton_unique DO NOTHING',
    );
  });

  it('reflects stored values', async () => {
    await pool.query(`UPDATE ai_configuration SET enabled = true, model = 'claude-opus-4-8'`);
    const config = await getAiConfig();
    expect(config.enabled).toBe(true);
    expect(config.model).toBe('claude-opus-4-8');
  });

  it('derives dpa_status = acknowledged when provider matches', async () => {
    await pool.query(`
      UPDATE ai_configuration SET
        provider = 'anthropic',
        dpa_acknowledged = true,
        dpa_acknowledged_for_provider = 'anthropic'
    `);
    const config = await getAiConfig();
    expect(config.dpa_status).toBe('acknowledged');
    expect(config.data_posture).toBe('green');
  });

  it('derives dpa_status = provider_changed when provider differs from acknowledged provider', async () => {
    await pool.query(`
      UPDATE ai_configuration SET
        provider = 'anthropic',
        dpa_acknowledged = true,
        dpa_acknowledged_for_provider = 'other_provider'
    `);
    const config = await getAiConfig();
    expect(config.dpa_status).toBe('provider_changed');
    expect(config.data_posture).toBe('red');
  });

  it('derives data_posture = green for self_hosted regardless of DPA', async () => {
    await pool.query(`
      UPDATE ai_configuration SET deployment_mode = 'self_hosted', dpa_acknowledged = false
    `);
    const config = await getAiConfig();
    expect(config.data_posture).toBe('green');
  });
});

// ── isAiEnabled ────────────────────────────────────────────────────────────────

describe('isAiEnabled', () => {
  it('returns false when enabled = false', async () => {
    await expect(isAiEnabled()).resolves.toBe(false);
  });

  it('returns true when enabled = true', async () => {
    await pool.query(`UPDATE ai_configuration SET enabled = true`);
    await expect(isAiEnabled()).resolves.toBe(true);
  });

  it('returns false when enabled = false (explicit)', async () => {
    await pool.query(`UPDATE ai_configuration SET enabled = false`);
    await expect(isAiEnabled()).resolves.toBe(false);
  });
});

// ── setAiEnabled ───────────────────────────────────────────────────────────────

describe('setAiEnabled', () => {
  it('persists the enabled flag and records a timestamp', async () => {
    const config = await setAiEnabled({ enabled: true }, ACTOR);
    expect(config.enabled).toBe(true);
    expect(config.enabled_updated_at).not.toBeNull();

    const off = await setAiEnabled({ enabled: false }, ACTOR);
    expect(off.enabled).toBe(false);
    expect(off.enabled_updated_at).not.toBeNull();
  });

  it('syncs the ai_features master flag so every ai_* sub-feature (e.g. ai_nli_page) is gated', async () => {
    await setAiEnabled({ enabled: false }, ACTOR);
    __clearCacheForTest();

    const row = await pool.query<{ enabled: boolean }>(
      `SELECT enabled FROM feature_flags WHERE flag_key = 'ai_features'`,
    );
    expect(row.rows[0].enabled).toBe(false);
    // ai_features gates every ai_* sub-feature flag (featureFlagService's
    // master-gate) — confirm the effect actually reaches ai_nli_page.
    expect(await isFlagEnabledForUser('ai_nli_page', ACTOR.id, 'admin')).toBe(false);
  });

  it('does not touch ai_nli_page.role_overrides — those stay under the Feature Flags page', async () => {
    await pool.query(
      `UPDATE feature_flags SET role_overrides = '{"admin": true, "rep": false}'::jsonb
       WHERE flag_key = 'ai_nli_page'`,
    );

    await setAiEnabled({ enabled: true }, ACTOR);

    const row = await pool.query<{ role_overrides: unknown }>(
      `SELECT role_overrides FROM feature_flags WHERE flag_key = 'ai_nli_page'`,
    );
    expect(row.rows[0].role_overrides).toEqual({ admin: true, rep: false });
  });

  it('writes a feature_flag audit entry when ai_features changes', async () => {
    await setAiEnabled({ enabled: false }, ACTOR);

    const audit = await pool.query(
      `SELECT * FROM audit_log
       WHERE record_type = 'feature_flag' AND field_name = 'enabled' AND changed_by_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [ACTOR.id],
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0].old_value).toBe('true');
    expect(audit.rows[0].new_value).toBe('false');
  });

  it('does not write a feature_flag audit entry when ai_features was already at the target value', async () => {
    await setAiEnabled({ enabled: false }, ACTOR);
    // Scoped by changed_by_id as well as the created_at boundary. record_type +
    // field_name are shared with aiConfigController.test.ts, which also mutates
    // the ai_features flag, so a window alone cannot isolate this assertion —
    // it only narrows the race. ACTOR.id is this file's own admin user.
    // (MINCRM-693)
    const before = await pool.query<{ max: string | null }>(
      `SELECT MAX(created_at)::text AS max FROM audit_log
       WHERE record_type = 'feature_flag' AND field_name = 'enabled' AND changed_by_id = $1`,
      [ACTOR.id],
    );

    // ai_features is already false — setting the master toggle to false again
    // should not produce a spurious "unchanged" audit entry. audit_log is
    // append-only (a DB trigger blocks UPDATE/DELETE), so assert via a
    // created_at boundary rather than clearing prior rows.
    await setAiEnabled({ enabled: false }, ACTOR);

    const after = await pool.query<{ id: string }>(
      `SELECT id FROM audit_log
       WHERE record_type = 'feature_flag' AND field_name = 'enabled' AND changed_by_id = $2
         AND ($1::timestamptz IS NULL OR created_at > $1::timestamptz)`,
      [before.rows[0]?.max ?? null, ACTOR.id],
    );
    expect(after.rows.length).toBe(0);
  });

  it('ai_configuration.enabled and the ai_features flag never diverge — both writes commit atomically on the same transaction', async () => {
    // Regression test: ai_configuration and feature_flags are written on the
    // same client/transaction inside setAiEnabled specifically so a failure
    // partway through can never leave one table reflecting the new value and
    // the other the old one. Flip it a few times and assert they always agree.
    for (const enabled of [true, false, true]) {
      await setAiEnabled({ enabled }, ACTOR);
      __clearCacheForTest();

      const configRow = await pool.query<{ enabled: boolean }>(
        `SELECT enabled FROM ai_configuration LIMIT 1`,
      );
      const flagRow = await pool.query<{ enabled: boolean }>(
        `SELECT enabled FROM feature_flags WHERE flag_key = 'ai_features'`,
      );
      expect(configRow.rows[0].enabled).toBe(enabled);
      expect(flagRow.rows[0].enabled).toBe(enabled);
    }
  });
});

// ── setAiConfig ────────────────────────────────────────────────────────────────

describe('setAiConfig', () => {
  it('persists provider, model, and deployment mode', async () => {
    const config = await setAiConfig(
      {
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        deployment_mode: 'cloud_api',
        base_url: '',
        custom_dpa_url: '',
      },
      ACTOR,
    );
    expect(config.provider).toBe('anthropic');
    expect(config.model).toBe('claude-opus-4-8');
    expect(config.deployment_mode).toBe('cloud_api');
  });

  it('stores and detects an encrypted API key without exposing plaintext', async () => {
    const config = await setAiConfig(
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        deployment_mode: 'cloud_api',
        base_url: '',
        custom_dpa_url: '',
        api_key: 'sk-ant-test-key-value',
      },
      ACTOR,
    );
    expect(config.api_key_set).toBe(true);

    // Verify the raw stored value is NOT the plaintext.
    const row = await pool.query<{ api_key_encrypted: string }>(
      'SELECT api_key_encrypted FROM ai_configuration LIMIT 1',
    );
    expect(row.rows[0].api_key_encrypted).not.toBe('sk-ant-test-key-value');
    expect(row.rows[0].api_key_encrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/); // iv:authTag:ciphertext
  });

  it('leaves the stored API key unchanged when api_key is omitted', async () => {
    // First set a key.
    await setAiConfig(
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        deployment_mode: 'cloud_api',
        base_url: '',
        custom_dpa_url: '',
        api_key: 'sk-ant-original',
      },
      ACTOR,
    );

    const before = await pool.query<{ api_key_encrypted: string }>(
      'SELECT api_key_encrypted FROM ai_configuration LIMIT 1',
    );

    // Update model without supplying api_key.
    await setAiConfig(
      {
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        deployment_mode: 'cloud_api',
        base_url: '',
        custom_dpa_url: '',
      },
      ACTOR,
    );

    const after = await pool.query<{ api_key_encrypted: string }>(
      'SELECT api_key_encrypted FROM ai_configuration LIMIT 1',
    );
    expect(after.rows[0].api_key_encrypted).toBe(before.rows[0].api_key_encrypted);
  });

  it('preserves DPA acknowledgment when provider is unchanged', async () => {
    // Pre-seed an acknowledged DPA for 'anthropic'.
    await pool.query(
      `UPDATE ai_configuration SET
         provider = 'anthropic',
         dpa_acknowledged = true,
         dpa_acknowledged_by = $1,
         dpa_acknowledged_at = now(),
         dpa_acknowledged_for_provider = 'anthropic'`,
      [ACTOR.id],
    );

    // Same provider — DPA acknowledgment must be preserved.
    const unchanged = await setAiConfig(
      {
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        deployment_mode: 'cloud_api',
        base_url: '',
        custom_dpa_url: '',
      },
      ACTOR,
    );
    expect(unchanged.dpa_acknowledged).toBe(true);
  });

  it('resets DPA acknowledgment when provider changes', async () => {
    // Pre-seed acknowledged DPA for a hypothetical 'other_provider'.
    await pool.query(
      `UPDATE ai_configuration SET
         provider = 'other_provider',
         dpa_acknowledged = true,
         dpa_acknowledged_by = $1,
         dpa_acknowledged_at = now(),
         dpa_acknowledged_for_provider = 'other_provider'`,
      [ACTOR.id],
    );

    // Switch to 'anthropic' — DPA acknowledgment must be cleared.
    const changed = await setAiConfig(
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        deployment_mode: 'cloud_api',
        base_url: '',
        custom_dpa_url: '',
      },
      ACTOR,
    );
    expect(changed.dpa_acknowledged).toBe(false);
    expect(changed.dpa_acknowledged_by).toBe('');
    expect(changed.dpa_acknowledged_at).toBeNull();
    expect(changed.dpa_status).toBe('not_acknowledged');
  });

  it('writes an audit entry when the API key is rotated', async () => {
    await setAiConfig(
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        deployment_mode: 'cloud_api',
        base_url: '',
        custom_dpa_url: '',
        api_key: 'sk-ant-new-key',
      },
      ACTOR,
    );

    const row = await pool.query<{
      field_name: string;
      old_value: string | null;
      new_value: string | null;
    }>(
      // Scoped by changed_by_id — record_type + field_name are shared with
      // aiConfigController.test.ts's own AI-config PATCHes. (MINCRM-693)
      `SELECT field_name, old_value, new_value
       FROM audit_log
       WHERE record_type = 'ai_settings' AND field_name = 'api_key'
         AND changed_by_id = $1
       ORDER BY id DESC LIMIT 1`,
      [ACTOR.id],
    );
    expect(row.rows).toHaveLength(1);
    // Values must be null — the audit entry records the fact of a change, never the key.
    expect(row.rows[0].old_value).toBeNull();
    expect(row.rows[0].new_value).toBeNull();
  });

  it('persists base_url for private_endpoint mode', async () => {
    const config = await setAiConfig(
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        deployment_mode: 'private_endpoint',
        base_url: 'https://my-private-endpoint.example.com',
        custom_dpa_url: '',
      },
      ACTOR,
    );
    expect(config.deployment_mode).toBe('private_endpoint');
    expect(config.base_url).toBe('https://my-private-endpoint.example.com');
  });
});

// ── setAiDpaAcknowledgment ─────────────────────────────────────────────────────

describe('setAiDpaAcknowledgment', () => {
  it('records acknowledgment with actor name, timestamp, and current provider', async () => {
    await pool.query(`UPDATE ai_configuration SET provider = 'anthropic'`);
    const config = await setAiDpaAcknowledgment({ acknowledged: true, custom_dpa_url: '' }, ACTOR);
    expect(config.dpa_acknowledged).toBe(true);
    // dpa_acknowledged_by is resolved from the UUID to the user's display name.
    expect(config.dpa_acknowledged_by).toBe(ACTOR.name);
    expect(config.dpa_acknowledged_at).not.toBeNull();
    expect(config.dpa_acknowledged_for_provider).toBe('anthropic');
    expect(config.dpa_status).toBe('acknowledged');
  });

  it('clears acknowledgment when acknowledged = false', async () => {
    await pool.query(
      `
      UPDATE ai_configuration SET
        dpa_acknowledged = true,
        dpa_acknowledged_by = $1,
        dpa_acknowledged_at = now(),
        dpa_acknowledged_for_provider = 'anthropic'
    `,
      [ACTOR.id],
    );

    const config = await setAiDpaAcknowledgment({ acknowledged: false, custom_dpa_url: '' }, ACTOR);
    expect(config.dpa_acknowledged).toBe(false);
    expect(config.dpa_acknowledged_by).toBe('');
    expect(config.dpa_acknowledged_at).toBeNull();
    expect(config.dpa_status).toBe('not_acknowledged');
  });

  it('stores custom_dpa_url when provided', async () => {
    const customUrl = 'https://example.sharepoint.com/signed-dpa.pdf';
    const config = await setAiDpaAcknowledgment(
      { acknowledged: true, custom_dpa_url: customUrl },
      ACTOR,
    );
    expect(config.custom_dpa_url).toBe(customUrl);
  });
});
