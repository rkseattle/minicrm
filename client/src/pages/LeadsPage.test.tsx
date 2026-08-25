/**
 * Tests for the LeadsPage component.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import LeadsPage from './LeadsPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { LEAD_1, REP_USER } from '../test/msw/handlers.js';
import * as bulkApi from '../api/bulk.js';
import * as leadsApi from '../api/leads.js';

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
      http.get('/api/v1/leads', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 50 }),
      ),
    );
    renderWithProviders(<LeadsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('leads-empty-state')).toBeInTheDocument();
      expect(screen.getByText('No leads yet')).toBeInTheDocument();
    });
  });

  it('shows error state when the API fails', async () => {
    server.use(
      http.get('/api/v1/leads', () =>
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
      http.get('/api/v1/leads', () =>
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
      http.post('/api/v1/leads', () =>
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

  it('creates the lead anyway when "Create anyway" is clicked after a duplicate warning', async () => {
    let secondCallBody: Record<string, unknown> = {};
    server.use(
      http.post('/api/v1/leads', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        // First call returns duplicate; subsequent calls succeed
        if (!secondCallBody.first_name) {
          secondCallBody = body;
          return HttpResponse.json(
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
          );
        }
        return HttpResponse.json(
          { lead: { ...LEAD_1, id: '00000000-0000-0000-0000-000000000803' } },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await waitFor(() => expect(screen.getByTestId('new-lead-button')).toBeInTheDocument());
    await user.click(screen.getByTestId('new-lead-button'));
    await user.type(screen.getByTestId('lead-first-name'), 'Carol');
    await user.type(screen.getByTestId('lead-email'), 'carol.white@example.com');
    await user.click(screen.getByTestId('lead-form-submit'));
    await waitFor(() => expect(screen.getByTestId('duplicate-lead-warning')).toBeInTheDocument());
    await user.click(screen.getByTestId('duplicate-create-anyway'));

    await waitFor(() => {
      expect(screen.queryByTestId('duplicate-lead-warning')).not.toBeInTheDocument();
    });
  });
});

// ── CSV/PDF export ───────────────────────────────────

describe('CSV export buttons', () => {
  beforeEach(() => {
    vi.spyOn(leadsApi, 'exportLeadsCsv').mockResolvedValue(undefined);
    vi.spyOn(leadsApi, 'exportLeadsPdf').mockResolvedValue(undefined);
  });

  /** Opens the Export menu so its items become queryable. */
  async function openExportMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await waitFor(() => {
      expect(screen.getByTestId('leads-export-menu-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('leads-export-menu-button'));
  }

  it('renders the Export CSV and Export PDF buttons', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await openExportMenu(user);
    expect(screen.getByTestId('leads-export-csv-button')).toBeInTheDocument();
    expect(screen.getByTestId('leads-export-pdf-button')).toBeInTheDocument();
  });

  it('renders the Export All button for admin users', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await openExportMenu(user);
    expect(screen.getByTestId('leads-export-all-button')).toBeInTheDocument();
  });

  it('does not render the Export All button for rep users', async () => {
    server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ user: REP_USER })));
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await openExportMenu(user);
    expect(screen.getByTestId('leads-export-csv-button')).toBeInTheDocument();
    expect(screen.queryByTestId('leads-export-all-button')).not.toBeInTheDocument();
  });

  it('calls exportLeadsCsv when Export CSV is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await openExportMenu(user);
    await user.click(screen.getByTestId('leads-export-csv-button'));
    expect(leadsApi.exportLeadsCsv).toHaveBeenCalled();
  });

  it('calls exportLeadsPdf when Export PDF is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await openExportMenu(user);
    await user.click(screen.getByTestId('leads-export-pdf-button'));
    expect(leadsApi.exportLeadsPdf).toHaveBeenCalled();
  });

  it('calls exportLeadsCsv with all:true when Export All is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await openExportMenu(user);
    await user.click(screen.getByTestId('leads-export-all-button'));
    expect(leadsApi.exportLeadsCsv).toHaveBeenCalledWith({ all: true });
  });
});

// ── Filter interactions ──────────────────────────────────────────

