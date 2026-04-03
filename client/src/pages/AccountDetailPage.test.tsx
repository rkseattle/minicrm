/**
 * Tests for the AccountDetailPage component.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import AccountDetailPage from './AccountDetailPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { ACCOUNT_1, CONTACT_1, ADMIN_USER, REP_USER } from '../test/msw/handlers.js';

/** Renders AccountDetailPage with the ACCOUNT_1 id in route params. */
function renderAccountDetail() {
  return renderWithProviders(<AccountDetailPage />, {
    initialEntries: [`/accounts/${ACCOUNT_1.id}`],
    path: '/accounts/:id',
  });
}

describe('AccountDetailPage', () => {
  it('renders the account name as the page heading', async () => {
    renderAccountDetail();
    await waitFor(() => {
      expect(screen.getByTestId('account-name')).toHaveTextContent(ACCOUNT_1.name);
    });
  });

  it('renders industry in the detail card', async () => {
    renderAccountDetail();
    await waitFor(() => {
      expect(screen.getByTestId('detail-industry')).toHaveTextContent(ACCOUNT_1.industry!);
    });
  });

  it('renders the back link', async () => {
    renderAccountDetail();
    await waitFor(() => {
      expect(screen.getByTestId('back-to-accounts')).toBeInTheDocument();
    });
  });

  it('shows not-found state for a missing account', async () => {
    server.use(
      http.get('/api/accounts/:id', () =>
        HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Account not found' } },
          { status: 404 },
        ),
      ),
    );
    renderAccountDetail();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('shows the edit form when Edit is clicked', async () => {
    const user = userEvent.setup();
    renderAccountDetail();
    await waitFor(() => {
      expect(screen.getByTestId('edit-account-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-account-button'));
    expect(screen.getByTestId('account-form')).toBeInTheDocument();
  });

  it('hides the edit form when Cancel is clicked', async () => {
    const user = userEvent.setup();
    renderAccountDetail();
    await waitFor(() => {
      expect(screen.getByTestId('edit-account-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-account-button'));
    expect(screen.getByTestId('account-form')).toBeInTheDocument();
    await user.click(screen.getByTestId('account-form-cancel'));
    expect(screen.queryByTestId('account-form')).not.toBeInTheDocument();
  });

  it('renders the linked contacts section heading', async () => {
    renderAccountDetail();
    await waitFor(() => {
      expect(screen.getByTestId('linked-contacts-heading')).toBeInTheDocument();
    });
  });

  it('renders linked contacts when contacts are linked to the account', async () => {
    renderAccountDetail();
    await waitFor(() => {
      expect(screen.getByTestId('linked-contacts-list')).toBeInTheDocument();
    });
    expect(screen.getByTestId(`linked-contact-${CONTACT_1.id}`)).toHaveTextContent(
      `${CONTACT_1.first_name} ${CONTACT_1.last_name}`,
    );
  });

  it('renders the empty state when no contacts are linked', async () => {
    server.use(
      http.get('/api/contacts', () => {
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 50 });
      }),
    );
    renderAccountDetail();
    await waitFor(() => {
      expect(screen.getByTestId('linked-contacts-empty')).toBeInTheDocument();
    });
  });

  it('displays the owner name (not UUID) in the detail view', async () => {
    renderAccountDetail();
    await waitFor(() => {
      expect(screen.getByTestId('detail-owner')).toHaveTextContent(ADMIN_USER.name);
    });
    expect(screen.getByTestId('detail-owner')).not.toHaveTextContent(ACCOUNT_1.owner_id!);
  });

  it('shows fallback owner text when owner is not in the active users list', async () => {
    server.use(
      http.get('/api/accounts/:id', ({ params }) => {
        if (params.id === ACCOUNT_1.id) {
          return HttpResponse.json({
            account: { ...ACCOUNT_1, owner_id: '00000000-0000-0000-0000-000000000999' },
          });
        }
        return HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Account not found' } },
          { status: 404 },
        );
      }),
    );
    renderAccountDetail();
    await waitFor(() => {
      expect(screen.getByTestId('detail-owner')).toHaveTextContent('Unknown');
    });
  });

  it('renders the owner select immediately when the edit form opens, even if the active users query is still loading', async () => {
    // Hang the active users response so it never resolves during this test.
    // The owner select must still render — the form cannot gate on this query.
    server.use(http.get('/api/users/active', () => new Promise(() => {})));

    const user = userEvent.setup();
    renderAccountDetail();
    await waitFor(() => {
      expect(screen.getByTestId('edit-account-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-account-button'));

    // Select must be present even though users haven't loaded yet
    const ownerSelect = screen.getByTestId<HTMLSelectElement>('account-owner-select');
    expect(ownerSelect).toBeInTheDocument();
    // The current owner UUID is preserved in state (not silently replaced)
    expect(ownerSelect.value).toBe(ACCOUNT_1.owner_id);
  });

  it('shows the owner select in the edit form populated with active users', async () => {
    const user = userEvent.setup();
    renderAccountDetail();
    await waitFor(() => {
      expect(screen.getByTestId('edit-account-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-account-button'));

    const ownerSelect = screen.getByTestId<HTMLSelectElement>('account-owner-select');
    expect(ownerSelect).toBeInTheDocument();
    // Should be pre-populated with the current owner
    expect(ownerSelect.value).toBe(ACCOUNT_1.owner_id);
    // Should list both active users as options
    const options = Array.from(ownerSelect.options).map((o) => o.text);
    expect(options).toContain(ADMIN_USER.name);
    expect(options).toContain(REP_USER.name);
  });

  it('sends updated owner_id when owner is changed and form is saved', async () => {
    const user = userEvent.setup();
    let patchedBody: Record<string, unknown> = {};
    server.use(
      http.patch('/api/accounts/:id', async ({ params, request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          account: { ...ACCOUNT_1, ...patchedBody, id: params.id as string },
        });
      }),
    );

    renderAccountDetail();
    await waitFor(() => {
      expect(screen.getByTestId('edit-account-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-account-button'));

    await user.selectOptions(screen.getByTestId('account-owner-select'), REP_USER.id);
    await user.click(screen.getByTestId('account-form-submit'));

    await waitFor(() => {
      expect(patchedBody.owner_id).toBe(REP_USER.id);
    });
  });

  it('shows delete button and navigates away after confirmed delete', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderAccountDetail();
    await waitFor(() => {
      expect(screen.getByTestId('delete-account-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('delete-account-button'));
    await waitFor(() => {
      expect(screen.queryByTestId('delete-account-button')).not.toBeInTheDocument();
    });
  });

  it('submits the edit form and returns to detail view on success', async () => {
    const user = userEvent.setup();
    renderAccountDetail();
    await waitFor(() => {
      expect(screen.getByTestId('edit-account-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-account-button'));

    const nameInput = screen.getByTestId('account-name-input');
    await user.clear(nameInput);
    await user.type(nameInput, 'Updated Corp');
    await user.click(screen.getByTestId('account-form-submit'));

    await waitFor(() => {
      expect(screen.queryByTestId('account-form')).not.toBeInTheDocument();
    });
  });
});
