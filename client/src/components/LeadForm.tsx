/**
 * LeadForm component.
 * Reusable form for creating and editing lead records.
 * Used by LeadsPage (create) and LeadDetailPage (edit).
 * (MINCRM-173, MINCRM-174)
 */

import { useState, useEffect, useRef, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input.js';
import { Select } from '@/components/ui/Select.js';
import { Button } from '@/components/ui/Button.js';
import OwnerSelect from '@/components/OwnerSelect.js';
import type { ActiveUser } from '@/api/users.js';
import { LEAD_SOURCES } from '@shared/schemas/leadSchema.js';

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
}

interface LeadFormProps {
  initialValues?: Partial<LeadFormValues>;
  activeUsers: ActiveUser[];
  isAdmin: boolean;
  onSubmit: (values: LeadFormValues) => void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
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
  };
}

/**
 * Form for creating or editing a lead.
 * Forwards its ref to the underlying <form> element for programmatic submit.
 */
const LeadForm = forwardRef<HTMLFormElement, LeadFormProps>(function LeadForm(
  { initialValues, activeUsers, isAdmin, onSubmit, onCancel, isSubmitting = false, submitLabel },
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
    setFormData((previous) => ({ ...previous, [name]: value }));
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
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
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
