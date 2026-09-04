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
import { ADMIN_USER } from '@/test/msw/handlers.js';
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

  it('says why a mailbox needs attention, not just that it does', async () => {
    // A badge alone makes an under-scoped mailbox look like a transient timeout, and the
    // two need opposite actions from the user — reconnect versus wait.
    enableEmailSync();
    respondWithAccounts([{ ...ACCOUNT, status: 'error', status_detail: 'INSUFFICIENT_SCOPE' }]);

    renderWithProviders(<ConnectedAccountsPanel />);

    expect(
      await screen.findByTestId(`connected-account-status-detail-${ACCOUNT_ID}`),
    ).toHaveTextContent('did not grant permission to read mail');
  });

  it('falls back to the generic reason for a code it does not know', async () => {
    // status_detail is written by the server; a code this build has no key for must not
    // reach the user as a raw token.
    enableEmailSync();
    respondWithAccounts([{ ...ACCOUNT, status: 'error', status_detail: 'SOME_NEW_CODE' }]);

    renderWithProviders(<ConnectedAccountsPanel />);

    expect(
      await screen.findByTestId(`connected-account-status-detail-${ACCOUNT_ID}`),
    ).toHaveTextContent('Syncing failed');
  });

  it('shows no reason for a healthy mailbox', async () => {
    enableEmailSync();
    respondWithAccounts([{ ...ACCOUNT, status: 'active', status_detail: null }]);

    renderWithProviders(<ConnectedAccountsPanel />);

    await screen.findByTestId(`connected-account-status-${ACCOUNT_ID}`);
    expect(
      screen.queryByTestId(`connected-account-status-detail-${ACCOUNT_ID}`),
    ).not.toBeInTheDocument();
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

  it('renders nothing for a role without connected_accounts:manage', async () => {
    enableEmailSync();
    respondWithAccounts([ACCOUNT]);
    // A viewer: the flag is on, but migration 170 never grants them the capability.
    server.use(
      http.get('/api/v1/auth/me', () =>
        HttpResponse.json({ user: { ...ADMIN_USER, role: 'viewer' }, capabilities: [] }),
      ),
    );

    renderWithProviders(<ConnectedAccountsPanel />);

    await waitFor(() => {
      expect(screen.queryByTestId('connected-accounts-section')).not.toBeInTheDocument();
    });
  });

  it('re-tests a mailbox and refreshes its status', async () => {
    enableEmailSync();
    respondWithAccounts([{ ...ACCOUNT, status: 'error' }]);

    let testCalls = 0;
    server.use(
      http.post(`/api/v1/connected-accounts/${ACCOUNT_ID}/test`, () => {
        testCalls += 1;
        return HttpResponse.json({ success: true });
      }),
    );

    renderWithProviders(<ConnectedAccountsPanel />);

    await userEvent.click(await screen.findByTestId(`connected-account-test-button-${ACCOUNT_ID}`));

    await waitFor(() => expect(testCalls).toBe(1));
  });

  it('drops a stale test reason once the mailbox reports healthy', async () => {
    // A reason that outlived its subject would sit under a green badge for the rest of
    // the session — the refetched row is the newer fact.
    enableEmailSync();
    respondWithAccounts([{ ...ACCOUNT, status: 'error', status_detail: 'CONNECTION_FAILED' }]);

    renderWithProviders(<ConnectedAccountsPanel />);
    expect(
      await screen.findByTestId(`connected-account-status-detail-${ACCOUNT_ID}`),
    ).toBeInTheDocument();

    // The test FAILS while the row comes back healthy — a background sync recovered the
    // mailbox. Without the guard the failed answer outlives its subject.
    respondWithAccounts([{ ...ACCOUNT, status: 'active', status_detail: null }]);
    server.use(
      http.post(`/api/v1/connected-accounts/${ACCOUNT_ID}/test`, () =>
        HttpResponse.json({ success: false, error: 'CONNECTION_FAILED' }),
      ),
    );
    await userEvent.click(await screen.findByTestId(`connected-account-test-button-${ACCOUNT_ID}`));

    // Neither element: a guard that only moves the message from one to the other still
    // leaves it under a green badge.
    await waitFor(() =>
      expect(
        screen.queryByTestId(`connected-account-status-detail-${ACCOUNT_ID}`),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(/could not reach this mail provider/)).not.toBeInTheDocument();
  });

  it('says so when the test request itself fails', async () => {
    // The provider was never asked, so naming it unreachable points at the wrong system.
    enableEmailSync();
    respondWithAccounts([{ ...ACCOUNT, status: 'active', status_detail: null }]);
    server.use(
      http.post(`/api/v1/connected-accounts/${ACCOUNT_ID}/test`, () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'boom' } }, { status: 500 }),
      ),
    );

    renderWithProviders(<ConnectedAccountsPanel />);
    await userEvent.click(await screen.findByTestId(`connected-account-test-button-${ACCOUNT_ID}`));

    expect(await screen.findByText(/could not run that test/)).toBeInTheDocument();
  });

  it('says why a test failed for a provider that has none', async () => {
    // The server writes nothing to the row in this case, deliberately — a healthy mailbox
    // must not be marked broken for having no test. So the response body is the only
    // place the answer exists, and discarding it leaves the button doing nothing visible.
    enableEmailSync();
    respondWithAccounts([{ ...ACCOUNT, provider: 'microsoft', status: 'active' }]);
    server.use(
      http.post(`/api/v1/connected-accounts/${ACCOUNT_ID}/test`, () =>
        HttpResponse.json({ success: false, error: 'UNTESTABLE_PROVIDER' }),
      ),
    );

    renderWithProviders(<ConnectedAccountsPanel />);
    await userEvent.click(await screen.findByTestId(`connected-account-test-button-${ACCOUNT_ID}`));

    // Survives a healthy row: the server writes nothing for a provider it cannot test, so
    // this answer is the only one that will ever exist for it.
    expect(
      await screen.findByTestId(`connected-account-status-detail-${ACCOUNT_ID}`),
    ).toHaveTextContent('not supported yet');
  });
});
