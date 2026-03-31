/**
 * DealForm component.
 * Reusable form for creating and editing deal records.
 * Used by DealsPage (create) and DealDetailPage (edit).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input.js';
import { Select } from '@/components/ui/Select.js';
import { Button } from '@/components/ui/Button.js';
import OwnerSelect from '@/components/OwnerSelect.js';
import { PIPELINE_STAGES } from '@shared/schemas/dealSchema.js';
import { PIPELINE_STAGE_I18N_KEY } from '@/utils/pipelineStageI18nKey.js';
import { CLOSED_STAGES } from '@/components/CloseDealModal.js';
import type { DealResponse, PipelineStage } from '@shared/schemas/dealSchema.js';
import type { AccountResponse } from '@shared/schemas/accountSchema.js';
import type { ActiveUser } from '@/api/users.js';

/** Form field values managed by this component */
export interface DealFormValues {
  name: string;
  stage: string;
  value: string;
  close_date: string;
  account_id: string;
  /** UUID of the owner; populated only when users prop is provided (edit mode) */
  owner_id: string;
}

interface DealFormProps {
  /** Pre-populate fields when editing an existing deal */
  initialValues?: Partial<DealResponse>;
  /**
   * When provided, an account selector is rendered.
   * Omit on the create form if not needed.
   */
  accounts?: AccountResponse[];
  /**
   * When true, the account selector requires a selection (no empty option rendered).
   * Defaults to false.
   */
  accountRequired?: boolean;
  /**
   * When provided, an owner selector is rendered.
   * Omit on the create form (ownership defaults to the creating user server-side).
   */
  users?: ActiveUser[];
  /**
   * When provided, fires instead of updating formData.stage when the user picks
   * a terminal stage (Closed Won / Closed Lost). The parent is responsible for
   * opening the close deal modal. If omitted, terminal stages update formData as
   * any other stage would (backward-compatible create flow).
   */
  onCloseRequested?: (stage: 'Closed Won' | 'Closed Lost') => void;
  /** Called with the current field values when the form is submitted */
  onSubmit: (values: DealFormValues) => void;
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
 * Returns the initial state for the form, optionally seeded from an existing deal.
 *
 * @param initial - Optional existing deal values to pre-populate
 */
function buildInitialState(initial?: Partial<DealResponse>): DealFormValues {
  return {
    name: initial?.name ?? '',
    stage: initial?.stage ?? PIPELINE_STAGES[0],
    value: initial?.value ?? '',
    close_date: initial?.close_date ?? '',
    account_id: initial?.account_id ?? '',
    owner_id: initial?.owner_id ?? '',
  };
}

/**
 * Form for creating or editing a deal.
 */
export default function DealForm({
  initialValues,
  accounts,
  accountRequired = false,
  users,
  onCloseRequested,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
  error,
}: DealFormProps) {
  const { t } = useTranslation();

  const [formData, setFormData] = useState<DealFormValues>(() => buildInitialState(initialValues));

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
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

  const resolvedSubmitLabel = submitLabel ?? t('deals.save');

  return (
    <form onSubmit={handleSubmit} data-testid="deal-form">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <Input
          id="deal-name"
          data-testid="deal-name-input"
          name="name"
          type="text"
          required
          label={t('deals.nameLabel')}
          placeholder={t('deals.namePlaceholder')}
          value={formData.name}
          onChange={handleChange}
          disabled={isSubmitting}
        />

        <Select
          id="deal-stage"
          data-testid="deal-stage-select"
          name="stage"
          label={t('deals.stageLabel')}
          value={formData.stage}
          onChange={(e) => {
            const selected = e.target.value as PipelineStage;
            if (onCloseRequested && (CLOSED_STAGES as PipelineStage[]).includes(selected)) {
              onCloseRequested(selected as 'Closed Won' | 'Closed Lost');
            } else {
              handleSelectChange(e);
            }
          }}
          disabled={isSubmitting}
          required
        >
          {PIPELINE_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {t(`pipeline.stages.${PIPELINE_STAGE_I18N_KEY[stage]}`)}
            </option>
          ))}
        </Select>

        <Input
          id="deal-value"
          data-testid="deal-value-input"
          name="value"
          type="number"
          min="0"
          step="0.01"
          label={t('deals.valueLabel')}
          placeholder={t('deals.valuePlaceholder')}
          value={formData.value}
          onChange={handleChange}
          disabled={isSubmitting}
        />

        <Input
          id="deal-close-date"
          data-testid="deal-close-date-input"
          name="close_date"
          type="date"
          label={t('deals.closeDateLabel')}
          value={formData.close_date}
          onChange={handleChange}
          disabled={isSubmitting}
        />

        {accounts !== undefined && (
          <Select
            id="deal-account"
            data-testid="deal-account-select"
            name="account_id"
            label={t('deals.accountLabel')}
            value={formData.account_id}
            onChange={handleSelectChange}
            disabled={isSubmitting}
            required={accountRequired}
          >
            {!accountRequired && <option value="">{t('deals.accountNone')}</option>}
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        )}

        {users !== undefined && (
          <OwnerSelect
            id="deal-owner"
            data-testid="deal-owner-select"
            name="owner_id"
            label={t('deals.ownerLabel')}
            users={users}
            unknownLabel={t('deals.ownerUnknown')}
            value={formData.owner_id}
            onChange={handleSelectChange}
            disabled={isSubmitting}
          />
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
        <Button type="submit" data-testid="deal-form-submit" disabled={isSubmitting}>
          {isSubmitting ? t('deals.saving') : resolvedSubmitLabel}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            data-testid="deal-form-cancel"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {t('deals.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}
