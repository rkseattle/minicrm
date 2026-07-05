/**
 * ContactForm component.
 * Reusable form for creating and editing contact records.
 * Used by ContactsPage (create) and ContactDetailPage (edit).
 */

import { useState, useEffect, useRef, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input.js';
import { Select } from '@/components/ui/Select.js';
import { Button } from '@/components/ui/Button.js';
import OwnerSelect from '@/components/OwnerSelect.js';
import ContactEnrichmentModal from '@/components/ContactEnrichmentModal.js';
import { useFeatureFlag } from '@/hooks/useFeatureFlag.js';
import type { ContactResponse } from '@shared/schemas/contactSchema.js';
import type { ActiveUser } from '@/api/users.js';
import type { ContactEnrichmentFields } from '@shared/schemas/contactEnrichmentSchema.js';

/** Minimal account option used to populate the account selector */
export interface AccountOption {
  id: string;
  name: string;
}

/** Form field values managed by this component */
export interface ContactFormValues {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  title: string;
  department: string;
  /** UUID of the linked account, or empty string for no account */
  account_id: string;
  /** UUID of the owner; populated only when users prop is provided (edit mode) */
  owner_id: string;
  // Social profile URLs (MINCRM-190)
  linkedin_url: string;
  twitter_x_url: string;
  other_url: string;
}

interface ContactFormProps {
  /** Pre-populate fields when editing an existing contact */
  initialValues?: Partial<ContactResponse>;
  /** List of accounts available for linking */
  accounts?: AccountOption[];
  /**
   * When provided, an owner selector is rendered.
   * Omit on the create form (ownership defaults to the creating user server-side).
   */
  users?: ActiveUser[];
  /** Called with the current field values when the form is submitted */
  onSubmit: (values: ContactFormValues) => void;
  /** Called when the Cancel button is clicked */
  onCancel?: () => void;
  /** Disables inputs and shows a loading state on the submit button */
  isSubmitting?: boolean;
  /** Text for the primary submit button */
  submitLabel?: string;
  /** Error message to display below the form */
  error?: string;
  /** When true, highlights the email field with a warning border (e.g. duplicate detected) */
  emailWarning?: boolean;
  /** Optional ref forwarded to the underlying <form> element for programmatic submit */
  formRef?: React.RefObject<HTMLFormElement | null>;
  /** Optional ref to the element that triggered the form open; focus returns here on cancel/success */
  triggerRef?: React.RefObject<HTMLElement | null>;
  /** When true, the built-in Save/Cancel buttons are not rendered (caller manages them externally) */
  hideActions?: boolean;
}

/**
 * Returns the initial state for the form, optionally seeded from an existing contact.
 *
 * @param initial - Optional existing contact values to pre-populate
 */
function buildInitialState(initial?: Partial<ContactResponse>): ContactFormValues {
  return {
    first_name: initial?.first_name ?? '',
    last_name: initial?.last_name ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    title: initial?.title ?? '',
    department: initial?.department ?? '',
    account_id: initial?.account_id ?? '',
    owner_id: initial?.owner_id ?? '',
    linkedin_url: initial?.linkedin_url ?? '',
    twitter_x_url: initial?.twitter_x_url ?? '',
    other_url: initial?.other_url ?? '',
  };
}

/**
 * Form for creating or editing a contact.
 */
export default function ContactForm({
  initialValues,
  accounts = [],
  users,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
  error,
  emailWarning = false,
  formRef,
  triggerRef,
  hideActions = false,
}: ContactFormProps) {
  const { t } = useTranslation();
  const firstInputRef = useRef<HTMLInputElement>(null);
  const socialPanelId = useId();
  const [socialOpen, setSocialOpen] = useState<boolean>(
    () =>
      !!(initialValues?.linkedin_url || initialValues?.twitter_x_url || initialValues?.other_url),
  );
  const { enabled: enrichmentEnabled } = useFeatureFlag('ai_contact_enrichment');
  const [isEnriching, setIsEnriching] = useState(false);

  const [formData, setFormData] = useState<ContactFormValues>(() =>
    buildInitialState(initialValues),
  );

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
    setFormData((previous) => ({ ...previous, [name]: value }));
  };

  const handleSelectChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const { name, value } = event.target;
    setFormData((previous) => ({ ...previous, [name]: value }));
  };

  /** Prepends https:// on blur if the field has a value but no protocol yet. */
  const handleUrlBlur = (event: React.FocusEvent<HTMLInputElement>): void => {
    const { name, value } = event.target;
    const trimmed = value.trim();
    if (trimmed && !trimmed.match(/^https?:\/\//i)) {
      setFormData((previous) => ({ ...previous, [name]: `https://${trimmed}` }));
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSubmit(formData);
  };

  /** Applies AI-extracted fields as a diff overlay: only non-null fields are pre-filled. */
  const handleApplyEnrichment = (
    fields: ContactEnrichmentFields,
    matchedAccountId: string | null,
  ): void => {
    setFormData((previous) => ({
      ...previous,
      first_name: fields.first_name ?? previous.first_name,
      last_name: fields.last_name ?? previous.last_name,
      title: fields.title ?? previous.title,
      email: fields.email ?? previous.email,
      phone: fields.phone ?? previous.phone,
      linkedin_url: fields.linkedin_url ?? previous.linkedin_url,
      account_id: matchedAccountId ?? previous.account_id,
    }));
    if (fields.linkedin_url) setSocialOpen(true);
    setIsEnriching(false);
  };

  const resolvedSubmitLabel = submitLabel ?? t('contacts.save');

  return (
    <form ref={formRef} onSubmit={handleSubmit} data-testid="contact-form">
      {enrichmentEnabled && (
        <div className="mb-4 flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="contact-enrich-from-text-button"
            onClick={() => setIsEnriching(true)}
          >
            {t('contactEnrichment.action')}
          </Button>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <Input
          ref={firstInputRef}
          id="contact-first-name"
          data-testid="contact-first-name"
          name="first_name"
          type="text"
          required
          label={t('contacts.firstNameLabel')}
          placeholder={t('contacts.firstNamePlaceholder')}
          value={formData.first_name}
          onChange={handleChange}
          disabled={isSubmitting}
        />

        <Input
          id="contact-last-name"
          data-testid="contact-last-name"
          name="last_name"
          type="text"
          required
          label={t('contacts.lastNameLabel')}
          placeholder={t('contacts.lastNamePlaceholder')}
          value={formData.last_name}
          onChange={handleChange}
          disabled={isSubmitting}
        />

        <Input
          id="contact-email"
          data-testid="contact-email"
          name="email"
          type="email"
          required
          label={t('contacts.emailLabel')}
          value={formData.email}
          onChange={handleChange}
          disabled={isSubmitting}
          warning={emailWarning}
        />

        <Input
          id="contact-phone"
          data-testid="contact-phone"
          name="phone"
          type="tel"
          label={t('contacts.phoneLabel')}
          placeholder={t('contacts.phonePlaceholder')}
          value={formData.phone}
          onChange={handleChange}
          disabled={isSubmitting}
        />

        <Input
          id="contact-title"
          data-testid="contact-title"
          name="title"
          type="text"
          label={t('contacts.titleLabel')}
          placeholder={t('contacts.titlePlaceholder')}
          value={formData.title}
          onChange={handleChange}
          disabled={isSubmitting}
        />

        <Input
          id="contact-department"
          data-testid="contact-department"
          name="department"
          type="text"
          label={t('contacts.departmentLabel')}
          placeholder={t('contacts.departmentPlaceholder')}
          value={formData.department}
          onChange={handleChange}
          disabled={isSubmitting}
        />

        <Select
          id="contact-account"
          data-testid="contact-account-select"
          name="account_id"
          label={t('contacts.accountLabel')}
          value={formData.account_id}
          onChange={handleSelectChange}
          disabled={isSubmitting}
        >
          <option value="">{t('contacts.accountNone')}</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>

        {users !== undefined && (
          <OwnerSelect
            id="contact-owner"
            data-testid="contact-owner-select"
            name="owner_id"
            label={t('contacts.ownerLabel')}
            users={users}
            unknownLabel={t('contacts.ownerUnknown')}
            value={formData.owner_id}
            onChange={handleSelectChange}
            disabled={isSubmitting}
          />
        )}
      </div>

      {/* Social Profiles section — collapsible (MINCRM-190) */}
      <div className="mb-4 border border-gray-200 rounded-lg overflow-hidden">
        <button
          type="button"
          data-testid="contact-social-toggle"
          aria-expanded={socialOpen}
          aria-controls={socialPanelId}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100"
          onClick={() => setSocialOpen((open) => !open)}
          disabled={isSubmitting}
        >
          {t('contacts.socialSection')}
          <svg
            aria-hidden="true"
            className={`w-4 h-4 transition-transform ${socialOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {socialOpen && (
          <div id={socialPanelId} className="p-4 grid grid-cols-1 gap-4">
            <Input
              id="contact-linkedin-url"
              data-testid="contact-linkedin-url"
              name="linkedin_url"
              type="url"
              label={t('contacts.linkedinUrlLabel')}
              placeholder="https://linkedin.com/in/jane-smith"
              value={formData.linkedin_url}
              onChange={handleChange}
              onBlur={handleUrlBlur}
              disabled={isSubmitting}
            />
            <Input
              id="contact-twitter-x-url"
              data-testid="contact-twitter-x-url"
              name="twitter_x_url"
              type="url"
              label={t('contacts.twitterXUrlLabel')}
              placeholder="https://x.com/janesmith"
              value={formData.twitter_x_url}
              onChange={handleChange}
              onBlur={handleUrlBlur}
              disabled={isSubmitting}
            />
            <Input
              id="contact-other-url"
              data-testid="contact-other-url"
              name="other_url"
              type="url"
              label={t('contacts.otherUrlLabel')}
              placeholder="https://example.com/profile"
              value={formData.other_url}
              onChange={handleChange}
              onBlur={handleUrlBlur}
              disabled={isSubmitting}
            />
          </div>
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

      {!hideActions && (
        <div className="flex items-center gap-3">
          <Button type="submit" data-testid="contact-form-submit" disabled={isSubmitting}>
            {isSubmitting ? t('contacts.saving') : resolvedSubmitLabel}
          </Button>
          {onCancel && (
            <Button
              type="button"
              variant="ghost"
              data-testid="contact-form-cancel"
              onClick={() => {
                returnFocus();
                onCancel();
              }}
              disabled={isSubmitting}
            >
              {t('contacts.cancel')}
            </Button>
          )}
        </div>
      )}

      {enrichmentEnabled && (
        <ContactEnrichmentModal
          isOpen={isEnriching}
          onApply={handleApplyEnrichment}
          onCancel={() => setIsEnriching(false)}
        />
      )}
    </form>
  );
}
