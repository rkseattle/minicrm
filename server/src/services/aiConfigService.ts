/**
 * AI configuration service — all reads and writes for AI provider/model settings.
 * Owns the full lifecycle: storage in system_settings, API key encryption,
 * DPA acknowledgment, deployment mode, and derived status indicators.
 * (MINCRM-457)
 */

import Anthropic from '@anthropic-ai/sdk';
import pool from '../db.js';
import logger from '../logger.js';
import { encrypt, decrypt } from './cryptoService.js';
import { writeAuditEntryBestEffort } from './auditService.js';
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
  TestAiConnectionInput,
  TestAiConnectionResponse,
} from '@minicrm/shared/schemas/settingsSchema.js';
import { AI_PROVIDERS, AI_DEPLOYMENT_MODES } from '@minicrm/shared/schemas/settingsSchema.js';

// ── System settings key constants ─────────────────────────────────────────────

const KEY_AI_ENABLED = 'ai_enabled';
const KEY_AI_ENABLED_UPDATED_AT = 'ai_enabled_updated_at';
const KEY_AI_PROVIDER = 'ai_provider';
const KEY_AI_MODEL = 'ai_model';
const KEY_AI_API_KEY = 'ai_api_key';
const KEY_AI_DEPLOYMENT_MODE = 'ai_deployment_mode';
const KEY_AI_BASE_URL = 'ai_base_url';
const KEY_AI_DPA_ACKNOWLEDGED = 'ai_dpa_acknowledged';
const KEY_AI_DPA_ACKNOWLEDGED_BY = 'ai_dpa_acknowledged_by';
const KEY_AI_DPA_ACKNOWLEDGED_AT = 'ai_dpa_acknowledged_at';
const KEY_AI_DPA_ACKNOWLEDGED_FOR_PROVIDER = 'ai_dpa_acknowledged_for_provider';
const KEY_AI_CUSTOM_DPA_URL = 'ai_custom_dpa_url';

/** Default values matching the seeds in migration 069. */
const DEFAULTS = {
  enabled: false,
  provider: 'anthropic' as AiProvider,
  model: 'claude-sonnet-4-20250514',
  deploymentMode: 'cloud_api' as AiDeploymentMode,
  baseUrl: '',
  dpaAcknowledged: false,
  dpaAcknowledgedBy: '',
  dpaAcknowledgedAt: null as string | null,
  dpaAcknowledgedForProvider: '',
  customDpaUrl: '',
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
  {
    id: 'claude-haiku-4-5-20251001',
    display_name: 'Claude Haiku 4.5 (2025-10-01)',
    provider: 'anthropic',
  },
];

/** Per-provider standard DPA URL shown alongside the provider selector. */
const PROVIDER_DPA_URLS: Record<AiProvider, string> = {
  anthropic: 'https://www.anthropic.com/legal/data-processing-agreement',
};

// ── Internal helpers ──────────────────────────────────────────────────────────

interface SystemSettingRow {
  key: string;
  value: string;
}

/** Fetch all AI-related system_settings rows in one query. */
async function fetchAiRows(): Promise<Map<string, string>> {
  const keys = [
    KEY_AI_ENABLED,
    KEY_AI_ENABLED_UPDATED_AT,
    KEY_AI_PROVIDER,
    KEY_AI_MODEL,
    KEY_AI_API_KEY,
    KEY_AI_DEPLOYMENT_MODE,
    KEY_AI_BASE_URL,
    KEY_AI_DPA_ACKNOWLEDGED,
    KEY_AI_DPA_ACKNOWLEDGED_BY,
    KEY_AI_DPA_ACKNOWLEDGED_AT,
    KEY_AI_DPA_ACKNOWLEDGED_FOR_PROVIDER,
    KEY_AI_CUSTOM_DPA_URL,
  ];
  const result = await pool.query<SystemSettingRow>(
    'SELECT key, value FROM system_settings WHERE key = ANY($1)',
    [keys],
  );
  return new Map(result.rows.map((r) => [r.key, r.value]));
}

/** Upsert a single system_settings key. */
async function upsertSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value],
  );
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
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

// ── Public service functions ───────────────────────────────────────────────────

/**
 * Returns the full AI configuration (public shape — API key never included).
 */
