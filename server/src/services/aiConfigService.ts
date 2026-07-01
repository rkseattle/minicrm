/**
 * AI configuration service — all reads and writes for AI provider/model settings.
 * Owns the full lifecycle: storage in ai_configuration, API key encryption,
 * DPA acknowledgment, deployment mode, and derived status indicators.
 * (MINCRM-457, MINCRM-502)
 */

import Anthropic from '@anthropic-ai/sdk';
import type { PoolClient } from 'pg';
import pool from '../db.js';
import logger from '../logger.js';
import { encryptVersioned, decryptVersioned } from './cryptoService.js';
import { writeAuditEntry } from './auditService.js';
import type { AuditActor } from './auditService.js';
import type {
  AiProvider,
  AiDeploymentMode,
  AiDpaStatus,
  AiDataPosture,
  AiConfigResponse,
  AiModelOption,
  SetAiConfigInput,
  SetAiEnabledInput,
  SetAiDpaAcknowledgmentInput,
  SetAiSessionRetentionInput,
  TestAiConnectionInput,
  TestAiConnectionResponse,
} from '@minicrm/shared/schemas/settingsSchema.js';
import { AI_PROVIDERS, AI_DEPLOYMENT_MODES } from '@minicrm/shared/schemas/settingsSchema.js';
import type { SetAiCostRatesInput } from '@minicrm/shared/schemas/aiUsageSchema.js';

// ── Row type for ai_configuration ─────────────────────────────────────────────

interface AiConfigRow {
  provider: string;
  model: string;
  api_key_encrypted: string;
  api_key_key_version: number;
  deployment_mode: string;
  base_url: string;
  enabled: boolean;
  enabled_updated_at: Date | null;
  dpa_acknowledged: boolean;
  dpa_acknowledged_by: string | null; // uuid stored as string by pg driver
  dpa_acknowledged_by_name: string | null; // resolved via LEFT JOIN on users
  dpa_acknowledged_at: Date | null;
  dpa_acknowledged_for_provider: string;
  custom_dpa_url: string;
  updated_by: string | null;
  ai_session_retention_days: number;
  ai_input_cost_per_million_cents: number;
  ai_output_cost_per_million_cents: number;
}

/** Default values applied when no row exists (should not occur post-migration). */
const DEFAULTS = {
  enabled: false,
  provider: 'anthropic' as AiProvider,
  model: 'claude-sonnet-4-20250514',
  deploymentMode: 'cloud_api' as AiDeploymentMode,
  baseUrl: '',
  dpaAcknowledged: false,
  dpaAcknowledgedAt: null as Date | null,
  dpaAcknowledgedForProvider: '',
  customDpaUrl: '',
  aiSessionRetentionDays: 90,
  aiInputCostPerMillionCents: 300,
  aiOutputCostPerMillionCents: 1500,
};

/**
 * Server-managed catalogue of available models per provider.
 * When Anthropic releases a new model, add it here and redeploy.
 * Deliberately not fetched live from the provider API to avoid latency
 * and availability coupling on the admin settings page.
 */
