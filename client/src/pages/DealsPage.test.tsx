/**
 * Tests for the DealsPage component.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import DealsPage from './DealsPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { DEAL_1, ADMIN_USER, REP_USER } from '../test/msw/handlers.js';

describe('DealsPage', () => {
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

  it('renders a deal row from the API', async () => {
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByText(DEAL_1.name)).toBeInTheDocument();
    });
    expect(screen.getByText(DEAL_1.stage)).toBeInTheDocument();
  });

  it('shows empty state when no deals are returned', async () => {
    server.use(http.get('/api/deals', () => HttpResponse.json({ deals: [] })));
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByText('No deals yet. Add one to get started.')).toBeInTheDocument();
    });
  });

  it('shows error state when the API fails', async () => {
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

  it('renders the owner column with the resolved user name', async () => {
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`deal-owner-${DEAL_1.id}`)).toHaveTextContent(ADMIN_USER.name);
    });
  });

  it('shows the owner filter select defaulting to all', async () => {
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      const filter = screen.getByTestId<HTMLSelectElement>('deals-owner-filter');
      expect(filter.value).toBe('all');
    });
  });

  it('filters deals to current user when owner filter is set to me', async () => {
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
      expect(screen.getByText(repDeal.name)).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByTestId('deals-owner-filter'), 'me');

    await waitFor(() => {
      expect(screen.queryByText(repDeal.name)).not.toBeInTheDocument();
    });
    expect(screen.getByText(DEAL_1.name)).toBeInTheDocument();
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

  it('shows fallback text for deals with an unresolvable owner', async () => {
    server.use(
      http.get('/api/deals', () =>
        HttpResponse.json({
          deals: [{ ...DEAL_1, owner_id: '00000000-0000-0000-0000-000000000999' }],
        }),
      ),
    );
    renderWithProviders(<DealsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`deal-owner-${DEAL_1.id}`)).toHaveTextContent('Unknown');
    });
  });
});
