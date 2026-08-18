/**
 * Tests for MfaRecoveryCodesModal.
 * Covers: closed state, recovery code list display, copy-all, and done callback.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import MfaRecoveryCodesModal from './MfaRecoveryCodesModal.js';
import { renderWithProviders } from '../test/renderWithProviders.js';

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

function renderModal(isOpen = true, onDone = vi.fn()) {
  return renderWithProviders(
    <MfaRecoveryCodesModal isOpen={isOpen} recoveryCodes={RECOVERY_CODES} onDone={onDone} />,
  );
}

describe('MfaRecoveryCodesModal', () => {
  describe('closed state', () => {
    it('renders nothing when isOpen is false', () => {
      renderModal(false);
      expect(screen.queryByTestId('mfa-recovery-codes-modal')).not.toBeInTheDocument();
    });
  });

  describe('open state', () => {
    it('renders the modal when isOpen is true', () => {
      renderModal();
      expect(screen.getByTestId('mfa-recovery-codes-modal')).toBeInTheDocument();
    });

    it('displays all 8 recovery codes', () => {
      renderModal();
      const list = screen.getByTestId('mfa-recovery-codes-list');
      RECOVERY_CODES.forEach((code) => {
        expect(list).toHaveTextContent(code);
      });
    });

    it('shows exactly 8 list items', () => {
      renderModal();
      const items = screen.getByTestId('mfa-recovery-codes-list').querySelectorAll('li');
      expect(items).toHaveLength(8);
    });

    it('shows the copy button', () => {
      renderModal();
      expect(screen.getByTestId('mfa-recovery-copy')).toBeInTheDocument();
    });

    it('shows "Copied!" after clicking copy', async () => {
      Object.assign(navigator, {
        clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
      });
      const user = userEvent.setup();
      renderModal();
      await user.click(screen.getByTestId('mfa-recovery-copy'));
      await waitFor(() => {
        expect(screen.getByTestId('mfa-recovery-copy')).toHaveTextContent('Copied!');
      });
    });

    it('calls onDone when the Done button is clicked', async () => {
      const onDone = vi.fn();
      const user = userEvent.setup();
      renderModal(true, onDone);
      await user.click(screen.getByTestId('mfa-recovery-done'));
      expect(onDone).toHaveBeenCalledOnce();
    });
  });
});