const AVAILABLE_MODELS: AiModelOption[] = [
  { id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8', provider: 'anthropic' },
  { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6', provider: 'anthropic' },
  {
    id: 'claude-sonnet-4-20250514',
    display_name: 'Claude Sonnet 4 (2025-05-14)',
    provider: 'anthropic',
  },
  { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', provider: 'anthropic' },
];

/** Per-provider standard DPA URL shown alongside the provider selector. */
const PROVIDER_DPA_URLS: Record<AiProvider, string> = {
  anthropic: 'https://www.anthropic.com/legal/data-processing-agreement',
};

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Fetch the singleton ai_configuration row, with the acknowledging user's name resolved. */
async function fetchAiRow(client?: PoolClient): Promise<AiConfigRow | null> {
  const q = `
    SELECT a.*, u.name AS dpa_acknowledged_by_name
    FROM ai_configuration a
    LEFT JOIN users u ON u.id = a.dpa_acknowledged_by
    LIMIT 1
  `;
  const result = client ? await client.query<AiConfigRow>(q) : await pool.query<AiConfigRow>(q);
  return result.rows[0] ?? null;
}

function parseProvider(raw: string | undefined): AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(raw ?? '')
    ? (raw as AiProvider)
    : DEFAULTS.provider;
}

function parseDeploymentMode(raw: string | undefined): AiDeploymentMode {
  return (AI_DEPLOYMENT_MODES as readonly string[]).includes(raw ?? '')
    ? (raw as AiDeploymentMode)
    : DEFAULTS.deploymentMode;
}

/**
 * Derives the DPA compliance status badge value from stored state.
 * Red wins over amber wins over green.
 */
function deriveDpaStatus(
  acknowledged: boolean,
  acknowledgedForProvider: string,
  currentProvider: AiProvider,
): AiDpaStatus {
  if (!acknowledged) return 'not_acknowledged';
  if (acknowledgedForProvider !== currentProvider) return 'provider_changed';
  return 'acknowledged';
}

/**
 * Derives the composite data-posture indicator per the AC matrix.
 * Self-Hosted is always green. Otherwise depends on DPA status.
 */
function deriveDataPosture(mode: AiDeploymentMode, dpaStatus: AiDpaStatus): AiDataPosture {
  if (mode === 'self_hosted') return 'green';
  if (dpaStatus === 'provider_changed') return 'red';
  if (dpaStatus === 'acknowledged') return 'green';
  return 'amber';
}

/** Builds the public AiConfigResponse from a raw row (or defaults when no row). */
function buildResponse(row: AiConfigRow | null): AiConfigResponse {
  const provider = parseProvider(row?.provider);
  const deploymentMode = parseDeploymentMode(row?.deployment_mode);
  const apiKeySet = (row?.api_key_encrypted ?? '').trim() !== '';

  const dpaAcknowledged = row?.dpa_acknowledged ?? DEFAULTS.dpaAcknowledged;
  const dpaAcknowledgedForProvider =
    row?.dpa_acknowledged_for_provider ?? DEFAULTS.dpaAcknowledgedForProvider;
  const dpaStatus = deriveDpaStatus(dpaAcknowledged, dpaAcknowledgedForProvider, provider);
  const dataPosture = deriveDataPosture(deploymentMode, dpaStatus);

  return {
    enabled: row?.enabled ?? DEFAULTS.enabled,
    enabled_updated_at: row?.enabled_updated_at?.toISOString() ?? null,
    provider,
    model: row?.model ?? DEFAULTS.model,
    api_key_set: apiKeySet,
    deployment_mode: deploymentMode,
    base_url: row?.base_url ?? DEFAULTS.baseUrl,
    dpa_acknowledged: dpaAcknowledged,
    dpa_acknowledged_by: row?.dpa_acknowledged_by_name ?? '',
    dpa_acknowledged_at: row?.dpa_acknowledged_at?.toISOString() ?? null,
    dpa_acknowledged_for_provider: dpaAcknowledgedForProvider,
    custom_dpa_url: row?.custom_dpa_url ?? DEFAULTS.customDpaUrl,
    dpa_status: dpaStatus,
    data_posture: dataPosture,
    available_models: AVAILABLE_MODELS.filter((m) => m.provider === provider),
    provider_dpa_url: PROVIDER_DPA_URLS[provider],
    ai_session_retention_days: row?.ai_session_retention_days ?? DEFAULTS.aiSessionRetentionDays,
    ai_input_cost_per_million_cents:
      row?.ai_input_cost_per_million_cents ?? DEFAULTS.aiInputCostPerMillionCents,
    ai_output_cost_per_million_cents:
      row?.ai_output_cost_per_million_cents ?? DEFAULTS.aiOutputCostPerMillionCents,
  };
}

// ── Public service functions ───────────────────────────────────────────────────

/**
 * Returns the full AI configuration (public shape — API key never included).
 */
export async function getAiConfig(): Promise<AiConfigResponse> {
  return buildResponse(await fetchAiRow());
}

/**
 * Returns the configured session retention window in days.
 * Called by the nightly retention job; avoids loading the full config payload.
 */
export async function getAiSessionRetentionDays(): Promise<number> {
  const result = await pool.query<{ ai_session_retention_days: number }>(
    'SELECT ai_session_retention_days FROM ai_configuration LIMIT 1',
  );
  return result.rows[0]?.ai_session_retention_days ?? DEFAULTS.aiSessionRetentionDays;
}

/**
 * Updates the AI session retention window.
 * Writes an audit entry in the same transaction as the data write.
 */
export async function setAiSessionRetention(
  params: SetAiSessionRetentionInput,
  actor: AuditActor,
): Promise<AiConfigResponse> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await fetchAiRow(client);
    const previousDays = current?.ai_session_retention_days ?? DEFAULTS.aiSessionRetentionDays;

    await client.query(
      `UPDATE ai_configuration SET
         ai_session_retention_days = $1,
         updated_at = now(),
         updated_by = $2`,
      [params.ai_session_retention_days, actor.id],
    );

    await writeAuditEntry(client, {
      recordType: 'ai_settings',
      recordName: 'AI Configuration',
      eventType: 'updated',
      fieldName: 'ai_session_retention_days',
      oldValue: String(previousDays),
      newValue: String(params.ai_session_retention_days),
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return getAiConfig();
}

/**
 * Updates the AI cost estimation rates (cents per 1,000,000 tokens, input and
 * output separately). Writes one audit entry per changed field in the same
 * transaction as the data write. (MINCRM-459)
 */
export async function setAiCostRates(
  params: SetAiCostRatesInput,
  actor: AuditActor,
): Promise<AiConfigResponse> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await fetchAiRow(client);
    const previousInputCost =
      current?.ai_input_cost_per_million_cents ?? DEFAULTS.aiInputCostPerMillionCents;
    const previousOutputCost =
      current?.ai_output_cost_per_million_cents ?? DEFAULTS.aiOutputCostPerMillionCents;

    await client.query(
      `UPDATE ai_configuration SET
         ai_input_cost_per_million_cents = $1,
         ai_output_cost_per_million_cents = $2,
         updated_at = now(),
         updated_by = $3`,
      [params.ai_input_cost_per_million_cents, params.ai_output_cost_per_million_cents, actor.id],
    );

    if (previousInputCost !== params.ai_input_cost_per_million_cents) {
      await writeAuditEntry(client, {
        recordType: 'ai_settings',
        recordName: 'AI Configuration',
        eventType: 'updated',
        fieldName: 'ai_input_cost_per_million_cents',
        oldValue: String(previousInputCost),
        newValue: String(params.ai_input_cost_per_million_cents),
        changedById: actor.id,
        changedByName: actor.name,
      });
    }

    if (previousOutputCost !== params.ai_output_cost_per_million_cents) {
      await writeAuditEntry(client, {
        recordType: 'ai_settings',
        recordName: 'AI Configuration',
        eventType: 'updated',
        fieldName: 'ai_output_cost_per_million_cents',
        oldValue: String(previousOutputCost),
        newValue: String(params.ai_output_cost_per_million_cents),
        changedById: actor.id,
        changedByName: actor.name,
      });
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return getAiConfig();
}

/**
 * Lightweight check — reads only the master toggle.
 * Used by requireAiEnabled middleware on every /api/v1/ai/* request.
 */
export async function isAiEnabled(): Promise<boolean> {
  const result = await pool.query<{ enabled: boolean }>(
    'SELECT enabled FROM ai_configuration LIMIT 1',
  );
  return result.rows[0]?.enabled ?? false;
}

/**
 * Persists provider/model/key/deployment configuration.
 * Encrypts the API key when provided. Resets DPA acknowledgment when the
 * provider changes. Writes one audit entry per changed field, all in the
 * same transaction as the data writes.
 */
export async function setAiConfig(
  params: SetAiConfigInput,
  actor: AuditActor,
): Promise<AiConfigResponse> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // Read raw row inside the transaction for accurate before-state comparisons.
    // Using fetchAiRow (raw provider string) instead of getAiConfig (parsed/normalized)
    // so provider-change detection fires on any string change, not just known providers.
    const beforeRow = await fetchAiRow(client);
    const beforeProvider = beforeRow?.provider ?? DEFAULTS.provider;
    const beforeDpaAcknowledged = beforeRow?.dpa_acknowledged ?? DEFAULTS.dpaAcknowledged;

    if (params.provider !== beforeProvider) {
      // Provider changed — DPA acknowledgment is no longer valid for the new provider.
      await client.query(
        `UPDATE ai_configuration SET
           dpa_acknowledged = false,
           dpa_acknowledged_by = NULL,
           dpa_acknowledged_at = NULL,
           dpa_acknowledged_for_provider = '',
           updated_at = now(),
           updated_by = $1`,
        [actor.id],
      );
      await writeAuditEntry(client, {
        recordType: 'ai_settings',
        recordName: 'AI Configuration',
        eventType: 'updated',
        fieldName: 'dpa_acknowledged',
        oldValue: String(beforeDpaAcknowledged),
        newValue: 'false',
        changedById: actor.id,
        changedByName: actor.name,
      });
    }

    // Build the SET clause for the main config fields.
    const versionedKey =
      params.api_key !== undefined && params.api_key !== ''
        ? encryptVersioned(params.api_key)
        : null;

    if (versionedKey !== null) {
      await client.query(
        `UPDATE ai_configuration SET
           provider = $1, model = $2, deployment_mode = $3,
           base_url = $4, custom_dpa_url = $5,
           api_key_encrypted = $6, api_key_key_version = $7,
           updated_at = now(), updated_by = $8`,
        [
          params.provider,
          params.model,
          params.deployment_mode,
          params.base_url ?? '',
          params.custom_dpa_url ?? '',
          versionedKey.ciphertext,
          versionedKey.keyVersion,
          actor.id,
        ],
      );
    } else {
      await client.query(
        `UPDATE ai_configuration SET
           provider = $1, model = $2, deployment_mode = $3,
           base_url = $4, custom_dpa_url = $5,
           updated_at = now(), updated_by = $6`,
        [
          params.provider,
          params.model,
          params.deployment_mode,
          params.base_url ?? '',
          params.custom_dpa_url ?? '',
          actor.id,
        ],
      );
    }

    const auditFields: Array<{ field: string; old: string; next: string }> = [
      { field: 'provider', old: beforeProvider, next: params.provider },
      { field: 'model', old: beforeRow?.model ?? DEFAULTS.model, next: params.model },
      {
        field: 'deployment_mode',
        old: beforeRow?.deployment_mode ?? DEFAULTS.deploymentMode,
        next: params.deployment_mode,
      },
      {
        field: 'base_url',
        old: beforeRow?.base_url ?? DEFAULTS.baseUrl,
        next: params.base_url ?? '',
      },
      {
        field: 'custom_dpa_url',
        old: beforeRow?.custom_dpa_url ?? DEFAULTS.customDpaUrl,
        next: params.custom_dpa_url ?? '',
      },
    ];

    if (versionedKey !== null) {
      // Never log API key values — record that a change occurred only.
      // Use distinct sentinel strings so the oldVal !== newVal guard fires.
      auditFields.push({ field: 'api_key', old: '[previous]', next: '[redacted]' });
    }

    for (const { field, old: oldVal, next: newVal } of auditFields) {
      if (oldVal !== newVal) {
        await writeAuditEntry(client, {
          recordType: 'ai_settings',
          recordName: 'AI Configuration',
          eventType: 'updated',
          fieldName: field,
          // API key values are never logged — only the fact that the key changed.
          oldValue: field === 'api_key' ? null : oldVal,
          newValue: field === 'api_key' ? null : newVal,
          changedById: actor.id,
          changedByName: actor.name,
        });
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return getAiConfig();
}

/**
 * Toggles the master AI enable/disable switch.
 * Writes an audit entry in the same transaction as the toggle write.
 */
export async function setAiEnabled(
  params: SetAiEnabledInput,
  actor: AuditActor,
): Promise<AiConfigResponse> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await fetchAiRow(client);
    const previousEnabled = current?.enabled ?? false;

    await client.query(
      `UPDATE ai_configuration SET
         enabled = $1,
         enabled_updated_at = now(),
         updated_at = now(),
         updated_by = $2`,
      [params.enabled, actor.id],
    );

    // Keep the ai_nli_page feature flag in sync with the master toggle so the
    // nav link appears/disappears immediately when AI is enabled/disabled.
    // role_overrides is cleared here too: the baseline seed (migration 000) set
    // role_overrides to {"admin":true,"rep":true} for this flag, and
    // isFlagEnabledForRole() checks role_overrides BEFORE the enabled column
    // (see featureFlagService.ts), so leaving a stale override in place meant
    // this UPDATE never actually took effect for any role — admins and reps
    // kept seeing the AI Assistant nav link even after disabling AI here.
    await client.query(
      `UPDATE feature_flags SET enabled = $1, role_overrides = NULL WHERE flag_key = 'ai_nli_page'`,
      [params.enabled],
    );

    await writeAuditEntry(client, {
      recordType: 'ai_settings',
      recordName: 'AI Configuration',
      eventType: 'updated',
      fieldName: 'enabled',
      oldValue: String(previousEnabled),
      newValue: String(params.enabled),
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return getAiConfig();
}

/**
 * Records or resets the DPA acknowledgment for the current provider.
 * When acknowledged=true, stores the actor's UUID, timestamp, and current provider.
 * When acknowledged=false, clears all acknowledgment state.
 * All writes and the audit entry are committed in the same transaction.
 */
export async function setAiDpaAcknowledgment(
  params: SetAiDpaAcknowledgmentInput,
  actor: AuditActor,
): Promise<AiConfigResponse> {
  const before = await getAiConfig();

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const customDpaUrl = params.custom_dpa_url ?? null;

    if (params.acknowledged) {
      await client.query(
        `UPDATE ai_configuration SET
           dpa_acknowledged = true,
           dpa_acknowledged_by = $1,
           dpa_acknowledged_at = now(),
           dpa_acknowledged_for_provider = provider,
           custom_dpa_url = COALESCE($2, custom_dpa_url),
           updated_at = now(),
           updated_by = $1`,
        [actor.id, customDpaUrl],
      );
    } else {
      await client.query(
        `UPDATE ai_configuration SET
           dpa_acknowledged = false,
           dpa_acknowledged_by = NULL,
           dpa_acknowledged_at = NULL,
           dpa_acknowledged_for_provider = '',
           custom_dpa_url = COALESCE($2, custom_dpa_url),
           updated_at = now(),
           updated_by = $1`,
        [actor.id, customDpaUrl],
      );
    }

    await writeAuditEntry(client, {
      recordType: 'ai_settings',
      recordName: 'AI Configuration',
      eventType: 'updated',
      fieldName: 'dpa_acknowledged',
      oldValue: String(before.dpa_acknowledged),
      newValue: String(params.acknowledged),
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return getAiConfig();
}

/**
 * Validates the provided API key and model against the provider's API.
 * Uses the supplied api_key if provided, otherwise falls back to the stored
 * encrypted key. Returns a structured result rather than throwing.
 */
export async function testAiConnection(
  params: TestAiConnectionInput,
): Promise<TestAiConnectionResponse> {
  let apiKey: string;

  if (params.api_key && params.api_key.trim() !== '') {
    apiKey = params.api_key;
  } else {
    const result = await pool.query<{
      api_key_encrypted: string;
      api_key_key_version: number;
    }>('SELECT api_key_encrypted, api_key_key_version FROM ai_configuration LIMIT 1');
    const stored = result.rows[0]?.api_key_encrypted ?? '';
    if (stored.trim() === '') {
      return { ok: false, message: 'No API key configured. Enter an API key to test.' };
    }
    try {
      apiKey = decryptVersioned(stored, result.rows[0].api_key_key_version ?? 1);
    } catch {
      return { ok: false, message: 'Stored API key is corrupted. Please re-enter it.' };
    }
  }

  if (params.provider === 'anthropic') {
    return testAnthropicConnection(apiKey, params.model, params.base_url ?? '');
  }

  // Unreachable with the current AI_PROVIDERS tuple, but guards future additions.
  return { ok: false, message: `Unknown provider: ${params.provider}` };
}

async function testAnthropicConnection(
  apiKey: string,
  model: string,
  baseUrl: string,
): Promise<TestAiConnectionResponse> {
  try {
    const clientOptions: ConstructorParameters<typeof Anthropic>[0] = { apiKey };
    if (baseUrl && baseUrl.trim() !== '') {
      clientOptions.baseURL = baseUrl;
    }
    const client = new Anthropic(clientOptions);
    await client.messages.create({
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
    return { ok: true, message: 'Connection successful' };
  } catch (err: unknown) {
    logger.info({ err }, 'AI connection test failed');
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, message: 'Authentication failed — check your API key' };
    }
    if (err instanceof Anthropic.NotFoundError) {
      return { ok: false, message: `Model not found: ${model}` };
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return { ok: false, message: 'Could not reach the API endpoint — check the base URL' };
    }
    if (err instanceof Anthropic.APIError) {
      return { ok: false, message: `API error ${err.status}: ${err.message}` };
    }
    return { ok: false, message: 'Connection test failed — see server logs for details' };
  }
}
