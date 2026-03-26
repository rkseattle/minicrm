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
import { CONTACT_1 } from '../test/msw/handlers.js';

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
    server.use(http.get('/api/contacts', () => HttpResponse.json({ contacts: [] })));
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
