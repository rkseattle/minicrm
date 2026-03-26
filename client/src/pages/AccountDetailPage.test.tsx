/**
 * Tests for the AccountDetailPage component.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import AccountDetailPage from './AccountDetailPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { ACCOUNT_1 } from '../test/msw/handlers.js';

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
