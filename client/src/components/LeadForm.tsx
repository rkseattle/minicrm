/**
 * LeadForm component.
 * Reusable form for creating and editing lead records.
 * Used by LeadsPage (create) and LeadDetailPage (edit).
 * (MINCRM-173, MINCRM-174)
 */

import { useState, useEffect, useRef, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/Input.js';
import { Select } from '@/components/ui/Select.js';
import { Button } from '@/components/ui/Button.js';
import OwnerSelect from '@/components/OwnerSelect.js';
import type { ActiveUser } from '@/api/users.js';
import { LEAD_SOURCES } from '@shared/schemas/leadSchema.js';
import { useDebounce } from '@/hooks/useDebounce.js';
import { useFeatureFlag } from '@/hooks/useFeatureFlag.js';
import { getLeadRoutingSuggestion } from '@/api/leadRouting.js';
import type { LeadRoutingSuggestionResponse } from '@shared/schemas/leadRoutingSchema.js';

/** Form field values managed by this component */
export interface LeadFormValues {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  company_name: string;
  lead_source: 'Web' | 'Referral' | 'Trade Show' | 'Cold Outreach' | 'Other' | '';
  notes: string;
  owner_id: string;
  territory: string;
  industry: string;
  employee_range: string;
  /** Set once the manager applies or dismisses a routing suggestion, echoed back on submit (MINCRM-475) */
  routingSuggestion: LeadRoutingSuggestionResponse | null;
}

interface LeadFormProps {
  initialValues?: Partial<LeadFormValues>;
  activeUsers: ActiveUser[];
  isAdmin: boolean;
  onSubmit: (values: LeadFormValues) => void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
  /** True only for the create flow — routing suggestions never apply to existing leads (MINCRM-475) */
  isCreate?: boolean;
}

function buildInitialState(initial?: Partial<LeadFormValues>): LeadFormValues {
  return {
    first_name: initial?.first_name ?? '',
    last_name: initial?.last_name ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    company_name: initial?.company_name ?? '',
    lead_source: initial?.lead_source ?? '',
    notes: initial?.notes ?? '',
    owner_id: initial?.owner_id ?? '',
    territory: initial?.territory ?? '',
    industry: initial?.industry ?? '',
    employee_range: initial?.employee_range ?? '',
    routingSuggestion: initial?.routingSuggestion ?? null,
  };
}

/**
 * Renders the AI routing suggestion panel: fetches a suggestion as the
 * manager fills in territory/industry/employee_range/lead_source, and lets
 * them apply it (sets owner_id) or dismiss it. Silently renders nothing when
 * the feature flag is off, no confident suggestion exists, or the manager
 * has already dismissed/applied one for the current profile. (MINCRM-475)
 */
function RoutingSuggestionPanel({
  territory,
  industry,
  employeeRange,
  leadSource,
  currentSuggestion,
  onApply,
  onDismiss,
}: {
  territory: string;
  industry: string;
  employeeRange: string;
  leadSource: string;
  currentSuggestion: LeadRoutingSuggestionResponse | null;
  onApply: (suggestion: LeadRoutingSuggestionResponse) => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const { enabled: featureEnabled } = useFeatureFlag('ai_lead_routing_suggestion');

  const debouncedTerritory = useDebounce(territory);
  const debouncedIndustry = useDebounce(industry);
  const debouncedEmployeeRange = useDebounce(employeeRange);
  const debouncedLeadSource = useDebounce(leadSource);

  const hasAnyProfileField = Boolean(
    debouncedTerritory || debouncedIndustry || debouncedEmployeeRange || debouncedLeadSource,
  );

  // Tracks which exact profile the manager dismissed a suggestion for, so
  // dismissing doesn't just re-fetch and re-show the identical suggestion on
  // the next render — it only reappears once the profile actually changes.
  const [dismissedForKey, setDismissedForKey] = useState<string | null>(null);
  const profileKey = `${debouncedTerritory}|${debouncedIndustry}|${debouncedEmployeeRange}|${debouncedLeadSource}`;
  const isDismissedForCurrentProfile = dismissedForKey === profileKey;

  const { data: suggestion, isFetching } = useQuery({
    queryKey: ['leadRoutingSuggestion', profileKey],
    queryFn: () =>
      getLeadRoutingSuggestion({
        territory: debouncedTerritory || undefined,
        industry: debouncedIndustry || undefined,
        employee_range: debouncedEmployeeRange || undefined,
        lead_source: debouncedLeadSource || undefined,
      }),
    enabled:
      featureEnabled &&
      hasAnyProfileField &&
      currentSuggestion === null &&
      !isDismissedForCurrentProfile,
  });

  function handleDismiss() {
    setDismissedForKey(profileKey);
    onDismiss();
  }

  if (
    !featureEnabled ||
    currentSuggestion !== null ||
    !hasAnyProfileField ||
    isDismissedForCurrentProfile
  ) {
    return null;
  }
  if (isFetching) {
    return (
      <div
        className="mb-4 h-16 rounded-md border border-gray-200 bg-gray-50 animate-pulse"
        aria-hidden="true"
        data-testid="lead-routing-suggestion-loading"
      />
    );
  }
  if (!suggestion) return null;

  return (
    <div
      className="mb-4 rounded-md border border-primary-200 bg-primary-50 p-4"
      data-testid="lead-routing-suggestion-panel"
    >
      <p className="text-sm font-medium text-gray-900">
        {t('leads.routingSuggestionHeading', { name: suggestion.suggested_rep_name })}
      </p>
      <p className="text-xs text-gray-600 mt-0.5">
        {t(
          `leads.routingConfidence${suggestion.confidence.charAt(0).toUpperCase()}${suggestion.confidence.slice(1)}`,
        )}
      </p>
      <ul className="mt-2 list-disc list-inside text-sm text-gray-700">
        {suggestion.contributing_factors.map((factor, index) => (
          <li key={index} data-testid={`lead-routing-factor-${index}`}>
            {factor.description}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          size="sm"
          data-testid="lead-routing-suggestion-apply"
          onClick={() => onApply(suggestion)}
        >
          {t('leads.routingSuggestionApply')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="lead-routing-suggestion-dismiss"
          onClick={handleDismiss}
        >
          {t('leads.routingSuggestionDismiss')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Form for creating or editing a lead.
 * Forwards its ref to the underlying <form> element for programmatic submit.
 */
const LeadForm = forwardRef<HTMLFormElement, LeadFormProps>(function LeadForm(
  {
    initialValues,
    activeUsers,
    isAdmin,
    onSubmit,
    onCancel,
    isSubmitting = false,
    submitLabel,
    isCreate = false,
  },
  ref,
) {
  const { t } = useTranslation();
  const firstInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState<LeadFormValues>(() => buildInitialState(initialValues));

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    const { name, value } = event.target;
    setFormData((previous) => ({ ...previous, [name]: value }));
  };

  const handleSelectChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const { name, value } = event.target;
    // Manually overriding the owner clears any applied suggestion — it no longer
    // reflects the manager's actual choice, matching the AC's "override with a
    // manual assignment" path.
    if (name === 'owner_id') {
      setFormData((previous) => ({ ...previous, owner_id: value, routingSuggestion: null }));
      return;
    }
    setFormData((previous) => ({ ...previous, [name]: value }));
  };

  const handleApplySuggestion = (suggestion: LeadRoutingSuggestionResponse): void => {
    setFormData((previous) => ({
      ...previous,
      owner_id: suggestion.suggested_rep_id,
      routingSuggestion: suggestion,
    }));
  };

  const handleDismissSuggestion = (): void => {
    setFormData((previous) => ({ ...previous, routingSuggestion: null }));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSubmit(formData);
  };

  const resolvedSubmitLabel = submitLabel ?? t('leads.save');

  return (
    <form ref={ref} onSubmit={handleSubmit} data-testid="lead-form">
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          ref={firstInputRef}
          id="lead-first-name"
          data-testid="lead-first-name"
          name="first_name"
          type="text"
          required
          label={t('leads.firstNameLabel')}
          placeholder={t('leads.firstNamePlaceholder')}
          value={formData.first_name}
          onChange={handleChange}
          disabled={isSubmitting}
        />

        <Input
          id="lead-last-name"
          data-testid="lead-last-name"
          name="last_name"
          type="text"
          label={t('leads.lastNameLabel')}
          placeholder={t('leads.lastNamePlaceholder')}
          value={formData.last_name}
          onChange={handleChange}
          disabled={isSubmitting}
        />

        <Input
          id="lead-email"
          data-testid="lead-email"
          name="email"
          type="email"
          required
          label={t('leads.emailLabel')}
          value={formData.email}
          onChange={handleChange}
          disabled={isSubmitting}
        />

        <Input
          id="lead-phone"
          data-testid="lead-phone"
          name="phone"
          type="tel"
          label={t('leads.phoneLabel')}
          placeholder={t('leads.phonePlaceholder')}
          value={formData.phone}
          onChange={handleChange}
          disabled={isSubmitting}
        />

        <Input
          id="lead-company-name"
          data-testid="lead-company-name"
          name="company_name"
          type="text"
          label={t('leads.companyLabel')}
          placeholder={t('leads.companyPlaceholder')}
          value={formData.company_name}
          onChange={handleChange}
          disabled={isSubmitting}
        />

        <Select
          id="lead-source"
          data-testid="lead-source-select"
          name="lead_source"
          label={t('leads.sourceLabel')}
          value={formData.lead_source}
          onChange={handleSelectChange}
          disabled={isSubmitting}
        >
          <option value="">{t('leads.sourceNone')}</option>
          {LEAD_SOURCES.map((source) => (
            <option key={source} value={source}>
              {t(`leads.source${source.replace(/\s+/g, '')}`)}
            </option>
          ))}
        </Select>

        <Input
          id="lead-territory"
          data-testid="lead-territory"
          name="territory"
          type="text"
          label={t('leads.territoryLabel')}
          placeholder={t('leads.territoryPlaceholder')}
          value={formData.territory}
          onChange={handleChange}
          disabled={isSubmitting}
        />

        <Input
          id="lead-industry"
          data-testid="lead-industry"
          name="industry"
          type="text"
          label={t('leads.industryLabel')}
          placeholder={t('leads.industryPlaceholder')}
          value={formData.industry}
          onChange={handleChange}
          disabled={isSubmitting}
        />

        <Input
          id="lead-employee-range"
          data-testid="lead-employee-range"
          name="employee_range"
          type="text"
          label={t('leads.employeeRangeLabel')}
          placeholder={t('leads.employeeRangePlaceholder')}
          value={formData.employee_range}
          onChange={handleChange}
          disabled={isSubmitting}
        />

        {/* Owner selector — visible to admins or always when isAdmin is true */}
        {isAdmin && (
          <OwnerSelect
            id="lead-owner"
            data-testid="lead-owner-select"
            name="owner_id"
            label={t('leads.ownerLabel')}
            users={activeUsers}
            unknownLabel={t('leads.ownerUnknown')}
            value={formData.owner_id}
            onChange={handleSelectChange}
            disabled={isSubmitting}
          />
        )}
      </div>

      {/* AI routing suggestion — create flow only, admins only (matches OwnerSelect's own gating) (MINCRM-475) */}
      {isCreate && isAdmin && (
        <RoutingSuggestionPanel
          territory={formData.territory}
          industry={formData.industry}
          employeeRange={formData.employee_range}
          leadSource={formData.lead_source}
          currentSuggestion={formData.routingSuggestion}
          onApply={handleApplySuggestion}
          onDismiss={handleDismissSuggestion}
        />
      )}

      {/* Notes spans full width */}
      <div className="mb-4">
        <label htmlFor="lead-notes" className="block text-sm font-medium text-gray-700">
          {t('leads.notesLabel')}
        </label>
        <textarea
          id="lead-notes"
          data-testid="lead-notes"
          name="notes"
          rows={3}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:opacity-50"
          placeholder={t('leads.notesPlaceholder')}
          value={formData.notes}
          onChange={handleChange}
          disabled={isSubmitting}
        />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" data-testid="lead-form-submit" disabled={isSubmitting}>
          {isSubmitting ? t('leads.saving') : resolvedSubmitLabel}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            data-testid="lead-form-cancel"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {t('leads.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
});

export default LeadForm;
