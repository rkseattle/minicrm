/**
 * AiUsageBudgetsSection — org/per-user token budgets and cost estimation rates.
 * One of the sub-sections behind the AI panel's sub-navigation (MINCRM-653).
 * Extracted from AiSettings.tsx without behavior changes.
 * (MINCRM-458, MINCRM-459)
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  getAiTokenBudgets,
  setOrgTokenBudget,
  setUserTokenBudget,
  AI_TOKEN_BUDGETS_QUERY_KEY,
  AI_CONFIG_QUERY_KEY,
  setAiCostRates,
} from '@/api/ai.js';
import type { AiTokenUsageRow, AiTokenBudgetStatus } from '@shared/schemas/settingsSchema.js';
import { Button } from '@/components/ui/Button.js';

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
      <div className="flex items-start justify-between gap-4">
        <h2 id="token-budgets-heading" className="text-base font-semibold text-gray-900">
          {t('aiSettings.tokenBudgets.heading')}
        </h2>
        <Link
          to="/admin/ai/usage"
          className="text-sm text-indigo-600 hover:text-indigo-800 underline whitespace-nowrap"
          data-testid="ai-usage-dashboard-link"
        >
          {t('aiSettings.tokenBudgets.usageDashboardLink')}
        </Link>
      </div>
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

// ── Cost rates section ────────────────────────────────────────────────────────

function CostRatesSection({
  inputCentsPerMillion,
  outputCentsPerMillion,
}: {
  inputCentsPerMillion: number;
  outputCentsPerMillion: number;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [inputRate, setInputRate] = useState(String(inputCentsPerMillion));
  const [outputRate, setOutputRate] = useState(String(outputCentsPerMillion));
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInputRate(String(inputCentsPerMillion));
    setOutputRate(String(outputCentsPerMillion));
  }, [inputCentsPerMillion, outputCentsPerMillion]);

  const mutation = useMutation({
    mutationFn: setAiCostRates,
    onSuccess: (freshData) => {
      queryClient.setQueryData(AI_CONFIG_QUERY_KEY, freshData);
      void queryClient.invalidateQueries({ queryKey: AI_CONFIG_QUERY_KEY });
      setSaveSuccess(true);
      setSaveError('');
      setTimeout(() => setSaveSuccess(false), 3000);
    },
    onError: () => {
      setSaveError(t('aiSettings.costRates.saveError'));
      setSaveSuccess(false);
    },
  });

  const handleSave = () => {
    const parsedInput = parseInt(inputRate, 10);
    const parsedOutput = parseInt(outputRate, 10);
    if (isNaN(parsedInput) || isNaN(parsedOutput) || parsedInput < 0 || parsedOutput < 0) {
      setSaveError(t('aiSettings.costRates.validationError'));
      return;
    }
    setSaveError('');
    mutation.mutate({
      ai_input_cost_per_million_cents: parsedInput,
      ai_output_cost_per_million_cents: parsedOutput,
    });
  };

  return (
    <section aria-labelledby="cost-rates-heading" data-testid="ai-cost-rates-section">
      <h2 id="cost-rates-heading" className="text-base font-semibold text-gray-900">
        {t('aiSettings.costRates.heading')}
      </h2>
      <p className="mt-1 text-sm text-gray-600">{t('aiSettings.costRates.description')}</p>

      <div className="mt-4 flex flex-col sm:flex-row gap-4">
        <div className="flex-1 max-w-xs">
          <label
            htmlFor="ai-input-cost-rate"
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            {t('aiSettings.costRates.inputLabel')}
          </label>
          <input
            id="ai-input-cost-rate"
            type="number"
            min={0}
            value={inputRate}
            onChange={(e) => setInputRate(e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid="ai-input-cost-rate-input"
          />
        </div>
        <div className="flex-1 max-w-xs">
          <label
            htmlFor="ai-output-cost-rate"
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            {t('aiSettings.costRates.outputLabel')}
          </label>
          <input
            id="ai-output-cost-rate"
            type="number"
            min={0}
            value={outputRate}
            onChange={(e) => setOutputRate(e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid="ai-output-cost-rate-input"
          />
        </div>
        <div className="pt-6">
          <Button
            onClick={handleSave}
            disabled={mutation.isPending}
            data-testid="ai-cost-rates-save-button"
          >
            {mutation.isPending ? t('common.saving') : t('aiSettings.costRates.save')}
          </Button>
        </div>
      </div>

      {saveSuccess && (
        <p className="mt-2 text-sm text-green-600" data-testid="ai-cost-rates-save-success">
          {t('aiSettings.costRates.saveSuccess')}
        </p>
      )}
      {saveError && (
        <p className="mt-2 text-sm text-red-600" data-testid="ai-cost-rates-save-error">
          {saveError}
        </p>
      )}
    </section>
  );
}

export function AiUsageBudgetsSection({
  inputCentsPerMillion,
  outputCentsPerMillion,
}: {
  inputCentsPerMillion: number;
  outputCentsPerMillion: number;
}) {
  return (
    <div className="space-y-8">
      <TokenBudgetSection />
      <div className="border-t border-gray-200 pt-6">
        <CostRatesSection
          inputCentsPerMillion={inputCentsPerMillion}
          outputCentsPerMillion={outputCentsPerMillion}
        />
      </div>
    </div>
  );
}
