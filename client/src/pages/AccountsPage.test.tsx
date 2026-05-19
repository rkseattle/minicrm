/**
 * Tests for the AccountsPage component.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import AccountsPage from './AccountsPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { ACCOUNT_1, ADMIN_USER, REP_USER } from '../test/msw/handlers.js';
import * as accountsApi from '../api/accounts.js';
import * as bulkApi from '../api/bulk.js';

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
      // name appears in both mobile card and desktop table
      expect(screen.getAllByText(ACCOUNT_1.name).length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByText(ACCOUNT_1.industry!).length).toBeGreaterThanOrEqual(1);
  });

  it('shows empty state when no accounts are returned', async () => {
    server.use(
      http.get('/api/v1/accounts', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 50 }),
      ),
    );
    renderWithProviders(<AccountsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('accounts-empty-state')).toBeInTheDocument();
      expect(screen.getByText('No accounts yet')).toBeInTheDocument();
    });
  });

  it('shows error state when the API fails', async () => {
    server.use(
      http.get('/api/v1/accounts', () =>
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

  it('shows the owner toggle defaulting to All', async () => {
    renderWithProviders(<AccountsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('accounts-owner-filter-all')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByTestId('accounts-owner-filter-mine')).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });
  });

  it('filters accounts to current user when Mine toggle is clicked', async () => {
    const repAccount = {
      ...ACCOUNT_1,
      id: '00000000-0000-0000-0000-000000000203',
      name: 'Rep Corp',
      owner_id: REP_USER.id,
    };
    server.use(
      http.get('/api/v1/accounts', ({ request }) => {
        const owner = new URL(request.url).searchParams.get('owner');
        const accounts = owner === 'me' ? [ACCOUNT_1] : [ACCOUNT_1, repAccount];
        return HttpResponse.json({ data: accounts, total: accounts.length, page: 1, limit: 50 });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<AccountsPage />);

    // Both accounts visible before filtering (each name appears in mobile card + desktop table)
    await waitFor(() => {
      expect(screen.getAllByText(repAccount.name).length).toBeGreaterThanOrEqual(1);
    });

    await user.click(screen.getByTestId('accounts-owner-filter-mine'));

    await waitFor(() => {
      expect(screen.queryByText(repAccount.name)).not.toBeInTheDocument();
    });
    expect(screen.getAllByText(ACCOUNT_1.name).length).toBeGreaterThanOrEqual(1);
  });

  it('shows fallback text for accounts with an unresolvable owner', async () => {
    server.use(
      http.get('/api/v1/accounts', () =>
        HttpResponse.json({
          data: [{ ...ACCOUNT_1, owner_id: '00000000-0000-0000-0000-000000000999' }],
          total: 1,
          page: 1,
          limit: 50,
        }),
      ),
    );
    renderWithProviders(<AccountsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`account-owner-${ACCOUNT_1.id}`)).toHaveTextContent('Unknown');
    });
  });

  it('renders the account name search input', async () => {
    renderWithProviders(<AccountsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('accounts-search')).toBeInTheDocument();
    });
  });

  it('renders the industry filter input', async () => {
    renderWithProviders(<AccountsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('accounts-industry-filter')).toBeInTheDocument();
    });
  });

  it('passes the search param to the API when the search input changes', async () => {
    let capturedSearch: string | null = null;
    server.use(
      http.get('/api/v1/accounts', ({ request }) => {
        capturedSearch = new URL(request.url).searchParams.get('search');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 50 });
      }),
    );

    const user = userEvent.setup({ delay: null });
    renderWithProviders(<AccountsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('accounts-search')).toBeInTheDocument();
    });

    await user.type(screen.getByTestId('accounts-search'), 'acme');

    await waitFor(() => {
      expect(capturedSearch).toBe('acme');
    });
  });

  it('passes the industry param to the API when the industry input changes', async () => {
    let capturedIndustry: string | null = null;
    server.use(
      http.get('/api/v1/accounts', ({ request }) => {
        capturedIndustry = new URL(request.url).searchParams.get('industry');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 50 });
      }),
    );

    const user = userEvent.setup({ delay: null });
    renderWithProviders(<AccountsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('accounts-industry-filter')).toBeInTheDocument();
    });

    await user.type(screen.getByTestId('accounts-industry-filter'), 'Technology');

    await waitFor(() => {
      expect(capturedIndustry).toBe('Technology');
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

  // ── Bulk selection ──────────────────────────────────────────────────────────

  describe('bulk selection', () => {
    const ACCOUNT_2 = {
      ...ACCOUNT_1,
      id: '00000000-0000-0000-0000-000000000202',
      name: 'Beta Corp',
    };

    beforeEach(() => {
      server.use(
        http.get('/api/v1/accounts', () =>
          HttpResponse.json({ data: [ACCOUNT_1, ACCOUNT_2], total: 2, page: 1, limit: 50 }),
        ),
      );
    });

    const getRowCheckbox = (id: string) => screen.getAllByTestId(`bulk-select-${id}`)[0]!;

    it('shows row checkboxes in the account list', async () => {
      renderWithProviders(<AccountsPage />);
      await waitFor(() => {
        expect(screen.getAllByTestId(`bulk-select-${ACCOUNT_1.id}`).length).toBeGreaterThan(0);
      });
    });

    it('shows the bulk action bar after selecting a row', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AccountsPage />);
      await waitFor(() => {
        expect(screen.getAllByTestId(`bulk-select-${ACCOUNT_1.id}`).length).toBeGreaterThan(0);
      });
      await user.click(getRowCheckbox(ACCOUNT_1.id));
      expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
    });

    it('does not show the bulk action bar before any rows are selected', async () => {
      renderWithProviders(<AccountsPage />);
      await waitFor(() => {
        expect(screen.getAllByTestId(`bulk-select-${ACCOUNT_1.id}`).length).toBeGreaterThan(0);
      });
      expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
    });

    it('select-all checkbox shows bulk action bar with all rows selected', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AccountsPage />);
      await waitFor(() => {
        expect(screen.getAllByTestId(`bulk-select-${ACCOUNT_1.id}`).length).toBeGreaterThan(0);
        expect(screen.getAllByTestId(`bulk-select-${ACCOUNT_2.id}`).length).toBeGreaterThan(0);
      });
      await user.click(screen.getAllByTestId('bulk-select-all')[0]!);
      await waitFor(() => {
        expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
      });
      expect(screen.getByTestId('bulk-action-count')).toHaveTextContent('2');
    });

    it('clear selection hides the bulk action bar', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AccountsPage />);
      await waitFor(() => {
        expect(screen.getAllByTestId(`bulk-select-${ACCOUNT_1.id}`).length).toBeGreaterThan(0);
      });
      await user.click(getRowCheckbox(ACCOUNT_1.id));
      expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
      await user.click(screen.getByTestId('bulk-clear-selection'));
      expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
    });

    it('bulk delete calls the API and clears selection on success', async () => {
      vi.spyOn(bulkApi, 'bulkAccounts').mockResolvedValue({ affected: 1 });
      const user = userEvent.setup();
      renderWithProviders(<AccountsPage />);
      await waitFor(() => {
        expect(screen.getAllByTestId(`bulk-select-${ACCOUNT_1.id}`).length).toBeGreaterThan(0);
      });
      await user.click(getRowCheckbox(ACCOUNT_1.id));
      await user.click(screen.getByTestId('bulk-delete-button'));

      await waitFor(() => {
        expect(screen.getByTestId('confirm-delete-confirm')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('confirm-delete-confirm'));

      await waitFor(() => {
        expect(bulkApi.bulkAccounts).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'delete', ids: [ACCOUNT_1.id] }),
          expect.anything(),
        );
      });
      await waitFor(() => {
        expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
      });
    });
  });

  // ── CSV export ─────────────────────────────────────────────────────────────

  describe('CSV export buttons', () => {
    beforeEach(() => {
      vi.spyOn(accountsApi, 'exportAccountsCsv').mockResolvedValue(undefined);
    });

    it('renders the Export CSV button', async () => {
      renderWithProviders(<AccountsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('accounts-export-csv-button')).toBeInTheDocument();
      });
    });

    it('renders the Export All button for admin users', async () => {
      renderWithProviders(<AccountsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('accounts-export-all-button')).toBeInTheDocument();
      });
    });

    it('does not render the Export All button for rep users', async () => {
      server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ user: REP_USER })));
      renderWithProviders(<AccountsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('accounts-export-csv-button')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('accounts-export-all-button')).not.toBeInTheDocument();
    });

    it('calls exportAccountsCsv when Export CSV is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AccountsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('accounts-export-csv-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('accounts-export-csv-button'));
      expect(accountsApi.exportAccountsCsv).toHaveBeenCalled();
    });

    it('calls exportAccountsCsv with all:true when Export All is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<AccountsPage />);
      await waitFor(() => {
        expect(screen.getByTestId('accounts-export-all-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('accounts-export-all-button'));
      expect(accountsApi.exportAccountsCsv).toHaveBeenCalledWith({ all: true });
    });
  });
});
