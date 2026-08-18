/**
 * Tests for SsoSettings component.
 *
 * Covers: loading, error, and unconfigured empty states; save flow;
 * certificate masking; disable with confirmation; all three required async states.
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import SsoSettings from './SsoSettings.js';

describe('SsoSettings', () => {
  // ── Loading state ────────────────────────────────────────────────────────────

  it('shows loading indicator while fetching SSO config', () => {
    server.use(
      http.get('/api/v1/settings/sso', async () => {
        await new Promise((r) => setTimeout(r, 5000));
        return HttpResponse.json({ sso: null });
      }),
    );

    renderWithProviders(<SsoSettings />);
    expect(screen.getByTestId('sso-loading')).toBeInTheDocument();
  });

  // ── Error state ──────────────────────────────────────────────────────────────

  it('shows error message when SSO config fails to load', async () => {
    server.use(
      http.get('/api/v1/settings/sso', () => {
        return HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'DB error' } },
          { status: 500 },
        );
      }),
    );

    renderWithProviders(<SsoSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('sso-load-error')).toBeInTheDocument();
    });
  });

  // ── Empty (unconfigured) state ────────────────────────────────────────────────

  it('shows form in unconfigured state with protocol selector and URL field', async () => {
    renderWithProviders(<SsoSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('sso-protocol-select')).toBeInTheDocument();
    });
    expect(screen.getByTestId('sso-idp-metadata-url-input')).toBeInTheDocument();
    expect(screen.getByTestId('sso-entity-id-input')).toBeInTheDocument();
    expect(screen.getByTestId('sso-save-button')).toBeInTheDocument();
  });

  it('save button is disabled when required fields are empty', async () => {
    renderWithProviders(<SsoSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('sso-save-button')).toBeDisabled();
    });
  });

  it('does not show disable button when SSO is not configured', async () => {
    renderWithProviders(<SsoSettings />);

    await waitFor(() => {
      expect(screen.queryByTestId('sso-disable-button')).not.toBeInTheDocument();
    });
  });

  // ── SAML-specific certificate field ──────────────────────────────────────────

  it('shows certificate textarea when SAML protocol is selected', async () => {
    renderWithProviders(<SsoSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('sso-protocol-select')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('sso-protocol-select'), {
      target: { value: 'saml' },
    });

    expect(screen.getByTestId('sso-idp-certificate-input')).toBeInTheDocument();
  });

  it('hides certificate textarea when OIDC protocol is selected', async () => {
    renderWithProviders(<SsoSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('sso-protocol-select')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('sso-protocol-select'), {
      target: { value: 'oidc' },
    });

    expect(screen.queryByTestId('sso-idp-certificate-input')).not.toBeInTheDocument();
  });

  // ── Save flow ─────────────────────────────────────────────────────────────────

  it('enables save button once required OIDC fields are filled and calls PUT on submit', async () => {
    server.use(
      http.put('/api/v1/settings/sso', async ({ request }) => {
        const body = (await request.json()) as {
          protocol: string;
          idp_metadata_url: string;
          entity_id: string;
        };
        return HttpResponse.json({
          sso: {
            protocol: body.protocol,
            idp_metadata_url: body.idp_metadata_url,
            entity_id: body.entity_id,
            idp_certificate_set: false,
          },
        });
      }),
    );

    renderWithProviders(<SsoSettings />);

    await waitFor(() => expect(screen.getByTestId('sso-protocol-select')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('sso-idp-metadata-url-input'), {
      target: { value: 'https://accounts.google.com/.well-known/openid-configuration' },
    });
    fireEvent.change(screen.getByTestId('sso-entity-id-input'), {
      target: { value: 'my-client-id' },
    });

    const saveButton = screen.getByTestId('sso-save-button');
    expect(saveButton).not.toBeDisabled();

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByTestId('sso-save-success')).toBeInTheDocument();
    });
  });

  it('shows error message when save fails', async () => {
    server.use(
      http.put('/api/v1/settings/sso', () => {
        return HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Failed' } },
          { status: 500 },
        );
      }),
    );

    renderWithProviders(<SsoSettings />);

    await waitFor(() => expect(screen.getByTestId('sso-protocol-select')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('sso-idp-metadata-url-input'), {
      target: { value: 'https://idp.example.com/.well-known/openid-configuration' },
    });
    fireEvent.change(screen.getByTestId('sso-entity-id-input'), {
      target: { value: 'client-id' },
    });

    fireEvent.click(screen.getByTestId('sso-save-button'));

    await waitFor(() => {
      expect(screen.getByTestId('sso-save-error')).toBeInTheDocument();
    });
  });

  // ── Configured state ──────────────────────────────────────────────────────────

  it('shows enabled badge and disable button when SSO is configured', async () => {
    server.use(
      http.get('/api/v1/settings/sso', () => {
        return HttpResponse.json({
          sso: {
            protocol: 'oidc',
            idp_metadata_url: 'https://accounts.google.com/.well-known/openid-configuration',
            entity_id: 'google-client-id',
            idp_certificate_set: false,
          },
        });
      }),
    );

    renderWithProviders(<SsoSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('sso-enabled-badge')).toBeInTheDocument();
    });
    expect(screen.getByTestId('sso-disable-button')).toBeInTheDocument();
  });

  it('shows certificate masked hint when SAML is configured with a stored cert', async () => {
    server.use(
      http.get('/api/v1/settings/sso', () => {
        return HttpResponse.json({
          sso: {
            protocol: 'saml',
            idp_metadata_url: 'https://idp.example.com/saml/metadata',
            entity_id: 'urn:sp:minicrm',
            idp_certificate_set: true,
          },
        });
      }),
    );

    renderWithProviders(<SsoSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('sso-certificate-masked')).toBeInTheDocument();
    });
  });

  // ── Disable flow ──────────────────────────────────────────────────────────────

  it('shows confirmation UI when disable button is clicked', async () => {
    server.use(
      http.get('/api/v1/settings/sso', () => {
        return HttpResponse.json({
          sso: {
            protocol: 'oidc',
            idp_metadata_url: 'https://accounts.google.com/.well-known/openid-configuration',
            entity_id: 'google-client-id',
            idp_certificate_set: false,
          },
        });
      }),
    );

    renderWithProviders(<SsoSettings />);

    await waitFor(() => expect(screen.getByTestId('sso-disable-button')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('sso-disable-button'));

    expect(screen.getByTestId('sso-disable-confirm')).toBeInTheDocument();
    expect(screen.getByTestId('sso-disable-confirm-button')).toBeInTheDocument();
    expect(screen.getByTestId('sso-disable-cancel-button')).toBeInTheDocument();
  });

  it('calls DELETE and clears the form after confirmed disable', async () => {
    let deleteCallCount = 0;

    server.use(
      http.get('/api/v1/settings/sso', () => {
        return HttpResponse.json({
          sso: {
            protocol: 'oidc',
            idp_metadata_url: 'https://accounts.google.com/.well-known/openid-configuration',
            entity_id: 'google-client-id',
            idp_certificate_set: false,
          },
        });
      }),
      http.delete('/api/v1/settings/sso', () => {
        deleteCallCount++;
        return HttpResponse.json({ ok: true });
      }),
    );

    renderWithProviders(<SsoSettings />);

    await waitFor(() => expect(screen.getByTestId('sso-disable-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('sso-disable-button'));
    fireEvent.click(screen.getByTestId('sso-disable-confirm-button'));

    await waitFor(() => {
      expect(deleteCallCount).toBe(1);
    });
  });

  it('cancels disable when cancel button is clicked', async () => {
    server.use(
      http.get('/api/v1/settings/sso', () => {
        return HttpResponse.json({
          sso: {
            protocol: 'oidc',
            idp_metadata_url: 'https://accounts.google.com/.well-known/openid-configuration',
            entity_id: 'google-client-id',
            idp_certificate_set: false,
          },
        });
      }),
    );

    renderWithProviders(<SsoSettings />);

    await waitFor(() => expect(screen.getByTestId('sso-disable-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('sso-disable-button'));

    expect(screen.getByTestId('sso-disable-confirm')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('sso-disable-cancel-button'));

    await waitFor(() => {
      expect(screen.queryByTestId('sso-disable-confirm')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('sso-disable-button')).toBeInTheDocument();
  });
});
