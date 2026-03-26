/**
 * ContactForm component.
 * Reusable form for creating and editing contact records.
 * Used by ContactsPage (create) and ContactDetailPage (edit).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input.js';
import { Button } from '@/components/ui/Button.js';
import type { ContactResponse } from '@shared/schemas/contactSchema.js';

/** Form field values managed by this component */
export interface ContactFormValues {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  title: string;
  department: string;
}

interface ContactFormProps {
  /** Pre-populate fields when editing an existing contact */
  initialValues?: Partial<ContactResponse>;
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
  };
}

/**
 * Form for creating or editing a contact.
 */
export default function ContactForm({
  initialValues,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
  error,
}: ContactFormProps) {
  const { t } = useTranslation();

  const [formData, setFormData] = useState<ContactFormValues>(() =>
    buildInitialState(initialValues),
  );

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const { name, value } = event.target;
    setFormData((previous) => ({ ...previous, [name]: value }));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSubmit(formData);
  };

  const resolvedSubmitLabel = submitLabel ?? t('contacts.save');

  return (
    <form onSubmit={handleSubmit} data-testid="contact-form">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <Input
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
        <Button type="submit" data-testid="contact-form-submit" disabled={isSubmitting}>
          {isSubmitting ? t('contacts.saving') : resolvedSubmitLabel}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            data-testid="contact-form-cancel"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {t('contacts.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}
