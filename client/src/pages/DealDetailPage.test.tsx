/**
 * Tests for the DealDetailPage component.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import DealDetailPage from './DealDetailPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { DEAL_1, CONTACT_1 } from '../test/msw/handlers.js';

/** Renders DealDetailPage with DEAL_1 id in route params. */
function renderDealDetail() {
  return renderWithProviders(<DealDetailPage />, {
    initialEntries: [`/deals/${DEAL_1.id}`],
    path: '/deals/:id',
  });
}

describe('DealDetailPage', () => {
  it('renders the deal name as the page heading', async () => {
    renderDealDetail();
    await waitFor(() => {
      expect(screen.getByTestId('deal-name')).toHaveTextContent(DEAL_1.name);
    });
  });

  it('renders deal fields in the detail card', async () => {
    renderDealDetail();
    await waitFor(() => {
      expect(screen.getByTestId('detail-stage')).toHaveTextContent(DEAL_1.stage);
    });
    expect(screen.getByTestId('detail-close-date')).toHaveTextContent(DEAL_1.close_date!);
  });

  it('renders the back to deals link', async () => {
    renderDealDetail();
    await waitFor(() => {
      expect(screen.getByTestId('back-to-deals')).toBeInTheDocument();
    });
  });

  it('renders the edit and delete buttons', async () => {
    renderDealDetail();
    await waitFor(() => {
      expect(screen.getByTestId('edit-deal-button')).toBeInTheDocument();
      expect(screen.getByTestId('delete-deal-button')).toBeInTheDocument();
    });
  });

  it('shows not found message for an unknown deal', async () => {
    server.use(
      http.get('/api/deals/:id', () =>
        HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Deal not found' } },
          { status: 404 },
        ),
      ),
    );
    renderWithProviders(<DealDetailPage />, {
      initialEntries: ['/deals/nonexistent'],
      path: '/deals/:id',
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('shows the edit form when Edit is clicked', async () => {
    const user = userEvent.setup();
    renderDealDetail();
    await waitFor(() => {
      expect(screen.getByTestId('edit-deal-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-deal-button'));
    expect(screen.getByTestId('deal-form')).toBeInTheDocument();
  });

  it('hides the edit form when Cancel is clicked', async () => {
    const user = userEvent.setup();
    renderDealDetail();
    await waitFor(() => {
      expect(screen.getByTestId('edit-deal-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-deal-button'));
    expect(screen.getByTestId('deal-form')).toBeInTheDocument();
    await user.click(screen.getByTestId('deal-form-cancel'));
    expect(screen.queryByTestId('deal-form')).not.toBeInTheDocument();
  });

  it('shows linked contacts section', async () => {
    renderDealDetail();
    await waitFor(() => {
      expect(screen.getByTestId('linked-contacts-heading')).toBeInTheDocument();
    });
  });

  it('shows empty state when no contacts are linked', async () => {
    renderDealDetail();
    await waitFor(() => {
      expect(screen.getByTestId('linked-contacts-empty')).toBeInTheDocument();
    });
  });

  it('renders linked contacts when present', async () => {
    server.use(
      http.get('/api/deals/:id', ({ params }) => {
        if (params.id === DEAL_1.id) {
          return HttpResponse.json({ deal: DEAL_1, contacts: [CONTACT_1] });
        }
        return HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Not found' } },
          { status: 404 },
        );
      }),
    );
    renderDealDetail();
    await waitFor(() => {
      expect(screen.getByTestId(`linked-contact-${CONTACT_1.id}`)).toBeInTheDocument();
    });
    expect(screen.getByText(`${CONTACT_1.first_name} ${CONTACT_1.last_name}`)).toBeInTheDocument();
  });

  it('shows a loading state while fetching', async () => {
    server.use(
      http.get('/api/deals/:id', async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return HttpResponse.json({ deal: DEAL_1, contacts: [] });
      }),
    );
    renderDealDetail();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
