/**
 * AccountForm component.
 * Reusable form for creating and editing account records.
 * Used by AccountsPage (create) and AccountDetailPage (edit).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input.js';
import { Button } from '@/components/ui/Button.js';
import OwnerSelect from '@/components/OwnerSelect.js';
import ContactSelector from '@/components/ContactSelector.js';
import type { AccountResponse } from '@shared/schemas/accountSchema.js';
import type { ActiveUser } from '@/api/users.js';

/** Form field values managed by this component */
export interface AccountFormValues {
  name: string;
  industry: string;
  website: string;
  employee_range: string;
  revenue_range: string;
  /** UUID of the owner; populated only when users prop is provided (edit mode) */
  owner_id: string;
  /** UUIDs of contacts linked to this account */
  contact_ids: string[];
}

interface AccountFormProps {
  /** Pre-populate fields when editing an existing account */
  initialValues?: Partial<AccountResponse>;
  /** Pre-populate the contact selector with already-linked contact UUIDs */
  initialContactIds?: string[];
  /**
   * When provided, an owner selector is rendered.
   * Omit on the create form (ownership defaults to the creating user server-side).
   */
  users?: ActiveUser[];
  /** Called with the current field values when the form is submitted */
  onSubmit: (values: AccountFormValues) => void;
  /** Called when the Cancel button is clicked */
  onCancel?: () => void;
  /** Disables inputs and shows a loading state on the submit button */
  isSubmitting?: boolean;
  /** Text for the primary submit button */
  submitLabel?: string;
  /** Error message to display below the form */
  error?: string;
}

/**
 * Returns the initial state for the form, optionally seeded from an existing account.
 *
 * @param initial - Optional existing account values to pre-populate
 * @param initialContactIds - Optional pre-selected contact UUIDs
 */
function buildInitialState(
  initial?: Partial<AccountResponse>,
  initialContactIds?: string[],
): AccountFormValues {
  return {
    name: initial?.name ?? '',
    industry: initial?.industry ?? '',
    website: initial?.website ?? '',
    employee_range: initial?.employee_range ?? '',
    revenue_range: initial?.revenue_range ?? '',
    owner_id: initial?.owner_id ?? '',
    contact_ids: initialContactIds ?? [],
  };
}

/**
 * Form for creating or editing an account.
 */
export default function AccountForm({
  initialValues,
  initialContactIds,
  users,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
  error,
}: AccountFormProps) {
  const { t } = useTranslation();

  const [formData, setFormData] = useState<AccountFormValues>(() =>
    buildInitialState(initialValues, initialContactIds),
  );

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const { name, value } = event.target;
    setFormData((previous) => ({ ...previous, [name]: value }));
  };

  const handleSelectChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const { name, value } = event.target;
    setFormData((previous) => ({ ...previous, [name]: value }));
  };

  /**
   * Updates the selected contact IDs in form state.
   *
   * @param ids - New array of selected contact UUIDs
   */
  const handleContactIdsChange = (ids: string[]): void => {
    setFormData((previous) => ({ ...previous, contact_ids: ids }));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSubmit(formData);
  };

  const resolvedSubmitLabel = submitLabel ?? t('accounts.save');

  return (
    <form onSubmit={handleSubmit} data-testid="account-form">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <Input
          id="account-name"
          data-testid="account-name-input"
          name="name"
          type="text"
          required
          label={t('accounts.nameLabel')}
          placeholder={t('accounts.namePlaceholder')}
          value={formData.name}
          onChange={handleChange}
          disabled={isSubmitting}
        />

        <Input
          id="account-industry"
          data-testid="account-industry"
          name="industry"
          type="text"
          label={t('accounts.industryLabel')}
          placeholder={t('accounts.industryPlaceholder')}
          value={formData.industry}
          onChange={handleChange}
          disabled={isSubmitting}
        />

        <Input
          id="account-website"
          data-testid="account-website"
          name="website"
          type="text"
          label={t('accounts.websiteLabel')}
          placeholder={t('accounts.websitePlaceholder')}
          value={formData.website}
          onChange={handleChange}
          disabled={isSubmitting}
        />

        <Input
          id="account-employee-range"
          data-testid="account-employee-range"
          name="employee_range"
          type="text"
          label={t('accounts.employeeRangeLabel')}
          placeholder={t('accounts.employeeRangePlaceholder')}
          value={formData.employee_range}
          onChange={handleChange}
          disabled={isSubmitting}
        />

        <Input
          id="account-revenue-range"
          data-testid="account-revenue-range"
          name="revenue_range"
          type="text"
          label={t('accounts.revenueRangeLabel')}
          placeholder={t('accounts.revenueRangePlaceholder')}
          value={formData.revenue_range}
          onChange={handleChange}
          disabled={isSubmitting}
        />

        {users !== undefined && (
          <OwnerSelect
            id="account-owner"
            data-testid="account-owner-select"
            name="owner_id"
            label={t('accounts.ownerLabel')}
            users={users}
            unknownLabel={t('accounts.ownerUnknown')}
            value={formData.owner_id}
            onChange={handleSelectChange}
            disabled={isSubmitting}
          />
        )}
      </div>

      {/* Contact selector spans full width */}
      <div className="mb-4">
        <ContactSelector
          id="account-contact-selector"
          selectedIds={formData.contact_ids}
          onChange={handleContactIdsChange}
          disabled={isSubmitting}
        />
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" data-testid="account-form-submit" disabled={isSubmitting}>
          {isSubmitting ? t('accounts.saving') : resolvedSubmitLabel}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            data-testid="account-form-cancel"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {t('accounts.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}
