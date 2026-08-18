/**
 * Tests for the ContactEnrichmentModal component.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import ContactEnrichmentModal from './ContactEnrichmentModal.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';

describe('ContactEnrichmentModal', () => {
  it('extracts fields and applies them on Apply', async () => {
    server.use(
      http.post('/api/v1/contacts/enrich-from-text', () =>
        HttpResponse.json({
          fields: {
            first_name: 'Jane',
            last_name: 'Doe',
            title: 'VP Sales',
            company_name: 'Acme Corp',
            email: 'jane@acme.com',
            phone: null,
            linkedin_url: null,
            location: null,
          },
          matched_account_id: 'acct-1',
          insufficient_data: false,
        }),
      ),
    );

    const handleApply = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ContactEnrichmentModal isOpen={true} onApply={handleApply} onCancel={vi.fn()} />,
    );

    await user.type(screen.getByTestId('contact-enrichment-input'), 'Jane Doe bio text');
    await user.click(screen.getByTestId('contact-enrichment-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('contact-enrichment-apply')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('contact-enrichment-apply'));

    expect(handleApply).toHaveBeenCalledWith(
      expect.objectContaining({ first_name: 'Jane', company_name: 'Acme Corp' }),
      'acct-1',
    );
  });

  it('shows the insufficient-data message and hides Apply when nothing was extracted', async () => {
    server.use(
      http.post('/api/v1/contacts/enrich-from-text', () =>
        HttpResponse.json({
          fields: {
            first_name: null,
            last_name: null,
            title: null,
            company_name: null,
            email: null,
            phone: null,
            linkedin_url: null,
            location: null,
          },
          matched_account_id: null,
          insufficient_data: true,
        }),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(
      <ContactEnrichmentModal isOpen={true} onApply={vi.fn()} onCancel={vi.fn()} />,
    );

    await user.type(screen.getByTestId('contact-enrichment-input'), 'asdf');
    await user.click(screen.getByTestId('contact-enrichment-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('contact-enrichment-insufficient')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('contact-enrichment-apply')).not.toBeInTheDocument();

    // The user can edit the pasted text and retry instead of being stuck (code review fix).
    expect(screen.getByTestId('contact-enrichment-submit')).toBeInTheDocument();
    expect(screen.getByTestId('contact-enrichment-submit')).not.toBeDisabled();
  });

  it('shows an error when extraction fails', async () => {
    server.use(
      http.post('/api/v1/contacts/enrich-from-text', () =>
        HttpResponse.json(
          { error: { code: 'AI_PROVIDER_ERROR', message: 'AI provider error' } },
          { status: 502 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(
      <ContactEnrichmentModal isOpen={true} onApply={vi.fn()} onCancel={vi.fn()} />,
    );

    await user.type(screen.getByTestId('contact-enrichment-input'), 'text');
    await user.click(screen.getByTestId('contact-enrichment-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('contact-enrichment-error')).toBeInTheDocument();
    });
  });

  it('calls onCancel when cancel is clicked', async () => {
    const handleCancel = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ContactEnrichmentModal isOpen={true} onApply={vi.fn()} onCancel={handleCancel} />,
    );

    await user.click(screen.getByTestId('contact-enrichment-cancel'));
    expect(handleCancel).toHaveBeenCalledOnce();
  });
});
