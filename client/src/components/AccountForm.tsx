/**
 * AccountForm component.
 * Reusable form for creating and editing account records.
 * Used by AccountsPage (create) and AccountDetailPage (edit).
 */

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input.js';
import { Select } from '@/components/ui/Select.js';
import { Button } from '@/components/ui/Button.js';
import OwnerSelect from '@/components/OwnerSelect.js';
import ContactSelector from '@/components/ContactSelector.js';
import type { AccountResponse, AccountType } from '@shared/schemas/accountSchema.js';
import { ACCOUNT_TYPE_VALUES } from '@shared/schemas/accountSchema.js';
import type { ActiveUser } from '@/api/users.js';
import { searchAccountsByName } from '@/api/accounts.js';

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
  /** Account classification type */
  account_type: AccountType | '';
  /** UUID of the parent account, or empty string for no parent */
  parent_account_id: string;
}

interface AccountFormProps {
  /** Pre-populate fields when editing an existing account */
  initialValues?: Partial<AccountResponse>;
  /** Pre-populate the contact selector with already-linked contact UUIDs */
  initialContactIds?: string[];
  /**
   * UUID of this account (used to exclude it from parent search to prevent self-parenting).
   * Omit on create form.
   */
  accountId?: string;
  /**
   * Display name of the currently selected parent account.
   * Populated by AccountDetailPage when editing an account that already has a parent.
   */
  initialParentAccountName?: string;
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
  /** Optional ref to the element that triggered the form open; focus returns here on cancel/success */
  triggerRef?: React.RefObject<HTMLElement | null>;
  /** Optional ref forwarded to the underlying <form> element for programmatic submit */
  formRef?: React.RefObject<HTMLFormElement | null>;
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
    account_type: initial?.account_type ?? '',
    parent_account_id: initial?.parent_account_id ?? '',
  };
}

/**
 * Form for creating or editing an account.
 */
export default function AccountForm({
  initialValues,
  initialContactIds,
  accountId,
  users,
  initialParentAccountName,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
  error,
  triggerRef,
  formRef,
}: AccountFormProps) {
  const { t } = useTranslation();
  const firstInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState<AccountFormValues>(() =>
    buildInitialState(initialValues, initialContactIds),
  );

  // Parent account type-ahead state
  const [parentQuery, setParentQuery] = useState('');
  const [parentSuggestions, setParentSuggestions] = useState<AccountResponse[]>([]);
  const [parentName, setParentName] = useState(initialParentAccountName ?? '');

  // Move focus to the first input when the form mounts (WCAG 2.4.3)
  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  // Search parent accounts when query changes
  useEffect(() => {
    const trimmed = parentQuery.trim();
    if (trimmed.length < 2) return;
    let cancelled = false;
    searchAccountsByName({ q: trimmed, exclude: accountId })
      .then((result) => {
        if (!cancelled) setParentSuggestions(result.accounts);
      })
      .catch(() => {
        if (!cancelled) setParentSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [parentQuery, accountId]);

  /** Returns focus to the trigger element when the form closes. */
  function returnFocus(): void {
    triggerRef?.current?.focus();
  }

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
    <form ref={formRef} onSubmit={handleSubmit} data-testid="account-form">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <Input
          ref={firstInputRef}
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

        {/* Account Type dropdown */}
        <Select
          id="account-type"
          data-testid="account-type-select"
          name="account_type"
          label={t('accounts.accountTypeLabel')}
          value={formData.account_type}
          onChange={handleSelectChange}
          disabled={isSubmitting}
        >
          <option value="">{t('accounts.accountTypeNone')}</option>
          {ACCOUNT_TYPE_VALUES.map((type) => (
            <option key={type} value={type}>
              {t(`accounts.accountType.${type}`)}
            </option>
          ))}
        </Select>

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

      {/* Parent Account type-ahead */}
      <div className="mb-4 relative">
        <label
          htmlFor="account-parent-search"
          className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1"
        >
          {t('accounts.parentAccountLabel')}
        </label>
        {formData.parent_account_id ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-900" data-testid="account-parent-selected-name">
              {parentName || t('accounts.parentAccountSelected')}
            </span>
            <button
              type="button"
              data-testid="account-parent-clear"
              className="text-xs text-red-500 hover:underline"
              onClick={() => {
                setFormData((prev) => ({ ...prev, parent_account_id: '' }));
                setParentName('');
                setParentQuery('');
              }}
              disabled={isSubmitting}
            >
              {t('accounts.parentAccountClear')}
            </button>
          </div>
        ) : (
          <>
            <Input
              id="account-parent-search"
              data-testid="account-parent-search"
              name="parent_account_search"
              type="text"
              placeholder={t('accounts.parentAccountPlaceholder')}
              value={parentQuery}
              onChange={(e) => setParentQuery(e.target.value)}
              disabled={isSubmitting}
            />
            {parentQuery.trim().length >= 2 && parentSuggestions.length > 0 && (
              <ul
                data-testid="account-parent-suggestions"
                className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto"
              >
                {parentSuggestions.map((suggestion) => (
                  <li key={suggestion.id}>
                    <button
                      type="button"
                      data-testid={`account-parent-option-${suggestion.id}`}
                      className="w-full text-start px-4 py-2 text-sm text-gray-900 hover:bg-gray-50"
                      onClick={() => {
                        setFormData((prev) => ({ ...prev, parent_account_id: suggestion.id }));
                        setParentName(suggestion.name);
                        setParentQuery('');
                        setParentSuggestions([]);
                      }}
                    >
                      {suggestion.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
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
            onClick={() => {
              returnFocus();
              onCancel();
            }}
            disabled={isSubmitting}
          >
            {t('accounts.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}
