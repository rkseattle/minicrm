/**
 * Tests for the LeadsPage component.
 * (MINCRM-173, MINCRM-174)
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import LeadsPage from './LeadsPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { LEAD_1 } from '../test/msw/handlers.js';

describe('LeadsPage', () => {
  it('renders the page heading', async () => {
    renderWithProviders(<LeadsPage />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Leads' })).toBeInTheDocument();
    });
  });

  it('renders the New Lead button', async () => {
    renderWithProviders(<LeadsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('new-lead-button')).toBeInTheDocument();
    });
  });

  it('renders a lead row from the API', async () => {
    renderWithProviders(<LeadsPage />);
    await waitFor(() => {
      expect(screen.getByText(`${LEAD_1.first_name} ${LEAD_1.last_name}`)).toBeInTheDocument();
    });
    expect(screen.getByText(LEAD_1.company_name!)).toBeInTheDocument();
  });

  it('shows empty state when no leads are returned', async () => {
    server.use(
      http.get('/api/leads', () => HttpResponse.json({ data: [], total: 0, page: 1, limit: 50 })),
    );
    renderWithProviders(<LeadsPage />);
    await waitFor(() => {
      expect(screen.getByText('No leads yet. Add one to get started.')).toBeInTheDocument();
    });
  });

  it('shows error state when the API fails', async () => {
    server.use(
      http.get('/api/leads', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'fail' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<LeadsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('leads-error')).toBeInTheDocument();
    });
  });

  it('shows the create form when New Lead is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('new-lead-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('new-lead-button'));
    expect(screen.getByTestId('lead-form')).toBeInTheDocument();
  });

  it('hides the form when Cancel is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('new-lead-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('new-lead-button'));
    expect(screen.getByTestId('lead-form')).toBeInTheDocument();
    await user.click(screen.getByTestId('lead-form-cancel'));
    expect(screen.queryByTestId('lead-form')).not.toBeInTheDocument();
  });

  it('shows the New status badge for the lead', async () => {
    renderWithProviders(<LeadsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`status-badge-${LEAD_1.id}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId(`status-badge-${LEAD_1.id}`)).toHaveTextContent('New');
  });

  it('shows a "Converted" badge for a converted lead', async () => {
    server.use(
      http.get('/api/leads', () =>
        HttpResponse.json({
          data: [{ ...LEAD_1, converted_at: '2025-06-01T00:00:00.000Z' }],
          total: 1,
          page: 1,
          limit: 50,
        }),
      ),
    );
    renderWithProviders(<LeadsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`badge-converted-${LEAD_1.id}`)).toBeInTheDocument();
    });
  });

  it('shows a status select on badge click for inline status update', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`status-badge-${LEAD_1.id}`)).toBeInTheDocument();
    });
    await user.click(screen.getByTestId(`status-badge-${LEAD_1.id}`));
    expect(screen.getByTestId(`status-select-${LEAD_1.id}`)).toBeInTheDocument();
  });

  it('shows duplicate warning when 409 is returned', async () => {
    server.use(
      http.post('/api/leads', () =>
        HttpResponse.json(
          {
            error: { code: 'DUPLICATE_EMAIL', message: 'Duplicate' },
            duplicate: {
              id: LEAD_1.id,
              first_name: LEAD_1.first_name,
              last_name: LEAD_1.last_name,
              email: LEAD_1.email,
            },
          },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await waitFor(() => expect(screen.getByTestId('new-lead-button')).toBeInTheDocument());
    await user.click(screen.getByTestId('new-lead-button'));
    await user.type(screen.getByTestId('lead-first-name'), 'Carol');
    await user.type(screen.getByTestId('lead-email'), 'carol.white@example.com');
    await user.click(screen.getByTestId('lead-form-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('duplicate-lead-warning')).toBeInTheDocument();
    });
  });
});
