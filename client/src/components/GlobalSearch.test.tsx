/**
 * Tests for the GlobalSearch component.
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
      http.get('/api/v1/search', () =>
        HttpResponse.json({ contacts: [], accounts: [], deals: [], leads: [], emails: [] }),
      ),
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

  it('shows lead results when query matches leads', async () => {
    server.use(
      http.get('/api/v1/search', () =>
        HttpResponse.json({
          contacts: [],
          accounts: [],
          deals: [],
          leads: [
            {
              id: '00000000-0000-0000-0000-000000000401',
              first_name: 'Lead',
              last_name: 'Person',
              email: 'lead@example.com',
              company_name: 'Lead Co',
            },
          ],
          emails: [],
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);
    await user.type(screen.getByTestId('global-search-input'), 'lead');
    await waitFor(() => {
      expect(
        screen.getByTestId('search-result-lead-00000000-0000-0000-0000-000000000401'),
      ).toBeInTheDocument();
    });
  });

  it('lead result links to the correct lead detail URL', async () => {
    server.use(
      http.get('/api/v1/search', () =>
        HttpResponse.json({
          contacts: [],
          accounts: [],
          deals: [],
          leads: [
            {
              id: '00000000-0000-0000-0000-000000000401',
              first_name: 'Lead',
              last_name: 'Person',
              email: 'lead@example.com',
              company_name: null,
            },
          ],
          emails: [],
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<GlobalSearch />);
    await user.type(screen.getByTestId('global-search-input'), 'lead');
    await waitFor(() => {
      const link = screen.getByTestId('search-result-lead-00000000-0000-0000-0000-000000000401');
      expect(link).toHaveAttribute('href', '/leads/00000000-0000-0000-0000-000000000401');
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

  describe('email results', () => {
    const EMAIL_ID = '00000000-0000-0000-0000-000000000501';
    const CONTACT_ID = '00000000-0000-0000-0000-000000000101';

    function serveEmails(subject: string | null): void {
      server.use(
        http.get('/api/v1/search', () =>
          HttpResponse.json({
            contacts: [],
            accounts: [],
            deals: [],
            leads: [],
            emails: [
              {
                id: EMAIL_ID,
                subject,
                snippet: 'the renewal terms',
                from_address: 'ada@client.test',
                sent_at: '2026-08-01T12:00:00.000Z',
                record_type: 'contact',
                record_id: CONTACT_ID,
              },
            ],
          }),
        ),
      );
    }

    it('shows an emails-only result rather than the empty state', async () => {
      serveEmails('Renewal');
      const user = userEvent.setup();
      renderWithProviders(<GlobalSearch />);
      await user.type(screen.getByTestId('global-search-input'), 'renewal');

      const link = await screen.findByTestId(`search-result-email-${EMAIL_ID}`);
      expect(link).toHaveTextContent('Renewal');
      expect(link).toHaveTextContent('ada@client.test — the renewal terms');
      expect(screen.queryByTestId('search-empty-state')).not.toBeInTheDocument();
    });

    it('opens the record the email is linked to', async () => {
      serveEmails('Renewal');
      const user = userEvent.setup();
      renderWithProviders(<GlobalSearch />);
      await user.type(screen.getByTestId('global-search-input'), 'renewal');

      expect(await screen.findByTestId(`search-result-email-${EMAIL_ID}`)).toHaveAttribute(
        'href',
        `/contacts/${CONTACT_ID}`,
      );
    });

    it('names a message with no subject', async () => {
      serveEmails(null);
      const user = userEvent.setup();
      renderWithProviders(<GlobalSearch />);
      await user.type(screen.getByTestId('global-search-input'), 'renewal');

      expect(await screen.findByTestId(`search-result-email-${EMAIL_ID}`)).toHaveTextContent(
        '(no subject)',
      );
    });
  });
});
