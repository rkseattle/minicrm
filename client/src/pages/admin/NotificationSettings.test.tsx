/**
 * Tests for NotificationSettings — Email notifications toggle and SMTP config.
 *
 * Verifies:
 * - Email notifications section renders
 * - Toggle reflects the current enabled state
 * - Clicking the toggle calls PATCH and shows success
 * - Toggle save failure shows error
 * - Recipient count is displayed
 * - SMTP section is visible to admin users
 * - SMTP section is hidden for rep users
 * - SMTP form renders with fields; save calls PUT and shows success
 * - SMTP save failure shows error
 * - Password masked hint shown when password is already set
 * - Change Password button reveals the password input
 * - SMTP test: disabled when address is empty, calls POST and shows success/error
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import NotificationSettings from './NotificationSettings.js';

function mockRepUser() {
  server.use(
    http.get('/api/v1/auth/me', () =>
      HttpResponse.json({
        user: {
          id: 'user-rep',
          email: 'rep@example.com',
          name: 'Rep User',
          role: 'rep',
          status: 'active',
          must_change_password: false,
        },
      }),
    ),
  );
}

describe('NotificationSettings — email notifications toggle', () => {
  it('renders the email notifications section', async () => {
    renderWithProviders(<NotificationSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('email-notifications-section')).toBeInTheDocument();
    });
  });

  it('renders the toggle in enabled state by default', async () => {
    renderWithProviders(<NotificationSettings />);

    await waitFor(() => {
      const toggle = screen.getByTestId('email-notif-toggle');
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });
  });

  it('renders the toggle in disabled state when notifications are off', async () => {
    server.use(
      http.get('/api/v1/settings/email-notifications', () => HttpResponse.json({ enabled: false })),
    );

    renderWithProviders(<NotificationSettings />);

    await waitFor(() => {
      const toggle = screen.getByTestId('email-notif-toggle');
      expect(toggle).toHaveAttribute('aria-checked', 'false');
    });
  });

  it('shows success after toggling notifications', async () => {
    renderWithProviders(<NotificationSettings />);

    await waitFor(() => expect(screen.getByTestId('email-notif-toggle')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('email-notif-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('email-notif-success')).toBeInTheDocument();
    });
  });

  it('shows error when toggling fails', async () => {
    server.use(
      http.patch(
        '/api/v1/settings/email-notifications',
        () => new HttpResponse(null, { status: 500 }),
      ),
    );

    renderWithProviders(<NotificationSettings />);

    await waitFor(() => expect(screen.getByTestId('email-notif-toggle')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('email-notif-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('email-notif-save-error')).toBeInTheDocument();
    });
  });

  it('shows load error when email-notifications fetch fails', async () => {
    server.use(
      http.get(
        '/api/v1/settings/email-notifications',
        () => new HttpResponse(null, { status: 500 }),
      ),
    );

    renderWithProviders(<NotificationSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('email-notif-error')).toBeInTheDocument();
    });
  });

  it('displays recipient count', async () => {
    renderWithProviders(<NotificationSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('email-notif-recipient-count')).toBeInTheDocument();
    });
  });
});

describe('NotificationSettings — SMTP section', () => {
  it('shows SMTP section for admin users', async () => {
    renderWithProviders(<NotificationSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('smtp-section')).toBeInTheDocument();
    });
  });

  it('hides SMTP section for rep users', async () => {
    mockRepUser();
    renderWithProviders(<NotificationSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('email-notifications-section')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('smtp-section')).not.toBeInTheDocument();
  });

  it('renders SMTP form fields when loaded', async () => {
    renderWithProviders(<NotificationSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('smtp-host-input')).toBeInTheDocument();
    });
    expect(screen.getByTestId('smtp-port-input')).toBeInTheDocument();
    expect(screen.getByTestId('smtp-user-input')).toBeInTheDocument();
    expect(screen.getByTestId('smtp-enabled-toggle')).toBeInTheDocument();
  });

  it('shows password input when no password is set', async () => {
    renderWithProviders(<NotificationSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('smtp-pass-input')).toBeInTheDocument();
    });
  });

  it('shows masked hint and Change Password button when password is already set', async () => {
    server.use(
      http.get('/api/v1/settings/smtp', () =>
        HttpResponse.json({
          smtp_host: 'smtp.example.com',
          smtp_port: 587,
          smtp_user: 'user@example.com',
          smtp_pass_set: true,
          smtp_enabled: true,
        }),
      ),
    );

    renderWithProviders(<NotificationSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('smtp-pass-masked')).toBeInTheDocument();
    });
    expect(screen.getByTestId('smtp-change-password-button')).toBeInTheDocument();
    expect(screen.queryByTestId('smtp-pass-input')).not.toBeInTheDocument();
  });

  it('reveals password input after clicking Change Password', async () => {
    server.use(
      http.get('/api/v1/settings/smtp', () =>
        HttpResponse.json({
          smtp_host: 'smtp.example.com',
          smtp_port: 587,
          smtp_user: 'user@example.com',
          smtp_pass_set: true,
          smtp_enabled: false,
        }),
      ),
    );

    renderWithProviders(<NotificationSettings />);

    await waitFor(() =>
      expect(screen.getByTestId('smtp-change-password-button')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('smtp-change-password-button'));

    expect(screen.getByTestId('smtp-pass-input')).toBeInTheDocument();
    expect(screen.queryByTestId('smtp-pass-masked')).not.toBeInTheDocument();
  });

  it('saves SMTP config and shows success', async () => {
    renderWithProviders(<NotificationSettings />);

    await waitFor(() => expect(screen.getByTestId('smtp-host-input')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('smtp-host-input'), {
      target: { value: 'smtp.example.com' },
    });
    fireEvent.click(screen.getByTestId('smtp-save-button'));

    await waitFor(() => {
      expect(screen.getByTestId('smtp-save-success')).toBeInTheDocument();
    });
  });

  it('shows error when SMTP save fails', async () => {
    server.use(http.put('/api/v1/settings/smtp', () => new HttpResponse(null, { status: 500 })));

    renderWithProviders(<NotificationSettings />);

    await waitFor(() => expect(screen.getByTestId('smtp-save-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('smtp-save-button'));

    await waitFor(() => {
      expect(screen.getByTestId('smtp-save-error')).toBeInTheDocument();
    });
  });

  it('disables SMTP test button when address is empty', async () => {
    renderWithProviders(<NotificationSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('smtp-test-button')).toBeDisabled();
    });
  });

  it('shows SMTP test success when test passes', async () => {
    renderWithProviders(<NotificationSettings />);

    await waitFor(() => expect(screen.getByTestId('smtp-test-address-input')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('smtp-test-address-input'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.click(screen.getByTestId('smtp-test-button'));

    await waitFor(() => {
      expect(screen.getByTestId('smtp-test-success')).toBeInTheDocument();
    });
  });

  it('shows SMTP test error when test fails', async () => {
    server.use(
      http.post('/api/v1/settings/smtp/test', () =>
        HttpResponse.json({ success: false, error: 'Connection refused' }),
      ),
    );

    renderWithProviders(<NotificationSettings />);

    await waitFor(() => expect(screen.getByTestId('smtp-test-address-input')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('smtp-test-address-input'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.click(screen.getByTestId('smtp-test-button'));

    await waitFor(() => {
      expect(screen.getByTestId('smtp-test-error')).toBeInTheDocument();
    });
  });
});
