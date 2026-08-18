/**
 * Tests for the ConvertLeadModal component.
 * Covers: prefilled values from lead prop, create/link account mode toggle,
 * validation, successful conversion callback, close button, Escape key.
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import ConvertLeadModal from './ConvertLeadModal.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { LEAD_1, ACCOUNT_1 } from '../test/msw/handlers.js';

// Plain function — not a spy, so call counts don't accumulate across tests
const noop = () => {};

describe('ConvertLeadModal', () => {
  describe('prefilled values from lead prop', () => {
    it('prefills contact first name and email from lead', () => {
      renderWithProviders(<ConvertLeadModal lead={LEAD_1} onClose={noop} onConverted={noop} />);
      expect(screen.getByTestId<HTMLInputElement>('convert-contact-first-name').value).toBe(
        LEAD_1.first_name,
      );
      expect(screen.getByTestId<HTMLInputElement>('convert-contact-email').value).toBe(
        LEAD_1.email,
      );
    });

    it('prefills contact last name and phone from lead', () => {
      renderWithProviders(<ConvertLeadModal lead={LEAD_1} onClose={noop} onConverted={noop} />);
      expect(screen.getByTestId<HTMLInputElement>('convert-contact-last-name').value).toBe(
        LEAD_1.last_name ?? '',
      );
      expect(screen.getByTestId<HTMLInputElement>('convert-contact-phone').value).toBe(
        LEAD_1.phone ?? '',
      );
    });

    it('prefills account name from lead company_name', () => {
      renderWithProviders(<ConvertLeadModal lead={LEAD_1} onClose={noop} onConverted={noop} />);
      expect(screen.getByTestId<HTMLInputElement>('convert-account-name').value).toBe(
        LEAD_1.company_name ?? '',
      );
    });

    it('renders a deal name field that includes the company name suffix', () => {
      renderWithProviders(<ConvertLeadModal lead={LEAD_1} onClose={noop} onConverted={noop} />);
      const dealNameInput = screen.getByTestId<HTMLInputElement>('convert-deal-name');
      expect(dealNameInput.value).toContain(LEAD_1.company_name ?? '');
    });
  });

  describe('account mode toggle', () => {
    it('defaults to "Create" mode with an account name input', () => {
      renderWithProviders(<ConvertLeadModal lead={LEAD_1} onClose={noop} onConverted={noop} />);
      expect(screen.getByTestId('convert-account-name')).toBeInTheDocument();
      expect(screen.queryByTestId('convert-account-search')).not.toBeInTheDocument();
    });

    it('switches to "Link" mode and shows the search input when Link button is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ConvertLeadModal lead={LEAD_1} onClose={noop} onConverted={noop} />);

      await user.click(screen.getByTestId('account-mode-link'));

      expect(screen.queryByTestId('convert-account-name')).not.toBeInTheDocument();
      expect(screen.getByTestId('convert-account-search')).toBeInTheDocument();
    });

    it('switches back to "Create" mode from Link mode', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ConvertLeadModal lead={LEAD_1} onClose={noop} onConverted={noop} />);

      await user.click(screen.getByTestId('account-mode-link'));
      await user.click(screen.getByTestId('account-mode-create'));

      expect(screen.getByTestId('convert-account-name')).toBeInTheDocument();
      expect(screen.queryByTestId('convert-account-search')).not.toBeInTheDocument();
    });

    it('shows account search results in Link mode after typing', async () => {
      server.use(
        http.get('/api/v1/leads/accounts/search', () =>
          HttpResponse.json({ accounts: [{ id: ACCOUNT_1.id, name: ACCOUNT_1.name }] }),
        ),
      );
      const user = userEvent.setup();
      renderWithProviders(<ConvertLeadModal lead={LEAD_1} onClose={noop} onConverted={noop} />);

      await user.click(screen.getByTestId('account-mode-link'));
      const searchInput = screen.getByTestId('convert-account-search');
      await user.type(searchInput, 'Acm');

      await waitFor(() =>
        expect(screen.getByTestId(`account-result-${ACCOUNT_1.id}`)).toBeInTheDocument(),
      );
    });

    it('selects an account from search results in Link mode', async () => {
      server.use(
        http.get('/api/v1/leads/accounts/search', () =>
          HttpResponse.json({ accounts: [{ id: ACCOUNT_1.id, name: ACCOUNT_1.name }] }),
        ),
      );
      const user = userEvent.setup();
      renderWithProviders(<ConvertLeadModal lead={LEAD_1} onClose={noop} onConverted={noop} />);

      await user.click(screen.getByTestId('account-mode-link'));
      await user.type(screen.getByTestId('convert-account-search'), 'Acm');

      await waitFor(() =>
        expect(screen.getByTestId(`account-result-${ACCOUNT_1.id}`)).toBeInTheDocument(),
      );
      await user.click(screen.getByTestId(`account-result-${ACCOUNT_1.id}`));

      // After selection the search input value should show the account name
      expect(screen.getByTestId<HTMLInputElement>('convert-account-search').value).toBe(
        ACCOUNT_1.name,
      );
    });
  });

  describe('validation', () => {
    it('shows an error when Link mode is active but no account is selected', async () => {
      const user = userEvent.setup();
      renderWithProviders(<ConvertLeadModal lead={LEAD_1} onClose={noop} onConverted={noop} />);

      await user.click(screen.getByTestId('account-mode-link'));
      await user.click(screen.getByTestId('convert-confirm'));

      await waitFor(() => expect(screen.getByTestId('convert-error')).toBeInTheDocument());
    });

    it('shows an error when contact first name is cleared', () => {
      renderWithProviders(<ConvertLeadModal lead={LEAD_1} onClose={noop} onConverted={noop} />);

      // Clear the pre-filled first name, then submit — bypasses HTML5 required validation
      fireEvent.change(screen.getByTestId('convert-contact-first-name'), {
        target: { value: '' },
      });
      // Directly submit the form to bypass HTML5 constraint validation
      fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);

      expect(screen.getByTestId('convert-error')).toBeInTheDocument();
    });

    it('shows an error when deal name is cleared', () => {
      renderWithProviders(<ConvertLeadModal lead={LEAD_1} onClose={noop} onConverted={noop} />);

      // Clear the pre-filled deal name, then submit — bypasses HTML5 required validation
      fireEvent.change(screen.getByTestId('convert-deal-name'), {
        target: { value: '' },
      });
      fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);

      expect(screen.getByTestId('convert-error')).toBeInTheDocument();
    });
  });

  describe('successful conversion', () => {
    it('calls onConverted with the conversion result on success', async () => {
      const handleConverted = vi.fn();
      const user = userEvent.setup();
      renderWithProviders(
        <ConvertLeadModal lead={LEAD_1} onClose={noop} onConverted={handleConverted} />,
      );

      await user.click(screen.getByTestId('convert-confirm'));

      await waitFor(() =>
        expect(handleConverted).toHaveBeenCalledWith(
          expect.objectContaining({
            contact_id: expect.any(String),
            account_id: expect.any(String),
            deal_id: expect.any(String),
          }),
        ),
      );
    });
  });

  describe('close behaviour', () => {
    it('calls onClose when the X button is clicked', async () => {
      const handleClose = vi.fn();
      const user = userEvent.setup();
      renderWithProviders(
        <ConvertLeadModal lead={LEAD_1} onClose={handleClose} onConverted={noop} />,
      );

      await user.click(screen.getByTestId('convert-modal-close'));
      expect(handleClose).toHaveBeenCalledOnce();
    });

    it('calls onClose when the Cancel button is clicked', async () => {
      const handleClose = vi.fn();
      const user = userEvent.setup();
      renderWithProviders(
        <ConvertLeadModal lead={LEAD_1} onClose={handleClose} onConverted={noop} />,
      );

      await user.click(screen.getByTestId('convert-cancel'));
      expect(handleClose).toHaveBeenCalledOnce();
    });

    it('calls onClose when Escape key is pressed', async () => {
      const handleClose = vi.fn();
      const user = userEvent.setup();
      renderWithProviders(
        <ConvertLeadModal lead={LEAD_1} onClose={handleClose} onConverted={noop} />,
      );

      await user.keyboard('[Escape]');
      expect(handleClose).toHaveBeenCalledOnce();
    });
  });

  describe('dialog accessibility', () => {
    it('renders as a dialog with aria-modal', () => {
      renderWithProviders(<ConvertLeadModal lead={LEAD_1} onClose={noop} onConverted={noop} />);
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('aria-modal', 'true');
    });
  });

  describe('email format validation', () => {
    it('contact email input has type="email" for browser format enforcement', () => {
      renderWithProviders(<ConvertLeadModal lead={LEAD_1} onClose={noop} onConverted={noop} />);
      expect(screen.getByTestId('convert-contact-email')).toHaveAttribute('type', 'email');
    });
  });
});
