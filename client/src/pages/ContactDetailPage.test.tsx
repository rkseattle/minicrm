/**
 * Tests for the ContactDetailPage component.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import ContactDetailPage from './ContactDetailPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { CONTACT_1 } from '../test/msw/handlers.js';

describe('ContactDetailPage', () => {
  it('renders the contact name', async () => {
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('contact-name')).toHaveTextContent(
        `${CONTACT_1.first_name} ${CONTACT_1.last_name}`,
      );
    });
  });

  it('renders contact detail fields', async () => {
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('detail-email')).toHaveTextContent(CONTACT_1.email);
    });
    expect(screen.getByTestId('detail-phone')).toHaveTextContent(CONTACT_1.phone!);
    expect(screen.getByTestId('detail-title')).toHaveTextContent(CONTACT_1.title!);
    expect(screen.getByTestId('detail-department')).toHaveTextContent(CONTACT_1.department!);
  });

  it('renders edit and delete buttons', async () => {
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument();
    });
    expect(screen.getByTestId('delete-contact-button')).toBeInTheDocument();
  });

  it('shows the edit form when Edit is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-contact-button'));
    expect(screen.getByTestId('contact-form')).toBeInTheDocument();
  });

  it('pre-populates the edit form with existing values', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-contact-button'));

    expect(screen.getByTestId<HTMLInputElement>('contact-first-name').value).toBe(
      CONTACT_1.first_name,
    );
    expect(screen.getByTestId<HTMLInputElement>('contact-email').value).toBe(CONTACT_1.email);
  });

  it('saves the edit form and returns to detail view', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-contact-button'));
    await user.click(screen.getByTestId('contact-form-submit'));

    await waitFor(() => {
      expect(screen.queryByTestId('contact-form')).not.toBeInTheDocument();
    });
  });

  it('cancels the edit form and returns to detail view', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('edit-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('edit-contact-button'));
    await user.click(screen.getByTestId('contact-form-cancel'));

    expect(screen.queryByTestId('contact-form')).not.toBeInTheDocument();
    expect(screen.getByTestId('contact-name')).toBeInTheDocument();
  });

  it('shows not-found message when contact does not exist', async () => {
    server.use(
      http.get('/api/contacts/:id', () =>
        HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Contact not found' } },
          { status: 404 },
        ),
      ),
    );
    renderWithProviders(<ContactDetailPage />, {
      initialEntries: ['/contacts/nonexistent'],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('calls delete API and navigates away on confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();

    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('delete-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('delete-contact-button'));

    // After delete the component navigates to /contacts; confirm the button is gone
    await waitFor(() => {
      expect(screen.queryByTestId('delete-contact-button')).not.toBeInTheDocument();
    });
  });

  it('does not delete when confirm is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();

    renderWithProviders(<ContactDetailPage />, {
      initialEntries: [`/contacts/${CONTACT_1.id}`],
      path: '/contacts/:id',
    });
    await waitFor(() => {
      expect(screen.getByTestId('delete-contact-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('delete-contact-button'));

    // Button should still be present — delete was not called
    expect(screen.getByTestId('delete-contact-button')).toBeInTheDocument();
  });
});
