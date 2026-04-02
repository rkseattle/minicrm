/**
 * Tests for the DealDetailPage component.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import DealDetailPage from './DealDetailPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { DEAL_1, CONTACT_1, CONTACT_2 } from '../test/msw/handlers.js';

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
    expect(screen.getByTestId('detail-close-date')).toHaveTextContent('Dec 31, 2026');
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

  it('shows an unlink button next to each linked contact', async () => {
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
      expect(screen.getByTestId(`unlink-contact-${CONTACT_1.id}`)).toBeInTheDocument();
    });
  });

  it('calls unlink API and refreshes when unlink button is clicked', async () => {
    const unlinkSpy = vi.fn();
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
      http.delete('/api/deals/:id/contacts/:contactId', ({ params }) => {
        unlinkSpy(params.id, params.contactId);
        return HttpResponse.json({ contacts: [] });
      }),
    );

    const user = userEvent.setup();
    renderDealDetail();

    await waitFor(() => {
      expect(screen.getByTestId(`unlink-contact-${CONTACT_1.id}`)).toBeInTheDocument();
    });
    await user.click(screen.getByTestId(`unlink-contact-${CONTACT_1.id}`));

    await waitFor(() => {
      expect(unlinkSpy).toHaveBeenCalledWith(DEAL_1.id, CONTACT_1.id);
    });
  });

  it('shows link contact select when there are linkable contacts', async () => {
    renderDealDetail();
    await waitFor(() => {
      expect(screen.getByTestId('link-contact-select')).toBeInTheDocument();
    });
  });

  it('calls link API when a contact is selected and Link button is clicked', async () => {
    const linkSpy = vi.fn();
    server.use(
      http.post('/api/deals/:id/contacts/:contactId', ({ params }) => {
        linkSpy(params.id, params.contactId);
        return HttpResponse.json({ contacts: [CONTACT_1] });
      }),
    );

    const user = userEvent.setup();
    renderDealDetail();

    await waitFor(() => {
      expect(screen.getByTestId('link-contact-select')).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByTestId('link-contact-select'), CONTACT_1.id);
    await user.click(screen.getByTestId('link-contact-button'));

    await waitFor(() => {
      expect(linkSpy).toHaveBeenCalledWith(DEAL_1.id, CONTACT_1.id);
    });
  });

  it('opens the close deal modal when Closed Won is selected in the edit form', async () => {
    const user = userEvent.setup();
    renderDealDetail();

    await waitFor(() => {
      expect(screen.getByTestId('edit-deal-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-deal-button'));

    await waitFor(() => {
      expect(screen.getByTestId('deal-stage-select')).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByTestId('deal-stage-select'), 'Closed Won');

    expect(screen.getByTestId('close-deal-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('close-deal-loss-reason-input')).not.toBeInTheDocument();
  });

  it('shows loss reason field when Closed Lost is selected in the edit form', async () => {
    const user = userEvent.setup();
    renderDealDetail();

    await waitFor(() => {
      expect(screen.getByTestId('edit-deal-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-deal-button'));

    await waitFor(() => {
      expect(screen.getByTestId('deal-stage-select')).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByTestId('deal-stage-select'), 'Closed Lost');

    expect(screen.getByTestId('close-deal-modal')).toBeInTheDocument();
    expect(screen.getByTestId('close-deal-loss-reason-input')).toBeInTheDocument();
  });

  it('calls PATCH with correct stage payload when close modal is confirmed', async () => {
    const patchSpy = vi.fn();
    server.use(
      http.patch('/api/deals/:id', async ({ params, request }) => {
        const body = await request.json();
        patchSpy(params.id, body);
        return HttpResponse.json({ deal: { ...DEAL_1, ...(body as object) } });
      }),
    );

    const user = userEvent.setup();
    renderDealDetail();

    await waitFor(() => {
      expect(screen.getByTestId('edit-deal-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-deal-button'));

    await waitFor(() => {
      expect(screen.getByTestId('deal-stage-select')).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByTestId('deal-stage-select'), 'Closed Won');

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

  it('closes the modal without saving when cancel is clicked', async () => {
    const patchSpy = vi.fn();
    server.use(
      http.patch('/api/deals/:id', async ({ params, request }) => {
        const body = (await request.json()) as { stage: string };
        patchSpy(params.id, body.stage);
        return HttpResponse.json({ deal: { ...DEAL_1, stage: body.stage } });
      }),
    );

    const user = userEvent.setup();
    renderDealDetail();

    await waitFor(() => {
      expect(screen.getByTestId('edit-deal-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-deal-button'));

    await waitFor(() => {
      expect(screen.getByTestId('deal-stage-select')).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByTestId('deal-stage-select'), 'Closed Lost');

    await waitFor(() => {
      expect(screen.getByTestId('close-deal-modal')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('close-deal-cancel'));

    expect(screen.queryByTestId('close-deal-modal')).not.toBeInTheDocument();
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('hides link select when all contacts are already linked', async () => {
    server.use(
      http.get('/api/deals/:id', ({ params }) => {
        if (params.id === DEAL_1.id) {
          // All contacts (CONTACT_1, CONTACT_2) are linked
          return HttpResponse.json({ deal: DEAL_1, contacts: [CONTACT_1, CONTACT_2] });
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
    expect(screen.queryByTestId('link-contact-form')).not.toBeInTheDocument();
  });
});
