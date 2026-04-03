/**
 * Tests for the ContactsPage component.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import ContactsPage from './ContactsPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { CONTACT_1, ADMIN_USER, REP_USER } from '../test/msw/handlers.js';

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
      expect(
        screen.getByText(`${CONTACT_1.first_name} ${CONTACT_1.last_name}`),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(CONTACT_1.email)).toBeInTheDocument();
  });

  it('shows empty state when no contacts are returned', async () => {
    server.use(
      http.get('/api/contacts', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 50 }),
      ),
    );
    renderWithProviders(<ContactsPage />);
    await waitFor(() => {
      expect(screen.getByText('No contacts yet. Add one to get started.')).toBeInTheDocument();
    });
  });

  it('shows error state when the API fails', async () => {
    server.use(
      http.get('/api/contacts', () =>
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
      http.get('/api/contacts', ({ request }) => {
        const owner = new URL(request.url).searchParams.get('owner');
        const contacts = owner === 'me' ? [CONTACT_1] : [CONTACT_1, repContact];
        return HttpResponse.json({ data: contacts, total: contacts.length, page: 1, limit: 50 });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);

    // Both contacts visible before filtering
    await waitFor(() => {
      expect(
        screen.getByText(`${repContact.first_name} ${repContact.last_name}`),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('contacts-owner-filter-mine'));

    await waitFor(() => {
      expect(
        screen.queryByText(`${repContact.first_name} ${repContact.last_name}`),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText(`${CONTACT_1.first_name} ${CONTACT_1.last_name}`)).toBeInTheDocument();
  });

  it('shows fallback text for contacts with an unresolvable owner', async () => {
    server.use(
      http.get('/api/contacts', () =>
        HttpResponse.json({
          data: [{ ...CONTACT_1, owner_id: '00000000-0000-0000-0000-000000000999' }],
          total: 1,
          page: 1,
          limit: 50,
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
      http.get('/api/contacts', ({ request }) => {
        capturedSearch = new URL(request.url).searchParams.get('search');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 50 });
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
      http.get('/api/contacts', ({ request }) => {
        capturedAccountSearch = new URL(request.url).searchParams.get('accountSearch');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 50 });
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
      http.post('/api/contacts', () =>
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
    expect(
      screen.getByText(
        `A contact with this email already exists: ${duplicateContact.first_name} ${duplicateContact.last_name}.`,
      ),
    ).toBeInTheDocument();
  });

  it('shows the "Go to existing contact" link in the duplicate warning', async () => {
    const duplicateContact = CONTACT_1;
    server.use(
      http.post('/api/contacts', () =>
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
      http.post('/api/contacts', ({ request }) => {
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
});
