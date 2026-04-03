/**
 * Tests for the DealsPage component.
 * Covers both board view (default) and list view (toggled via deals-view-toggle button).
 * MINCRM-51: board view is now the default; list view is toggled.
 */

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import DealsPage from './DealsPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { DEAL_1, ADMIN_USER, REP_USER } from '../test/msw/handlers.js';
import { PIPELINE_STAGES } from '@shared/schemas/dealSchema.js';

describe('DealsPage', () => {
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

  it('shows loading state in board view while deals are being fetched', () => {
    renderWithProviders(<DealsPage />);
    expect(screen.getByRole('paragraph', { hidden: true })).toHaveAttribute('aria-busy', 'true');
  });

  it('shows error state in board view when the API fails', async () => {
    server.use(
      http.get('/api/deals', () =>
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
      http.patch('/api/deals/:id', () =>
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
    // The owner toggle is only visible in list view
    expect(screen.getByTestId('deals-owner-filter-all')).toBeInTheDocument();
    expect(screen.getByTestId('deals-owner-filter-mine')).toBeInTheDocument();
  });

  it('renders a deal row from the API in list view', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('deals-view-toggle')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('deals-view-toggle'));
    await waitFor(() => {
      expect(screen.getByText(DEAL_1.name)).toBeInTheDocument();
    });
    // Stage label is rendered inside the deal row (scoped to avoid matching the summary bar chip)
    const row = screen.getByTestId(`deal-link-${DEAL_1.id}`).closest('tr')!;
    expect(within(row).getByText(/prospecting/i)).toBeInTheDocument();
  });

  it('shows empty state in list view when no deals are returned', async () => {
    server.use(http.get('/api/deals', () => HttpResponse.json({ deals: [] })));
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

  it('shows error state in list view when the API fails', async () => {
    server.use(
      http.get('/api/deals', () =>
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
      http.get('/api/deals', ({ request }) => {
        const owner = new URL(request.url).searchParams.get('owner');
        const deals = owner === 'me' ? [DEAL_1] : [DEAL_1, repDeal];
        return HttpResponse.json({ deals });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('deals-view-toggle')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('deals-view-toggle'));

    await waitFor(() => {
      expect(screen.getByText(repDeal.name)).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('deals-owner-filter-mine'));

    await waitFor(() => {
      expect(screen.queryByText(repDeal.name)).not.toBeInTheDocument();
    });
    expect(screen.getByText(DEAL_1.name)).toBeInTheDocument();
  });

  it('shows fallback text for deals with an unresolvable owner in list view', async () => {
    server.use(
      http.get('/api/deals', () =>
        HttpResponse.json({
          deals: [{ ...DEAL_1, owner_id: '00000000-0000-0000-0000-000000000999' }],
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

  it('resets owner filter to all when switching back to board view', async () => {
    const repDeal = {
      ...DEAL_1,
      id: '00000000-0000-0000-0000-000000000303',
      name: 'Rep Deal',
      owner_id: '00000000-0000-0000-0000-000000000002',
    };
    server.use(
      http.get('/api/deals', ({ request }) => {
        const owner = new URL(request.url).searchParams.get('owner');
        const deals = owner === 'me' ? [DEAL_1] : [DEAL_1, repDeal];
        return HttpResponse.json({ deals });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);

    // Switch to list view and set filter to "mine"
    await waitFor(() => expect(screen.getByTestId('deals-view-toggle')).toBeInTheDocument());
    await user.click(screen.getByTestId('deals-view-toggle'));
    await waitFor(() => expect(screen.getByTestId('deals-owner-filter-mine')).toBeInTheDocument());
    await user.click(screen.getByTestId('deals-owner-filter-mine'));

    // Switch back to board — filter should be reset to all
    await user.click(screen.getByTestId('deals-view-toggle'));
    await waitFor(() => expect(screen.getByTestId('pipeline-board')).toBeInTheDocument());

    // Both deals should be visible on the board (not just the filtered one)
    await waitFor(() => {
      expect(screen.getByTestId(`deal-card-${DEAL_1.id}`)).toBeInTheDocument();
    });

    // Switch to list again to confirm filter was reset
    await user.click(screen.getByTestId('deals-view-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('deals-owner-filter-all')).toHaveAttribute('aria-pressed', 'true');
    });
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
      http.get('/api/deals', () =>
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
    expect(screen.queryByTestId('deals-owner-filter-all')).not.toBeInTheDocument();
    expect(screen.queryByTestId('deals-owner-filter-mine')).not.toBeInTheDocument();
  });
});
