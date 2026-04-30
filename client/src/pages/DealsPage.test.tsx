/**
 * Tests for the DealsPage component.
 * Covers both board view (default) and list view (toggled via deals-view-toggle button).
 * MINCRM-51: board view is now the default; list view is toggled.
 */

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import DealsPage from './DealsPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { DEAL_1, ADMIN_USER, REP_USER } from '../test/msw/handlers.js';
import * as dealsApi from '../api/deals.js';
import * as bulkApi from '../api/bulk.js';
import { PIPELINE_STAGES } from '@shared/schemas/dealSchema.js';

describe('DealsPage', () => {
  // Clear persisted view mode before each test so tests start in a known state (MINCRM-146)
  beforeEach(() => {
    sessionStorage.removeItem('deals.viewMode');
  });

  // ── Common ─────────────────────────────────────────────────────────────────

  it('renders the page heading', async () => {
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Deals' })).toBeInTheDocument();
    });
  });

  it('renders the New Deal button', async () => {
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('new-deal-button')).toBeInTheDocument();
    });
  });

  it('renders the view toggle button', async () => {
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('deals-view-toggle')).toBeInTheDocument();
    });
  });

  it('shows the create form when New Deal is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('new-deal-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('new-deal-button'));
    expect(screen.getByTestId('deal-form')).toBeInTheDocument();
  });

  it('hides the form when Cancel is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('new-deal-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('new-deal-button'));
    expect(screen.getByTestId('deal-form')).toBeInTheDocument();
    await user.click(screen.getByTestId('deal-form-cancel'));
    expect(screen.queryByTestId('deal-form')).not.toBeInTheDocument();
  });

  it('submits the create form and hides it on success', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('new-deal-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('new-deal-button'));

    await user.type(screen.getByTestId('deal-name-input'), 'New Enterprise Deal');
    await user.click(screen.getByTestId('deal-form-submit'));

    await waitFor(() => {
      expect(screen.queryByTestId('deal-form')).not.toBeInTheDocument();
    });
  });

  // ── Board view (default) ───────────────────────────────────────────────────

  it('defaults to board view — renders the pipeline board', async () => {
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('pipeline-board')).toBeInTheDocument();
    });
  });

  it('renders a column for each pipeline stage in board view', async () => {
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('pipeline-board')).toBeInTheDocument();
    });
    for (const stage of PIPELINE_STAGES) {
      const slug = stage.toLowerCase().replace(/\s+/g, '-');
      expect(screen.getByTestId(`stage-column-${slug}`)).toBeInTheDocument();
    }
  });

  it('renders a deal card in the correct stage column in board view', async () => {
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`deal-card-${DEAL_1.id}`)).toBeInTheDocument();
    });
    const column = screen.getByTestId('stage-column-prospecting');
    expect(column).toContainElement(screen.getByTestId(`deal-card-${DEAL_1.id}`));
  });

  it('renders the hide/show closed deals toggle in board view', async () => {
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('toggle-closed-deals')).toBeInTheDocument();
    });
  });

  it('renders the owner toggle in board view (MINCRM-176)', async () => {
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('deals-owner-filter-all')).toBeInTheDocument();
      expect(screen.getByTestId('deals-owner-filter-mine')).toBeInTheDocument();
    });
  });

  it('shows loading state in board view while deals are being fetched', () => {
    renderWithProviders(<DealsPage />);
    expect(screen.getByRole('paragraph', { hidden: true })).toHaveAttribute('aria-busy', 'true');
  });

  it('shows error state in board view when the API fails', async () => {
    server.use(
      http.get('/api/v1/deals', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'fail' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('opens the close deal modal when a terminal stage is selected on a card', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`deal-card-stage-select-${DEAL_1.id}`)).toBeInTheDocument();
    });
    await user.selectOptions(
      screen.getByTestId(`deal-card-stage-select-${DEAL_1.id}`),
      'Closed Won',
    );
    expect(screen.getByTestId('close-deal-modal')).toBeInTheDocument();
  });

  it('shows an inline error banner when a stage change fails in board view', async () => {
    server.use(
      http.patch('/api/v1/deals/:id', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'fail' } }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`deal-card-stage-select-${DEAL_1.id}`)).toBeInTheDocument();
    });
    await user.selectOptions(
      screen.getByTestId(`deal-card-stage-select-${DEAL_1.id}`),
      'Qualification',
    );
    await waitFor(() => {
      expect(screen.getByTestId('stage-update-error')).toBeInTheDocument();
    });
  });

  // ── List view ──────────────────────────────────────────────────────────────

  it('switches to list view when the toggle is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('deals-view-toggle')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('deals-view-toggle'));
    expect(screen.queryByTestId('pipeline-board')).not.toBeInTheDocument();
    // Owner toggle and hide-closed button are visible in list view (MINCRM-176)
    expect(screen.getByTestId('deals-owner-filter-all')).toBeInTheDocument();
    expect(screen.getByTestId('deals-owner-filter-mine')).toBeInTheDocument();
    expect(screen.getByTestId('toggle-closed-deals')).toBeInTheDocument();
  });

  it('renders a deal row from the API in list view', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('deals-view-toggle')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('deals-view-toggle'));
    await waitFor(() => {
      // name appears in both mobile card and desktop table
      expect(screen.getAllByText(DEAL_1.name).length).toBeGreaterThanOrEqual(1);
    });
    // Stage label is rendered inside the desktop deal row (scoped to avoid matching the summary bar chip)
    const row = screen.getByTestId(`deal-link-${DEAL_1.id}`).closest('tr')!;
    expect(within(row).getByText(/prospecting/i)).toBeInTheDocument();
  });

  it('shows empty state in list view when no deals are returned', async () => {
    server.use(
      http.get('/api/v1/deals', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 50 }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('deals-view-toggle')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('deals-view-toggle'));
    await waitFor(() => {
      expect(screen.getByText('No deals yet. Add one to get started.')).toBeInTheDocument();
    });
  });

  it('renders the hide/show closed deals toggle in list view (MINCRM-176)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await waitFor(() => expect(screen.getByTestId('deals-view-toggle')).toBeInTheDocument());
    await user.click(screen.getByTestId('deals-view-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('toggle-closed-deals')).toBeInTheDocument();
    });
  });

  it('hides closed deals from list view when hide-closed toggle is clicked (MINCRM-176)', async () => {
    const closedDeal = {
      ...DEAL_1,
      id: '00000000-0000-0000-0000-000000000399',
      name: 'Closed Won Deal',
      stage: 'Closed Won' as const,
    };
    // Server-side: respect hideClosed=true param so pagination total is also accurate
    server.use(
      http.get('/api/v1/deals', ({ request }) => {
        const hideClosed = new URL(request.url).searchParams.get('hideClosed') === 'true';
        const deals = hideClosed ? [DEAL_1] : [DEAL_1, closedDeal];
        return HttpResponse.json({ data: deals, total: deals.length, page: 1, limit: 50 });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await waitFor(() => expect(screen.getByTestId('deals-view-toggle')).toBeInTheDocument());
    await user.click(screen.getByTestId('deals-view-toggle'));

    // Both deals visible initially
    await waitFor(() => {
      expect(screen.getAllByText(closedDeal.name).length).toBeGreaterThanOrEqual(1);
    });

    // Click hide closed — triggers a new query with hideClosed=true
    await user.click(screen.getByTestId('toggle-closed-deals'));

    // Closed deal should disappear; open deal stays
    await waitFor(() => {
      expect(screen.queryByText(closedDeal.name)).not.toBeInTheDocument();
    });
    expect(screen.getAllByText(DEAL_1.name).length).toBeGreaterThanOrEqual(1);
  });

  it('resets to page 1 when hide-closed toggle is clicked in list view (MINCRM-176)', async () => {
    const requests: URL[] = [];
    // Return enough total to show pagination (total > limit)
    server.use(
      http.get('/api/v1/deals', ({ request }) => {
        requests.push(new URL(request.url));
        return HttpResponse.json({ data: [DEAL_1], total: 100, page: 1, limit: 50 });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await waitFor(() => expect(screen.getByTestId('deals-view-toggle')).toBeInTheDocument());
    await user.click(screen.getByTestId('deals-view-toggle'));

    // Advance to page 2
    await waitFor(() => expect(screen.getByTestId('pagination-next')).toBeInTheDocument());
    await user.click(screen.getByTestId('pagination-next'));

    // Toggle hide-closed — should reset back to page 1
    requests.length = 0; // clear so we only check the next request
    await user.click(screen.getByTestId('toggle-closed-deals'));

    await waitFor(() => {
      const lastReq = requests[requests.length - 1];
      expect(lastReq?.searchParams.get('page')).not.toBe('2');
    });
  });

  it('shows error state in list view when the API fails', async () => {
    server.use(
      http.get('/api/v1/deals', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'fail' } }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('deals-view-toggle')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('deals-view-toggle'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('renders the owner column with the resolved user name in list view', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('deals-view-toggle')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('deals-view-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId(`deal-owner-${DEAL_1.id}`)).toHaveTextContent(ADMIN_USER.name);
    });
  });

  it('shows the owner toggle defaulting to All in list view', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('deals-view-toggle')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('deals-view-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('deals-owner-filter-all')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('deals-owner-filter-mine')).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });
  });

  it('filters deals to current user when Mine toggle is clicked in list view', async () => {
    const repDeal = {
      ...DEAL_1,
      id: '00000000-0000-0000-0000-000000000303',
      name: 'Rep Deal',
      owner_id: REP_USER.id,
    };
    server.use(
      http.get('/api/v1/deals', ({ request }) => {
        const owner = new URL(request.url).searchParams.get('owner');
        const deals = owner === 'me' ? [DEAL_1] : [DEAL_1, repDeal];
        return HttpResponse.json({ data: deals, total: deals.length, page: 1, limit: 50 });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('deals-view-toggle')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('deals-view-toggle'));

    await waitFor(() => {
      // name appears in both mobile card and desktop table
      expect(screen.getAllByText(repDeal.name).length).toBeGreaterThanOrEqual(1);
    });

    await user.click(screen.getByTestId('deals-owner-filter-mine'));

    await waitFor(() => {
      expect(screen.queryByText(repDeal.name)).not.toBeInTheDocument();
    });
    expect(screen.getAllByText(DEAL_1.name).length).toBeGreaterThanOrEqual(1);
  });

  it('shows fallback text for deals with an unresolvable owner in list view', async () => {
    server.use(
      http.get('/api/v1/deals', () =>
        HttpResponse.json({
          data: [{ ...DEAL_1, owner_id: '00000000-0000-0000-0000-000000000999' }],
          total: 1,
          page: 1,
          limit: 50,
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('deals-view-toggle')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('deals-view-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId(`deal-owner-${DEAL_1.id}`)).toHaveTextContent('Unknown');
    });
  });

  it('preserves owner filter when switching between board and list views (MINCRM-176)', async () => {
    const repDeal = {
      ...DEAL_1,
      id: '00000000-0000-0000-0000-000000000303',
      name: 'Rep Deal',
      owner_id: '00000000-0000-0000-0000-000000000002',
    };
    server.use(
      http.get('/api/v1/deals', ({ request }) => {
        const owner = new URL(request.url).searchParams.get('owner');
        const deals = owner === 'me' ? [DEAL_1] : [DEAL_1, repDeal];
        return HttpResponse.json({ data: deals, total: deals.length, page: 1, limit: 50 });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);

    // Board view starts with All filter active
    await waitFor(() => expect(screen.getByTestId('deals-owner-filter-all')).toBeInTheDocument());
    expect(screen.getByTestId('deals-owner-filter-all')).toHaveAttribute('aria-pressed', 'true');

    // Set filter to "mine" in board view
    await user.click(screen.getByTestId('deals-owner-filter-mine'));
    await waitFor(() =>
      expect(screen.getByTestId('deals-owner-filter-mine')).toHaveAttribute('aria-pressed', 'true'),
    );

    // Switch to list view — filter should still be "mine"
    await user.click(screen.getByTestId('deals-view-toggle'));
    await waitFor(() => expect(screen.queryByTestId('pipeline-board')).not.toBeInTheDocument());
    expect(screen.getByTestId('deals-owner-filter-mine')).toHaveAttribute('aria-pressed', 'true');

    // Switch back to board — filter should remain "mine"
    await user.click(screen.getByTestId('deals-view-toggle'));
    await waitFor(() => expect(screen.getByTestId('pipeline-board')).toBeInTheDocument());
    expect(screen.getByTestId('deals-owner-filter-mine')).toHaveAttribute('aria-pressed', 'true');
  });

  // ── Pipeline summary bar ───────────────────────────────────────────────────

  it('renders the pipeline summary bar in list view', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await waitFor(() => expect(screen.getByTestId('deals-view-toggle')).toBeInTheDocument());
    await user.click(screen.getByTestId('deals-view-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('pipeline-summary-bar')).toBeInTheDocument();
    });
  });

  it('renders a summary chip for each open pipeline stage', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await waitFor(() => expect(screen.getByTestId('deals-view-toggle')).toBeInTheDocument());
    await user.click(screen.getByTestId('deals-view-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('pipeline-summary-prospecting')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pipeline-summary-qualification')).toBeInTheDocument();
    expect(screen.getByTestId('pipeline-summary-proposal')).toBeInTheDocument();
    expect(screen.getByTestId('pipeline-summary-negotiation')).toBeInTheDocument();
    // Closed stages must NOT appear in the summary bar
    expect(screen.queryByTestId('pipeline-summary-closed-won')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pipeline-summary-closed-lost')).not.toBeInTheDocument();
  });

  it('shows correct deal count for a stage in the summary bar', async () => {
    // DEAL_1 is in Prospecting — expect count 1
    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await waitFor(() => expect(screen.getByTestId('deals-view-toggle')).toBeInTheDocument());
    await user.click(screen.getByTestId('deals-view-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('pipeline-summary-prospecting')).toHaveTextContent('1');
    });
    // Other stages should show 0
    expect(screen.getByTestId('pipeline-summary-qualification')).toHaveTextContent('0');
  });

  it('does not render the pipeline summary bar in board view', async () => {
    renderWithProviders(<DealsPage />);
    await waitFor(() => expect(screen.getByTestId('pipeline-board')).toBeInTheDocument());
    expect(screen.queryByTestId('pipeline-summary-bar')).not.toBeInTheDocument();
  });

  it('does not render the pipeline summary bar when the API errors in list view', async () => {
    server.use(
      http.get('/api/v1/deals', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'fail' } }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await waitFor(() => expect(screen.getByTestId('deals-view-toggle')).toBeInTheDocument());
    await user.click(screen.getByTestId('deals-view-toggle'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('pipeline-summary-bar')).not.toBeInTheDocument();
  });

  // ── View mode persistence (MINCRM-146) ───────────────────────────────────────

  it('restores list view when sessionStorage has deals.viewMode=list', async () => {
    sessionStorage.setItem('deals.viewMode', 'list');
    renderWithProviders(<DealsPage />);
    // List view: pipeline-board is absent; owner filter and toggle-closed-deals are present in both views
    await waitFor(() => {
      expect(screen.getByTestId('deals-owner-filter-all')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('pipeline-board')).not.toBeInTheDocument();
  });

  it('defaults to board view when sessionStorage has no stored value', async () => {
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('pipeline-board')).toBeInTheDocument();
    });
  });

  it('persists list view to sessionStorage when toggled', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await waitFor(() => expect(screen.getByTestId('deals-view-toggle')).toBeInTheDocument());
    await user.click(screen.getByTestId('deals-view-toggle'));
    expect(sessionStorage.getItem('deals.viewMode')).toBe('list');
  });

  it('persists board view to sessionStorage when toggled back from list', async () => {
    sessionStorage.setItem('deals.viewMode', 'list');
    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await waitFor(() => expect(screen.getByTestId('deals-view-toggle')).toBeInTheDocument());
    await user.click(screen.getByTestId('deals-view-toggle'));
    expect(sessionStorage.getItem('deals.viewMode')).toBe('board');
  });

  it('toggles back to board view from list view', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('deals-view-toggle')).toBeInTheDocument();
    });
    // Switch to list
    await user.click(screen.getByTestId('deals-view-toggle'));
    expect(screen.queryByTestId('pipeline-board')).not.toBeInTheDocument();
    // Switch back to board
    await user.click(screen.getByTestId('deals-view-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('pipeline-board')).toBeInTheDocument();
    });
    // Filter controls are present in board view too (MINCRM-176)
    expect(screen.getByTestId('deals-owner-filter-all')).toBeInTheDocument();
    expect(screen.getByTestId('deals-owner-filter-mine')).toBeInTheDocument();
    expect(screen.getByTestId('toggle-closed-deals')).toBeInTheDocument();
  });

  // ── CSV export ─────────────────────────────────────────────────────────────

  describe('CSV export buttons', () => {
    beforeEach(() => {
      vi.spyOn(dealsApi, 'exportDealsCsv').mockResolvedValue(undefined);
    });

    it('renders the Export CSV button', async () => {
      renderWithProviders(<DealsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('deals-export-csv-button')).toBeInTheDocument();
      });
    });

    it('renders the Export All button for admin users', async () => {
      renderWithProviders(<DealsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('deals-export-all-button')).toBeInTheDocument();
      });
    });

    it('does not render the Export All button for rep users', async () => {
      server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ user: REP_USER })));
      renderWithProviders(<DealsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('deals-export-csv-button')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('deals-export-all-button')).not.toBeInTheDocument();
    });

    it('calls exportDealsCsv when Export CSV is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<DealsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('deals-export-csv-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('deals-export-csv-button'));
      expect(dealsApi.exportDealsCsv).toHaveBeenCalled();
    });

    it('calls exportDealsCsv with all:true when Export All is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<DealsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('deals-export-all-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('deals-export-all-button'));
      expect(dealsApi.exportDealsCsv).toHaveBeenCalledWith({ all: true });
    });
  });

  // ── Bulk selection (list view only) ────────────────────────────────────────

  describe('bulk selection', () => {
    const DEAL_2 = {
      ...DEAL_1,
      id: '00000000-0000-0000-0000-000000000302',
      name: 'Second Deal',
    };

    async function switchToListView(user: ReturnType<typeof userEvent.setup>) {
      await waitFor(() => {
        expect(screen.getByTestId('deals-view-toggle')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('deals-view-toggle'));
    }

    beforeEach(() => {
      server.use(
        http.get('/api/v1/deals', () =>
          HttpResponse.json({ data: [DEAL_1, DEAL_2], total: 2, page: 1, limit: 50 }),
        ),
      );
    });

    const getRowCheckbox = (id: string) => screen.getAllByTestId(`bulk-select-${id}`)[0]!;

    it('shows row checkboxes in the deal list view', async () => {
      const user = userEvent.setup();
      renderWithProviders(<DealsPage />);
      await switchToListView(user);
      await waitFor(() => {
        expect(screen.getAllByTestId(`bulk-select-${DEAL_1.id}`).length).toBeGreaterThan(0);
      });
    });

    it('shows the bulk action bar after selecting a row', async () => {
      const user = userEvent.setup();
      renderWithProviders(<DealsPage />);
      await switchToListView(user);
      await waitFor(() => {
        expect(screen.getAllByTestId(`bulk-select-${DEAL_1.id}`).length).toBeGreaterThan(0);
      });
      await user.click(getRowCheckbox(DEAL_1.id));
      expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
    });

    it('does not show the bulk action bar before any rows are selected', async () => {
      const user = userEvent.setup();
      renderWithProviders(<DealsPage />);
      await switchToListView(user);
      await waitFor(() => {
        expect(screen.getAllByTestId(`bulk-select-${DEAL_1.id}`).length).toBeGreaterThan(0);
      });
      expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
    });

    it('select-all checkbox shows bulk action bar with all rows selected', async () => {
      const user = userEvent.setup();
      renderWithProviders(<DealsPage />);
      await switchToListView(user);
      await waitFor(() => {
        expect(screen.getAllByTestId(`bulk-select-${DEAL_1.id}`).length).toBeGreaterThan(0);
        expect(screen.getAllByTestId(`bulk-select-${DEAL_2.id}`).length).toBeGreaterThan(0);
      });
      await user.click(screen.getAllByTestId('bulk-select-all')[0]!);
      await waitFor(() => {
        expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
      });
      expect(screen.getByTestId('bulk-action-count')).toHaveTextContent('2');
    });

    it('clear selection hides the bulk action bar', async () => {
      const user = userEvent.setup();
      renderWithProviders(<DealsPage />);
      await switchToListView(user);
      await waitFor(() => {
        expect(screen.getAllByTestId(`bulk-select-${DEAL_1.id}`).length).toBeGreaterThan(0);
      });
      await user.click(getRowCheckbox(DEAL_1.id));
      expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
      await user.click(screen.getByTestId('bulk-clear-selection'));
      expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
    });

    it('bulk delete calls the API and clears selection on success', async () => {
      vi.spyOn(bulkApi, 'bulkDeals').mockResolvedValue({ affected: 1 });
      const user = userEvent.setup();
      renderWithProviders(<DealsPage />);
      await switchToListView(user);
      await waitFor(() => {
        expect(screen.getAllByTestId(`bulk-select-${DEAL_1.id}`).length).toBeGreaterThan(0);
      });
      await user.click(getRowCheckbox(DEAL_1.id));
      await user.click(screen.getByTestId('bulk-delete-button'));

      await waitFor(() => {
        expect(screen.getByTestId('confirm-delete-confirm')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('confirm-delete-confirm'));

      await waitFor(() => {
        expect(bulkApi.bulkDeals).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'delete', ids: [DEAL_1.id] }),
          expect.anything(),
        );
      });
      await waitFor(() => {
        expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
      });
    });
  });
});
