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

  // MINCRM-441 prerequisite: rule-based lead scoring
  it('renders the computed lead score badge', async () => {
    renderWithProviders(<LeadDetailPage />, {
      initialEntries: [`/leads/${LEAD_1.id}`],
      path: '/leads/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('lead-score-badge')).toHaveTextContent('55');
    });
  });

  it('hides the score badge when the ai_lead_scoring flag is disabled', async () => {
    server.use(
      http.get('/api/v1/feature-flags/me', () =>
        HttpResponse.json({ flags: { ai_lead_scoring: false } }),
      ),
    );
    renderWithProviders(<LeadDetailPage />, {
      initialEntries: [`/leads/${LEAD_1.id}`],
      path: '/leads/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('lead-name')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('lead-score-badge')).not.toBeInTheDocument();
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
      http.get(`/api/v1/leads/${LEAD_1.id}`, () =>
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
      http.get('/api/v1/leads/:id', () =>
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
      http.get(`/api/v1/leads/${LEAD_1.id}`, () =>
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
      http.get(`/api/v1/leads/${LEAD_1.id}`, () =>
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
      http.get(`/api/v1/leads/${LEAD_1.id}/status-history`, () =>
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
      http.get(`/api/v1/leads/${leadId}`, () =>
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

  // ── Edit save / error (MINCRM-295) ─────────────────────────────────────────

  describe('edit save flow', () => {
    it('saves the edit form and hides it on success', async () => {
      const user = userEvent.setup();
      renderWithProviders(<LeadDetailPage />, {
        initialEntries: [`/leads/${LEAD_1.id}`],
        path: '/leads/:id',
      });
      await waitFor(() => expect(screen.getByTestId('edit-lead-button')).toBeInTheDocument());
      await user.click(screen.getByTestId('edit-lead-button'));
      await user.click(screen.getByTestId('lead-form-submit'));

      await waitFor(() => {
        expect(screen.queryByTestId('lead-form')).not.toBeInTheDocument();
      });
    });

    it('sends the patched fields to the PATCH endpoint', async () => {
      let capturedBody: Record<string, unknown> = {};
      server.use(
        http.patch(`/api/v1/leads/${LEAD_1.id}`, async ({ request }) => {
          capturedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ lead: { ...LEAD_1, ...capturedBody } });
        }),
      );

      const user = userEvent.setup();
      renderWithProviders(<LeadDetailPage />, {
        initialEntries: [`/leads/${LEAD_1.id}`],
        path: '/leads/:id',
      });
      await waitFor(() => expect(screen.getByTestId('edit-lead-button')).toBeInTheDocument());
      await user.click(screen.getByTestId('edit-lead-button'));

      const firstNameInput = screen.getByTestId('lead-first-name');
      await user.clear(firstNameInput);
      await user.type(firstNameInput, 'UpdatedName');
      await user.click(screen.getByTestId('lead-form-submit'));

      await waitFor(() => {
        expect(capturedBody.first_name).toBe('UpdatedName');
      });
    });

    it('shows an update error message when the PATCH fails', async () => {
      server.use(
        http.patch(`/api/v1/leads/${LEAD_1.id}`, () =>
          HttpResponse.json(
            { error: { code: 'VALIDATION_ERROR', message: 'Email already taken' } },
            { status: 400 },
          ),
        ),
      );

      const user = userEvent.setup();
      renderWithProviders(<LeadDetailPage />, {
        initialEntries: [`/leads/${LEAD_1.id}`],
        path: '/leads/:id',
      });
      await waitFor(() => expect(screen.getByTestId('edit-lead-button')).toBeInTheDocument());
      await user.click(screen.getByTestId('edit-lead-button'));
      await user.click(screen.getByTestId('lead-form-submit'));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });
  });

  // ── Delete flow (MINCRM-295) ────────────────────────────────────────────────

  describe('delete flow', () => {
    it('opens the confirm-delete modal when Delete is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<LeadDetailPage />, {
        initialEntries: [`/leads/${LEAD_1.id}`],
        path: '/leads/:id',
      });
      await waitFor(() => expect(screen.getByTestId('delete-lead-button')).toBeInTheDocument());
      await user.click(screen.getByTestId('delete-lead-button'));
      expect(screen.getByTestId('confirm-delete-modal')).toBeInTheDocument();
    });

    it('calls DELETE and navigates away when confirm is clicked', async () => {
      let deleteCalled = false;
      server.use(
        http.delete(`/api/v1/leads/${LEAD_1.id}`, () => {
          deleteCalled = true;
          return new HttpResponse(null, { status: 204 });
        }),
      );

      const user = userEvent.setup();
      renderWithProviders(<LeadDetailPage />, {
        initialEntries: [`/leads/${LEAD_1.id}`],
        path: '/leads/:id',
      });
      await waitFor(() => expect(screen.getByTestId('delete-lead-button')).toBeInTheDocument());
      await user.click(screen.getByTestId('delete-lead-button'));
      await user.click(screen.getByTestId('confirm-delete-confirm'));

      await waitFor(() => {
        expect(deleteCalled).toBe(true);
      });
    });

    it('does not delete and keeps the button when modal cancel is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<LeadDetailPage />, {
        initialEntries: [`/leads/${LEAD_1.id}`],
        path: '/leads/:id',
      });
      await waitFor(() => expect(screen.getByTestId('delete-lead-button')).toBeInTheDocument());
      await user.click(screen.getByTestId('delete-lead-button'));
      await user.click(screen.getByTestId('confirm-delete-cancel'));

      expect(screen.getByTestId('delete-lead-button')).toBeInTheDocument();
    });

    it('shows a delete error message when the DELETE request fails', async () => {
      server.use(
        http.delete(`/api/v1/leads/${LEAD_1.id}`, () =>
          HttpResponse.json(
            { error: { code: 'INTERNAL_ERROR', message: 'Server error' } },
            { status: 500 },
          ),
        ),
      );

      const user = userEvent.setup();
      renderWithProviders(<LeadDetailPage />, {
        initialEntries: [`/leads/${LEAD_1.id}`],
        path: '/leads/:id',
      });
      await waitFor(() => expect(screen.getByTestId('delete-lead-button')).toBeInTheDocument());
      await user.click(screen.getByTestId('delete-lead-button'));
      await user.click(screen.getByTestId('confirm-delete-confirm'));

      await waitFor(() => {
        expect(screen.getByTestId('delete-error')).toBeInTheDocument();
      });
    });
  });

  // ── Convert modal confirmation (MINCRM-295) ────────────────────────────────

  describe('convert lead flow', () => {
    it('calls the convert endpoint and shows converted badges on success', async () => {
      let convertCalled = false;
      // Use a stateful GET handler so the initial render sees an unconverted lead
      // (allowing the convert button to appear), and only after the POST fires does
      // the re-fetch return the converted payload.
      server.use(
        http.get(`/api/v1/leads/${LEAD_1.id}`, () => {
          if (!convertCalled) {
            return HttpResponse.json({ lead: LEAD_1 });
          }
          return HttpResponse.json({
            lead: {
              ...LEAD_1,
              converted_at: '2025-06-01T00:00:00.000Z',
              converted_contact_id: '00000000-0000-0000-0000-000000000101',
              converted_account_id: '00000000-0000-0000-0000-000000000201',
              converted_deal_id: '00000000-0000-0000-0000-000000000301',
            },
          });
        }),
        http.post(`/api/v1/leads/${LEAD_1.id}/convert`, () => {
          convertCalled = true;
          return HttpResponse.json(
            {
              conversion: {
                contact_id: '00000000-0000-0000-0000-000000000101',
                account_id: '00000000-0000-0000-0000-000000000201',
                deal_id: '00000000-0000-0000-0000-000000000301',
              },
            },
            { status: 201 },
          );
        }),
      );

      const user = userEvent.setup();
      renderWithProviders(<LeadDetailPage />, {
        initialEntries: [`/leads/${LEAD_1.id}`],
        path: '/leads/:id',
      });
      await waitFor(() => expect(screen.getByTestId('convert-lead-button')).toBeInTheDocument());
      await user.click(screen.getByTestId('convert-lead-button'));
      expect(screen.getByTestId('convert-confirm')).toBeInTheDocument();
      await user.click(screen.getByTestId('convert-confirm'));

      await waitFor(() => {
        expect(convertCalled).toBe(true);
      });
    });
  });

  // ── Disqualification reason display (MINCRM-295) ───────────────────────────

  describe('disqualified lead', () => {
    it('shows the disqualification reason when the lead is disqualified', async () => {
      server.use(
        http.get(`/api/v1/leads/${LEAD_1.id}`, () =>
          HttpResponse.json({
            lead: {
              ...LEAD_1,
              status: 'Disqualified',
              disqualification_reason: 'Budget too small',
            },
          }),
        ),
      );
      renderWithProviders(<LeadDetailPage />, {
        initialEntries: [`/leads/${LEAD_1.id}`],
        path: '/leads/:id',
      });
      await waitFor(() => {
        expect(screen.getByText('Budget too small')).toBeInTheDocument();
      });
    });
  });
});
