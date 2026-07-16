/**
 * AiLeadRoutingSection — lead routing suggestion scoring weights + per-team
 * disable toggle. One of the sub-sections behind the AI panel's
 * sub-navigation (MINCRM-653). (MINCRM-475)
 *
 * Split into a data-fetching wrapper (this component) and presentational
 * forms that only mount once their query data exists — same pattern as
 * AiCoachingSection, avoiding a useEffect-based state sync
 * (react-hooks/set-state-in-effect).
 */

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getLeadRoutingConfig,
  setLeadRoutingConfig,
  listTeamRoutingOverrides,
  setTeamRoutingOverride,
  LEAD_ROUTING_CONFIG_QUERY_KEY,
  TEAM_ROUTING_OVERRIDES_QUERY_KEY,
} from '@/api/leadRouting.js';
import { listTeams, TEAMS_QUERY_KEY } from '@/api/teams.js';
import { Button } from '@/components/ui/Button.js';
import type { LeadRoutingConfigResponse } from '@shared/schemas/leadRoutingSchema.js';

interface FormState {
  territory_weight: string;
  industry_weight: string;
  workload_weight: string;
  win_rate_weight: string;
  availability_weight: string;
  low_confidence_threshold: string;
  medium_confidence_threshold: string;
  min_closed_deals_for_win_rate: string;
}

function toFormState(config: LeadRoutingConfigResponse): FormState {
  return {
    territory_weight: String(config.territory_weight),
    industry_weight: String(config.industry_weight),
    workload_weight: String(config.workload_weight),
    win_rate_weight: String(config.win_rate_weight),
    availability_weight: String(config.availability_weight),
    low_confidence_threshold: String(config.low_confidence_threshold),
    medium_confidence_threshold: String(config.medium_confidence_threshold),
    min_closed_deals_for_win_rate: String(config.min_closed_deals_for_win_rate),
  };
}

