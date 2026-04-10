/**
 * Tests for the GlobalSearch component. (MINCRM-168)
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import GlobalSearch from './GlobalSearch.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';

describe('GlobalSearch', () => {
  it('renders the search input', () => {
    renderWithProviders(<GlobalSearch />);
    expect(screen.getByTestId('global-search-input')).toBeInTheDocument();
  });

  it('does not show the results panel when input is empty', () => {
    renderWithProviders(<GlobalSearch />);
    expect(screen.queryByTestId('search-results-panel')).not.toBeInTheDocument();
  });

  it('shows the min-length hint when query is 1 character', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);
    await user.type(screen.getByTestId('global-search-input'), 'a');
    await waitFor(() => {
      expect(screen.getByTestId('search-results-panel')).toBeInTheDocument();
    });
    expect(screen.getByTestId('search-min-length-hint')).toBeInTheDocument();
  });

  it('does not show min-length hint when query is at least 2 characters', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);
    await user.type(screen.getByTestId('global-search-input'), 'al');
    await waitFor(() => {
      expect(screen.queryByTestId('search-min-length-hint')).not.toBeInTheDocument();
    });
  });

  it('shows the empty state when query returns no results', async () => {
    server.use(
      http.get('/api/search', () => HttpResponse.json({ contacts: [], accounts: [], deals: [] })),
    );
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);
    await user.type(screen.getByTestId('global-search-input'), 'zzznomatch');
    await waitFor(() => {
      expect(screen.getByTestId('search-empty-state')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('search-min-length-hint')).not.toBeInTheDocument();
  });

  it('shows contact results when query matches contacts', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);
    await user.type(screen.getByTestId('global-search-input'), 'alice');
    await waitFor(() => {
      expect(
        screen.getByTestId('search-result-contact-00000000-0000-0000-0000-000000000101'),
      ).toBeInTheDocument();
    });
  });

  it('shows account results when query matches accounts', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);
    await user.type(screen.getByTestId('global-search-input'), 'acme');
    await waitFor(() => {
      expect(
        screen.getByTestId('search-result-account-00000000-0000-0000-0000-000000000201'),
      ).toBeInTheDocument();
    });
  });

  it('shows deal results when query matches deals', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);
    await user.type(screen.getByTestId('global-search-input'), 'acme');
    await waitFor(() => {
      expect(
        screen.getByTestId('search-result-deal-00000000-0000-0000-0000-000000000301'),
      ).toBeInTheDocument();
    });
  });

  it('contact result links to the correct contact detail URL', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);
    await user.type(screen.getByTestId('global-search-input'), 'alice');
    await waitFor(() => {
      const link = screen.getByTestId('search-result-contact-00000000-0000-0000-0000-000000000101');
      expect(link).toHaveAttribute('href', '/contacts/00000000-0000-0000-0000-000000000101');
    });
  });

  it('account result links to the correct account detail URL', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);
    await user.type(screen.getByTestId('global-search-input'), 'acme');
    await waitFor(() => {
      const link = screen.getByTestId('search-result-account-00000000-0000-0000-0000-000000000201');
      expect(link).toHaveAttribute('href', '/accounts/00000000-0000-0000-0000-000000000201');
    });
  });

  it('deal result links to the correct deal detail URL', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);
    await user.type(screen.getByTestId('global-search-input'), 'acme');
    await waitFor(() => {
      const link = screen.getByTestId('search-result-deal-00000000-0000-0000-0000-000000000301');
      expect(link).toHaveAttribute('href', '/deals/00000000-0000-0000-0000-000000000301');
    });
  });

  it('closes the dropdown on Escape key', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);
    const input = screen.getByTestId('global-search-input');
    await user.type(input, 'alice');
    await waitFor(() => {
      expect(screen.getByTestId('search-results-panel')).toBeInTheDocument();
    });
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('search-results-panel')).not.toBeInTheDocument();
  });

  it('closes the dropdown when a result is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);
    await user.type(screen.getByTestId('global-search-input'), 'alice');
    await waitFor(() => {
      expect(
        screen.getByTestId('search-result-contact-00000000-0000-0000-0000-000000000101'),
      ).toBeInTheDocument();
    });
    await user.click(
      screen.getByTestId('search-result-contact-00000000-0000-0000-0000-000000000101'),
    );
    expect(screen.queryByTestId('search-results-panel')).not.toBeInTheDocument();
  });
});