export async function getAiConfig(): Promise<AiConfigResponse> {
  const rows = await fetchAiRows();

  const provider = parseProvider(rows.get(KEY_AI_PROVIDER));
  const deploymentMode = parseDeploymentMode(rows.get(KEY_AI_DEPLOYMENT_MODE));
  const rawApiKey = rows.get(KEY_AI_API_KEY) ?? '';
  const apiKeySet = rawApiKey.trim() !== '';

  const dpaAcknowledged = parseBool(rows.get(KEY_AI_DPA_ACKNOWLEDGED), false);
  const dpaAcknowledgedForProvider = rows.get(KEY_AI_DPA_ACKNOWLEDGED_FOR_PROVIDER) ?? '';
  const dpaStatus = deriveDpaStatus(dpaAcknowledged, dpaAcknowledgedForProvider, provider);
  const dataPosture = deriveDataPosture(deploymentMode, dpaStatus);

  return {
    enabled: parseBool(rows.get(KEY_AI_ENABLED), false),
    enabled_updated_at: rows.get(KEY_AI_ENABLED_UPDATED_AT) || null,
    provider,
    model: rows.get(KEY_AI_MODEL) ?? DEFAULTS.model,
    api_key_set: apiKeySet,
    deployment_mode: deploymentMode,
    base_url: rows.get(KEY_AI_BASE_URL) ?? '',
    dpa_acknowledged: dpaAcknowledged,
    dpa_acknowledged_by: rows.get(KEY_AI_DPA_ACKNOWLEDGED_BY) ?? '',
    dpa_acknowledged_at: rows.get(KEY_AI_DPA_ACKNOWLEDGED_AT) || null,
    dpa_acknowledged_for_provider: dpaAcknowledgedForProvider,
    custom_dpa_url: rows.get(KEY_AI_CUSTOM_DPA_URL) ?? '',
    dpa_status: dpaStatus,
    data_posture: dataPosture,
    available_models: AVAILABLE_MODELS.filter((m) => m.provider === provider),
    provider_dpa_url: PROVIDER_DPA_URLS[provider],
  };
}

/**
 * Lightweight check — reads only the master toggle.
 * Used by requireAiEnabled middleware on every /api/v1/ai/* request.
 */
export async function isAiEnabled(): Promise<boolean> {
  const result = await pool.query<SystemSettingRow>(
    'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
    [KEY_AI_ENABLED],
  );
  return parseBool(result.rows[0]?.value, false);
}

/**
 * Persists provider/model/key/deployment configuration.
 * Encrypts the API key when provided. Resets DPA acknowledgment when the
 * provider changes. Writes one audit entry per changed field.
 */
export async function setAiConfig(
  params: SetAiConfigInput,
  actor: AuditActor,
): Promise<AiConfigResponse> {
  const before = await getAiConfig();

  if (params.provider !== before.provider) {
    // Provider changed — DPA acknowledgment is no longer valid.
    await upsertSetting(KEY_AI_DPA_ACKNOWLEDGED, 'false');
    await upsertSetting(KEY_AI_DPA_ACKNOWLEDGED_BY, '');
    await upsertSetting(KEY_AI_DPA_ACKNOWLEDGED_AT, '');
    await upsertSetting(KEY_AI_DPA_ACKNOWLEDGED_FOR_PROVIDER, '');
    void writeAuditEntryBestEffort({
      recordType: 'ai_settings',
      recordName: 'AI Configuration',
      eventType: 'updated',
      fieldName: 'dpa_acknowledged',
      oldValue: String(before.dpa_acknowledged),
      newValue: 'false',
      changedById: actor.id,
      changedByName: actor.name,
    }).catch((err) => logger.warn({ err }, 'Failed to write AI DPA reset audit entry'));
  }

  await upsertSetting(KEY_AI_PROVIDER, params.provider);
  await upsertSetting(KEY_AI_MODEL, params.model);
  await upsertSetting(KEY_AI_DEPLOYMENT_MODE, params.deployment_mode);
  await upsertSetting(KEY_AI_BASE_URL, params.base_url ?? '');
  await upsertSetting(KEY_AI_CUSTOM_DPA_URL, params.custom_dpa_url ?? '');

  if (params.api_key !== undefined && params.api_key !== '') {
    const encrypted = encrypt(params.api_key);
    await upsertSetting(KEY_AI_API_KEY, encrypted);
  }

  const auditFields: Array<{ field: string; old: string; next: string }> = [
    { field: 'provider', old: before.provider, next: params.provider },
    { field: 'model', old: before.model, next: params.model },
    { field: 'deployment_mode', old: before.deployment_mode, next: params.deployment_mode },
    { field: 'base_url', old: before.base_url, next: params.base_url ?? '' },
    { field: 'custom_dpa_url', old: before.custom_dpa_url, next: params.custom_dpa_url ?? '' },
  ];

  if (params.api_key !== undefined && params.api_key !== '') {
    // Never log API key values — record that a change occurred only.
    auditFields.push({ field: 'api_key', old: '[redacted]', next: '[redacted]' });
  }

  for (const { field, old: oldVal, next: newVal } of auditFields) {
    if (oldVal !== newVal) {
      void writeAuditEntryBestEffort({
        recordType: 'ai_settings',
        recordName: 'AI Configuration',
        eventType: 'updated',
        fieldName: field,
        oldValue: field === 'api_key' ? null : oldVal,
        newValue: field === 'api_key' ? null : newVal,
        changedById: actor.id,
        changedByName: actor.name,
      }).catch((err) => logger.warn({ err }, 'Failed to write AI config audit entry'));
    }
  }

  return getAiConfig();
}

