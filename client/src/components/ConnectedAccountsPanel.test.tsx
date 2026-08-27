/**
 * Tests for ConnectedAccountsPanel.
 *
 * email_sync is off by default in the MSW handlers, matching its seeded value, so every
 * test that exercises the panel turns it on explicitly.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, it, expect } from 'vitest';

import type { ConnectedAccountResponse } from '@shared/schemas/connectedAccountSchema.js';

import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';

import ConnectedAccountsPanel from './ConnectedAccountsPanel.js';

const ACCOUNT_ID = '00000000-0000-0000-0000-0000000000c1';

const ACCOUNT: ConnectedAccountResponse = {
  id: ACCOUNT_ID,
  provider: 'imap',
  email_address: 'rep@example.com',
  granted_scopes: [],
  status: 'active',
  status_detail: null,
  last_sync_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

/** Turns email_sync on; the default handler reports it off, as the flag is seeded. */
function enableEmailSync(): void {
  server.use(
    http.get('/api/v1/feature-flags/me', () => HttpResponse.json({ flags: { email_sync: true } })),
  );
}

function respondWithAccounts(accounts: ConnectedAccountResponse[]): void {
  server.use(http.get('/api/v1/connected-accounts', () => HttpResponse.json({ accounts })));
}

describe('ConnectedAccountsPanel', () => {
  it('renders nothing when email_sync is off', async () => {
    renderWithProviders(<ConnectedAccountsPanel />);

    await waitFor(() => {
      expect(screen.queryByTestId('connected-accounts-section')).not.toBeInTheDocument();
    });
  });

  it('shows the empty state when no mailbox is connected', async () => {
    enableEmailSync();
    respondWithAccounts([]);

    renderWithProviders(<ConnectedAccountsPanel />);

    expect(await screen.findByTestId('connected-accounts-empty')).toBeInTheDocument();
  });

  it('shows the error state when the list fails to load', async () => {
    enableEmailSync();
    server.use(
      http.get('/api/v1/connected-accounts', () => new HttpResponse(null, { status: 500 })),
    );

    renderWithProviders(<ConnectedAccountsPanel />);

    expect(await screen.findByTestId('connected-accounts-load-error')).toBeInTheDocument();
  });

  it('renders a connected account with its status badge and disconnect control', async () => {
    enableEmailSync();
    respondWithAccounts([ACCOUNT]);

    renderWithProviders(<ConnectedAccountsPanel />);

    expect(await screen.findByText('rep@example.com')).toBeInTheDocument();
    expect(screen.getByTestId(`connected-account-status-${ACCOUNT_ID}`)).toHaveTextContent(
      'Active',
    );
    expect(
      screen.getByTestId(`connected-account-disconnect-button-${ACCOUNT_ID}`),
    ).toBeInTheDocument();
  });

  it('renders an errored account with the needs-attention badge', async () => {
    enableEmailSync();
    respondWithAccounts([{ ...ACCOUNT, status: 'error', status_detail: 'PROVIDER_AUTH_EXPIRED' }]);

    renderWithProviders(<ConnectedAccountsPanel />);

    expect(await screen.findByTestId(`connected-account-status-${ACCOUNT_ID}`)).toHaveTextContent(
      'Needs attention',
    );
  });

  it('asks for confirmation before disconnecting, and refetches after', async () => {
    enableEmailSync();
    respondWithAccounts([ACCOUNT]);

    let deleteCalls = 0;
    server.use(
      http.delete(`/api/v1/connected-accounts/${ACCOUNT_ID}`, () => {
        deleteCalls += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderWithProviders(<ConnectedAccountsPanel />);

    await userEvent.click(
      await screen.findByTestId(`connected-account-disconnect-button-${ACCOUNT_ID}`),
    );

    // The first click only reveals the confirm, so nothing is deleted yet.
    expect(deleteCalls).toBe(0);
    expect(
      screen.getByTestId(`connected-account-disconnect-confirm-${ACCOUNT_ID}`),
    ).toBeInTheDocument();

    respondWithAccounts([]);
    await userEvent.click(
      screen.getByTestId(`connected-account-disconnect-confirm-button-${ACCOUNT_ID}`),
    );

    await waitFor(() => expect(deleteCalls).toBe(1));
    expect(await screen.findByTestId('connected-accounts-empty')).toBeInTheDocument();
  });

  it('cancelling the confirm leaves the account in place', async () => {
    enableEmailSync();
    respondWithAccounts([ACCOUNT]);

    renderWithProviders(<ConnectedAccountsPanel />);

    await userEvent.click(
      await screen.findByTestId(`connected-account-disconnect-button-${ACCOUNT_ID}`),
    );
    await userEvent.click(
      screen.getByTestId(`connected-account-disconnect-cancel-button-${ACCOUNT_ID}`),
    );

    expect(
      screen.getByTestId(`connected-account-disconnect-button-${ACCOUNT_ID}`),
    ).toBeInTheDocument();
  });

  it('surfaces a failed IMAP connect without clearing what was typed', async () => {
    enableEmailSync();
    respondWithAccounts([]);
    server.use(
      http.post('/api/v1/connected-accounts', () =>
        HttpResponse.json(
          { error: { code: 'CONNECTION_FAILED', message: 'Could not reach that mail server.' } },
          { status: 400 },
        ),
      ),
    );

    renderWithProviders(<ConnectedAccountsPanel />);

    await userEvent.click(await screen.findByTestId('connected-accounts-show-imap-form'));
    await userEvent.type(screen.getByTestId('connected-accounts-imap-email'), 'rep@example.com');
    await userEvent.type(screen.getByTestId('connected-accounts-imap-host'), 'imap.example.com');
    await userEvent.type(screen.getByTestId('connected-accounts-imap-username'), 'rep');
    await userEvent.type(screen.getByTestId('connected-accounts-imap-password'), 'secret-value');
    await userEvent.click(screen.getByTestId('connected-accounts-imap-submit'));

    expect(await screen.findByTestId('connected-accounts-connect-error')).toBeInTheDocument();
    expect(screen.getByTestId('connected-accounts-imap-host')).toHaveValue('imap.example.com');
  });

  it('points each connect button at its provider start route', async () => {
    enableEmailSync();
    respondWithAccounts([]);

    renderWithProviders(<ConnectedAccountsPanel />);

    expect(await screen.findByTestId('connected-accounts-connect-google')).toHaveAttribute(
      'href',
      '/api/v1/connected-accounts/oauth/google/start',
    );
    expect(screen.getByTestId('connected-accounts-connect-microsoft')).toHaveAttribute(
      'href',
      '/api/v1/connected-accounts/oauth/microsoft/start',
    );
  });

  it('announces a successful OAuth connect from the redirect', async () => {
    enableEmailSync();
    respondWithAccounts([]);

    renderWithProviders(<ConnectedAccountsPanel />, {
      initialEntries: ['/profile?connect=connected'],
    });

    const banner = await screen.findByTestId('connected-accounts-connect-result');
    expect(banner).toHaveTextContent('Mailbox connected.');
    expect(banner).toHaveAttribute('role', 'status');
  });

  it('reports an unconfigured provider as an error, not a success', async () => {
    enableEmailSync();
    respondWithAccounts([]);

    renderWithProviders(<ConnectedAccountsPanel />, {
      initialEntries: ['/profile?connect=PROVIDER_NOT_CONFIGURED'],
    });

    const banner = await screen.findByTestId('connected-accounts-connect-result');
    expect(banner).toHaveTextContent(/not set up/i);
    expect(banner).toHaveAttribute('role', 'alert');
  });

  // An unrecognised code must still say something rather than render a raw key path.
  it('falls back to the generic message for an unknown code', async () => {
    enableEmailSync();
    respondWithAccounts([]);

    renderWithProviders(<ConnectedAccountsPanel />, {
      initialEntries: ['/profile?connect=something-nobody-defined'],
    });

    const banner = await screen.findByTestId('connected-accounts-connect-result');
    expect(banner).toHaveTextContent(/could not be connected/i);
    expect(banner).not.toHaveTextContent('connectedAccounts.results');
  });

  it('dismissing the banner removes it', async () => {
    enableEmailSync();
    respondWithAccounts([]);

    renderWithProviders(<ConnectedAccountsPanel />, {
      initialEntries: ['/profile?connect=connected'],
    });

    await userEvent.click(await screen.findByTestId('connected-accounts-dismiss-result'));

    expect(screen.queryByTestId('connected-accounts-connect-result')).not.toBeInTheDocument();
  });

  it('shows no banner when the URL carries no result', async () => {
    enableEmailSync();
    respondWithAccounts([]);

    renderWithProviders(<ConnectedAccountsPanel />);

    await screen.findByTestId('connected-accounts-empty');
    expect(screen.queryByTestId('connected-accounts-connect-result')).not.toBeInTheDocument();
  });
});