function WeightsForm({ config }: { config: LeadRoutingConfigResponse }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(() => toFormState(config));
  const [validationError, setValidationError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (successTimerRef.current !== null) clearTimeout(successTimerRef.current);
    };
  }, []);

  const mutation = useMutation({
    mutationFn: setLeadRoutingConfig,
    onSuccess: (freshData) => {
      queryClient.setQueryData(LEAD_ROUTING_CONFIG_QUERY_KEY, freshData);
      setForm(toFormState(freshData));
      setSaveSuccess(true);
      setSaveError('');
      if (successTimerRef.current !== null) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => setSaveSuccess(false), 3000);
    },
    onError: () => {
      setSaveError(t('aiSettings.leadRouting.saveError'));
      setSaveSuccess(false);
    },
  });

  function updateField(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setValidationError('');
  }

  function handleSave() {
    setValidationError('');
    setSaveSuccess(false);
    setSaveError('');

    const parsed = {
      territory_weight: Number(form.territory_weight),
      industry_weight: Number(form.industry_weight),
      workload_weight: Number(form.workload_weight),
      win_rate_weight: Number(form.win_rate_weight),
      availability_weight: Number(form.availability_weight),
      low_confidence_threshold: Number(form.low_confidence_threshold),
      medium_confidence_threshold: Number(form.medium_confidence_threshold),
      min_closed_deals_for_win_rate: Number(form.min_closed_deals_for_win_rate),
    };

    if (Object.values(parsed).some((v) => isNaN(v))) {
      setValidationError(t('aiSettings.leadRouting.validationNumeric'));
      return;
    }
    const weightSum =
      parsed.territory_weight +
      parsed.industry_weight +
      parsed.workload_weight +
      parsed.win_rate_weight +
      parsed.availability_weight;
    if (Math.abs(weightSum - 1) > 0.001) {
      setValidationError(t('aiSettings.leadRouting.validationWeightsSum'));
      return;
    }
    if (parsed.medium_confidence_threshold <= parsed.low_confidence_threshold) {
      setValidationError(t('aiSettings.leadRouting.validationThresholdOrder'));
      return;
    }
    if (
      !Number.isInteger(parsed.min_closed_deals_for_win_rate) ||
      parsed.min_closed_deals_for_win_rate < 1
    ) {
      setValidationError(t('aiSettings.leadRouting.validationMinClosedDeals'));
      return;
    }

    mutation.mutate(parsed);
  }

  const weightFields: Array<{ key: keyof FormState; labelKey: string }> = [
    { key: 'territory_weight', labelKey: 'aiSettings.leadRouting.territoryWeightLabel' },
    { key: 'industry_weight', labelKey: 'aiSettings.leadRouting.industryWeightLabel' },
    { key: 'workload_weight', labelKey: 'aiSettings.leadRouting.workloadWeightLabel' },
    { key: 'win_rate_weight', labelKey: 'aiSettings.leadRouting.winRateWeightLabel' },
    { key: 'availability_weight', labelKey: 'aiSettings.leadRouting.availabilityWeightLabel' },
  ];

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700">{t('aiSettings.leadRouting.heading')}</h3>
      <p className="mt-1 text-sm text-gray-600">{t('aiSettings.leadRouting.description')}</p>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
        {weightFields.map(({ key, labelKey }) => (
          <div key={key}>
            <label
              className="block text-xs font-medium text-gray-700 mb-1"
              htmlFor={`lead-routing-${key}`}
            >
              {t(labelKey)}
            </label>
            <input
              id={`lead-routing-${key}`}
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={form[key]}
              onChange={(e) => updateField(key, e.target.value)}
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              data-testid={`lead-routing-${key}-input`}
            />
          </div>
        ))}
        <div>
          <label
            className="block text-xs font-medium text-gray-700 mb-1"
            htmlFor="lead-routing-low-confidence-threshold"
          >
            {t('aiSettings.leadRouting.lowConfidenceThresholdLabel')}
          </label>
          <input
            id="lead-routing-low-confidence-threshold"
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={form.low_confidence_threshold}
            onChange={(e) => updateField('low_confidence_threshold', e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid="lead-routing-low-confidence-threshold-input"
          />
        </div>
        <div>
          <label
            className="block text-xs font-medium text-gray-700 mb-1"
            htmlFor="lead-routing-medium-confidence-threshold"
          >
            {t('aiSettings.leadRouting.mediumConfidenceThresholdLabel')}
          </label>
          <input
            id="lead-routing-medium-confidence-threshold"
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={form.medium_confidence_threshold}
            onChange={(e) => updateField('medium_confidence_threshold', e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid="lead-routing-medium-confidence-threshold-input"
          />
        </div>
        <div>
          <label
            className="block text-xs font-medium text-gray-700 mb-1"
            htmlFor="lead-routing-min-closed-deals"
          >
            {t('aiSettings.leadRouting.minClosedDealsLabel')}
          </label>
          <input
            id="lead-routing-min-closed-deals"
            type="number"
            min={1}
            step={1}
            value={form.min_closed_deals_for_win_rate}
            onChange={(e) => updateField('min_closed_deals_for_win_rate', e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid="lead-routing-min-closed-deals-input"
          />
        </div>
      </div>

      {validationError && (
        <p className="mt-2 text-xs text-red-600" data-testid="lead-routing-validation-error">
          {validationError}
        </p>
      )}

      <div className="mt-4">
        <Button
          onClick={handleSave}
          disabled={mutation.isPending}
          data-testid="lead-routing-save-button"
        >
          {mutation.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </div>

      {saveSuccess && (
        <p className="mt-2 text-xs text-green-600" data-testid="lead-routing-save-success">
          {t('aiSettings.leadRouting.saveSuccess')}
        </p>
      )}
      {saveError && (
        <p className="mt-2 text-xs text-red-600" data-testid="lead-routing-save-error">
          {saveError}
        </p>
      )}
    </div>
  );
}

function TeamOverridesList() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data: teams, isLoading: teamsLoading } = useQuery({
    queryKey: TEAMS_QUERY_KEY,
    queryFn: listTeams,
  });
  const { data: overrides, isLoading: overridesLoading } = useQuery({
    queryKey: TEAM_ROUTING_OVERRIDES_QUERY_KEY,
    queryFn: listTeamRoutingOverrides,
  });

  const mutation = useMutation({
    mutationFn: ({ teamId, enabled }: { teamId: string; enabled: boolean | null }) =>
      setTeamRoutingOverride(teamId, { enabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TEAM_ROUTING_OVERRIDES_QUERY_KEY });
    },
  });

  if (teamsLoading || overridesLoading) {
    return (
      <div
        className="animate-pulse h-16 bg-gray-100 rounded"
        data-testid="lead-routing-team-overrides-loading"
      />
    );
  }

  const overrideByTeamId = new Map((overrides ?? []).map((o) => [o.team_id, o]));

  return (
    <div className="mt-6 border-t border-gray-100 pt-4">
      <h4 className="text-sm font-semibold text-gray-700">
        {t('aiSettings.leadRouting.teamOverridesHeading')}
      </h4>
      <p className="mt-1 text-sm text-gray-600 mb-3">
        {t('aiSettings.leadRouting.teamOverridesDescription')}
      </p>
      <ul
        className="divide-y divide-gray-100 border border-gray-200 rounded-md"
        data-testid="lead-routing-team-overrides-list"
      >
        {(teams ?? []).map((team) => {
          const override = overrideByTeamId.get(team.id);
          const enabled = override?.enabled ?? true;
          return (
            <li
              key={team.id}
              className="flex items-center justify-between px-4 py-2"
              data-testid={`lead-routing-team-override-${team.id}`}
            >
              <span className="text-sm text-gray-900">{team.name}</span>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                onClick={() => mutation.mutate({ teamId: team.id, enabled: !enabled })}
                disabled={mutation.isPending}
                data-testid={`lead-routing-team-override-toggle-${team.id}`}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 ${enabled ? 'bg-indigo-600' : 'bg-gray-200'}`}
              >
                <span
                  className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : 'translate-x-1'}`}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function AiLeadRoutingSection() {
  const { t } = useTranslation();

  const { data, isLoading, isError } = useQuery({
    queryKey: LEAD_ROUTING_CONFIG_QUERY_KEY,
    queryFn: getLeadRoutingConfig,
  });

  if (isLoading) {
    return (
      <div className="py-8 text-center text-gray-500" data-testid="lead-routing-loading">
        {t('common.loading')}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="py-8 text-center text-red-600" data-testid="lead-routing-error">
        {t('aiSettings.leadRouting.loadError')}
      </div>
    );
  }

  return (
    <div>
      <WeightsForm config={data} />
      <TeamOverridesList />
    </div>
  );
}
