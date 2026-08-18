/**
 * AiGeneralSection — deployment status header, provider/model configuration,
 * connection test, and Data Processing Agreement acknowledgment.
 * One of the sub-sections behind the AI panel's sub-navigation.
 * Extracted from AiSettings.tsx without behavior changes.
 */

import { useState, useEffect, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  setAiConfig,
  setAiDpaAcknowledgment,
  testAiConnection,
  AI_CONFIG_QUERY_KEY,
} from '@/api/ai.js';
import type {
  AiConfigResponse,
  AiDeploymentMode,
  AiProvider,
  AiDpaStatus,
  AiDataPosture,
} from '@shared/schemas/settingsSchema.js';
import { AI_PROVIDERS, AI_DEPLOYMENT_MODES } from '@shared/schemas/settingsSchema.js';
import { Button } from '@/components/ui/Button.js';

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function DataPostureBadge({ posture }: { posture: AiDataPosture }) {
  const { t } = useTranslation();
  const colorMap = {
    green: 'bg-green-100 text-green-800 border-green-200',
    amber: 'bg-amber-100 text-amber-800 border-amber-200',
    red: 'bg-red-100 text-red-800 border-red-200',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${colorMap[posture]}`}
      data-testid="ai-data-posture-badge"
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${posture === 'green' ? 'bg-green-500' : posture === 'amber' ? 'bg-amber-500' : 'bg-red-500'}`}
      />
      {t(`aiSettings.dataPosture.${posture}`)}
    </span>
  );
}

