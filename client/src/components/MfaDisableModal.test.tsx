/**
 * Tests for MfaDisableModal. (MINCRM-392)
 * Covers: closed state, form render, invalid password error,
 * success callback, cancel, and Escape key.
 */

import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import MfaDisableModal from './MfaDisableModal.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';

function renderModal(isOpen = true, onSuccess = vi.fn(), onCancel = vi.fn()) {
  return renderWithProviders(
    <MfaDisableModal isOpen={isOpen} onSuccess={onSuccess} onCancel={onCancel} />,
  );
}

describe('MfaDisableModal', () => {
  describe('closed state', () => {
    it('renders nothing when isOpen is false', () => {
      renderModal(false);
      expect(screen.queryByTestId('mfa-disable-modal')).not.toBeInTheDocument();
    });
  });

  describe('open state', () => {
    it('renders the password input', () => {
      renderModal();
      expect(screen.getByTestId('mfa-disable-password-input')).toBeInTheDocument();
    });

    it('confirm button is disabled when password is empty', () => {
      renderModal();
      expect(screen.getByTestId('mfa-disable-confirm')).toBeDisabled();
    });

    it('confirm button is enabled after entering a password', async () => {
      const user = userEvent.setup();
      renderModal();
      await user.type(screen.getByTestId('mfa-disable-password-input'), 'correct-password');
      expect(screen.getByTestId('mfa-disable-confirm')).not.toBeDisabled();
    });

    it('calls onCancel when the Cancel button is clicked', async () => {
      const onCancel = vi.fn();
      const user = userEvent.setup();
      renderModal(true, vi.fn(), onCancel);
      await user.click(screen.getByTestId('mfa-disable-cancel'));
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it('calls onCancel when Escape is pressed', () => {
      const onCancel = vi.fn();
      renderModal(true, vi.fn(), onCancel);
      const modal = screen.getByTestId('mfa-disable-modal');
      fireEvent.keyDown(modal, { key: 'Escape' });
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it('shows invalid password error when API returns 401', async () => {
      server.use(
        http.post('/api/v1/auth/mfa/disable', () =>
          HttpResponse.json(
            {
              error: {
                code: 'AUTH_INVALID_CREDENTIALS',
                message: 'Current password is incorrect.',
              },
            },
            { status: 401 },
          ),
        ),
      );
      const user = userEvent.setup();
      renderModal();
      await user.type(screen.getByTestId('mfa-disable-password-input'), 'wrong-password');
      await user.click(screen.getByTestId('mfa-disable-confirm'));
      await waitFor(() => {
        expect(screen.getByTestId('mfa-disable-invalid-password')).toBeInTheDocument();
      });
    });

    it('calls onSuccess when disable succeeds', async () => {
      const onSuccess = vi.fn();
      const user = userEvent.setup();
      renderModal(true, onSuccess);
      await user.type(screen.getByTestId('mfa-disable-password-input'), 'correct-password');
      await user.click(screen.getByTestId('mfa-disable-confirm'));
      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledOnce();
      });
    });

    it('password input starts empty on each open', () => {
      renderModal();
      expect(screen.getByTestId('mfa-disable-password-input')).toHaveValue('');
    });
  });
});
