/**
 * Tests for BrandingSettings admin panel.
 *
 * Covers:
 * - Loading state
 * - Error state
 * - Empty state (no branding configured)
 * - Form renders with existing branding config
 * - Save success
 * - Save error
 * - Reset success
 * - Reset error
 * - WCAG contrast indicator shown
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import BrandingSettings from './BrandingSettings.js';

describe('BrandingSettings — loading state', () => {
  it('shows loading text while branding is being fetched', () => {
    server.use(
      http.get(
        '/api/v1/settings/branding',
        () =>
          new Promise(() => {
            /* never resolves */
          }),
      ),
    );
    renderWithProviders(<BrandingSettings />);
    expect(screen.getByTestId('branding-loading')).toBeInTheDocument();
  });
});

describe('BrandingSettings — error state', () => {
  it('shows error message when branding fetch fails', async () => {
    server.use(
      http.get('/api/v1/settings/branding', () => new HttpResponse(null, { status: 500 })),
    );
    renderWithProviders(<BrandingSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('branding-load-error')).toBeInTheDocument();
    });
  });
});

describe('BrandingSettings — empty state', () => {
  it('renders the form with empty defaults when no branding is configured', async () => {
    renderWithProviders(<BrandingSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('branding-form')).toBeInTheDocument();
    });
    expect(screen.getByTestId('branding-section-title')).toBeInTheDocument();
    expect(screen.getByTestId('branding-company-name')).toHaveValue('');
    expect(screen.getByTestId('branding-logo-url')).toHaveValue('');
    expect(screen.getByTestId('branding-font-select')).toHaveValue('inter');
    expect(screen.getByTestId('branding-reset-section')).toBeInTheDocument();
  });
});

describe('BrandingSettings — with existing branding', () => {
  beforeEach(() => {
    server.use(
      http.get('/api/v1/settings/branding', () =>
        HttpResponse.json({
          branding: {
            logoUrl: 'https://example.com/logo.png',
            logoAltText: 'Acme Logo',
            faviconUrl: null,
            primaryColor: '#e53e3e',
            primaryColorText: '#ffffff',
            fontFamily: 'roboto',
            companyName: 'Acme Corp',
            poweredByEnabled: true,
          },
        }),
      ),
    );
  });

  it('pre-fills form fields from existing config', async () => {
    renderWithProviders(<BrandingSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('branding-company-name')).toHaveValue('Acme Corp');
    });
    expect(screen.getByTestId('branding-logo-url')).toHaveValue('https://example.com/logo.png');
    expect(screen.getByTestId('branding-logo-alt-text')).toHaveValue('Acme Logo');
    expect(screen.getByTestId('branding-font-select')).toHaveValue('roboto');
  });

  it('shows logo preview when logoUrl is set', async () => {
    renderWithProviders(<BrandingSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('branding-logo-preview')).toBeInTheDocument();
    });
  });

  it('shows contrast indicator for primary colour', async () => {
    renderWithProviders(<BrandingSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('contrast-indicator')).toBeInTheDocument();
    });
  });
});

describe('BrandingSettings — save', () => {
  it('calls PUT and shows success message on save', async () => {
    let savedBody: unknown = null;
    server.use(
      http.put('/api/v1/settings/branding', async ({ request }) => {
        savedBody = await request.json();
        return HttpResponse.json({
          branding: {
            logoUrl: null,
            logoAltText: null,
            faviconUrl: null,
            primaryColor: '#4f46e5',
            primaryColorText: '#ffffff',
            fontFamily: 'inter',
            companyName: 'Test Co',
            poweredByEnabled: true,
          },
        });
      }),
    );

    renderWithProviders(<BrandingSettings />);
    await waitFor(() => expect(screen.getByTestId('branding-form')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('branding-company-name'), {
      target: { value: 'Test Co' },
    });
    fireEvent.submit(screen.getByTestId('branding-form'));

    await waitFor(() => {
      expect(screen.getByTestId('branding-success')).toBeInTheDocument();
    });
    expect(savedBody).toBeTruthy();
  });

  it('shows error message when save fails', async () => {
    server.use(
      http.put('/api/v1/settings/branding', () => new HttpResponse(null, { status: 500 })),
    );

    renderWithProviders(<BrandingSettings />);
    await waitFor(() => expect(screen.getByTestId('branding-form')).toBeInTheDocument());

    fireEvent.submit(screen.getByTestId('branding-form'));

    await waitFor(() => {
      expect(screen.getByTestId('branding-error')).toBeInTheDocument();
    });
  });
});

describe('BrandingSettings — reset', () => {
  it('shows confirm dialog when Reset is clicked', async () => {
    renderWithProviders(<BrandingSettings />);
    await waitFor(() => expect(screen.getByTestId('branding-reset-button')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('branding-reset-button'));

    expect(screen.getByTestId('branding-reset-confirm')).toBeInTheDocument();
  });

  it('calls DELETE and shows success after confirming reset', async () => {
    renderWithProviders(<BrandingSettings />);
    await waitFor(() => expect(screen.getByTestId('branding-reset-button')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('branding-reset-button'));
    fireEvent.click(screen.getByTestId('branding-reset-confirm-button'));

    await waitFor(() => {
      expect(screen.getByTestId('branding-reset-success')).toBeInTheDocument();
    });
  });

  it('dismisses confirm dialog when Cancel is clicked', async () => {
    renderWithProviders(<BrandingSettings />);
    await waitFor(() => expect(screen.getByTestId('branding-reset-button')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('branding-reset-button'));
    expect(screen.getByTestId('branding-reset-confirm')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('branding-reset-cancel-button'));
    expect(screen.queryByTestId('branding-reset-confirm')).not.toBeInTheDocument();
  });

  it('shows error when reset fails', async () => {
    server.use(
      http.delete('/api/v1/settings/branding', () => new HttpResponse(null, { status: 500 })),
    );

    renderWithProviders(<BrandingSettings />);
    await waitFor(() => expect(screen.getByTestId('branding-reset-button')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('branding-reset-button'));
    fireEvent.click(screen.getByTestId('branding-reset-confirm-button'));

    await waitFor(() => {
      expect(screen.getByTestId('branding-reset-error')).toBeInTheDocument();
    });
  });
});
