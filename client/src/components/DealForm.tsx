/**
 * DealForm component.
 * Reusable form for creating and editing deal records.
 * Used by DealsPage (create) and DealDetailPage (edit).
 */

import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/Input.js';
import { Select } from '@/components/ui/Select.js';
import { Button } from '@/components/ui/Button.js';
import OwnerSelect from '@/components/OwnerSelect.js';
import { PIPELINE_STAGES } from '@shared/schemas/dealSchema.js';
import { SUPPORTED_CURRENCIES } from '@shared/schemas/settingsSchema.js';
import { getStageDisplayName } from '@/utils/pipelineStageI18nKey.js';
import { usePipelineStages } from '@/hooks/usePipelineStages.js';
import { getDefaultCurrency, DEFAULT_CURRENCY_QUERY_KEY } from '@/api/settings.js';
import type { DealResponse } from '@shared/schemas/dealSchema.js';
import type { AccountResponse } from '@shared/schemas/accountSchema.js';
import type { ActiveUser } from '@/api/users.js';

/** Form field values managed by this component */
export interface DealFormValues {
  name: string;
  stage: string;
  value: string;
  /** ISO 4217 currency code for the deal value (MINCRM-189) */
  currency: string;
  close_date: string;
  account_id: string;
  /** UUID of the owner; populated only when users prop is provided (edit mode) */
  owner_id: string;
  /**
   * Probability override string (empty string = no override, use stage default).
   * When non-empty, must parse to an integer 0–100. (MINCRM-179)
   */
  probability: string;
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
   * opening the close deal modal. The current form values are passed so the
   * parent can persist all in-progress edits alongside the close fields.
   * If omitted, terminal stages update formData as any other stage would
   * (backward-compatible create flow).
   */
  onCloseRequested?: (stage: string, formValues: DealFormValues) => void;
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
  /** Optional ref to the element that triggered the form open; focus returns here on cancel/success */
  triggerRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Returns the initial state for the form, optionally seeded from an existing deal.
 * When the deal has a probability override, it is pre-populated in the probability field.
 * When not overridden, the field is left empty (stage default will display as a hint).
 *
 * @param initial - Optional existing deal values to pre-populate
 */
function buildInitialState(
  initial?: Partial<DealResponse>,
  defaultCurrency = 'USD',
): DealFormValues {
  return {
    name: initial?.name ?? '',
    stage: initial?.stage ?? PIPELINE_STAGES[0], // fallback; overridden once live stages load
    value: initial?.value ?? '',
    currency: initial?.currency ?? defaultCurrency,
    close_date: initial?.close_date ?? '',
    account_id: initial?.account_id ?? '',
    owner_id: initial?.owner_id ?? '',
    // Pre-populate only when overridden; empty string means "use stage default" (MINCRM-179)
    probability: initial?.probability_is_overridden ? String(initial.effective_probability) : '',
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
  triggerRef,
}: DealFormProps) {
  const { t } = useTranslation();
  const { stageNames, terminalStageNames, stages } = usePipelineStages();
  const firstInputRef = useRef<HTMLInputElement>(null);

  const { data: defaultCurrencyData } = useQuery({
    queryKey: DEFAULT_CURRENCY_QUERY_KEY,
    queryFn: getDefaultCurrency,
    staleTime: 5 * 60 * 1000,
  });
  const defaultCurrency = defaultCurrencyData?.currency ?? 'USD';

  const [formData, setFormData] = useState<DealFormValues>(() =>
    buildInitialState(initialValues, 'USD'),
  );

  // True once the user explicitly picks a currency from the selector (or when editing
  // an existing deal that already has a currency set). Until touched, we display the
  // system default from the async query rather than the hardcoded 'USD' placeholder
  // that useState was initialised with.
  const [currencyTouched, setCurrencyTouched] = useState(!!initialValues?.currency);

  // For new deals, display the system default currency until the user explicitly
  // selects a different one. For existing deals, always trust the form state.
  const activeCurrency = currencyTouched ? formData.currency : defaultCurrency;
  const [probabilityError, setProbabilityError] = useState<string | null>(null);

  // Move focus to the first input when the form mounts (WCAG 2.4.3)
  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  /** Returns focus to the trigger element when the form closes. */
  function returnFocus(): void {
    triggerRef?.current?.focus();
  }

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const { name, value } = event.target;
    if (name === 'probability') setProbabilityError(null);
    setFormData((previous) => ({ ...previous, [name]: value }));
  };

  const handleSelectChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const { name, value } = event.target;
    if (name === 'currency') setCurrencyTouched(true);
    setFormData((previous) => ({ ...previous, [name]: value }));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    // Reject decimal probability input before it reaches parseInt (MINCRM-179)
    if (formData.probability !== '') {
      const raw = Number(formData.probability);
      if (!Number.isInteger(raw) || raw < 0 || raw > 100) {
        setProbabilityError(t('deals.probabilityInvalid'));
        return;
      }
    }
    setProbabilityError(null);
    onSubmit({ ...formData, currency: activeCurrency });
  };

  const resolvedSubmitLabel = submitLabel ?? t('deals.save');

  return (
    <form onSubmit={handleSubmit} data-testid="deal-form">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <Input
          ref={firstInputRef}
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
            const selected = e.target.value;
            if (onCloseRequested && terminalStageNames.includes(selected)) {
              onCloseRequested(selected, formData);
            } else {
              handleSelectChange(e);
            }
          }}
          disabled={isSubmitting}
          required
        >
          {stageNames.map((stage) => (
            <option key={stage} value={stage}>
              {getStageDisplayName(stage, t)}
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

        <Select
          id="deal-currency"
          data-testid="deal-currency-select"
          name="currency"
          label={t('deals.currencyLabel')}
          value={activeCurrency}
          onChange={handleSelectChange}
          disabled={isSubmitting}
        >
          {SUPPORTED_CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </Select>

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

        {/* Probability override field — empty = inherit from stage default (MINCRM-179) */}
        <div className="flex flex-col gap-1">
          <Input
            id="deal-probability"
            data-testid="deal-probability-input"
            name="probability"
            type="number"
            min="0"
            max="100"
            step="1"
            label={t('deals.probabilityLabel')}
            placeholder={String(stages.find((s) => s.name === formData.stage)?.probability ?? '')}
            value={formData.probability}
            onChange={handleChange}
            disabled={isSubmitting}
          />
          {formData.probability !== '' && (
            <button
              type="button"
              data-testid="deal-probability-clear"
              className="text-xs text-indigo-600 hover:underline self-start"
              onClick={() => setFormData((prev) => ({ ...prev, probability: '' }))}
              disabled={isSubmitting}
            >
              {t('deals.probabilityClear')}
            </button>
          )}
          {probabilityError ? (
            <p className="text-xs text-red-600" data-testid="deal-probability-error" role="alert">
              {probabilityError}
            </p>
          ) : (
            <p className="text-xs text-gray-400">
              {formData.probability !== ''
                ? t('deals.probabilityOverriddenHint')
                : t('deals.probabilityDefaultHint', {
                    pct: stages.find((s) => s.name === formData.stage)?.probability ?? 0,
                  })}
            </p>
          )}
        </div>

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
            onClick={() => {
              returnFocus();
              onCancel();
            }}
            disabled={isSubmitting}
          >
            {t('deals.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}
