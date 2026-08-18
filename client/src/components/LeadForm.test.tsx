/**
 * Tests for the LeadForm component.
 * Covers: field rendering, required fields, lead source dropdown, owner selector conditional,
 * initialValues population, onSubmit values, cancel button, isSubmitting state.
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import LeadForm from './LeadForm.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';

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

  describe('routing profile fields', () => {
    it('renders territory, industry, and employee_range fields', () => {
      renderWithProviders(<LeadForm onSubmit={noop} activeUsers={[]} isAdmin={false} />);
      expect(screen.getByTestId('lead-territory')).toBeInTheDocument();
      expect(screen.getByTestId('lead-industry')).toBeInTheDocument();
      expect(screen.getByTestId('lead-employee-range')).toBeInTheDocument();
    });

    it('pre-populates routing profile fields from initialValues', () => {
      renderWithProviders(
        <LeadForm
          onSubmit={noop}
          activeUsers={[]}
          isAdmin={false}
          initialValues={{ territory: 'West', industry: 'SaaS', employee_range: '51-200' }}
        />,
      );
      expect(screen.getByTestId<HTMLInputElement>('lead-territory').value).toBe('West');
      expect(screen.getByTestId<HTMLInputElement>('lead-industry').value).toBe('SaaS');
      expect(screen.getByTestId<HTMLInputElement>('lead-employee-range').value).toBe('51-200');
    });

    it('includes routing profile fields in the submitted values', () => {
      const handleSubmit = vi.fn();
      renderWithProviders(<LeadForm onSubmit={handleSubmit} activeUsers={[]} isAdmin={false} />);

      fireEvent.change(screen.getByTestId('lead-territory'), {
        target: { name: 'territory', value: 'East' },
      });
      fireEvent.submit(screen.getByTestId('lead-form'));

      expect(handleSubmit).toHaveBeenCalledWith(expect.objectContaining({ territory: 'East' }));
    });
  });

  describe('routing suggestion panel', () => {
    const ACTIVE_USERS_FOR_ROUTING = [{ id: 'u-1', name: 'Alice Smith' }];

    it('does not render for the edit flow (isCreate=false)', () => {
      renderWithProviders(
        <LeadForm onSubmit={noop} activeUsers={ACTIVE_USERS_FOR_ROUTING} isAdmin />,
      );
      expect(screen.queryByTestId('lead-routing-suggestion-panel')).not.toBeInTheDocument();
    });

    it('does not render for non-admins even on create', () => {
      renderWithProviders(<LeadForm onSubmit={noop} activeUsers={[]} isAdmin={false} isCreate />);
      expect(screen.queryByTestId('lead-routing-suggestion-panel')).not.toBeInTheDocument();
    });

    it('renders a suggestion and applies it to the owner field on click', async () => {
      server.use(
        http.post('/api/v1/leads/routing-suggestion', () =>
          HttpResponse.json({
            suggested_rep_id: 'u-1',
            suggested_rep_name: 'Alice Smith',
            confidence: 'high',
            contributing_factors: [
              { type: 'territory_match', description: 'Territory match (West)' },
            ],
          }),
        ),
      );

      renderWithProviders(
        <LeadForm onSubmit={noop} activeUsers={ACTIVE_USERS_FOR_ROUTING} isAdmin isCreate />,
      );

      fireEvent.change(screen.getByTestId('lead-territory'), {
        target: { name: 'territory', value: 'West' },
      });

      await waitFor(() => {
        expect(screen.getByTestId('lead-routing-suggestion-panel')).toBeInTheDocument();
      });
      expect(screen.getByText(/Territory match \(West\)/)).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('lead-routing-suggestion-apply'));

      expect(screen.getByTestId<HTMLSelectElement>('lead-owner-select').value).toBe('u-1');
      // Applying collapses the panel back (currentSuggestion is now set).
      expect(screen.queryByTestId('lead-routing-suggestion-panel')).not.toBeInTheDocument();
    });

    it('dismisses the suggestion without changing the owner field', async () => {
      server.use(
        http.post('/api/v1/leads/routing-suggestion', () =>
          HttpResponse.json({
            suggested_rep_id: 'u-1',
            suggested_rep_name: 'Alice Smith',
            confidence: 'medium',
            contributing_factors: [{ type: 'workload', description: 'Has capacity' }],
          }),
        ),
      );

      const handleSubmit = vi.fn();
      renderWithProviders(
        <LeadForm
          onSubmit={handleSubmit}
          activeUsers={ACTIVE_USERS_FOR_ROUTING}
          isAdmin
          isCreate
        />,
      );

      fireEvent.change(screen.getByTestId('lead-industry'), {
        target: { name: 'industry', value: 'SaaS' },
      });

      await waitFor(() => {
        expect(screen.getByTestId('lead-routing-suggestion-dismiss')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('lead-routing-suggestion-dismiss'));

      expect(screen.queryByTestId('lead-routing-suggestion-panel')).not.toBeInTheDocument();
      // Assert via submitted state, not the <select> DOM value — with only one
      // user in the list and no explicit blank option, the browser/jsdom falls
      // back to displaying the first <option> when value='' matches nothing
      // (a pre-existing OwnerSelect quirk, unrelated to the dismiss behavior
      // under test here). owner_id in form state is the source of truth.
      fireEvent.submit(screen.getByTestId('lead-form'));
      expect(handleSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ owner_id: '', routingSuggestion: null }),
      );
    });

    it('renders nothing when the server returns 204 (no confident suggestion)', async () => {
      renderWithProviders(
        <LeadForm onSubmit={noop} activeUsers={ACTIVE_USERS_FOR_ROUTING} isAdmin isCreate />,
      );

      fireEvent.change(screen.getByTestId('lead-territory'), {
        target: { name: 'territory', value: 'Anywhere' },
      });

      // Default MSW handler returns 204 — wait for the loading skeleton to
      // disappear (debounce + query settled), then assert the panel never appears.
      await waitFor(() => {
        expect(screen.queryByTestId('lead-routing-suggestion-loading')).not.toBeInTheDocument();
      });
      expect(screen.queryByTestId('lead-routing-suggestion-panel')).not.toBeInTheDocument();
    });

    it('clears an applied suggestion when the owner is changed manually afterward', async () => {
      server.use(
        http.post('/api/v1/leads/routing-suggestion', () =>
          HttpResponse.json({
            suggested_rep_id: 'u-1',
            suggested_rep_name: 'Alice Smith',
            confidence: 'high',
            contributing_factors: [
              { type: 'territory_match', description: 'Territory match (West)' },
            ],
          }),
        ),
      );

      const handleSubmit = vi.fn();
      renderWithProviders(
        <LeadForm
          onSubmit={handleSubmit}
          activeUsers={[...ACTIVE_USERS_FOR_ROUTING, { id: 'u-2', name: 'Bob Jones' }]}
          isAdmin
          isCreate
        />,
      );

      fireEvent.change(screen.getByTestId('lead-territory'), {
        target: { name: 'territory', value: 'West' },
      });
      await waitFor(() => screen.getByTestId('lead-routing-suggestion-apply'));
      fireEvent.click(screen.getByTestId('lead-routing-suggestion-apply'));

      // Manager overrides with a different owner.
      fireEvent.change(screen.getByTestId('lead-owner-select'), {
        target: { name: 'owner_id', value: 'u-2' },
      });

      fireEvent.submit(screen.getByTestId('lead-form'));
      expect(handleSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ owner_id: 'u-2', routingSuggestion: null }),
      );
    });
  });
});
