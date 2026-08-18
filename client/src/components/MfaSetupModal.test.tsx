/**
 * Tests for MfaSetupModal.
 * Covers: loading state, QR code display, verification step,
 * invalid code error, success callback, cancel, and Escape key.
 */

import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import MfaSetupModal from './MfaSetupModal.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';

const DUMMY_QR =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const RECOVERY_CODES = [
  'AAAA-1111',
  'BBBB-2222',
  'CCCC-3333',
  'DDDD-4444',
  'EEEE-5555',
  'FFFF-6666',
  'GGGG-7777',
  'HHHH-8888',
];

function renderModal(isOpen = true, onSuccess = vi.fn(), onCancel = vi.fn()) {
  return renderWithProviders(
    <MfaSetupModal isOpen={isOpen} onSuccess={onSuccess} onCancel={onCancel} />,
  );
}

describe('MfaSetupModal', () => {
  describe('closed state', () => {
    it('renders nothing when isOpen is false', () => {
      renderModal(false);
      expect(screen.queryByTestId('mfa-setup-modal')).not.toBeInTheDocument();
    });
  });

  describe('QR code step (loading state)', () => {
    it('shows loading indicator while setup API is pending', async () => {
      server.use(http.post('/api/v1/auth/mfa/setup', () => new Promise(() => {})));
      renderModal();
      await waitFor(() => {
        expect(screen.getByTestId('mfa-qr-loading')).toBeInTheDocument();
      });
    });

    it('shows error when setup API fails', async () => {
      server.use(
        http.post('/api/v1/auth/mfa/setup', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR' } }, { status: 500 }),
        ),
      );
      renderModal();
      await waitFor(() => {
        expect(screen.getByTestId('mfa-setup-load-error')).toBeInTheDocument();
      });
    });
  });

  describe('QR code step (loaded)', () => {
    it('shows the QR code image after setup loads', async () => {
      renderModal();
      await waitFor(() => {
        expect(screen.getByTestId('mfa-qr-code')).toBeInTheDocument();
      });
      expect(screen.getByTestId('mfa-qr-code').querySelector('img')).toHaveAttribute(
        'src',
        DUMMY_QR,
      );
    });

    it('Next button is disabled until QR code is loaded', () => {
      server.use(http.post('/api/v1/auth/mfa/setup', () => new Promise(() => {})));
      renderModal();
      expect(screen.getByTestId('mfa-setup-next')).toBeDisabled();
    });

    it('Next button is enabled after QR code loads', async () => {
      renderModal();
      await waitFor(() => {
        expect(screen.getByTestId('mfa-setup-next')).not.toBeDisabled();
      });
    });

    it('calls onCancel when Cancel is clicked', async () => {
      const onCancel = vi.fn();
      const user = userEvent.setup();
      renderModal(true, vi.fn(), onCancel);
      await waitFor(() => expect(screen.getByTestId('mfa-setup-cancel')).toBeInTheDocument());
      await user.click(screen.getByTestId('mfa-setup-cancel'));
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it('calls onCancel when Escape is pressed', async () => {
      const onCancel = vi.fn();
      renderModal(true, vi.fn(), onCancel);
      const modal = await screen.findByTestId('mfa-setup-modal');
      fireEvent.keyDown(modal, { key: 'Escape' });
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it('advances to the verify step when Next is clicked', async () => {
      const user = userEvent.setup();
      renderModal();
      await waitFor(() => expect(screen.getByTestId('mfa-setup-next')).not.toBeDisabled());
      await user.click(screen.getByTestId('mfa-setup-next'));
      await waitFor(() => {
        expect(screen.getByTestId('mfa-setup-code-input')).toBeInTheDocument();
      });
    });
  });

  describe('verify step', () => {
    async function goToVerifyStep(onSuccess = vi.fn(), onCancel = vi.fn()) {
      const user = userEvent.setup();
      renderModal(true, onSuccess, onCancel);
      await waitFor(() => expect(screen.getByTestId('mfa-setup-next')).not.toBeDisabled());
      await user.click(screen.getByTestId('mfa-setup-next'));
      await waitFor(() => expect(screen.getByTestId('mfa-setup-code-input')).toBeInTheDocument());
      return user;
    }

    it('renders the code input', async () => {
      await goToVerifyStep();
      expect(screen.getByTestId('mfa-setup-code-input')).toBeInTheDocument();
    });

    it('verify button is disabled when code is not 6 digits', async () => {
      const user = await goToVerifyStep();
      await user.type(screen.getByTestId('mfa-setup-code-input'), '12345');
      expect(screen.getByTestId('mfa-setup-verify')).toBeDisabled();
    });

    it('verify button is enabled when code is exactly 6 digits', async () => {
      const user = await goToVerifyStep();
      await user.type(screen.getByTestId('mfa-setup-code-input'), '123456');
      expect(screen.getByTestId('mfa-setup-verify')).not.toBeDisabled();
    });

    it('only accepts numeric input', async () => {
      const user = await goToVerifyStep();
      await user.type(screen.getByTestId('mfa-setup-code-input'), 'abc123def');
      expect(screen.getByTestId('mfa-setup-code-input')).toHaveValue('123');
    });

    it('shows invalid code error when verify-setup returns 401', async () => {
      server.use(
        http.post('/api/v1/auth/mfa/verify-setup', () =>
          HttpResponse.json({ error: { code: 'MFA_INVALID_CODE' } }, { status: 401 }),
        ),
      );
      const user = await goToVerifyStep();
      await user.type(screen.getByTestId('mfa-setup-code-input'), '999999');
      await user.click(screen.getByTestId('mfa-setup-verify'));
      await waitFor(() => {
        expect(screen.getByTestId('mfa-setup-invalid-code')).toBeInTheDocument();
      });
    });

    it('calls onSuccess with recovery codes when verify succeeds', async () => {
      const onSuccess = vi.fn();
      const user = await goToVerifyStep(onSuccess);
      await user.type(screen.getByTestId('mfa-setup-code-input'), '123456');
      await user.click(screen.getByTestId('mfa-setup-verify'));
      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(RECOVERY_CODES);
      });
    });

    it('Back button returns to QR step', async () => {
      const user = await goToVerifyStep();
      await user.click(screen.getByTestId('mfa-setup-back'));
      await waitFor(() => {
        expect(screen.getByTestId('mfa-qr-code')).toBeInTheDocument();
      });
    });
  });
});
