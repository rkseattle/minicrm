/**
 * Tests for the GdprPrivacySection component. (MINCRM-364)
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';
import GdprPrivacySection from './GdprPrivacySection.js';

const RECORD_ID = '11111111-1111-1111-1111-111111111111';
const ERASE_DATE = '2026-05-14T12:00:00.000Z';

describe('GdprPrivacySection — loading state', () => {
  it('shows loading indicator initially', () => {
    renderWithProviders(
      <GdprPrivacySection recordType="contact" recordId={RECORD_ID} onErased={vi.fn()} />,
    );
    expect(screen.getByTestId('gdpr-status-loading')).toBeInTheDocument();
  });
});

describe('GdprPrivacySection — not yet erased', () => {
  it('shows the section heading and erase button', async () => {
    renderWithProviders(
      <GdprPrivacySection recordType="contact" recordId={RECORD_ID} onErased={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByTestId('gdpr-erase-button')).toBeInTheDocument());
    expect(screen.getByTestId('gdpr-privacy-heading')).toBeInTheDocument();
    expect(screen.getByTestId('gdpr-export-button')).toBeInTheDocument();
  });

  it('opens the erase modal when the erase button is clicked', async () => {
    renderWithProviders(
      <GdprPrivacySection recordType="contact" recordId={RECORD_ID} onErased={vi.fn()} />,
    );
    await waitFor(() => screen.getByTestId('gdpr-erase-button'));
    fireEvent.click(screen.getByTestId('gdpr-erase-button'));
    expect(screen.getByTestId('gdpr-erase-modal')).toBeInTheDocument();
  });

  it('does not show the erased banner', async () => {
    renderWithProviders(
      <GdprPrivacySection recordType="contact" recordId={RECORD_ID} onErased={vi.fn()} />,
    );
    await waitFor(() => screen.getByTestId('gdpr-erase-button'));
    expect(screen.queryByTestId('gdpr-erased-banner')).not.toBeInTheDocument();
  });
});

describe('GdprPrivacySection — already erased', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/v1/gdpr/status/:recordType/:recordId', () => {
        return HttpResponse.json({
          status: {
            id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            record_type: 'contact',
            record_id: RECORD_ID,
            requested_by: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            requested_at: ERASE_DATE,
            completed_at: ERASE_DATE,
            erasure_scope: ['first_name', 'last_name', 'email'],
            notes: null,
          },
        });
      }),
    );
  });

  it('shows the erased banner instead of the erase button', async () => {
    renderWithProviders(
      <GdprPrivacySection recordType="contact" recordId={RECORD_ID} onErased={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByTestId('gdpr-erased-banner')).toBeInTheDocument());
    expect(screen.queryByTestId('gdpr-erase-button')).not.toBeInTheDocument();
  });

  it('still shows the export button', async () => {
    renderWithProviders(
      <GdprPrivacySection recordType="contact" recordId={RECORD_ID} onErased={vi.fn()} />,
    );
    await waitFor(() => screen.getByTestId('gdpr-erased-banner'));
    expect(screen.getByTestId('gdpr-export-button')).toBeInTheDocument();
  });
});

describe('GdprPrivacySection — erase error', () => {
  beforeEach(() => {
    server.use(
      http.post('/api/v1/contacts/:id/gdpr-erase', () => {
        return HttpResponse.json(
          { error: { code: 'GDPR_ALREADY_ERASED', message: 'Already erased' } },
          { status: 409 },
        );
      }),
    );
  });

  it('shows an error when the erase API call fails', async () => {
    renderWithProviders(
      <GdprPrivacySection recordType="contact" recordId={RECORD_ID} onErased={vi.fn()} />,
    );

    await waitFor(() => screen.getByTestId('gdpr-erase-button'));
    fireEvent.click(screen.getByTestId('gdpr-erase-button'));
    await waitFor(() => screen.getByTestId('gdpr-erase-modal'));

    fireEvent.change(screen.getByTestId('gdpr-erase-confirm-input'), {
      target: { value: 'ERASE' },
    });
    fireEvent.click(screen.getByTestId('gdpr-erase-confirm-button'));

    await waitFor(() => expect(screen.getByTestId('gdpr-erase-error')).toBeInTheDocument());
  });
});
