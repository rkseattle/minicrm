/**
 * Tests for the SMTP configuration section of AdminSettingsPage. (MINCRM-254)
 *
 * Covers: loading state, form rendering, password masking pattern,
 * save success/error, and test email inline result.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import AdminSettingsPage from './AdminSettingsPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';

function renderOnNotificationsTab() {
  return renderWithProviders(<AdminSettingsPage />, {
    initialEntries: ['/?tab=notifications'],
  });
}

describe('AdminSettingsPage — SMTP section', () => {
  describe('loading state', () => {
    it('shows loading text while fetching SMTP config', async () => {
      server.use(http.get('/api/v1/settings/smtp', () => new Promise(() => {})));
      renderOnNotificationsTab();
      await waitFor(() => {
        expect(screen.getByTestId('smtp-loading')).toBeInTheDocument();
      });
    });
  });

  describe('load error', () => {
    it('shows error when SMTP config fails to load', async () => {
      server.use(
        http.get('/api/v1/settings/smtp', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      renderOnNotificationsTab();
      await waitFor(() => {
        expect(screen.getByTestId('smtp-load-error')).toBeInTheDocument();
      });
    });
  });

  describe('form rendering', () => {
    it('renders the SMTP section with all form fields', async () => {
      renderOnNotificationsTab();
      await waitFor(() => {
        expect(screen.getByTestId('smtp-section')).toBeInTheDocument();
      });
      expect(screen.getByTestId('smtp-host-input')).toBeInTheDocument();
      expect(screen.getByTestId('smtp-port-input')).toBeInTheDocument();
      expect(screen.getByTestId('smtp-user-input')).toBeInTheDocument();
      expect(screen.getByTestId('smtp-enabled-toggle')).toBeInTheDocument();
      expect(screen.getByTestId('smtp-save-button')).toBeInTheDocument();
    });

    it('shows the password input directly when no password is set', async () => {
      renderOnNotificationsTab();
      await waitFor(() => {
        expect(screen.getByTestId('smtp-pass-input')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('smtp-pass-masked')).not.toBeInTheDocument();
    });

    it('shows the masked placeholder and change-password button when password is set', async () => {
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
      renderOnNotificationsTab();
      await waitFor(() => {
        expect(screen.getByTestId('smtp-pass-masked')).toBeInTheDocument();
      });
      expect(screen.getByTestId('smtp-change-password-button')).toBeInTheDocument();
      expect(screen.queryByTestId('smtp-pass-input')).not.toBeInTheDocument();
    });

    it('reveals the password input when "Change password" is clicked', async () => {
      const user = userEvent.setup();
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
      renderOnNotificationsTab();
      await waitFor(() => {
        expect(screen.getByTestId('smtp-change-password-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('smtp-change-password-button'));
      expect(screen.getByTestId('smtp-pass-input')).toBeInTheDocument();
      expect(screen.queryByTestId('smtp-pass-masked')).not.toBeInTheDocument();
    });

    it('hides the password input when "Cancel" is clicked after opening change mode', async () => {
      const user = userEvent.setup();
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
      renderOnNotificationsTab();
      await waitFor(() => {
        expect(screen.getByTestId('smtp-change-password-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('smtp-change-password-button'));
      expect(screen.getByTestId('smtp-cancel-password-button')).toBeInTheDocument();
      await user.click(screen.getByTestId('smtp-cancel-password-button'));
      expect(screen.queryByTestId('smtp-pass-input')).not.toBeInTheDocument();
      expect(screen.getByTestId('smtp-pass-masked')).toBeInTheDocument();
    });
  });

  describe('save action', () => {
    it('shows success message after save', async () => {
      const user = userEvent.setup();
      renderOnNotificationsTab();
      await waitFor(() => {
        expect(screen.getByTestId('smtp-save-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('smtp-save-button'));
      await waitFor(() => {
        expect(screen.getByTestId('smtp-save-success')).toBeInTheDocument();
      });
    });

    it('shows error message when save fails', async () => {
      const user = userEvent.setup();
      server.use(
        http.put('/api/v1/settings/smtp', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      renderOnNotificationsTab();
      await waitFor(() => {
        expect(screen.getByTestId('smtp-save-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('smtp-save-button'));
      await waitFor(() => {
        expect(screen.getByTestId('smtp-save-error')).toBeInTheDocument();
      });
    });
  });

  describe('test email', () => {
    it('renders the test email section', async () => {
      renderOnNotificationsTab();
      await waitFor(() => {
        expect(screen.getByTestId('smtp-test-address-input')).toBeInTheDocument();
        expect(screen.getByTestId('smtp-test-button')).toBeInTheDocument();
      });
    });

    it('shows success result after a successful test send', async () => {
      const user = userEvent.setup();
      renderOnNotificationsTab();
      await waitFor(() => {
        expect(screen.getByTestId('smtp-test-address-input')).toBeInTheDocument();
      });
      await user.type(screen.getByTestId('smtp-test-address-input'), 'test@example.com');
      await user.click(screen.getByTestId('smtp-test-button'));
      await waitFor(() => {
        expect(screen.getByTestId('smtp-test-success')).toBeInTheDocument();
      });
    });

    it('shows error result when test send fails', async () => {
      const user = userEvent.setup();
      server.use(
        http.post('/api/v1/settings/smtp/test', () =>
          HttpResponse.json({ success: false, error: 'Connection refused' }),
        ),
      );
      renderOnNotificationsTab();
      await waitFor(() => {
        expect(screen.getByTestId('smtp-test-address-input')).toBeInTheDocument();
      });
      await user.type(screen.getByTestId('smtp-test-address-input'), 'test@example.com');
      await user.click(screen.getByTestId('smtp-test-button'));
      await waitFor(() => {
        expect(screen.getByTestId('smtp-test-error')).toBeInTheDocument();
      });
    });

    it('disables test button when no address is entered', async () => {
      renderOnNotificationsTab();
      await waitFor(() => {
        expect(screen.getByTestId('smtp-test-button')).toBeDisabled();
      });
    });
  });

  describe('enabled toggle', () => {
    it('toggles smtp_enabled state when clicked', async () => {
      const user = userEvent.setup();
      renderOnNotificationsTab();
      await waitFor(() => {
        expect(screen.getByTestId('smtp-enabled-toggle')).toBeInTheDocument();
      });
      const toggle = screen.getByTestId('smtp-enabled-toggle');
      expect(toggle).toHaveAttribute('aria-checked', 'false');
      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });
  });
});
