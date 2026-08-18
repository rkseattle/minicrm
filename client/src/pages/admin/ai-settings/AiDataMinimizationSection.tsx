/**
 * AiDataMinimizationSection — field exclusions from AI context.
 * One of the sub-sections behind the AI panel's sub-navigation.
 * Extracted from AiSettings.tsx without behavior changes.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  getEffectiveFieldExclusions,
  setFieldExclusion,
  AI_FIELD_EXCLUSIONS_QUERY_KEY,
} from '@/api/ai.js';
import type { StandardFieldExclusionEntry } from '@shared/schemas/aiFieldExclusionSchema.js';
import type { EntityType } from '@shared/schemas/customFieldSchema.js';

const ENTITY_TYPE_ORDER = ['contact', 'account', 'deal'] as const;

interface StandardFieldRowProps {
  entry: StandardFieldExclusionEntry;
  onToggle: (entityType: string, fieldName: string, excluded: boolean) => void;
  isSaving: boolean;
}

function StandardFieldRow({ entry, onToggle, isSaving }: StandardFieldRowProps) {
  const { t } = useTranslation();
  return (
    <tr data-testid={`field-exclusion-row-${entry.entity_type}-${entry.field_name}`}>
      <td className="px-4 py-2 text-sm text-gray-800">{entry.field_name}</td>
      <td className="px-4 py-2 text-sm text-gray-500 capitalize">{entry.entity_type}</td>
      <td className="px-4 py-2 text-sm">
        <input
          type="checkbox"
          checked={entry.excluded}
          disabled={isSaving}
          onChange={(e) => onToggle(entry.entity_type, entry.field_name, e.target.checked)}
          data-testid={`field-exclusion-toggle-${entry.entity_type}-${entry.field_name}`}
          aria-label={t('aiSettings.dataMinimization.toggleAriaLabel', {
            field: entry.field_name,
            entity: entry.entity_type,
          })}
        />
      </td>
    </tr>
  );
}

export function AiDataMinimizationSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: AI_FIELD_EXCLUSIONS_QUERY_KEY,
    queryFn: getEffectiveFieldExclusions,
  });

  const [saveError, setSaveError] = useState('');

  const toggleMutation = useMutation({
    mutationFn: (input: { entity_type: EntityType; field_name: string; excluded: boolean }) =>
      setFieldExclusion(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: AI_FIELD_EXCLUSIONS_QUERY_KEY });
      setSaveError('');
    },
    onError: () => {
      setSaveError(t('aiSettings.dataMinimization.saveError'));
      void queryClient.invalidateQueries({ queryKey: AI_FIELD_EXCLUSIONS_QUERY_KEY });
    },
  });

  const handleToggle = (entityType: string, fieldName: string, excluded: boolean) => {
    // entityType always originates from the server's standard field registry
    // (STANDARD_FIELDS_BY_ENTITY), so it is always a valid EntityType value.
    toggleMutation.mutate({
      entity_type: entityType as EntityType,
      field_name: fieldName,
      excluded,
    });
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-2 py-4" data-testid="ai-field-exclusions-loading">
        <div className="h-4 bg-gray-200 rounded w-1/3" />
        <div className="h-4 bg-gray-200 rounded w-1/2" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p className="text-sm text-red-600" data-testid="ai-field-exclusions-error">
        {t('aiSettings.dataMinimization.loadError')}
      </p>
    );
  }

  const sortedStandardFields = [...data.standard_fields].sort((a, b) => {
    const orderDiff =
      ENTITY_TYPE_ORDER.indexOf(a.entity_type as (typeof ENTITY_TYPE_ORDER)[number]) -
      ENTITY_TYPE_ORDER.indexOf(b.entity_type as (typeof ENTITY_TYPE_ORDER)[number]);
    return orderDiff !== 0 ? orderDiff : a.field_name.localeCompare(b.field_name);
  });

  return (
    <section aria-labelledby="data-minimization-heading" data-testid="ai-data-minimization-section">
      <h2 id="data-minimization-heading" className="text-base font-semibold text-gray-900">
        {t('aiSettings.dataMinimization.heading')}
      </h2>
      <p className="mt-1 text-sm text-gray-600">{t('aiSettings.dataMinimization.description')}</p>

      {saveError && (
        <p className="mt-2 text-sm text-red-600" data-testid="ai-field-exclusions-save-error">
          {saveError}
        </p>
      )}

      {/* Always-excluded (locked) fields */}
      <div className="mt-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-2">
          {t('aiSettings.dataMinimization.alwaysExcludedHeading')}
        </h3>
        <div
          className="flex flex-wrap gap-2"
          data-testid="ai-always-excluded-fields"
          aria-label={t('aiSettings.dataMinimization.alwaysExcludedHeading')}
        >
          {data.always_excluded.map((fieldName) => (
            <span
              key={fieldName}
              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200"
              data-testid={`always-excluded-field-${fieldName}`}
              title={t('aiSettings.dataMinimization.lockedTooltip')}
            >
              {fieldName}
            </span>
          ))}
        </div>
      </div>

      {/* Admin-configurable standard fields */}
      <div className="mt-6">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">
          {t('aiSettings.dataMinimization.standardFieldsHeading')}
        </h3>
        <div className="overflow-x-auto rounded-md border border-gray-200">
          <table
            className="min-w-full divide-y divide-gray-200"
            data-testid="ai-standard-fields-table"
          >
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('aiSettings.dataMinimization.tableField')}
                </th>
                <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('aiSettings.dataMinimization.tableEntity')}
                </th>
                <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('aiSettings.dataMinimization.tableExcluded')}
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {sortedStandardFields.map((entry) => (
                <StandardFieldRow
                  key={`${entry.entity_type}-${entry.field_name}`}
                  entry={entry}
                  onToggle={handleToggle}
                  isSaving={toggleMutation.isPending}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Custom fields summary (read-only, managed in Customisation Settings) */}
      <div className="mt-6">
        <h3 className="text-sm font-semibold text-gray-800 mb-2">
          {t('aiSettings.dataMinimization.customFieldsHeading')}
        </h3>
        {data.custom_fields.length === 0 ? (
          <p className="text-sm text-gray-500" data-testid="ai-custom-fields-excluded-empty">
            {t('aiSettings.dataMinimization.noCustomFields')}
          </p>
        ) : (
          <ul
            className="text-sm text-gray-700 space-y-1"
            data-testid="ai-custom-fields-excluded-list"
          >
            {data.custom_fields
              .filter((f) => f.excluded)
              .map((f) => (
                <li key={`${f.entity_type}-${f.field_name}`}>
                  {t('aiSettings.dataMinimization.customFieldEntry', {
                    field: f.field_name,
                    entity: f.entity_type,
                  })}
                </li>
              ))}
            {data.custom_fields.every((f) => !f.excluded) && (
              <li className="text-gray-500">{t('aiSettings.dataMinimization.noCustomFields')}</li>
            )}
          </ul>
        )}
        <p className="mt-2 text-xs text-gray-500">
          {t('aiSettings.dataMinimization.customFieldsHint')}{' '}
          <Link
            to="/admin/settings?tab=pipelines"
            className="text-indigo-600 hover:text-indigo-800 underline"
            data-testid="ai-manage-custom-fields-link"
          >
            {t('aiSettings.dataMinimization.customFieldsLink')}
          </Link>
        </p>
      </div>
    </section>
  );
}
