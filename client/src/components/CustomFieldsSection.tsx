/**
 * CustomFieldsSection — displays and edits custom field values for a record. (MINCRM-276)
 * Mounted on ContactDetailPage, AccountDetailPage, and DealDetailPage.
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  listCustomFieldDefinitions,
  getCustomFieldValues,
  CUSTOM_FIELD_DEFINITIONS_QUERY_KEY,
  customFieldValuesQueryKey,
} from '@/api/customFields.js';
import type { CustomFieldValueInput } from '@shared/schemas/customFieldSchema.js';

interface CustomFieldsSectionProps {
  entityType: 'contact' | 'account' | 'deal';
  recordId: string;
  isEditing: boolean;
  onValuesChange?: (values: CustomFieldValueInput[]) => void;
}

export default function CustomFieldsSection({
  entityType,
  recordId,
  isEditing,
  onValuesChange,
}: CustomFieldsSectionProps) {
  const { t } = useTranslation();

  const { data: defsData } = useQuery({
    queryKey: [...CUSTOM_FIELD_DEFINITIONS_QUERY_KEY, entityType],
    queryFn: () => listCustomFieldDefinitions(entityType),
    enabled: Boolean(recordId),
  });

  const { data: valuesData } = useQuery({
    queryKey: customFieldValuesQueryKey(entityType, recordId),
    queryFn: () => getCustomFieldValues(entityType, recordId),
    enabled: Boolean(recordId),
  });

  const definitions = defsData?.definitions ?? [];
  const serverValues = valuesData?.values ?? [];

  // Local edit state: map from definition_id → current string value
  const [editValues, setEditValues] = useState<Record<string, string | null>>({});

  // Seed edit state from server values whenever we enter edit mode or server values load
  useEffect(() => {
    if (isEditing) {
      const initial: Record<string, string | null> = {};
      for (const def of definitions) {
        const existing = serverValues.find((v) => v.definition_id === def.id);
        initial[def.id] = existing?.value ?? null;
      }
      setEditValues(initial);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, definitions.length, serverValues.length]);

  // Notify parent whenever edit values change
  useEffect(() => {
    if (!isEditing || !onValuesChange) return;
    const payload: CustomFieldValueInput[] = definitions.map((def) => ({
      definition_id: def.id,
      value: editValues[def.id] ?? null,
    }));
    onValuesChange(payload);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editValues, isEditing]);

  if (definitions.length === 0) return null;

  function handleChange(definitionId: string, value: string | null): void {
    setEditValues((prev) => ({ ...prev, [definitionId]: value }));
  }

  if (!isEditing) {
    const visibleValues = serverValues.filter((v) => v.value !== null && v.value !== '');
    if (visibleValues.length === 0) return null;

    return (
      <div
        className="bg-white border border-gray-200 rounded-lg p-6 mt-4"
        data-testid="custom-fields-section"
      >
        <h3 className="text-sm font-semibold text-gray-900 mb-4">
          {t('customFields.sectionTitle')}
        </h3>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="custom-fields-read-grid">
          {visibleValues.map((v) => (
            <div key={v.definition_id}>
              <dt
                className="text-xs font-semibold text-gray-500 uppercase tracking-wide"
                data-testid={`custom-field-label-${v.definition_id}`}
              >
                {v.definition.name}
              </dt>
              <dd className="mt-1 text-sm text-gray-900 break-words">
                {v.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  // Edit mode
  return (
    <div
      className="bg-white border border-gray-200 rounded-lg p-6 mt-4"
      data-testid="custom-fields-section"
    >
      <h3 className="text-sm font-semibold text-gray-900 mb-4">
        {t('customFields.sectionTitle')}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="custom-fields-edit-grid">
        {definitions.map((def) => {
          const currentValue = editValues[def.id] ?? '';

          return (
            <div key={def.id}>
              <label
                htmlFor={`cf-${def.id}`}
                className="block text-sm font-medium text-gray-700 mb-1"
                data-testid={`custom-field-label-${def.id}`}
              >
                {def.name}
              </label>

              {def.field_type === 'text' && (
                <input
                  id={`cf-${def.id}`}
                  type="text"
                  data-testid={`custom-field-input-${def.id}`}
                  value={currentValue}
                  onChange={(e) => handleChange(def.id, e.target.value || null)}
                  className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
                />
              )}

              {def.field_type === 'number' && (
                <input
                  id={`cf-${def.id}`}
                  type="number"
                  data-testid={`custom-field-input-${def.id}`}
                  value={currentValue}
                  onChange={(e) => handleChange(def.id, e.target.value || null)}
                  className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
                />
              )}

              {def.field_type === 'date' && (
                <input
                  id={`cf-${def.id}`}
                  type="date"
                  data-testid={`custom-field-input-${def.id}`}
                  value={currentValue}
                  onChange={(e) => handleChange(def.id, e.target.value || null)}
                  className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
                />
              )}

              {def.field_type === 'boolean' && (
                <div className="flex items-center gap-2 mt-1">
                  <input
                    id={`cf-${def.id}`}
                    type="checkbox"
                    data-testid={`custom-field-input-${def.id}`}
                    checked={currentValue === 'true'}
                    onChange={(e) => handleChange(def.id, e.target.checked ? 'true' : 'false')}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <label htmlFor={`cf-${def.id}`} className="text-sm text-gray-700">
                    {def.name}
                  </label>
                </div>
              )}

              {def.field_type === 'select' && (
                <select
                  id={`cf-${def.id}`}
                  data-testid={`custom-field-input-${def.id}`}
                  value={currentValue}
                  onChange={(e) => handleChange(def.id, e.target.value || null)}
                  className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
                >
                  <option value="">—</option>
                  {(def.options ?? []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
