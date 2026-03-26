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
import { ACCOUNT_1 } from '../test/msw/handlers.js';

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
