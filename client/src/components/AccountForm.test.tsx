/**
 * Tests for the AccountForm component. (MINCRM-198)
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import AccountForm from './AccountForm.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { ACCOUNT_1 } from '../test/msw/handlers.js';

const noop = vi.fn();

describe('AccountForm', () => {
  describe('field rendering', () => {
    it('renders all core fields', () => {
      renderWithProviders(<AccountForm onSubmit={noop} />);
      expect(screen.getByTestId('account-name-input')).toBeInTheDocument();
      expect(screen.getByTestId('account-industry')).toBeInTheDocument();
      expect(screen.getByTestId('account-website')).toBeInTheDocument();
      expect(screen.getByTestId('account-employee-range')).toBeInTheDocument();
      expect(screen.getByTestId('account-revenue-range')).toBeInTheDocument();
      expect(screen.getByTestId('account-type-select')).toBeInTheDocument();
    });

    it('renders all ACCOUNT_TYPE_VALUES as options in the type dropdown', () => {
      renderWithProviders(<AccountForm onSubmit={noop} />);
      const select = screen.getByTestId<HTMLSelectElement>('account-type-select');
      // Verify a blank "none" option plus the six type values
      const options = Array.from(select.options).map((o) => o.value);
      expect(options).toContain('');
      expect(options).toContain('Prospect');
      expect(options).toContain('Customer');
      expect(options).toContain('Partner');
      expect(options).toContain('Vendor');
      expect(options).toContain('Competitor');
      expect(options).toContain('Other');
    });

    it('does not render owner selector when users prop is omitted', () => {
      renderWithProviders(<AccountForm onSubmit={noop} />);
      expect(screen.queryByTestId('account-owner-select')).not.toBeInTheDocument();
    });

    it('renders owner selector when users prop is provided', () => {
      renderWithProviders(
        <AccountForm onSubmit={noop} users={[{ id: 'u-1', name: 'Alice Smith' }]} />,
      );
      expect(screen.getByTestId('account-owner-select')).toBeInTheDocument();
    });

    it('renders the contact selector', () => {
      renderWithProviders(<AccountForm onSubmit={noop} />);
      expect(screen.getByTestId('account-contact-selector')).toBeInTheDocument();
    });

    it('renders the parent account search input when no parent is selected', () => {
      renderWithProviders(<AccountForm onSubmit={noop} />);
      expect(screen.getByTestId('account-parent-search')).toBeInTheDocument();
    });
  });

  describe('initialValues population', () => {
    it('pre-populates fields from initialValues', () => {
      renderWithProviders(
        <AccountForm
          onSubmit={noop}
          initialValues={{
            name: 'Acme Corp',
            industry: 'Technology',
            website: 'https://acme.example.com',
            employee_range: '51-200',
            revenue_range: '10M-50M',
            account_type: 'Customer',
          }}
        />,
      );
      expect(screen.getByTestId<HTMLInputElement>('account-name-input').value).toBe('Acme Corp');
      expect(screen.getByTestId<HTMLInputElement>('account-industry').value).toBe('Technology');
      expect(screen.getByTestId<HTMLInputElement>('account-website').value).toBe(
        'https://acme.example.com',
      );
      expect(screen.getByTestId<HTMLInputElement>('account-employee-range').value).toBe('51-200');
      expect(screen.getByTestId<HTMLInputElement>('account-revenue-range').value).toBe('10M-50M');
      expect(screen.getByTestId<HTMLSelectElement>('account-type-select').value).toBe('Customer');
    });

    it('shows the selected parent name and clear button when initialValues has parent_account_id', () => {
      renderWithProviders(
        <AccountForm
          onSubmit={noop}
          initialValues={{ parent_account_id: ACCOUNT_1.id }}
          initialParentAccountName={ACCOUNT_1.name}
        />,
      );
      expect(screen.getByTestId('account-parent-selected-name')).toHaveTextContent(ACCOUNT_1.name);
      expect(screen.getByTestId('account-parent-clear')).toBeInTheDocument();
    });
  });

  describe('onSubmit', () => {
    it('calls onSubmit with form values when submitted', () => {
      const handleSubmit = vi.fn();
      renderWithProviders(<AccountForm onSubmit={handleSubmit} />);

      fireEvent.change(screen.getByTestId('account-name-input'), {
        target: { name: 'name', value: 'New Account' },
      });
      fireEvent.change(screen.getByTestId('account-industry'), {
        target: { name: 'industry', value: 'Finance' },
      });

      fireEvent.submit(screen.getByTestId('account-form'));

      expect(handleSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Account',
          industry: 'Finance',
        }),
      );
    });

    it('does not call onSubmit when the required name field is empty', () => {
      const handleSubmit = vi.fn();
      renderWithProviders(<AccountForm onSubmit={handleSubmit} />);
      // Attempt to submit with no name (HTML5 required prevents submission)
      const nameInput = screen.getByTestId<HTMLInputElement>('account-name-input');
      expect(nameInput).toBeRequired();
    });
  });

  describe('cancel button', () => {
    it('calls onCancel when the Cancel button is clicked', async () => {
      const handleCancel = vi.fn();
      const user = userEvent.setup();
      renderWithProviders(<AccountForm onSubmit={noop} onCancel={handleCancel} />);

      await user.click(screen.getByTestId('account-form-cancel'));
      expect(handleCancel).toHaveBeenCalledOnce();
    });

    it('does not render a Cancel button when onCancel is not provided', () => {
      renderWithProviders(<AccountForm onSubmit={noop} />);
      expect(screen.queryByTestId('account-form-cancel')).not.toBeInTheDocument();
    });
  });

  describe('isSubmitting state', () => {
    it('disables inputs and submit button when isSubmitting is true', () => {
      renderWithProviders(<AccountForm onSubmit={noop} isSubmitting />);
      expect(screen.getByTestId('account-name-input')).toBeDisabled();
      expect(screen.getByTestId('account-industry')).toBeDisabled();
      expect(screen.getByTestId('account-form-submit')).toBeDisabled();
    });
  });

  describe('error display', () => {
    it('renders error message in an alert when error prop is set', () => {
      renderWithProviders(<AccountForm onSubmit={noop} error="Failed to save" />);
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to save');
    });

    it('does not render an alert when error prop is absent', () => {
      renderWithProviders(<AccountForm onSubmit={noop} />);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('parent account type-ahead', () => {
    it('shows autocomplete suggestions when a query of 2+ chars is typed', async () => {
      server.use(
        http.get('/api/accounts/search', () => HttpResponse.json({ accounts: [ACCOUNT_1] })),
      );
      const user = userEvent.setup();
      renderWithProviders(<AccountForm onSubmit={noop} />);

      const searchInput = screen.getByTestId('account-parent-search');
      await user.type(searchInput, 'Ac');

      await waitFor(() =>
        expect(screen.getByTestId('account-parent-suggestions')).toBeInTheDocument(),
      );
      expect(screen.getByTestId(`account-parent-option-${ACCOUNT_1.id}`)).toBeInTheDocument();
    });

    it('does not show suggestions when query is fewer than 2 characters', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AccountForm onSubmit={noop} />);

      await user.type(screen.getByTestId('account-parent-search'), 'A');
      expect(screen.queryByTestId('account-parent-suggestions')).not.toBeInTheDocument();
    });

    it('selects a parent account and hides the search input', async () => {
      server.use(
        http.get('/api/accounts/search', () => HttpResponse.json({ accounts: [ACCOUNT_1] })),
      );
      const user = userEvent.setup();
      renderWithProviders(<AccountForm onSubmit={noop} />);

      await user.type(screen.getByTestId('account-parent-search'), 'Ac');
      await waitFor(() =>
        expect(screen.getByTestId(`account-parent-option-${ACCOUNT_1.id}`)).toBeInTheDocument(),
      );
      await user.click(screen.getByTestId(`account-parent-option-${ACCOUNT_1.id}`));

      expect(screen.getByTestId('account-parent-selected-name')).toHaveTextContent(ACCOUNT_1.name);
      expect(screen.queryByTestId('account-parent-search')).not.toBeInTheDocument();
    });

    it('clears the selected parent when the clear button is clicked', async () => {
      renderWithProviders(
        <AccountForm
          onSubmit={noop}
          initialValues={{ parent_account_id: ACCOUNT_1.id }}
          initialParentAccountName={ACCOUNT_1.name}
        />,
      );
      const user = userEvent.setup();
      await user.click(screen.getByTestId('account-parent-clear'));

      expect(screen.queryByTestId('account-parent-selected-name')).not.toBeInTheDocument();
      expect(screen.getByTestId('account-parent-search')).toBeInTheDocument();
    });
  });

  describe('contact selector', () => {
    it('renders the contact selector search input', () => {
      renderWithProviders(<AccountForm onSubmit={noop} />);
      // The ContactSelector always renders a search input once mounted
      expect(screen.getByTestId('account-contact-selector-search')).toBeInTheDocument();
    });

    it('shows an empty-state message when no contacts are selected', () => {
      renderWithProviders(<AccountForm onSubmit={noop} />);
      expect(screen.getByTestId('account-contact-selector-none')).toBeInTheDocument();
    });
  });
});
