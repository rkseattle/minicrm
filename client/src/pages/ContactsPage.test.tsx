/**
 * Tests for the ContactsPage component.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import ContactsPage from './ContactsPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { CONTACT_1, CONTACT_2, ADMIN_USER, REP_USER } from '../test/msw/handlers.js';
import * as contactsApi from '../api/contacts.js';
import * as bulkApi from '../api/bulk.js';

describe('ContactsPage', () => {
  it('renders the page heading', async () => {
    renderWithProviders(<ContactsPage />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Contacts' })).toBeInTheDocument();
    });
  });

  it('renders the New Contact button', async () => {
    renderWithProviders(<ContactsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('new-contact-button')).toBeInTheDocument();
    });
  });

  it('renders a contact row from the API', async () => {
    renderWithProviders(<ContactsPage />);
    await waitFor(() => {
      // name appears in both mobile card and desktop table
      expect(
        screen.getAllByText(`${CONTACT_1.first_name} ${CONTACT_1.last_name}`).length,
      ).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByText(CONTACT_1.email).length).toBeGreaterThanOrEqual(1);
  });

  it('shows empty state when no contacts are returned', async () => {
    server.use(
      http.get('/api/v1/contacts', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 }),
      ),
    );
    renderWithProviders(<ContactsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('contacts-empty-state')).toBeInTheDocument();
      expect(screen.getByText('No contacts yet')).toBeInTheDocument();
    });
  });

  it('shows error state when the API fails', async () => {
    server.use(
      http.get('/api/v1/contacts', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'fail' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<ContactsPage />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('shows the create form when New Contact is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('new-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('new-contact-button'));
    expect(screen.getByTestId('contact-form')).toBeInTheDocument();
  });

  it('hides the form when Cancel is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('new-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('new-contact-button'));
    expect(screen.getByTestId('contact-form')).toBeInTheDocument();
    await user.click(screen.getByTestId('contact-form-cancel'));
    expect(screen.queryByTestId('contact-form')).not.toBeInTheDocument();
  });

  it('renders the owner column with the resolved user name', async () => {
    renderWithProviders(<ContactsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`contact-owner-${CONTACT_1.id}`)).toHaveTextContent(
        ADMIN_USER.name,
      );
    });
  });

  it('shows the owner toggle defaulting to All', async () => {
    renderWithProviders(<ContactsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('contacts-owner-filter-all')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByTestId('contacts-owner-filter-mine')).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });
  });

  it('filters contacts to current user when Mine toggle is clicked', async () => {
    const repContact = {
      ...CONTACT_1,
      id: '00000000-0000-0000-0000-000000000103',
      first_name: 'Bob',
      last_name: 'Jones',
      owner_id: REP_USER.id,
    };
    server.use(
      http.get('/api/v1/contacts', ({ request }) => {
        const owner = new URL(request.url).searchParams.get('owner');
        const contacts = owner === 'me' ? [CONTACT_1] : [CONTACT_1, repContact];
        return HttpResponse.json({ data: contacts, total: contacts.length, page: 1, limit: 25 });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);

    // Both contacts visible before filtering (each name appears in mobile card + desktop table)
    await waitFor(() => {
      expect(
        screen.getAllByText(`${repContact.first_name} ${repContact.last_name}`).length,
      ).toBeGreaterThanOrEqual(1);
    });

    await user.click(screen.getByTestId('contacts-owner-filter-mine'));

    await waitFor(() => {
      expect(
        screen.queryByText(`${repContact.first_name} ${repContact.last_name}`),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getAllByText(`${CONTACT_1.first_name} ${CONTACT_1.last_name}`).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('shows fallback text for contacts with an unresolvable owner', async () => {
    server.use(
      http.get('/api/v1/contacts', () =>
        HttpResponse.json({
          data: [{ ...CONTACT_1, owner_id: '00000000-0000-0000-0000-000000000999' }],
          total: 1,
          page: 1,
          limit: 25,
        }),
      ),
    );
    renderWithProviders(<ContactsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`contact-owner-${CONTACT_1.id}`)).toHaveTextContent('Unknown');
    });
  });

  it('renders the name/email search input', async () => {
    renderWithProviders(<ContactsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('contacts-search')).toBeInTheDocument();
    });
  });

  it('renders the account name search input', async () => {
    renderWithProviders(<ContactsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('contacts-account-search')).toBeInTheDocument();
    });
  });

  it('passes the search param to the API when the search input changes', async () => {
    let capturedSearch: string | null = null;
    server.use(
      http.get('/api/v1/contacts', ({ request }) => {
        capturedSearch = new URL(request.url).searchParams.get('search');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 });
      }),
    );

    const user = userEvent.setup({ delay: null });
    renderWithProviders(<ContactsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('contacts-search')).toBeInTheDocument();
    });

    await user.type(screen.getByTestId('contacts-search'), 'alice');

    await waitFor(() => {
      expect(capturedSearch).toBe('alice');
    });
  });

  it('passes the accountSearch param to the API when the account search input changes', async () => {
    let capturedAccountSearch: string | null = null;
    server.use(
      http.get('/api/v1/contacts', ({ request }) => {
        capturedAccountSearch = new URL(request.url).searchParams.get('accountSearch');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 });
      }),
    );

    const user = userEvent.setup({ delay: null });
    renderWithProviders(<ContactsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('contacts-account-search')).toBeInTheDocument();
    });

    await user.type(screen.getByTestId('contacts-account-search'), 'Acme');

    await waitFor(() => {
      expect(capturedAccountSearch).toBe('Acme');
    });
  });

  it('shows the duplicate warning banner when the API returns 409', async () => {
    const duplicateContact = CONTACT_1;
    server.use(
      http.post('/api/v1/contacts', () =>
        HttpResponse.json(
          {
            error: { code: 'DUPLICATE_EMAIL', message: 'Duplicate email' },
            duplicate: {
              id: duplicateContact.id,
              first_name: duplicateContact.first_name,
              last_name: duplicateContact.last_name,
              email: duplicateContact.email,
            },
          },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('new-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('new-contact-button'));
    await user.type(screen.getByTestId('contact-first-name'), 'Alice');
    await user.type(screen.getByTestId('contact-last-name'), 'Smith');
    await user.type(screen.getByTestId('contact-email'), duplicateContact.email);
    await user.click(screen.getByTestId('contact-form-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('duplicate-contact-warning')).toBeInTheDocument();
    });
    expect(screen.getByTestId('duplicate-warning-message')).toBeInTheDocument();
    expect(screen.getByTestId('contact-email')).toHaveClass('border-yellow-400');
  });

  it('shows the "Go to existing contact" link in the duplicate warning', async () => {
    const duplicateContact = CONTACT_1;
    server.use(
      http.post('/api/v1/contacts', () =>
        HttpResponse.json(
          {
            error: { code: 'DUPLICATE_EMAIL', message: 'Duplicate email' },
            duplicate: {
              id: duplicateContact.id,
              first_name: duplicateContact.first_name,
              last_name: duplicateContact.last_name,
              email: duplicateContact.email,
            },
          },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('new-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('new-contact-button'));
    await user.type(screen.getByTestId('contact-email'), duplicateContact.email);
    await user.type(screen.getByTestId('contact-first-name'), 'Alice');
    await user.type(screen.getByTestId('contact-last-name'), 'Smith');
    await user.click(screen.getByTestId('contact-form-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('duplicate-go-to-existing')).toBeInTheDocument();
    });
    expect(screen.getByTestId('duplicate-go-to-existing')).toHaveAttribute(
      'href',
      `/contacts/${duplicateContact.id}`,
    );
  });

  it('creates the contact when "Create anyway" is clicked after a duplicate warning', async () => {
    let postCount = 0;
    let lastForceParam: string | null = null;
    const duplicateContact = CONTACT_1;
    server.use(
      http.post('/api/v1/contacts', ({ request }) => {
        postCount++;
        lastForceParam = new URL(request.url).searchParams.get('force');
        if (postCount === 1) {
          return HttpResponse.json(
            {
              error: { code: 'DUPLICATE_EMAIL', message: 'Duplicate email' },
              duplicate: {
                id: duplicateContact.id,
                first_name: duplicateContact.first_name,
                last_name: duplicateContact.last_name,
                email: duplicateContact.email,
              },
            },
            { status: 409 },
          );
        }
        return HttpResponse.json(
          {
            contact: {
              ...duplicateContact,
              id: '00000000-0000-0000-0000-000000000199',
            },
          },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('new-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('new-contact-button'));
    await user.type(screen.getByTestId('contact-first-name'), 'Alice');
    await user.type(screen.getByTestId('contact-last-name'), 'Smith');
    await user.type(screen.getByTestId('contact-email'), duplicateContact.email);
    await user.click(screen.getByTestId('contact-form-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('duplicate-create-anyway')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('duplicate-create-anyway'));

    await waitFor(() => {
      expect(screen.queryByTestId('contact-form')).not.toBeInTheDocument();
    });
    expect(lastForceParam).toBe('true');
  });

  // AI duplicate detection explanation
  it('shows an AI explanation when the Explain button is clicked in the duplicate warning', async () => {
    const duplicateContact = CONTACT_1;
    server.use(
      http.post('/api/v1/contacts', () =>
        HttpResponse.json(
          {
            error: { code: 'DUPLICATE_EMAIL', message: 'Duplicate email' },
            duplicate: {
              id: duplicateContact.id,
              first_name: duplicateContact.first_name,
              last_name: duplicateContact.last_name,
              email: duplicateContact.email,
            },
          },
          { status: 409 },
        ),
      ),
      http.post('/api/v1/duplicates/explain', () =>
        HttpResponse.json({
          explanation: 'Same email address — likely the same person.',
          inconclusive: false,
          generated_at: '2026-07-05T00:00:00.000Z',
        }),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('new-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('new-contact-button'));
    await user.type(screen.getByTestId('contact-first-name'), 'Alice');
    await user.type(screen.getByTestId('contact-last-name'), 'Smith');
    await user.type(screen.getByTestId('contact-email'), duplicateContact.email);
    await user.click(screen.getByTestId('contact-form-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('duplicate-explain-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('duplicate-explain-button'));

    await waitFor(() => {
      expect(screen.getByTestId('duplicate-explanation-text')).toHaveTextContent(
        'Same email address',
      );
    });
  });

  it('submits the create form and hides it on success', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('new-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('new-contact-button'));

    await user.type(screen.getByTestId('contact-first-name'), 'Bob');
    await user.type(screen.getByTestId('contact-last-name'), 'Jones');
    await user.type(screen.getByTestId('contact-email'), 'bob@example.com');
    await user.click(screen.getByTestId('contact-form-submit'));

    await waitFor(() => {
      expect(screen.queryByTestId('contact-form')).not.toBeInTheDocument();
    });
  });

  // ── CSV export ─────────────────────────────────────────────────────────────

  describe('CSV export buttons', () => {
    beforeEach(() => {
      vi.spyOn(contactsApi, 'exportContactsCsv').mockResolvedValue(undefined);
    });

    /** Opens the Export menu so its items become queryable. */
    async function openExportMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
      await waitFor(() => {
        expect(screen.getByTestId('contacts-export-menu-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('contacts-export-menu-button'));
    }

    it('renders the Export CSV button', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ContactsPage />);
      await openExportMenu(user);
      expect(screen.getByTestId('contacts-export-csv-button')).toBeInTheDocument();
    });

    it('renders the Export All button for admin users', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ContactsPage />);
      await openExportMenu(user);
      expect(screen.getByTestId('contacts-export-all-button')).toBeInTheDocument();
    });

    it('does not render the Export All button for rep users', async () => {
      server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ user: REP_USER })));
      const user = userEvent.setup();
      renderWithProviders(<ContactsPage />);
      await openExportMenu(user);
      expect(screen.getByTestId('contacts-export-csv-button')).toBeInTheDocument();
      expect(screen.queryByTestId('contacts-export-all-button')).not.toBeInTheDocument();
    });

    it('calls exportContactsCsv with current filters when Export CSV is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ContactsPage />);
      await openExportMenu(user);
      await user.click(screen.getByTestId('contacts-export-csv-button'));
      expect(contactsApi.exportContactsCsv).toHaveBeenCalledWith(
        expect.objectContaining({ search: undefined, accountSearch: undefined }),
      );
    });

    it('calls exportContactsCsv with all:true when Export All is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ContactsPage />);
      await openExportMenu(user);
      await user.click(screen.getByTestId('contacts-export-all-button'));
      expect(contactsApi.exportContactsCsv).toHaveBeenCalledWith({ all: true });
    });
  });

  // ── Bulk selection ──────────────────────────────────────────────────────────

  describe('bulk selection', () => {
    // Checkboxes render in both mobile card and desktop table — use getAllByTestId
    // and take the first match (either works for interaction purposes).
    const getRowCheckbox = (id: string) => screen.getAllByTestId(`bulk-select-${id}`)[0]!;

    it('shows row checkboxes in the contact list', async () => {
      renderWithProviders(<ContactsPage />);
      await waitFor(() => {
        expect(screen.getAllByTestId(`bulk-select-${CONTACT_1.id}`).length).toBeGreaterThan(0);
      });
    });

    it('changing the page size clears the selection, which the new rows invalidate', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ContactsPage />);
      await waitFor(() => {
        expect(screen.getAllByTestId(`bulk-select-${CONTACT_1.id}`).length).toBeGreaterThan(0);
      });
      await user.click(screen.getAllByTestId(`bulk-select-${CONTACT_1.id}`)[0]!);
      expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();

      // A size change leaves `page` at 1, so the page number alone cannot clear the
      // selection — a bulk delete would then act on rows swapped out of view.
      await user.selectOptions(screen.getByLabelText(/rows per page/i), '50');

      await waitFor(
        () => {
          expect(screen.queryByTestId('bulk-action-count')).not.toBeInTheDocument();
        },
        { timeout: 5000 },
      );
    });

    it('shows the bulk action bar after selecting a row', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ContactsPage />);
      await waitFor(() => {
        expect(screen.getAllByTestId(`bulk-select-${CONTACT_1.id}`).length).toBeGreaterThan(0);
      });
      await user.click(getRowCheckbox(CONTACT_1.id));
      expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
    });

    it('does not show the bulk action bar before any rows are selected', async () => {
      renderWithProviders(<ContactsPage />);
      await waitFor(() => {
        expect(screen.getAllByTestId(`bulk-select-${CONTACT_1.id}`).length).toBeGreaterThan(0);
      });
      expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
    });

    it('select-all checkbox shows bulk action bar with all rows selected', async () => {
      // Default handler returns [CONTACT_1, CONTACT_2] — no override needed
      const user = userEvent.setup();
      renderWithProviders(<ContactsPage />);
      // Wait for both contacts to appear before clicking select-all
      await waitFor(() => {
        expect(screen.getAllByTestId(`bulk-select-${CONTACT_1.id}`).length).toBeGreaterThan(0);
        expect(screen.getAllByTestId(`bulk-select-${CONTACT_2.id}`).length).toBeGreaterThan(0);
      });
      // Click the mobile select-all checkbox (first in DOM)
      await user.click(screen.getAllByTestId('bulk-select-all')[0]!);
      // Bulk action bar should appear, showing 2 selected
      await waitFor(() => {
        expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
      });
      expect(screen.getByTestId('bulk-action-count')).toHaveTextContent('2');
    });

    it('clear selection hides the bulk action bar', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ContactsPage />);
      await waitFor(() => {
        expect(screen.getAllByTestId(`bulk-select-${CONTACT_1.id}`).length).toBeGreaterThan(0);
      });
      await user.click(getRowCheckbox(CONTACT_1.id));
      expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();

      await user.click(screen.getByTestId('bulk-clear-selection'));
      expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
    });

    it('bulk delete calls the API and clears selection on success', async () => {
      vi.spyOn(bulkApi, 'bulkDeleteContacts').mockResolvedValue({
        succeeded: [CONTACT_1.id],
        failed: [],
      });
      const user = userEvent.setup();
      renderWithProviders(<ContactsPage />);
      await waitFor(() => {
        expect(screen.getAllByTestId(`bulk-select-${CONTACT_1.id}`).length).toBeGreaterThan(0);
      });
      await user.click(getRowCheckbox(CONTACT_1.id));
      await user.click(screen.getByTestId('bulk-delete-button'));

      // confirm dialog appears
      await waitFor(() => {
        expect(screen.getByTestId('confirm-delete-confirm')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('confirm-delete-confirm'));

      await waitFor(() => {
        expect(bulkApi.bulkDeleteContacts).toHaveBeenCalledWith(
          expect.objectContaining({ ids: [CONTACT_1.id] }),
        );
      });
      await waitFor(() => {
        expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
      });
    });
  });
});
