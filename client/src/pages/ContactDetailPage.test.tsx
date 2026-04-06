/**
 * Tests for the ContactDetailPage component.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import ContactDetailPage from './ContactDetailPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { CONTACT_1, ACCOUNT_1, ADMIN_USER, REP_USER, DEAL_1 } from '../test/msw/handlers.js';

describe('ContactDetailPage', () => {
  it('renders the contact name', async () => {
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('contact-name')).toHaveTextContent(
        `${CONTACT_1.first_name} ${CONTACT_1.last_name}`,
      );
    });
  });

  it('renders contact detail fields', async () => {
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('detail-email')).toHaveTextContent(CONTACT_1.email);
    });
    expect(screen.getByTestId('detail-phone')).toHaveTextContent(CONTACT_1.phone!);
    expect(screen.getByTestId('detail-title')).toHaveTextContent(CONTACT_1.title!);
    expect(screen.getByTestId('detail-department')).toHaveTextContent(CONTACT_1.department!);
  });

  it('renders edit and delete buttons', async () => {
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument();
    });
    expect(screen.getByTestId('delete-contact-button')).toBeInTheDocument();
  });

  it('shows the edit form when Edit is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-contact-button'));
    expect(screen.getByTestId('contact-form')).toBeInTheDocument();
  });

  it('pre-populates the edit form with existing values', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-contact-button'));

    expect(screen.getByTestId<HTMLInputElement>('contact-first-name').value).toBe(
      CONTACT_1.first_name,
    );
    expect(screen.getByTestId<HTMLInputElement>('contact-email').value).toBe(CONTACT_1.email);
  });

  it('saves the edit form and returns to detail view', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-contact-button'));
    await user.click(screen.getByTestId('contact-form-submit'));

    await waitFor(() => {
      expect(screen.queryByTestId('contact-form')).not.toBeInTheDocument();
    });
  });

  it('cancels the edit form and returns to detail view', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-contact-button'));
    await user.click(screen.getByTestId('contact-form-cancel'));

    expect(screen.queryByTestId('contact-form')).not.toBeInTheDocument();
    expect(screen.getByTestId('contact-name')).toBeInTheDocument();
  });

  it('shows not-found message when contact does not exist', async () => {
    server.use(
      http.get('/api/contacts/:id', () =>
        HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Contact not found' } },
          { status: 404 },
        ),
      ),
    );
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: ['/contacts/nonexistent'],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('opens the confirm-delete modal when Delete is clicked', async () => {
    const user = userEvent.setup();

    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('delete-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('delete-contact-button'));

    expect(screen.getByTestId('confirm-delete-modal')).toBeInTheDocument();
  });

  it('calls delete API and navigates away when modal confirm is clicked', async () => {
    const user = userEvent.setup();

    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('delete-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('delete-contact-button'));
    await user.click(screen.getByTestId('confirm-delete-confirm'));

    // After delete the component navigates to /contacts; confirm the button is gone
    await waitFor(() => {
      expect(screen.queryByTestId('delete-contact-button')).not.toBeInTheDocument();
    });
  });

  it('renders the linked account name as a clickable link', async () => {
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      const accountLink = screen.getByTestId('detail-account');
      expect(accountLink).toHaveTextContent(ACCOUNT_1.name);
    });
    expect(screen.getByTestId('detail-account').closest('a')).toHaveAttribute(
      'href',
      `/accounts/${ACCOUNT_1.id}`,
    );
  });

  it('renders "—" in the account row when no account is linked', async () => {
    server.use(
      http.get('/api/contacts/:id', ({ params }) => {
        if (params.id === CONTACT_1.id) {
          return HttpResponse.json({ contact: { ...CONTACT_1, account_id: null } });
        }
        return HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Contact not found' } },
          { status: 404 },
        );
      }),
    );
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('detail-account')).toHaveTextContent('—');
    });
  });

  it('displays the owner name (not UUID) in the detail view', async () => {
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('detail-owner')).toHaveTextContent(ADMIN_USER.name);
    });
    expect(screen.getByTestId('detail-owner')).not.toHaveTextContent(CONTACT_1.owner_id!);
  });

  it('shows fallback owner text when owner is not in the active users list', async () => {
    server.use(
      http.get('/api/contacts/:id', ({ params }) => {
        if (params.id === CONTACT_1.id) {
          return HttpResponse.json({
            contact: { ...CONTACT_1, owner_id: '00000000-0000-0000-0000-000000000999' },
          });
        }
        return HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Contact not found' } },
          { status: 404 },
        );
      }),
    );
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('detail-owner')).toHaveTextContent('Unknown');
    });
  });

  it('renders the owner select immediately when the edit form opens, even if the active users query is still loading', async () => {
    // Hang the active users response so it never resolves during this test.
    // The owner select must still render — the form cannot gate on this query.
    server.use(http.get('/api/users/active', () => new Promise(() => {})));

    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-contact-button'));

    // Select must be present even though users haven't loaded yet
    const ownerSelect = screen.getByTestId<HTMLSelectElement>('contact-owner-select');
    expect(ownerSelect).toBeInTheDocument();
    // The current owner UUID is preserved in state (not silently replaced)
    expect(ownerSelect.value).toBe(CONTACT_1.owner_id);
  });

  it('shows the owner select in the edit form populated with active users', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-contact-button'));

    const ownerSelect = screen.getByTestId<HTMLSelectElement>('contact-owner-select');
    expect(ownerSelect).toBeInTheDocument();
    // Should be pre-populated with the current owner
    expect(ownerSelect.value).toBe(CONTACT_1.owner_id);
    // Should list both active users as options
    const options = Array.from(ownerSelect.options).map((o) => o.text);
    expect(options).toContain(ADMIN_USER.name);
    expect(options).toContain(REP_USER.name);
  });

  it('shows a disabled unknown option in the edit form when the owner is deactivated', async () => {
    const deactivatedOwnerId = '00000000-0000-0000-0000-000000000999';
    server.use(
      http.get('/api/contacts/:id', ({ params }) => {
        if (params.id === CONTACT_1.id) {
          return HttpResponse.json({
            contact: { ...CONTACT_1, owner_id: deactivatedOwnerId },
          });
        }
        return HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Contact not found' } },
          { status: 404 },
        );
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-contact-button'));

    const ownerSelect = screen.getByTestId<HTMLSelectElement>('contact-owner-select');
    // The unknown UUID must be preserved in the select's value, not silently replaced
    expect(ownerSelect.value).toBe(deactivatedOwnerId);
    // The disabled placeholder option should be present so the browser shows it
    const unknownOption = Array.from(ownerSelect.options).find(
      (o) => o.value === deactivatedOwnerId,
    );
    expect(unknownOption).toBeDefined();
    expect(unknownOption?.disabled).toBe(true);
  });

  it('sends updated owner_id when owner is changed and form is saved', async () => {
    const user = userEvent.setup();
    let patchedBody: Record<string, unknown> = {};
    server.use(
      http.patch('/api/contacts/:id', async ({ params, request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          contact: { ...CONTACT_1, ...patchedBody, id: params.id as string },
        });
      }),
    );

    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-contact-button'));

    await user.selectOptions(screen.getByTestId('contact-owner-select'), REP_USER.id);
    await user.click(screen.getByTestId('contact-form-submit'));

    await waitFor(() => {
      expect(patchedBody.owner_id).toBe(REP_USER.id);
    });
  });

  it('renders the linked deals section heading', async () => {
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('linked-deals-heading')).toBeInTheDocument();
    });
  });

  it('shows linked deal with name and stage', async () => {
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId(`linked-deal-${DEAL_1.id}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId(`linked-deal-${DEAL_1.id}`)).toHaveTextContent(DEAL_1.name);
    expect(screen.getByText(DEAL_1.stage)).toBeInTheDocument();
  });

  it('shows empty state when no deals are linked', async () => {
    server.use(http.get('/api/contacts/:id/deals', () => HttpResponse.json({ deals: [] })));
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('linked-deals-empty')).toBeInTheDocument();
    });
  });

  it('linked deal name links to the deal detail page', async () => {
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId(`linked-deal-${DEAL_1.id}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId(`linked-deal-${DEAL_1.id}`)).toHaveAttribute(
      'href',
      `/deals/${DEAL_1.id}`,
    );
  });

  it('does not delete when modal cancel is clicked', async () => {
    const user = userEvent.setup();

    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('delete-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('delete-contact-button'));
    await user.click(screen.getByTestId('confirm-delete-cancel'));

    // Modal dismissed, delete button still present — delete was not called
    expect(screen.getByTestId('delete-contact-button')).toBeInTheDocument();
  });

  it('renders back-to-contacts link with aria-label', async () => {
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      const backLink = screen.getByTestId('back-to-contacts');
      expect(backLink).toHaveAttribute('aria-label');
    });
  });

  it('shows a delete error message when the delete request fails', async () => {
    server.use(
      http.delete('/api/contacts/:id', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Server error' } },
          { status: 500 },
        ),
      ),
    );
    const user = userEvent.setup();

    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('delete-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('delete-contact-button'));
    await user.click(screen.getByTestId('confirm-delete-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('delete-error')).toBeInTheDocument();
    });
  });
});