function DpaStatusBadge({ status }: { status: AiDpaStatus }) {
  const { t } = useTranslation();
  const colorMap = {
    acknowledged: 'bg-green-100 text-green-800 border-green-200',
    not_acknowledged: 'bg-amber-100 text-amber-800 border-amber-200',
    provider_changed: 'bg-red-100 text-red-800 border-red-200',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${colorMap[status]}`}
      data-testid="ai-dpa-status-badge"
    >
      {t(`aiSettings.dpa.status.${status}`)}
    </span>
  );
}

export function AiGeneralSection({ data }: { data: AiConfigResponse }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // ── Provider & model form state ───────────────────────────────────────────
  const [provider, setProvider] = useState<AiProvider>('anthropic');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyEditing, setApiKeyEditing] = useState(false);
  const [deploymentMode, setDeploymentMode] = useState<AiDeploymentMode>('cloud_api');
  const [baseUrl, setBaseUrl] = useState('');
  const [customDpaUrl, setCustomDpaUrl] = useState('');

  // ── Connection test state ─────────────────────────────────────────────────
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [testMessage, setTestMessage] = useState('');

  // ── Save feedback ─────────────────────────────────────────────────────────
  const [configSaveSuccess, setConfigSaveSuccess] = useState(false);
  const [configSaveError, setConfigSaveError] = useState('');
  const [dpaSaveSuccess, setDpaSaveSuccess] = useState(false);
  const [dpaSaveError, setDpaSaveError] = useState('');

  // Populate form from loaded data.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProvider(data.provider);
    setModel(data.model);
    setDeploymentMode(data.deployment_mode);
    setBaseUrl(data.base_url);
    setCustomDpaUrl(data.custom_dpa_url);
    setApiKey('');
    setApiKeyEditing(false);
  }, [data]);

  // Reset model to first available when provider changes.
  const handleProviderChange = useCallback(
    (next: AiProvider) => {
      setProvider(next);
      const firstModel = data.available_models.find((m) => m.provider === next);
      if (firstModel) setModel(firstModel.id);
    },
    [data],
  );

  const configMutation = useMutation({
    mutationFn: setAiConfig,
    onSuccess: (freshData) => {
      queryClient.setQueryData(AI_CONFIG_QUERY_KEY, freshData);
      void queryClient.invalidateQueries({ queryKey: AI_CONFIG_QUERY_KEY });
      setConfigSaveSuccess(true);
      setConfigSaveError('');
      setApiKey('');
      setApiKeyEditing(false);
    },
    onError: (err: Error) => {
      setConfigSaveError(err.message || t('aiSettings.provider.saveError'));
      setConfigSaveSuccess(false);
    },
  });

  const dpaMutation = useMutation({
    mutationFn: setAiDpaAcknowledgment,
    onSuccess: (freshData) => {
      // Write the server's response directly into the cache so the checkbox
      // disappears immediately — invalidateQueries alone causes a brief
      // stale-data re-render where dpa_acknowledged is still false, which
      // makes the checkbox reappear before the refetch completes.
      queryClient.setQueryData(AI_CONFIG_QUERY_KEY, freshData);
      void queryClient.invalidateQueries({ queryKey: AI_CONFIG_QUERY_KEY });
      setDpaSaveSuccess(true);
      setDpaSaveError('');
    },
    onError: (err: Error) => {
      setDpaSaveError(err.message || t('aiSettings.dpa.saveError'));
      setDpaSaveSuccess(false);
    },
  });

  function handleConfigSubmit(e: React.FormEvent) {
    e.preventDefault();
    setConfigSaveSuccess(false);
    setConfigSaveError('');
    configMutation.mutate({
      provider,
      model,
      deployment_mode: deploymentMode,
      base_url: baseUrl,
      custom_dpa_url: customDpaUrl,
      ...(apiKey ? { api_key: apiKey } : {}),
    });
  }

  async function handleTestConnection() {
    setTestStatus('testing');
    setTestMessage('');
    try {
      const result = await testAiConnection({
        provider,
        model,
        deployment_mode: deploymentMode,
        base_url: baseUrl,
        ...(apiKey ? { api_key: apiKey } : {}),
      });
      setTestStatus(result.ok ? 'ok' : 'fail');
      setTestMessage(result.message);
    } catch {
      setTestStatus('fail');
      setTestMessage(t('aiSettings.provider.testConnectionError'));
    }
  }

  function handleDpaAcknowledge() {
    setDpaSaveSuccess(false);
    setDpaSaveError('');
    dpaMutation.mutate({ acknowledged: true, custom_dpa_url: customDpaUrl });
  }

  const requiresBaseUrl = deploymentMode === 'private_endpoint' || deploymentMode === 'self_hosted';
  const availableModels = data.available_models.filter((m) => m.provider === provider);

  return (
    <div className="space-y-8">
      {/* ── Header status bar ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 pb-4 border-b border-gray-200">
        <span className="text-sm font-medium text-gray-700">
          {t('aiSettings.header.deploymentMode')}:{' '}
          <span className="font-semibold" data-testid="ai-deployment-mode-badge">
            {t(`aiSettings.deploymentMode.${deploymentMode}.label`)}
          </span>
        </span>
        <DpaStatusBadge status={data.dpa_status} />
        <DataPostureBadge posture={data.data_posture} />
      </div>

      {/* DPA unacknowledged warning banner */}
      {data.dpa_status !== 'acknowledged' && data.deployment_mode !== 'self_hosted' && (
        <div
          className="flex items-start gap-3 px-4 py-3 rounded-md border border-amber-200 bg-amber-50 text-sm text-amber-800"
          role="alert"
          data-testid="ai-dpa-warning-banner"
        >
          <svg
            className="shrink-0 mt-0.5 h-4 w-4"
            fill="currentColor"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd"
            />
          </svg>
          <span>{t('aiSettings.dpa.warningBanner')}</span>
        </div>
      )}

      {/* ── Provider & Model ────────────────────────────────────────────────── */}
      <section aria-labelledby="ai-provider-heading">
        <h2 id="ai-provider-heading" className="text-base font-semibold text-gray-900 mb-1">
          {t('aiSettings.provider.heading')}
        </h2>
        <p className="text-sm text-gray-500 mb-4">{t('aiSettings.provider.description')}</p>

        <form onSubmit={handleConfigSubmit} className="space-y-5">
          {/* Provider */}
          <div>
            <label
              htmlFor="ai-provider-select"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              {t('aiSettings.provider.providerLabel')}
            </label>
            <select
              id="ai-provider-select"
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value as AiProvider)}
              className="block w-full max-w-xs rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              data-testid="ai-provider-select"
            >
              {AI_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {t(`aiSettings.provider.providers.${p}`)}
                </option>
              ))}
            </select>
          </div>

          {/* Model */}
          <div>
            <label
              htmlFor="ai-model-select"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              {t('aiSettings.provider.modelLabel')}
            </label>
            <select
              id="ai-model-select"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="block w-full max-w-xs rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              data-testid="ai-model-select"
            >
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          </div>

          {/* Deployment mode */}
          <fieldset>
            <legend className="block text-sm font-medium text-gray-700 mb-2">
              {t('aiSettings.deploymentMode.label')}
            </legend>
            <div className="space-y-3">
              {AI_DEPLOYMENT_MODES.map((mode) => (
                <label
                  key={mode}
                  htmlFor={`ai-deployment-mode-radio-${mode}`}
                  aria-label={t(`aiSettings.deploymentMode.${mode}.label`)}
                  className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${deploymentMode === mode ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}`}
                  data-testid={`ai-deployment-mode-${mode}`}
                >
                  <input
                    id={`ai-deployment-mode-radio-${mode}`}
                    type="radio"
                    name="deployment_mode"
                    value={mode}
                    checked={deploymentMode === mode}
                    onChange={() => setDeploymentMode(mode)}
                    className="mt-0.5 h-4 w-4 text-indigo-600 border-gray-300 focus:ring-indigo-500"
                    data-testid={`ai-deployment-mode-radio-${mode}`}
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {t(`aiSettings.deploymentMode.${mode}.label`)}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {t(`aiSettings.deploymentMode.${mode}.description`)}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </fieldset>

          {/* Base URL (required for private_endpoint / self_hosted) */}
          {requiresBaseUrl && (
            <div>
              <label htmlFor="ai-base-url" className="block text-sm font-medium text-gray-700 mb-1">
                {t('aiSettings.provider.baseUrlLabel')} <span className="text-red-500">*</span>
              </label>
              <input
                id="ai-base-url"
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://your-endpoint.example.com"
                required={requiresBaseUrl}
                className="block w-full max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                data-testid="ai-base-url-input"
              />
            </div>
          )}

          {/* API key */}
          <div>
            <label htmlFor="ai-api-key" className="block text-sm font-medium text-gray-700 mb-1">
              {t('aiSettings.provider.apiKeyLabel')}
            </label>
            {!apiKeyEditing && data.api_key_set ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500 font-mono" data-testid="ai-api-key-masked">
                  {t('aiSettings.provider.apiKeyMasked')}
                </span>
                <span className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-0.5">
                  {t('aiSettings.provider.apiKeySet')}
                </span>
                <button
                  type="button"
                  className="text-xs text-indigo-600 hover:text-indigo-800 underline"
                  onClick={() => setApiKeyEditing(true)}
                  data-testid="ai-api-key-change-button"
                >
                  {t('aiSettings.provider.changeApiKey')}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <input
                  id="ai-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="new-password"
                  placeholder={
                    data.api_key_set
                      ? t('aiSettings.provider.apiKeyPlaceholderChange')
                      : t('aiSettings.provider.apiKeyPlaceholder')
                  }
                  className="block w-full max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm font-mono shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  data-testid="ai-api-key-input"
                />
                {apiKeyEditing && data.api_key_set && (
                  <button
                    type="button"
                    className="text-xs text-gray-500 hover:text-gray-700"
                    onClick={() => {
                      setApiKeyEditing(false);
                      setApiKey('');
                    }}
                    data-testid="ai-api-key-cancel-button"
                  >
                    {t('common.cancel')}
                  </button>
                )}
              </div>
            )}
            <p className="mt-1 text-xs text-gray-400">{t('aiSettings.provider.apiKeyHint')}</p>
          </div>

          {/* Test connection */}
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => void handleTestConnection()}
              disabled={testStatus === 'testing'}
              className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              data-testid="ai-test-connection-button"
            >
              {testStatus === 'testing'
                ? t('aiSettings.provider.testingConnection')
                : t('aiSettings.provider.testConnection')}
            </button>
            {testStatus !== 'idle' && testStatus !== 'testing' && (
              <span
                className={`text-sm ${testStatus === 'ok' ? 'text-green-700' : 'text-red-600'}`}
                data-testid="ai-test-connection-result"
                role="status"
                aria-live="polite"
              >
                {testMessage}
              </span>
            )}
          </div>

          {/* Save */}
          <div className="flex items-center gap-4 pt-2">
            <Button
              type="submit"
              disabled={configMutation.isPending}
              data-testid="ai-config-save-button"
            >
              {configMutation.isPending ? t('common.saving') : t('common.save')}
            </Button>
            {configSaveSuccess && (
              <span className="text-sm text-green-700" data-testid="ai-config-save-success">
                {t('aiSettings.provider.saveSuccess')}
              </span>
            )}
            {configSaveError && (
              <span className="text-sm text-red-600" data-testid="ai-config-save-error">
                {configSaveError}
              </span>
            )}
          </div>
        </form>
      </section>

      {/* ── Data Processing Agreement ──────────────────────────────────────── */}
      <section aria-labelledby="ai-dpa-heading">
        <h2 id="ai-dpa-heading" className="text-base font-semibold text-gray-900 mb-1">
          {t('aiSettings.dpa.heading')}
        </h2>
        <p className="text-sm text-gray-500 mb-4">{t('aiSettings.dpa.description')}</p>

        <div className="space-y-4">
          {/* Provider DPA link */}
          <div>
            <p className="text-sm text-gray-700">
              {t('aiSettings.dpa.providerDpaLabel', {
                provider: t(`aiSettings.provider.providers.${data.provider}`),
              })}
              {': '}
              <a
                href={data.provider_dpa_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 hover:text-indigo-800 underline"
                data-testid="ai-provider-dpa-link"
              >
                {data.provider_dpa_url}
              </a>
            </p>
          </div>

          {/* Custom DPA URL */}
          <div>
            <label
              htmlFor="ai-custom-dpa-url"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              {t('aiSettings.dpa.customDpaUrlLabel')}
            </label>
            <input
              id="ai-custom-dpa-url"
              type="url"
              value={customDpaUrl}
              onChange={(e) => setCustomDpaUrl(e.target.value)}
              placeholder="https://your-sharepoint.example.com/signed-dpa.pdf"
              className="block w-full max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              data-testid="ai-custom-dpa-url-input"
            />
            <p className="mt-1 text-xs text-gray-400">{t('aiSettings.dpa.customDpaUrlHint')}</p>
          </div>

          {/* Current acknowledgment state */}
          <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
            {data.dpa_acknowledged ? (
              <p className="text-sm text-gray-700" data-testid="ai-dpa-acknowledged-state">
                {t('aiSettings.dpa.acknowledgedBy', {
                  name: data.dpa_acknowledged_by,
                  date: formatTimestamp(data.dpa_acknowledged_at),
                })}
              </p>
            ) : (
              <p className="text-sm text-gray-500" data-testid="ai-dpa-not-acknowledged-state">
                {t('aiSettings.dpa.notAcknowledged')}
              </p>
            )}
          </div>

          {/* Acknowledgment checkbox + button — hidden once acknowledged */}
          {!data.dpa_acknowledged && data.deployment_mode !== 'self_hosted' && (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <input
                  id="ai-dpa-checkbox"
                  type="checkbox"
                  checked={false}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  onChange={() => {
                    handleDpaAcknowledge();
                  }}
                  data-testid="ai-dpa-checkbox"
                />
                <label htmlFor="ai-dpa-checkbox" className="text-sm text-gray-700">
                  {t('aiSettings.dpa.checkboxLabel')}
                </label>
              </div>
              {dpaSaveSuccess && (
                <p className="text-sm text-green-700" data-testid="ai-dpa-save-success">
                  {t('aiSettings.dpa.saveSuccess')}
                </p>
              )}
              {dpaSaveError && (
                <p className="text-sm text-red-600" data-testid="ai-dpa-save-error">
                  {dpaSaveError}
                </p>
              )}
            </div>
          )}

          {data.deployment_mode === 'self_hosted' && (
            <p
              className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2"
              data-testid="ai-dpa-self-hosted-notice"
            >
              {t('aiSettings.dpa.selfHostedNotice')}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
