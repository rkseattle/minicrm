/**
 * Tests for the LeadForm component. (MINCRM-198)
 * Covers: field rendering, required fields, lead source dropdown, owner selector conditional,
 * initialValues population, onSubmit values, cancel button, isSubmitting state.
 */

import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import LeadForm from './LeadForm.js';
import { renderWithProviders } from '../test/renderWithProviders.js';

// Plain function — not a spy, so call counts don't accumulate across tests
const noop = () => {};

const ACTIVE_USERS = [
  { id: 'u-1', name: 'Alice Smith' },
  { id: 'u-2', name: 'Bob Jones' },
];

describe('LeadForm', () => {
  describe('field rendering', () => {
    it('renders all core fields', () => {
      renderWithProviders(<LeadForm onSubmit={noop} activeUsers={[]} isAdmin={false} />);
      expect(screen.getByTestId('lead-first-name')).toBeInTheDocument();
      expect(screen.getByTestId('lead-last-name')).toBeInTheDocument();
      expect(screen.getByTestId('lead-email')).toBeInTheDocument();
      expect(screen.getByTestId('lead-phone')).toBeInTheDocument();
      expect(screen.getByTestId('lead-company-name')).toBeInTheDocument();
      expect(screen.getByTestId('lead-source-select')).toBeInTheDocument();
      expect(screen.getByTestId('lead-notes')).toBeInTheDocument();
    });

    it('does not render the owner selector when isAdmin is false', () => {
      renderWithProviders(<LeadForm onSubmit={noop} activeUsers={ACTIVE_USERS} isAdmin={false} />);
      expect(screen.queryByTestId('lead-owner-select')).not.toBeInTheDocument();
    });

    it('renders the owner selector when isAdmin is true', () => {
      renderWithProviders(<LeadForm onSubmit={noop} activeUsers={ACTIVE_USERS} isAdmin />);
      expect(screen.getByTestId('lead-owner-select')).toBeInTheDocument();
    });

    it('renders all lead source options in the dropdown', () => {
      renderWithProviders(<LeadForm onSubmit={noop} activeUsers={[]} isAdmin={false} />);
      const select = screen.getByTestId<HTMLSelectElement>('lead-source-select');
      const values = Array.from(select.options).map((o) => o.value);
      expect(values).toContain('');
      expect(values).toContain('Web');
      expect(values).toContain('Referral');
      expect(values).toContain('Trade Show');
      expect(values).toContain('Cold Outreach');
      expect(values).toContain('Other');
    });
  });

  describe('required fields', () => {
    it('first_name is required', () => {
      renderWithProviders(<LeadForm onSubmit={noop} activeUsers={[]} isAdmin={false} />);
      expect(screen.getByTestId<HTMLInputElement>('lead-first-name')).toBeRequired();
    });

    it('email is required', () => {
      renderWithProviders(<LeadForm onSubmit={noop} activeUsers={[]} isAdmin={false} />);
      expect(screen.getByTestId<HTMLInputElement>('lead-email')).toBeRequired();
    });

    it('last_name is not required', () => {
      renderWithProviders(<LeadForm onSubmit={noop} activeUsers={[]} isAdmin={false} />);
      expect(screen.getByTestId<HTMLInputElement>('lead-last-name')).not.toBeRequired();
    });

    it('does not call onSubmit when required fields are empty (user.click respects HTML5 required)', async () => {
      const handleSubmit = vi.fn();
      const user = userEvent.setup();
      renderWithProviders(<LeadForm onSubmit={handleSubmit} activeUsers={[]} isAdmin={false} />);
      // Click the submit button — user-event triggers HTML5 constraint validation
      await user.click(screen.getByTestId('lead-form-submit'));
      expect(handleSubmit).not.toHaveBeenCalled();
    });
  });

  describe('email format validation', () => {
    it('email input has type="email" for browser format enforcement', () => {
      renderWithProviders(<LeadForm onSubmit={noop} activeUsers={[]} isAdmin={false} />);
      expect(screen.getByTestId('lead-email')).toHaveAttribute('type', 'email');
    });
  });

  describe('initialValues population', () => {
    it('pre-populates all fields from initialValues', () => {
      renderWithProviders(
        <LeadForm
          onSubmit={noop}
          activeUsers={[]}
          isAdmin={false}
          initialValues={{
            first_name: 'Carol',
            last_name: 'White',
            email: 'carol@example.com',
            phone: '555-9999',
            company_name: 'Example Corp',
            lead_source: 'Web',
            notes: 'Met at conference',
          }}
        />,
      );
      expect(screen.getByTestId<HTMLInputElement>('lead-first-name').value).toBe('Carol');
      expect(screen.getByTestId<HTMLInputElement>('lead-last-name').value).toBe('White');
      expect(screen.getByTestId<HTMLInputElement>('lead-email').value).toBe('carol@example.com');
      expect(screen.getByTestId<HTMLInputElement>('lead-phone').value).toBe('555-9999');
      expect(screen.getByTestId<HTMLInputElement>('lead-company-name').value).toBe('Example Corp');
      expect(screen.getByTestId<HTMLSelectElement>('lead-source-select').value).toBe('Web');
      expect(screen.getByTestId<HTMLTextAreaElement>('lead-notes').value).toBe('Met at conference');
    });
  });

  describe('onSubmit', () => {
    it('calls onSubmit with the entered form values', () => {
      const handleSubmit = vi.fn();
      renderWithProviders(<LeadForm onSubmit={handleSubmit} activeUsers={[]} isAdmin={false} />);

      fireEvent.change(screen.getByTestId('lead-first-name'), {
        target: { name: 'first_name', value: 'Jane' },
      });
      fireEvent.change(screen.getByTestId('lead-email'), {
        target: { name: 'email', value: 'jane@example.com' },
      });
      fireEvent.change(screen.getByTestId('lead-source-select'), {
        target: { name: 'lead_source', value: 'Referral' },
      });
      fireEvent.change(screen.getByTestId('lead-notes'), {
        target: { name: 'notes', value: 'Test note' },
      });

      fireEvent.submit(screen.getByTestId('lead-form'));

      expect(handleSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          first_name: 'Jane',
          email: 'jane@example.com',
          lead_source: 'Referral',
          notes: 'Test note',
        }),
      );
    });
  });

  describe('cancel button', () => {
    it('calls onCancel when the Cancel button is clicked', async () => {
      const handleCancel = vi.fn();
      const user = userEvent.setup();
      renderWithProviders(
        <LeadForm onSubmit={noop} activeUsers={[]} isAdmin={false} onCancel={handleCancel} />,
      );

      await user.click(screen.getByTestId('lead-form-cancel'));
      expect(handleCancel).toHaveBeenCalledOnce();
    });

    it('does not render Cancel button when onCancel is not provided', () => {
      renderWithProviders(<LeadForm onSubmit={noop} activeUsers={[]} isAdmin={false} />);
      expect(screen.queryByTestId('lead-form-cancel')).not.toBeInTheDocument();
    });
  });

  describe('isSubmitting state', () => {
    it('disables inputs and shows saving label when isSubmitting is true', () => {
      renderWithProviders(
        <LeadForm onSubmit={noop} activeUsers={[]} isAdmin={false} isSubmitting />,
      );
      expect(screen.getByTestId('lead-first-name')).toBeDisabled();
      expect(screen.getByTestId('lead-email')).toBeDisabled();
      expect(screen.getByTestId('lead-form-submit')).toBeDisabled();
    });

    it('does not disable inputs when isSubmitting is false', () => {
      renderWithProviders(
        <LeadForm onSubmit={noop} activeUsers={[]} isAdmin={false} isSubmitting={false} />,
      );
      expect(screen.getByTestId('lead-first-name')).not.toBeDisabled();
    });
  });

  describe('notes textarea', () => {
    it('updates notes value when typed', () => {
      renderWithProviders(<LeadForm onSubmit={noop} activeUsers={[]} isAdmin={false} />);
      fireEvent.change(screen.getByTestId('lead-notes'), {
        target: { name: 'notes', value: 'New note content' },
      });
      expect(screen.getByTestId<HTMLTextAreaElement>('lead-notes').value).toBe('New note content');
    });
  });
});
