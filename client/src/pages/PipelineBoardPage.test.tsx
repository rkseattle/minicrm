/**
 * Tests for the PipelineBoardPage component.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { QueryClient } from '@tanstack/react-query';
import PipelineBoardPage from './PipelineBoardPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { DEAL_1, ACCOUNT_1 } from '../test/msw/handlers.js';
import { PIPELINE_STAGES } from '@shared/schemas/dealSchema.js';
import { DASHBOARD_QUERY_KEY } from '@/api/dashboard.js';
import { WIN_LOSS_REPORT_QUERY_KEY } from '@/api/reports.js';

describe('PipelineBoardPage', () => {
  it('renders the pipeline board heading', async () => {
    renderWithProviders(<PipelineBoardPage />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Pipeline Board' })).toBeInTheDocument();
    });
  });

  it('renders a column for each pipeline stage', async () => {
    renderWithProviders(<PipelineBoardPage />);
    await waitFor(() => {
      expect(screen.getByTestId('pipeline-board')).toBeInTheDocument();
    });
    for (const stage of PIPELINE_STAGES) {
      const slug = stage.toLowerCase().replace(/\s+/g, '-');
      expect(screen.getByTestId(`stage-column-${slug}`)).toBeInTheDocument();
    }
  });

  it('renders a deal card in the correct stage column', async () => {
    renderWithProviders(<PipelineBoardPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`deal-card-${DEAL_1.id}`)).toBeInTheDocument();
    });
    // DEAL_1 is in 'Prospecting' — its card should be inside that column
    const column = screen.getByTestId('stage-column-prospecting');
    expect(column).toContainElement(screen.getByTestId(`deal-card-${DEAL_1.id}`));
  });

  it('shows the deal name as a link on the card', async () => {
    renderWithProviders(<PipelineBoardPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`deal-card-link-${DEAL_1.id}`)).toHaveTextContent(DEAL_1.name);
    });
  });

  it('shows the account name on the deal card', async () => {
    renderWithProviders(<PipelineBoardPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`deal-card-account-${DEAL_1.id}`)).toHaveTextContent(
        ACCOUNT_1.name,
      );
    });
  });

  it('shows the deal value on the card', async () => {
    renderWithProviders(<PipelineBoardPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`deal-card-value-${DEAL_1.id}`)).toHaveTextContent('50,000');
    });
  });

  it('shows the close date on the card', async () => {
    renderWithProviders(<PipelineBoardPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`deal-card-close-date-${DEAL_1.id}`)).toHaveTextContent(
        DEAL_1.close_date!,
      );
    });
  });

  it('shows deal count in the Prospecting column header', async () => {
    renderWithProviders(<PipelineBoardPage />);
    await waitFor(() => {
      expect(screen.getByTestId('stage-column-count-prospecting')).toHaveTextContent('1');
    });
  });

  it('shows total value in the Prospecting column header', async () => {
    renderWithProviders(<PipelineBoardPage />);
    await waitFor(() => {
      // DEAL_1.value = '50000.00'
      expect(screen.getByTestId('stage-column-total-prospecting')).toHaveTextContent('$50,000');
    });
  });

  it('shows 0 count for empty stage columns', async () => {
    renderWithProviders(<PipelineBoardPage />);
    await waitFor(() => {
      expect(screen.getByTestId('stage-column-count-qualification')).toHaveTextContent('0');
    });
  });

  it('calls updateDeal and refreshes when a stage is changed', async () => {
    const patchSpy = vi.fn();
    server.use(
      http.patch('/api/deals/:id', async ({ params, request }) => {
        const body = (await request.json()) as { stage: string };
        patchSpy(params.id, body.stage);
        return HttpResponse.json({ deal: { ...DEAL_1, stage: body.stage } });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<PipelineBoardPage />);

    await waitFor(() => {
      expect(screen.getByTestId(`deal-card-stage-select-${DEAL_1.id}`)).toBeInTheDocument();
    });

    await user.selectOptions(
      screen.getByTestId(`deal-card-stage-select-${DEAL_1.id}`),
      'Qualification',
    );

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith(DEAL_1.id, 'Qualification');
    });
  });

  it('shows loading state while deals are being fetched', () => {
    // The loading indicator is visible before the first query settles
    renderWithProviders(<PipelineBoardPage />);
    expect(screen.getByRole('paragraph', { hidden: true })).toHaveAttribute('aria-busy', 'true');
  });

  it('shows error state when the deals API fails', async () => {
    server.use(
      http.get('/api/deals', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'fail' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<PipelineBoardPage />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('shows an inline error banner when a stage change fails', async () => {
    server.use(
      http.patch('/api/deals/:id', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'fail' } }, { status: 500 }),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(<PipelineBoardPage />);

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

  it('clears the stage error banner when a subsequent change succeeds', async () => {
    let failNext = true;
    server.use(
      http.patch('/api/deals/:id', async ({ request }) => {
        const body = (await request.json()) as { stage: string };
        if (failNext) {
          failNext = false;
          return HttpResponse.json(
            { error: { code: 'INTERNAL_ERROR', message: 'fail' } },
            { status: 500 },
          );
        }
        return HttpResponse.json({ deal: { ...DEAL_1, stage: body.stage } });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<PipelineBoardPage />);

    await waitFor(() => {
      expect(screen.getByTestId(`deal-card-stage-select-${DEAL_1.id}`)).toBeInTheDocument();
    });

    // First change — fails, shows error
    await user.selectOptions(
      screen.getByTestId(`deal-card-stage-select-${DEAL_1.id}`),
      'Qualification',
    );
    await waitFor(() => {
      expect(screen.getByTestId('stage-update-error')).toBeInTheDocument();
    });

    // Second change — succeeds, error clears
    await user.selectOptions(screen.getByTestId(`deal-card-stage-select-${DEAL_1.id}`), 'Proposal');
    await waitFor(() => {
      expect(screen.queryByTestId('stage-update-error')).not.toBeInTheDocument();
    });
  });

  it('renders Closed Won and Closed Lost columns with distinct test IDs', async () => {
    renderWithProviders(<PipelineBoardPage />);
    await waitFor(() => {
      expect(screen.getByTestId('stage-column-closed-won')).toBeInTheDocument();
      expect(screen.getByTestId('stage-column-closed-lost')).toBeInTheDocument();
    });
  });

  it('renders the hide/show closed deals toggle button', async () => {
    renderWithProviders(<PipelineBoardPage />);
    await waitFor(() => {
      expect(screen.getByTestId('toggle-closed-deals')).toBeInTheDocument();
    });
  });

  it('opens the close deal modal instead of immediately patching when Closed Won is selected', async () => {
    const patchSpy = vi.fn();
    server.use(
      http.patch('/api/deals/:id', async ({ params, request }) => {
        const body = (await request.json()) as { stage: string };
        patchSpy(params.id, body.stage);
        return HttpResponse.json({ deal: { ...DEAL_1, stage: body.stage } });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<PipelineBoardPage />);

    await waitFor(() => {
      expect(screen.getByTestId(`deal-card-stage-select-${DEAL_1.id}`)).toBeInTheDocument();
    });

    await user.selectOptions(
      screen.getByTestId(`deal-card-stage-select-${DEAL_1.id}`),
      'Closed Won',
    );

    // Modal should open — patch should NOT have fired yet
    expect(screen.getByTestId('close-deal-modal')).toBeInTheDocument();
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('shows the loss reason field when Closed Lost is selected', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PipelineBoardPage />);

    await waitFor(() => {
      expect(screen.getByTestId(`deal-card-stage-select-${DEAL_1.id}`)).toBeInTheDocument();
    });

    await user.selectOptions(
      screen.getByTestId(`deal-card-stage-select-${DEAL_1.id}`),
      'Closed Lost',
    );

    expect(screen.getByTestId('close-deal-loss-reason-input')).toBeInTheDocument();
  });

  it('calls PATCH with stage and close_date when close modal is confirmed', async () => {
    const patchSpy = vi.fn();
    server.use(
      http.patch('/api/deals/:id', async ({ params, request }) => {
        const body = await request.json();
        patchSpy(params.id, body);
        return HttpResponse.json({ deal: { ...DEAL_1, ...(body as object) } });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<PipelineBoardPage />);

    await waitFor(() => {
      expect(screen.getByTestId(`deal-card-stage-select-${DEAL_1.id}`)).toBeInTheDocument();
    });

    await user.selectOptions(
      screen.getByTestId(`deal-card-stage-select-${DEAL_1.id}`),
      'Closed Won',
    );

    await waitFor(() => {
      expect(screen.getByTestId('close-deal-modal')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('close-deal-confirm'));

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith(
        DEAL_1.id,
        expect.objectContaining({ stage: 'Closed Won' }),
      );
    });
  });

  it('calls PATCH with loss_reason when Closed Lost is confirmed with a reason', async () => {
    const patchSpy = vi.fn();
    server.use(
      http.patch('/api/deals/:id', async ({ params, request }) => {
        const body = await request.json();
        patchSpy(params.id, body);
        return HttpResponse.json({ deal: { ...DEAL_1, ...(body as object) } });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<PipelineBoardPage />);

    await waitFor(() => {
      expect(screen.getByTestId(`deal-card-stage-select-${DEAL_1.id}`)).toBeInTheDocument();
    });

    await user.selectOptions(
      screen.getByTestId(`deal-card-stage-select-${DEAL_1.id}`),
      'Closed Lost',
    );

    await waitFor(() => {
      expect(screen.getByTestId('close-deal-modal')).toBeInTheDocument();
    });

    await user.type(screen.getByTestId('close-deal-loss-reason-input'), 'Budget constraints');
    await user.click(screen.getByTestId('close-deal-confirm'));

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith(
        DEAL_1.id,
        expect.objectContaining({ stage: 'Closed Lost', loss_reason: 'Budget constraints' }),
      );
    });
  });

  it('invalidates dashboard cache on any stage change and win/loss cache only on terminal stage', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    server.use(
      http.patch('/api/deals/:id', async ({ request }) => {
        const body = (await request.json()) as { stage: string };
        return HttpResponse.json({ deal: { ...DEAL_1, stage: body.stage } });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<PipelineBoardPage />, { queryClient });

    await waitFor(() => {
      expect(screen.getByTestId(`deal-card-stage-select-${DEAL_1.id}`)).toBeInTheDocument();
    });

    // Non-terminal stage change — dashboard invalidated, win/loss not
    await user.selectOptions(
      screen.getByTestId(`deal-card-stage-select-${DEAL_1.id}`),
      'Qualification',
    );

    await waitFor(() => {
      const invalidatedKeys = invalidateSpy.mock.calls.map(
        (call) => (call[0] as { queryKey: unknown[] }).queryKey,
      );
      expect(invalidatedKeys).toContainEqual(DASHBOARD_QUERY_KEY);
      expect(invalidatedKeys).not.toContainEqual(WIN_LOSS_REPORT_QUERY_KEY);
    });

    invalidateSpy.mockClear();

    // Terminal stage change — both dashboard and win/loss invalidated
    await user.selectOptions(
      screen.getByTestId(`deal-card-stage-select-${DEAL_1.id}`),
      'Closed Won',
    );

    // Confirm the close deal modal
    await waitFor(() => {
      expect(screen.getByTestId('close-deal-modal')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('close-deal-confirm'));

    await waitFor(() => {
      const invalidatedKeys = invalidateSpy.mock.calls.map(
        (call) => (call[0] as { queryKey: unknown[] }).queryKey,
      );
      expect(invalidatedKeys).toContainEqual(DASHBOARD_QUERY_KEY);
      expect(invalidatedKeys).toContainEqual(WIN_LOSS_REPORT_QUERY_KEY);
    });
  });

  it('does not call PATCH when the close modal is cancelled', async () => {
    const patchSpy = vi.fn();
    server.use(
      http.patch('/api/deals/:id', async ({ params, request }) => {
        const body = (await request.json()) as { stage: string };
        patchSpy(params.id, body.stage);
        return HttpResponse.json({ deal: { ...DEAL_1, stage: body.stage } });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<PipelineBoardPage />);

    await waitFor(() => {
      expect(screen.getByTestId(`deal-card-stage-select-${DEAL_1.id}`)).toBeInTheDocument();
    });

    await user.selectOptions(
      screen.getByTestId(`deal-card-stage-select-${DEAL_1.id}`),
      'Closed Won',
    );

    await waitFor(() => {
      expect(screen.getByTestId('close-deal-modal')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('close-deal-cancel'));

    expect(screen.queryByTestId('close-deal-modal')).not.toBeInTheDocument();
    expect(patchSpy).not.toHaveBeenCalled();
  });
});