describe('filter interactions', () => {
  it('sends ?owner=me when "Mine" filter is clicked', async () => {
    let capturedOwner: string | null = null;
    server.use(
      http.get('/api/v1/leads', ({ request }) => {
        const url = new URL(request.url);
        capturedOwner = url.searchParams.get('owner');
        return HttpResponse.json({ data: [LEAD_1], total: 1, page: 1, limit: 50 });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await waitFor(() => expect(screen.getByTestId('filter-owner-mine')).toBeInTheDocument());
    await user.click(screen.getByTestId('filter-owner-mine'));

    await waitFor(() => {
      expect(capturedOwner).toBe('me');
    });
  });

  it('removes ?owner param when "All" filter is clicked after selecting "Mine"', async () => {
    let lastOwner: string | null = 'unset';
    server.use(
      http.get('/api/v1/leads', ({ request }) => {
        const url = new URL(request.url);
        lastOwner = url.searchParams.get('owner');
        return HttpResponse.json({ data: [LEAD_1], total: 1, page: 1, limit: 50 });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await waitFor(() => expect(screen.getByTestId('filter-owner-mine')).toBeInTheDocument());
    await user.click(screen.getByTestId('filter-owner-mine'));
    await user.click(screen.getByTestId('filter-owner-all'));

    await waitFor(() => {
      expect(lastOwner).toBeNull();
    });
  });

  it('sends ?status=New when New is selected in the status filter', async () => {
    let capturedStatus: string | null = null;
    server.use(
      http.get('/api/v1/leads', ({ request }) => {
        const url = new URL(request.url);
        capturedStatus = url.searchParams.get('status');
        return HttpResponse.json({ data: [LEAD_1], total: 1, page: 1, limit: 50 });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await waitFor(() => expect(screen.getByTestId('filter-status')).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId('filter-status'), 'New');

    await waitFor(() => {
      expect(capturedStatus).toBe('New');
    });
  });

  it('sends ?lead_source=Web when Web is selected in the source filter', async () => {
    let capturedSource: string | null = null;
    server.use(
      http.get('/api/v1/leads', ({ request }) => {
        const url = new URL(request.url);
        capturedSource = url.searchParams.get('lead_source');
        return HttpResponse.json({ data: [LEAD_1], total: 1, page: 1, limit: 50 });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await waitFor(() => expect(screen.getByTestId('filter-source')).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId('filter-source'), 'Web');

    await waitFor(() => {
      expect(capturedSource).toBe('Web');
    });
  });

  it('sends includeDisqualified=true when the disqualified checkbox is toggled on', async () => {
    let capturedIncludeDisqualified: string | null = null;
    server.use(
      http.get('/api/v1/leads', ({ request }) => {
        const url = new URL(request.url);
        capturedIncludeDisqualified = url.searchParams.get('includeDisqualified');
        return HttpResponse.json({ data: [LEAD_1], total: 1, page: 1, limit: 50 });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await waitFor(() => expect(screen.getByTestId('toggle-disqualified')).toBeInTheDocument());
    await user.click(screen.getByTestId('toggle-disqualified'));

    await waitFor(() => {
      expect(capturedIncludeDisqualified).toBe('true');
    });
  });

  it('sends includeConverted=true when the converted checkbox is toggled on', async () => {
    let capturedIncludeConverted: string | null = null;
    server.use(
      http.get('/api/v1/leads', ({ request }) => {
        const url = new URL(request.url);
        capturedIncludeConverted = url.searchParams.get('includeConverted');
        return HttpResponse.json({ data: [LEAD_1], total: 1, page: 1, limit: 50 });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await waitFor(() => expect(screen.getByTestId('toggle-converted')).toBeInTheDocument());
    await user.click(screen.getByTestId('toggle-converted'));

    await waitFor(() => {
      expect(capturedIncludeConverted).toBe('true');
    });
  });
});

// ── Delete action ────────────────────────────────────────────────

describe('delete lead action', () => {
  it('calls DELETE after window.confirm and removes the row', async () => {
    let deleteCalled = false;
    server.use(
      http.delete(`/api/v1/leads/${LEAD_1.id}`, () => {
        deleteCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    // Stub window.confirm to return true
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await waitFor(() => expect(screen.getByTestId(`delete-lead-${LEAD_1.id}`)).toBeInTheDocument());
    await user.click(screen.getByTestId(`delete-lead-${LEAD_1.id}`));

    await waitFor(() => {
      expect(deleteCalled).toBe(true);
    });

    confirmSpy.mockRestore();
  });

  it('does NOT call DELETE when window.confirm returns false', async () => {
    let deleteCalled = false;
    server.use(
      http.delete(`/api/v1/leads/${LEAD_1.id}`, () => {
        deleteCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await waitFor(() => expect(screen.getByTestId(`delete-lead-${LEAD_1.id}`)).toBeInTheDocument());
    await user.click(screen.getByTestId(`delete-lead-${LEAD_1.id}`));

    expect(deleteCalled).toBe(false);
    confirmSpy.mockRestore();
  });
});

// ── Inline status update ────────────────────────────────────────

describe('inline status update', () => {
  it('calls PATCH with the new status when a new value is selected', async () => {
    let patchedStatus: string | null = null;
    server.use(
      http.patch(`/api/v1/leads/${LEAD_1.id}`, async ({ request }) => {
        const body = (await request.json()) as { status?: string };
        patchedStatus = body.status ?? null;
        return HttpResponse.json({ lead: { ...LEAD_1, status: body.status ?? LEAD_1.status } });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await waitFor(() =>
      expect(screen.getByTestId(`status-badge-${LEAD_1.id}`)).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId(`status-badge-${LEAD_1.id}`));
    expect(screen.getByTestId(`status-select-${LEAD_1.id}`)).toBeInTheDocument();
    await user.selectOptions(screen.getByTestId(`status-select-${LEAD_1.id}`), 'Contacted');

    await waitFor(() => {
      expect(patchedStatus).toBe('Contacted');
    });
  });

  // badge must display the new status after the mutation succeeds
  it('updates the status badge text after inline status change', async () => {
    const updatedLead = { ...LEAD_1, status: 'Contacted' as const };
    // Override PATCH handler; GET still returns LEAD_1 (status: New) on initial load.
    server.use(
      http.patch(`/api/v1/leads/${LEAD_1.id}`, async ({ request }) => {
        const body = (await request.json()) as { status?: string };
        // Once the PATCH fires, switch the GET to return the updated lead so the
        // post-invalidation refetch reflects the new status.
        server.use(
          http.get('/api/v1/leads', () =>
            HttpResponse.json({ data: [updatedLead], total: 1, page: 1, limit: 50 }),
          ),
        );
        return HttpResponse.json({ lead: { ...LEAD_1, status: body.status ?? LEAD_1.status } });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await waitFor(() =>
      expect(screen.getByTestId(`status-badge-${LEAD_1.id}`)).toBeInTheDocument(),
    );
    expect(screen.getByTestId(`status-badge-${LEAD_1.id}`)).toHaveTextContent('New');

    await user.click(screen.getByTestId(`status-badge-${LEAD_1.id}`));
    await user.selectOptions(screen.getByTestId(`status-select-${LEAD_1.id}`), 'Contacted');

    // Badge should now show the new status
    await waitFor(() => {
      expect(screen.getByTestId(`status-badge-${LEAD_1.id}`)).toHaveTextContent('Contacted');
    });
  });
});

// ── Bulk selection ───────────────────────────────────────────────

describe('bulk selection', () => {
  it('does not show the bulk action bar before any rows are selected', async () => {
    renderWithProviders(<LeadsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`bulk-select-${LEAD_1.id}`)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
  });

  it('changing the page size clears the selection, which the new rows invalidate', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId(`bulk-select-${LEAD_1.id}`).length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByTestId(`bulk-select-${LEAD_1.id}`)[0]!);
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();

    // A size change leaves `page` at 1, so the page number alone cannot clear the
    // selection — a bulk delete would then act on rows swapped out of view.
    await user.selectOptions(screen.getByLabelText(/rows per page/i), '50');

    await waitFor(
      () => {
        expect(screen.queryByTestId('bulk-action-count')).not.toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });

  it('shows the bulk action bar after selecting a row', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`bulk-select-${LEAD_1.id}`)).toBeInTheDocument();
    });
    await user.click(screen.getByTestId(`bulk-select-${LEAD_1.id}`));
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-action-count')).toHaveTextContent('1');
  });

  it('select-all checkbox selects all rows and shows bulk action bar', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`bulk-select-${LEAD_1.id}`)).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('leads-select-all'));
    await waitFor(() => {
      expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
    });
    expect(screen.getByTestId('bulk-action-count')).toHaveTextContent('1');
  });

  it('clear selection hides the bulk action bar', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`bulk-select-${LEAD_1.id}`)).toBeInTheDocument();
    });
    await user.click(screen.getByTestId(`bulk-select-${LEAD_1.id}`));
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
    await user.click(screen.getByTestId('bulk-clear-selection'));
    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
  });

  it('bulk delete calls the API and clears selection on success', async () => {
    vi.spyOn(bulkApi, 'bulkDeleteLeads').mockResolvedValue({
      succeeded: [LEAD_1.id],
      failed: [],
    });

    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`bulk-select-${LEAD_1.id}`)).toBeInTheDocument();
    });
    await user.click(screen.getByTestId(`bulk-select-${LEAD_1.id}`));
    await user.click(screen.getByTestId('leads-bulk-delete-button'));

    await waitFor(() => {
      expect(screen.getByTestId('confirm-delete-confirm')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('confirm-delete-confirm'));

    await waitFor(() => {
      expect(bulkApi.bulkDeleteLeads).toHaveBeenCalledWith({ ids: [LEAD_1.id] });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
    });
  });
});
