/**
 * AiSettings — AI provider, model, deployment mode, DPA configuration, and token budgets.
 * Hosted as the 'ai' tab in AdminSettingsPage.
 * (MINCRM-457, MINCRM-458)
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getAiConfig,
  setAiConfig,
  setAiEnabled,
  setAiDpaAcknowledgment,
  setAiSessionRetention,
  testAiConnection,
  AI_CONFIG_QUERY_KEY,
  getAiTokenBudgets,
  setOrgTokenBudget,
  setUserTokenBudget,
  AI_TOKEN_BUDGETS_QUERY_KEY,
} from '@/api/ai.js';
import type {
  AiDeploymentMode,
  AiProvider,
  AiTokenUsageRow,
  AiTokenBudgetStatus,
} from '@shared/schemas/settingsSchema.js';
import { AI_PROVIDERS, AI_DEPLOYMENT_MODES } from '@shared/schemas/settingsSchema.js';
import { Button } from '@/components/ui/Button.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function DataPostureBadge({ posture }: { posture: 'green' | 'amber' | 'red' }) {
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

function DpaStatusBadge({
  status,
}: {
  status: 'acknowledged' | 'not_acknowledged' | 'provider_changed';
}) {
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

// ── Toggle confirmation dialog ─────────────────────────────────────────────────

interface ToggleConfirmDialogProps {
  enabling: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}

function ToggleConfirmDialog({
  enabling,
  onConfirm,
  onCancel,
  isPending,
}: ToggleConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-toggle-confirm-title"
      data-testid="ai-toggle-confirm-dialog"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <h2 id="ai-toggle-confirm-title" className="text-lg font-semibold text-gray-900 mb-3">
          {enabling
            ? t('aiSettings.toggle.confirmEnableTitle')
            : t('aiSettings.toggle.confirmDisableTitle')}
        </h2>
        <p className="text-sm text-gray-600 mb-6">
          {enabling
            ? t('aiSettings.toggle.confirmEnableBody')
            : t('aiSettings.toggle.confirmDisableBody')}
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            onClick={onCancel}
            disabled={isPending}
            data-testid="ai-toggle-cancel-button"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={`px-4 py-2 text-sm font-medium text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 ${enabling ? 'bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500' : 'bg-red-600 hover:bg-red-700 focus:ring-red-500'}`}
            onClick={onConfirm}
            disabled={isPending}
            data-testid="ai-toggle-confirm-button"
          >
            {isPending ? t('common.saving') : t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Token budget status badge ──────────────────────────────────────────────────

function BudgetStatusBadge({ status }: { status: AiTokenBudgetStatus }) {
  const { t } = useTranslation();
  const colorMap: Record<AiTokenBudgetStatus, string> = {
    ok: 'bg-green-100 text-green-800 border-green-200',
    warning: 'bg-amber-100 text-amber-800 border-amber-200',
    exceeded: 'bg-red-100 text-red-800 border-red-200',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${colorMap[status]}`}
    >
      {t(`aiSettings.tokenBudgets.status${status.charAt(0).toUpperCase()}${status.slice(1)}`)}
    </span>
  );
}

// ── User budget override row ───────────────────────────────────────────────────

interface UserBudgetRowProps {
  row: AiTokenUsageRow;
  onSave: (userId: string, limit: number | null) => void;
  isSaving: boolean;
}

function UserBudgetRow({ row, onSave, isSaving }: UserBudgetRowProps) {
  const { t } = useTranslation();
  const [overrideValue, setOverrideValue] = useState(row.limit !== null ? String(row.limit) : '');
  const [isDirty, setIsDirty] = useState(false);

  // Sync the input back to server state when the parent re-fetches and the field is not dirty.
  // Without this, key={row.user_id} reuse keeps showing the stale value after an external change.
  useEffect(() => {
    if (!isDirty) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOverrideValue(row.limit !== null ? String(row.limit) : '');
    }
  }, [row.limit, isDirty]);

  const handleChange = (value: string) => {
    setOverrideValue(value);
    setIsDirty(true);
  };

  const handleSave = () => {
    const parsed = overrideValue === '' ? null : parseInt(overrideValue, 10);
    if (overrideValue !== '' && (isNaN(parsed as number) || (parsed as number) < 0)) return;
    onSave(row.user_id, parsed);
    setIsDirty(false);
  };

  const handleRemove = () => {
    setOverrideValue('');
    onSave(row.user_id, null);
    setIsDirty(false);
  };

  const usedDisplay = row.used.toLocaleString();
  const limitDisplay =
    row.limit !== null ? row.limit.toLocaleString() : t('aiSettings.tokenBudgets.unlimited');
  const usageDisplay = row.percentage !== null ? `${row.percentage}%` : '—';

  return (
    <tr data-testid={`budget-row-${row.user_id}`}>
      <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
        <div className="font-medium">{row.user_name}</div>
        <div className="text-xs text-gray-500">{row.user_email}</div>
      </td>
      <td className="px-4 py-3 text-sm text-gray-600 capitalize">{row.user_role}</td>
      <td className="px-4 py-3 text-sm text-gray-600">{limitDisplay}</td>
      <td className="px-4 py-3 text-sm text-gray-600">{usedDisplay}</td>
      <td className="px-4 py-3 text-sm">
        <div className="flex items-center gap-2">
          <span>{usageDisplay}</span>
          <BudgetStatusBadge status={row.status} />
        </div>
      </td>
      <td className="px-4 py-3 text-sm">
        {row.user_role === 'admin' ? (
          <span className="text-gray-400 text-xs">{t('aiSettings.tokenBudgets.unlimited')}</span>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              value={overrideValue}
              onChange={(e) => {
                handleChange(e.target.value);
              }}
              placeholder={t('aiSettings.tokenBudgets.overridePlaceholder')}
              className="w-28 rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              data-testid={`budget-override-input-${row.user_id}`}
            />
            {isDirty && (
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-50"
                data-testid={`budget-override-save-${row.user_id}`}
              >
                {t('aiSettings.tokenBudgets.saveOverride')}
              </button>
            )}
            {row.limit !== null && !isDirty && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={isSaving}
                className="text-xs text-red-600 hover:text-red-800 font-medium disabled:opacity-50"
                data-testid={`budget-override-remove-${row.user_id}`}
              >
                {t('aiSettings.tokenBudgets.removeOverride')}
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

// ── Session retention section (MINCRM-447) ────────────────────────────────────

function SessionRetentionSection({ retentionDays }: { retentionDays: number }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [inputValue, setInputValue] = useState(String(retentionDays));
  const [validationError, setValidationError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    setInputValue(String(retentionDays));
  }, [retentionDays]);

  const mutation = useMutation({
    mutationFn: (days: number) => setAiSessionRetention({ ai_session_retention_days: days }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AI_CONFIG_QUERY_KEY });
      setSaveSuccess(true);
      setSaveError('');
      setTimeout(() => {
        setSaveSuccess(false);
      }, 3000);
    },
    onError: () => {
      setSaveError(t('aiSettings.sessionRetention.saveError'));
      setSaveSuccess(false);
    },
  });

  const handleSave = () => {
    setValidationError('');
    setSaveSuccess(false);
    setSaveError('');

    const parsed = parseInt(inputValue, 10);
    if (isNaN(parsed) || !Number.isInteger(parsed)) {
      setValidationError(t('aiSettings.sessionRetention.validationMin'));
      return;
    }
    if (parsed < 30) {
      setValidationError(t('aiSettings.sessionRetention.validationMin'));
      return;
    }
    if (parsed > 3650) {
      setValidationError(t('aiSettings.sessionRetention.validationMax'));
      return;
    }

    mutation.mutate(parsed);
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700">
        {t('aiSettings.sessionRetention.heading')}
      </h3>
      <p className="mt-1 text-sm text-gray-600">{t('aiSettings.sessionRetention.description')}</p>
      <div className="mt-4 flex items-start gap-3">
        <div className="flex-1 max-w-xs">
          <label
            className="block text-xs font-medium text-gray-700 mb-1"
            htmlFor="session-retention-days"
          >
            {t('aiSettings.sessionRetention.label')}
          </label>
          <input
            id="session-retention-days"
            type="number"
            min={30}
            max={3650}
            step={1}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setValidationError('');
            }}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid="ai-session-retention-days-input"
          />
          {validationError && <p className="mt-1 text-xs text-red-600">{validationError}</p>}
          <p className="mt-1 text-xs text-gray-500">{t('aiSettings.sessionRetention.hint')}</p>
        </div>
        <div className="pt-6">
          <Button
            onClick={handleSave}
            disabled={mutation.isPending}
            data-testid="ai-session-retention-save-button"
          >
            {mutation.isPending
              ? t('aiSettings.sessionRetention.saving')
              : t('aiSettings.sessionRetention.save')}
          </Button>
        </div>
      </div>
      {saveSuccess && (
        <p className="mt-2 text-xs text-green-600">
          {t('aiSettings.sessionRetention.saveSuccess')}
        </p>
      )}
      {saveError && <p className="mt-2 text-xs text-red-600">{saveError}</p>}
    </div>
  );
}

// ── Token budget section ───────────────────────────────────────────────────────

function TokenBudgetSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: AI_TOKEN_BUDGETS_QUERY_KEY,
    queryFn: getAiTokenBudgets,
  });

  const [orgLimitInput, setOrgLimitInput] = useState('');
  const [orgSaveSuccess, setOrgSaveSuccess] = useState(false);
  const [orgSaveError, setOrgSaveError] = useState('');

  useEffect(() => {
    if (data) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOrgLimitInput(data.org_monthly_limit === 0 ? '' : String(data.org_monthly_limit));
    }
  }, [data]);

  const orgMutation = useMutation({
    mutationFn: (limit: number) => setOrgTokenBudget({ monthly_limit: limit }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AI_TOKEN_BUDGETS_QUERY_KEY });
      setOrgSaveSuccess(true);
      setOrgSaveError('');
      setTimeout(() => {
        setOrgSaveSuccess(false);
      }, 3000);
    },
    onError: () => {
      setOrgSaveError(t('aiSettings.tokenBudgets.orgLimitSaveError'));
      setOrgSaveSuccess(false);
    },
  });

  const userMutation = useMutation({
    mutationFn: ({ userId, limit }: { userId: string; limit: number | null }) =>
      setUserTokenBudget(userId, { monthly_limit: limit }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AI_TOKEN_BUDGETS_QUERY_KEY });
    },
    onError: () => {
      // Re-fetch to snap the row back to the server-confirmed state so the admin
      // is not left with a stale value that looks like it was saved.
      void queryClient.invalidateQueries({ queryKey: AI_TOKEN_BUDGETS_QUERY_KEY });
    },
  });

  const handleOrgSave = () => {
    const parsed = orgLimitInput === '' ? 0 : parseInt(orgLimitInput, 10);
    if (isNaN(parsed) || parsed < 0) return;
    orgMutation.mutate(parsed);
  };

  const handleUserSave = (userId: string, limit: number | null) => {
    userMutation.mutate({ userId, limit });
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-2 py-4" data-testid="ai-token-budgets-loading">
        <div className="h-4 bg-gray-200 rounded w-1/3" />
        <div className="h-4 bg-gray-200 rounded w-1/2" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p className="text-sm text-red-600" data-testid="ai-token-budgets-error">
        {t('aiSettings.tokenBudgets.loadError')}
      </p>
    );
  }

  return (
    <section aria-labelledby="token-budgets-heading" data-testid="ai-token-budgets-section">
      <h2 id="token-budgets-heading" className="text-base font-semibold text-gray-900">
        {t('aiSettings.tokenBudgets.heading')}
      </h2>
      <p className="mt-1 text-sm text-gray-600">{t('aiSettings.tokenBudgets.description')}</p>

      {/* Org-wide limit */}
      <div className="mt-4 flex items-end gap-3">
        <div className="flex-1 max-w-xs">
          <label
            htmlFor="org-monthly-limit"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            {t('aiSettings.tokenBudgets.orgLimitLabel')}
          </label>
          <input
            id="org-monthly-limit"
            type="number"
            min="0"
            value={orgLimitInput}
            onChange={(e) => {
              setOrgLimitInput(e.target.value);
            }}
            placeholder={t('aiSettings.tokenBudgets.orgLimitPlaceholder')}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            data-testid="ai-org-monthly-limit-input"
          />
          <p className="mt-1 text-xs text-gray-500">{t('aiSettings.tokenBudgets.orgLimitHint')}</p>
        </div>
        <Button
          onClick={handleOrgSave}
          disabled={orgMutation.isPending}
          data-testid="ai-org-limit-save-button"
        >
          {orgMutation.isPending ? t('common.saving') : t('aiSettings.tokenBudgets.orgLimitSave')}
        </Button>
      </div>

      {orgSaveSuccess && (
        <p className="mt-2 text-sm text-green-600" data-testid="ai-org-limit-save-success">
          {t('aiSettings.tokenBudgets.orgLimitSaveSuccess')}
        </p>
      )}
      {orgSaveError && (
        <p className="mt-2 text-sm text-red-600" data-testid="ai-org-limit-save-error">
          {orgSaveError}
        </p>
      )}

      {/* Per-user consumption table */}
      <div className="mt-6">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">
          {t('aiSettings.tokenBudgets.usersTableHeading')}
          <span className="ms-2 text-xs font-normal text-gray-500">
            {t('aiSettings.tokenBudgets.orgTotal', {
              total: data.org_used_this_month.toLocaleString(),
            })}
          </span>
        </h3>
        <div className="overflow-x-auto rounded-md border border-gray-200">
          <table
            className="min-w-full divide-y divide-gray-200"
            data-testid="ai-budget-users-table"
          >
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('aiSettings.tokenBudgets.tableUser')}
                </th>
                <th className="px-4 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('aiSettings.tokenBudgets.tableRole')}
                </th>
                <th className="px-4 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('aiSettings.tokenBudgets.tableLimit')}
                </th>
                <th className="px-4 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('aiSettings.tokenBudgets.tableUsed')}
                </th>
                <th className="px-4 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('aiSettings.tokenBudgets.tableUsage')}
                </th>
                <th className="px-4 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('aiSettings.tokenBudgets.tableOverride')}
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {data.users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-500">
                    {t('aiSettings.tokenBudgets.noUsers')}
                  </td>
                </tr>
              ) : (
                data.users.map((row) => (
                  <UserBudgetRow
                    key={row.user_id}
                    row={row}
                    onSave={handleUserSave}
                    isSaving={userMutation.isPending}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function AiSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: AI_CONFIG_QUERY_KEY,
    queryFn: getAiConfig,
  });

  // ── Provider & model form state ───────────────────────────────────────────
  const [provider, setProvider] = useState<AiProvider>('anthropic');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyEditing, setApiKeyEditing] = useState(false);
  const [deploymentMode, setDeploymentMode] = useState<AiDeploymentMode>('cloud_api');
  const [baseUrl, setBaseUrl] = useState('');
  const [customDpaUrl, setCustomDpaUrl] = useState('');

  // ── Toggle confirmation state ─────────────────────────────────────────────
  const [showToggleConfirm, setShowToggleConfirm] = useState(false);
  const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null);

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
    if (data) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProvider(data.provider);
      setModel(data.model);
      setDeploymentMode(data.deployment_mode);
      setBaseUrl(data.base_url);
      setCustomDpaUrl(data.custom_dpa_url);
      setApiKey('');
      setApiKeyEditing(false);
    }
  }, [data]);

  // Reset model to first available when provider changes.
  const handleProviderChange = useCallback(
    (next: AiProvider) => {
      setProvider(next);
      if (data) {
        const firstModel = data.available_models.find((m) => m.provider === next);
        if (firstModel) setModel(firstModel.id);
      }
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

  const toggleMutation = useMutation({
    mutationFn: setAiEnabled,
    onSuccess: (freshData) => {
      // Write the server's response directly into the cache so the toggle
      // reflects the new enabled state immediately — invalidateQueries alone
      // causes a stale-data re-render where enabled is briefly the old value
      // while the background refetch is in flight.
      queryClient.setQueryData(AI_CONFIG_QUERY_KEY, freshData);
      void queryClient.invalidateQueries({ queryKey: AI_CONFIG_QUERY_KEY });
      setShowToggleConfirm(false);
      setPendingEnabled(null);
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

  function handleToggleClick() {
    if (!data) return;
    setPendingEnabled(!data.enabled);
    setShowToggleConfirm(true);
  }

  function handleToggleConfirm() {
    if (pendingEnabled === null) return;
    toggleMutation.mutate({ enabled: pendingEnabled });
  }

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
      ...(apiKeyEditing && apiKey ? { api_key: apiKey } : {}),
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
        ...(apiKeyEditing && apiKey ? { api_key: apiKey } : {}),
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

  if (isLoading) {
    return (
      <div className="py-8 text-center text-gray-500" data-testid="ai-settings-loading">
        {t('common.loading')}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="py-8 text-center text-red-600" data-testid="ai-settings-error">
        {t('aiSettings.loadError')}
      </div>
    );
  }

  const availableModels = data.available_models.filter((m) => m.provider === provider);

  return (
    <div className="space-y-8" data-testid="ai-settings-panel" role="region">
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

      {/* ── Section 1: Master AI toggle ────────────────────────────────────── */}
      <section aria-labelledby="ai-toggle-heading">
        <h2 id="ai-toggle-heading" className="text-base font-semibold text-gray-900 mb-1">
          {t('aiSettings.toggle.heading')}
        </h2>
        <p className="text-sm text-gray-500 mb-4">{t('aiSettings.toggle.description')}</p>

        <div className="flex items-center gap-4">
          <button
            type="button"
            role="switch"
            aria-checked={data.enabled}
            onClick={handleToggleClick}
            disabled={toggleMutation.isPending}
            data-testid="ai-master-toggle"
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 ${data.enabled ? 'bg-indigo-600' : 'bg-gray-200'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${data.enabled ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </button>
          <div>
            <span
              className={`text-sm font-medium ${data.enabled ? 'text-indigo-700' : 'text-gray-500'}`}
              data-testid="ai-toggle-status-label"
            >
              {data.enabled ? t('aiSettings.toggle.enabled') : t('aiSettings.toggle.disabled')}
            </span>
            {data.enabled_updated_at && (
              <p className="text-xs text-gray-400 mt-0.5">
                {t('aiSettings.toggle.lastChanged', {
                  timestamp: formatTimestamp(data.enabled_updated_at),
                })}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ── Section 2: Provider & Model ────────────────────────────────────── */}
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

      {/* ── Section 3: Data Processing Agreement ──────────────────────────── */}
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

      {/* Session retention section (MINCRM-447) */}
      <div className="border-t border-gray-200 pt-6">
        <SessionRetentionSection retentionDays={data.ai_session_retention_days} />
      </div>

      {/* Token budget section (MINCRM-458) */}
      <div className="border-t border-gray-200 pt-6">
        <TokenBudgetSection />
      </div>

      {/* Toggle confirmation dialog */}
      {showToggleConfirm && pendingEnabled !== null && (
        <ToggleConfirmDialog
          enabling={pendingEnabled}
          onConfirm={handleToggleConfirm}
          onCancel={() => {
            setShowToggleConfirm(false);
            setPendingEnabled(null);
          }}
          isPending={toggleMutation.isPending}
        />
      )}
    </div>
  );
}
