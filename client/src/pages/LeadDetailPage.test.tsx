/**
 * Tests for the LeadDetailPage component.
 * (MINCRM-173, MINCRM-174, MINCRM-175)
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import LeadDetailPage from './LeadDetailPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { LEAD_1 } from '../test/msw/handlers.js';

describe('LeadDetailPage', () => {
  it('renders the lead name', async () => {
    renderWithProviders(<LeadDetailPage />, {
      initialEntries: [`/leads/${LEAD_1.id}`],
      path: '/leads/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('lead-name')).toHaveTextContent(
        `${LEAD_1.first_name} ${LEAD_1.last_name}`,
      );
    });
  });

  it('renders the lead email', async () => {
    renderWithProviders(<LeadDetailPage />, {
      initialEntries: [`/leads/${LEAD_1.id}`],
      path: '/leads/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('lead-email')).toBeInTheDocument();
    });
  });

  it('shows the status badge', async () => {
    renderWithProviders(<LeadDetailPage />, {
      initialEntries: [`/leads/${LEAD_1.id}`],
      path: '/leads/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('lead-status-badge')).toHaveTextContent('New');
    });
  });

  it('shows a "Converted" badge when the lead is converted', async () => {
    server.use(
      http.get(`/api/leads/${LEAD_1.id}`, () =>
        HttpResponse.json({
          lead: { ...LEAD_1, converted_at: '2025-06-01T00:00:00.000Z' },
        }),
      ),
    );
    renderWithProviders(<LeadDetailPage />, {
      initialEntries: [`/leads/${LEAD_1.id}`],
      path: '/leads/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('lead-converted-badge')).toBeInTheDocument();
    });
  });

  it('shows "not found" when the lead does not exist', async () => {
    server.use(
      http.get('/api/leads/:id', () =>
        HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Lead not found' } },
          { status: 404 },
        ),
      ),
    );
    renderWithProviders(<LeadDetailPage />, {
      initialEntries: ['/leads/00000000-0000-0000-0000-000000000000'],
      path: '/leads/:id',
    });
    await waitFor(() => {
      expect(screen.getByText('Lead not found.')).toBeInTheDocument();
    });
  });

  it('shows the edit form when Edit is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LeadDetailPage />, {
      initialEntries: [`/leads/${LEAD_1.id}`],
      path: '/leads/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('edit-lead-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-lead-button'));
    expect(screen.getByTestId('lead-form')).toBeInTheDocument();
  });

  it('hides the edit form when Cancel is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LeadDetailPage />, {
      initialEntries: [`/leads/${LEAD_1.id}`],
      path: '/leads/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('edit-lead-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-lead-button'));
    expect(screen.getByTestId('lead-form')).toBeInTheDocument();
    await user.click(screen.getByTestId('lead-form-cancel'));
    expect(screen.queryByTestId('lead-form')).not.toBeInTheDocument();
  });

  it('shows the Convert Lead button when lead is not Disqualified and not converted', async () => {
    renderWithProviders(<LeadDetailPage />, {
      initialEntries: [`/leads/${LEAD_1.id}`],
      path: '/leads/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('convert-lead-button')).toBeInTheDocument();
    });
  });

  it('does NOT show Convert Lead button when lead is Disqualified', async () => {
    server.use(
      http.get(`/api/leads/${LEAD_1.id}`, () =>
        HttpResponse.json({ lead: { ...LEAD_1, status: 'Disqualified' } }),
      ),
    );
    renderWithProviders(<LeadDetailPage />, {
      initialEntries: [`/leads/${LEAD_1.id}`],
      path: '/leads/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('lead-status-badge')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('convert-lead-button')).not.toBeInTheDocument();
  });

  it('does NOT show Convert Lead button when lead is already converted', async () => {
    server.use(
      http.get(`/api/leads/${LEAD_1.id}`, () =>
        HttpResponse.json({
          lead: { ...LEAD_1, converted_at: '2025-06-01T00:00:00.000Z' },
        }),
      ),
    );
    renderWithProviders(<LeadDetailPage />, {
      initialEntries: [`/leads/${LEAD_1.id}`],
      path: '/leads/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('lead-converted-badge')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('convert-lead-button')).not.toBeInTheDocument();
  });

  it('shows the conversion modal when Convert Lead is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LeadDetailPage />, {
      initialEntries: [`/leads/${LEAD_1.id}`],
      path: '/leads/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('convert-lead-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('convert-lead-button'));
    expect(screen.getByTestId('convert-confirm')).toBeInTheDocument();
  });

  it('shows status history when entries are returned', async () => {
    server.use(
      http.get(`/api/leads/${LEAD_1.id}/status-history`, () =>
        HttpResponse.json({
          history: [
            {
              id: '00000000-0000-0000-0000-000000000901',
              lead_id: LEAD_1.id,
              from_status: null,
              to_status: 'New',
              changed_by_name: 'Test Admin',
              created_at: '2025-01-01T00:00:00.000Z',
            },
            {
              id: '00000000-0000-0000-0000-000000000902',
              lead_id: LEAD_1.id,
              from_status: 'New',
              to_status: 'Contacted',
              changed_by_name: 'Test Admin',
              created_at: '2025-01-02T00:00:00.000Z',
            },
          ],
        }),
      ),
    );
    renderWithProviders(<LeadDetailPage />, {
      initialEntries: [`/leads/${LEAD_1.id}`],
      path: '/leads/:id',
    });
    await waitFor(() => {
      expect(screen.getByText('Status history')).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('status-history-00000000-0000-0000-0000-000000000902'),
    ).toBeInTheDocument();
  });

  it('shows the converted-from-lead banner on a converted lead', async () => {
    const leadId = LEAD_1.id;
    server.use(
      http.get(`/api/leads/${leadId}`, () =>
        HttpResponse.json({
          lead: {
            ...LEAD_1,
            converted_at: '2025-06-01T00:00:00.000Z',
            converted_contact_id: '00000000-0000-0000-0000-000000000101',
            converted_account_id: '00000000-0000-0000-0000-000000000201',
            converted_deal_id: '00000000-0000-0000-0000-000000000301',
          },
        }),
      ),
    );
    renderWithProviders(<LeadDetailPage />, {
      initialEntries: [`/leads/${leadId}`],
      path: '/leads/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('converted-contact-link')).toBeInTheDocument();
      expect(screen.getByTestId('converted-account-link')).toBeInTheDocument();
      expect(screen.getByTestId('converted-deal-link')).toBeInTheDocument();
    });
  });
});