/**
 * Toggles the master AI enable/disable switch.
 * Writes an audit entry and records the timestamp.
 */
export async function setAiEnabled(
  params: SetAiEnabledInput,
  actor: AuditActor,
): Promise<AiConfigResponse> {
  const rows = await pool.query<SystemSettingRow>(
    'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
    [KEY_AI_ENABLED],
  );
  const previousEnabled = parseBool(rows.rows[0]?.value, false);

  await upsertSetting(KEY_AI_ENABLED, String(params.enabled));
  await upsertSetting(KEY_AI_ENABLED_UPDATED_AT, new Date().toISOString());

  void writeAuditEntryBestEffort({
    recordType: 'ai_settings',
    recordName: 'AI Configuration',
    eventType: 'updated',
    fieldName: 'enabled',
    oldValue: String(previousEnabled),
    newValue: String(params.enabled),
    changedById: actor.id,
    changedByName: actor.name,
  }).catch((err) => logger.warn({ err }, 'Failed to write AI enabled audit entry'));

  return getAiConfig();
}

/**
 * Records or resets the DPA acknowledgment for the current provider.
 * When acknowledged=true, stores the actor's name, timestamp, and current provider.
 * When acknowledged=false, clears all acknowledgment state.
 */
export async function setAiDpaAcknowledgment(
  params: SetAiDpaAcknowledgmentInput,
  actor: AuditActor,
): Promise<AiConfigResponse> {
  const before = await getAiConfig();

  if (params.acknowledged) {
    const now = new Date().toISOString();
    await upsertSetting(KEY_AI_DPA_ACKNOWLEDGED, 'true');
    await upsertSetting(KEY_AI_DPA_ACKNOWLEDGED_BY, actor.name);
    await upsertSetting(KEY_AI_DPA_ACKNOWLEDGED_AT, now);
    await upsertSetting(KEY_AI_DPA_ACKNOWLEDGED_FOR_PROVIDER, before.provider);
  } else {
    await upsertSetting(KEY_AI_DPA_ACKNOWLEDGED, 'false');
    await upsertSetting(KEY_AI_DPA_ACKNOWLEDGED_BY, '');
    await upsertSetting(KEY_AI_DPA_ACKNOWLEDGED_AT, '');
    await upsertSetting(KEY_AI_DPA_ACKNOWLEDGED_FOR_PROVIDER, '');
  }

  if (params.custom_dpa_url !== undefined) {
    await upsertSetting(KEY_AI_CUSTOM_DPA_URL, params.custom_dpa_url);
  }

  void writeAuditEntryBestEffort({
    recordType: 'ai_settings',
    recordName: 'AI Configuration',
    eventType: 'updated',
    fieldName: 'dpa_acknowledged',
    oldValue: String(before.dpa_acknowledged),
    newValue: String(params.acknowledged),
    changedById: actor.id,
    changedByName: actor.name,
  }).catch((err) => logger.warn({ err }, 'Failed to write DPA acknowledgment audit entry'));

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
    const result = await pool.query<SystemSettingRow>(
      'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
      [KEY_AI_API_KEY],
    );
    const stored = result.rows[0]?.value ?? '';
    if (stored.trim() === '') {
      return { ok: false, message: 'No API key configured. Enter an API key to test.' };
    }
    try {
      apiKey = decrypt(stored);
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
