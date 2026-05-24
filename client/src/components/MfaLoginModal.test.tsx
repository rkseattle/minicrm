/**
 * Tests for MfaLoginModal. (MINCRM-392)
 * Covers: closed state, TOTP mode, recovery code mode switching,
 * invalid code error, success callback, cancel, and Escape key.
 */

import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { ADMIN_USER } from '../test/msw/handlers.js';
import MfaLoginModal from './MfaLoginModal.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';

const MFA_TOKEN = 'test-mfa-token';

function renderModal(isOpen = true, onSuccess = vi.fn(), onCancel = vi.fn()) {
  return renderWithProviders(
    <MfaLoginModal
      isOpen={isOpen}
      mfaToken={MFA_TOKEN}
      onSuccess={onSuccess}
      onCancel={onCancel}
    />,
  );
}

describe('MfaLoginModal', () => {
  describe('closed state', () => {
    it('renders nothing when isOpen is false', () => {
      renderModal(false);
      expect(screen.queryByTestId('mfa-login-modal')).not.toBeInTheDocument();
    });
  });

  describe('TOTP mode (default)', () => {
    it('renders the modal when isOpen is true', () => {
      renderModal();
      expect(screen.getByTestId('mfa-login-modal')).toBeInTheDocument();
    });

    it('renders the code input', () => {
      renderModal();
      expect(screen.getByTestId('mfa-login-code-input')).toBeInTheDocument();
    });

    it('submit button is disabled when code is empty', () => {
      renderModal();
      expect(screen.getByTestId('mfa-login-submit')).toBeDisabled();
    });

    it('submit button is enabled after typing a code', async () => {
      const user = userEvent.setup();
      renderModal();
      await user.type(screen.getByTestId('mfa-login-code-input'), '123456');
      expect(screen.getByTestId('mfa-login-submit')).not.toBeDisabled();
    });

    it('only accepts numeric input in TOTP mode', async () => {
      const user = userEvent.setup();
      renderModal();
      await user.type(screen.getByTestId('mfa-login-code-input'), 'abc123def');
      expect(screen.getByTestId('mfa-login-code-input')).toHaveValue('123');
    });

    it('shows invalid code error when verify-login returns 401', async () => {
      server.use(
        http.post('/api/v1/auth/mfa/verify-login', () =>
          HttpResponse.json({ error: { code: 'MFA_INVALID_CODE' } }, { status: 401 }),
        ),
      );
      const user = userEvent.setup();
      renderModal();
      await user.type(screen.getByTestId('mfa-login-code-input'), '999999');
      await user.click(screen.getByTestId('mfa-login-submit'));
      await waitFor(() => {
        expect(screen.getByTestId('mfa-login-invalid-code')).toBeInTheDocument();
      });
    });

    it('calls onSuccess with response data when TOTP login succeeds', async () => {
      const onSuccess = vi.fn();
      const user = userEvent.setup();
      renderModal(true, onSuccess);
      await user.type(screen.getByTestId('mfa-login-code-input'), '123456');
      await user.click(screen.getByTestId('mfa-login-submit'));
      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(
          expect.objectContaining({ user: ADMIN_USER, mustChangePassword: false }),
        );
      });
    });

    it('calls onCancel when Escape is pressed', () => {
      const onCancel = vi.fn();
      renderModal(true, vi.fn(), onCancel);
      const modal = screen.getByTestId('mfa-login-modal');
      fireEvent.keyDown(modal, { key: 'Escape' });
      expect(onCancel).toHaveBeenCalledOnce();
    });
  });

  describe('mode switching', () => {
    it('shows the switch-mode button', () => {
      renderModal();
      expect(screen.getByTestId('mfa-login-switch-mode')).toBeInTheDocument();
    });

    it('switches to recovery code mode when switch button is clicked', async () => {
      const user = userEvent.setup();
      renderModal();
      await user.click(screen.getByTestId('mfa-login-switch-mode'));
      expect(screen.getByTestId('mfa-login-code-input')).toHaveAttribute('inputmode', 'text');
    });

    it('clears the code field when switching modes', async () => {
      const user = userEvent.setup();
      renderModal();
      await user.type(screen.getByTestId('mfa-login-code-input'), '123456');
      await user.click(screen.getByTestId('mfa-login-switch-mode'));
      expect(screen.getByTestId('mfa-login-code-input')).toHaveValue('');
    });

    it('calls onSuccess with response data when recovery login succeeds', async () => {
      const onSuccess = vi.fn();
      const user = userEvent.setup();
      renderModal(true, onSuccess);
      await user.click(screen.getByTestId('mfa-login-switch-mode'));
      await user.type(screen.getByTestId('mfa-login-code-input'), 'AAAA-1111');
      await user.click(screen.getByTestId('mfa-login-submit'));
      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(
          expect.objectContaining({ user: ADMIN_USER, mustChangePassword: false }),
        );
      });
    });

    it('shows invalid code error in recovery mode when recovery-login returns 401', async () => {
      server.use(
        http.post('/api/v1/auth/mfa/recovery-login', () =>
          HttpResponse.json({ error: { code: 'MFA_INVALID_RECOVERY_CODE' } }, { status: 401 }),
        ),
      );
      const user = userEvent.setup();
      renderModal();
      await user.click(screen.getByTestId('mfa-login-switch-mode'));
      await user.type(screen.getByTestId('mfa-login-code-input'), 'BAD-CODE');
      await user.click(screen.getByTestId('mfa-login-submit'));
      await waitFor(() => {
        expect(screen.getByTestId('mfa-login-invalid-code')).toBeInTheDocument();
      });
    });
  });
});
