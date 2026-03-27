/**
 * Tests for the AccountsPage component.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import AccountsPage from './AccountsPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { ACCOUNT_1, ADMIN_USER, REP_USER } from '../test/msw/handlers.js';

describe('AccountsPage', () => {
  it('renders the page heading', async () => {
    renderWithProviders(<AccountsPage />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Accounts' })).toBeInTheDocument();
    });
  });

  it('renders the New Account button', async () => {
    renderWithProviders(<AccountsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('new-account-button')).toBeInTheDocument();
    });
  });

  it('renders an account row from the API', async () => {
    renderWithProviders(<AccountsPage />);
    await waitFor(() => {
      expect(screen.getByText(ACCOUNT_1.name)).toBeInTheDocument();
    });
    expect(screen.getByText(ACCOUNT_1.industry!)).toBeInTheDocument();
  });

  it('shows empty state when no accounts are returned', async () => {
    server.use(http.get('/api/accounts', () => HttpResponse.json({ accounts: [] })));
    renderWithProviders(<AccountsPage />);
    await waitFor(() => {
      expect(screen.getByText('No accounts yet. Add one to get started.')).toBeInTheDocument();
    });
  });

  it('shows error state when the API fails', async () => {
    server.use(
      http.get('/api/accounts', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'fail' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<AccountsPage />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('shows the create form when New Account is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccountsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('new-account-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('new-account-button'));
    expect(screen.getByTestId('account-form')).toBeInTheDocument();
  });

  it('hides the form when Cancel is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccountsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('new-account-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('new-account-button'));
    expect(screen.getByTestId('account-form')).toBeInTheDocument();
    await user.click(screen.getByTestId('account-form-cancel'));
    expect(screen.queryByTestId('account-form')).not.toBeInTheDocument();
  });

  it('renders the owner column with the resolved user name', async () => {
    renderWithProviders(<AccountsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`account-owner-${ACCOUNT_1.id}`)).toHaveTextContent(
        ADMIN_USER.name,
      );
    });
  });

  it('shows the owner filter select defaulting to all', async () => {
    renderWithProviders(<AccountsPage />);
    await waitFor(() => {
      const filter = screen.getByTestId<HTMLSelectElement>('accounts-owner-filter');
      expect(filter.value).toBe('all');
    });
  });

  it('filters accounts to current user when owner filter is set to me', async () => {
    const repAccount = {
      ...ACCOUNT_1,
      id: '00000000-0000-0000-0000-000000000203',
      name: 'Rep Corp',
      owner_id: REP_USER.id,
    };
    server.use(
      http.get('/api/accounts', ({ request }) => {
        const owner = new URL(request.url).searchParams.get('owner');
        const accounts = owner === 'me' ? [ACCOUNT_1] : [ACCOUNT_1, repAccount];
        return HttpResponse.json({ accounts });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<AccountsPage />);

    // Both accounts visible before filtering
    await waitFor(() => {
      expect(screen.getByText(repAccount.name)).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByTestId('accounts-owner-filter'), 'me');

    await waitFor(() => {
      expect(screen.queryByText(repAccount.name)).not.toBeInTheDocument();
    });
    expect(screen.getByText(ACCOUNT_1.name)).toBeInTheDocument();
  });

  it('shows fallback text for accounts with an unresolvable owner', async () => {
    server.use(
      http.get('/api/accounts', () =>
        HttpResponse.json({
          accounts: [{ ...ACCOUNT_1, owner_id: '00000000-0000-0000-0000-000000000999' }],
        }),
      ),
    );
    renderWithProviders(<AccountsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`account-owner-${ACCOUNT_1.id}`)).toHaveTextContent('Unknown');
    });
  });

  it('submits the create form and hides it on success', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccountsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('new-account-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('new-account-button'));

    await user.type(screen.getByTestId('account-name-input'), 'Beta Corp');
    await user.click(screen.getByTestId('account-form-submit'));

    await waitFor(() => {
      expect(screen.queryByTestId('account-form')).not.toBeInTheDocument();
    });
  });
});
