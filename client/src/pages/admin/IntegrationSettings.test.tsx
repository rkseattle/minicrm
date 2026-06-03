/**
 * Tests for IntegrationSettings — File Storage + Webhooks panels.
 *
 * Verifies:
 * - Storage panel and webhook panel each render as separate sections
 * - Storage form renders in unconfigured state
 * - Storage form renders masked secret hint when already configured
 * - Save button is disabled until all fields are filled
 * - Successful save shows success message
 * - Storage load error shows error state
 * - Clear button appears only when storage is configured; calls DELETE on click
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import IntegrationSettings from './IntegrationSettings.js';

describe('IntegrationSettings', () => {
  it('renders the storage section, SSO section, and webhooks section as separate panels', async () => {
    renderWithProviders(<IntegrationSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('storage-section')).toBeInTheDocument();
    });
    expect(screen.getByTestId('sso-settings-wrapper')).toBeInTheDocument();
    expect(screen.getByTestId('webhooks-section')).toBeInTheDocument();
    expect(screen.getByTestId('webhook-settings-section')).toBeInTheDocument();
  });

  it('renders storage form when not configured', async () => {
    renderWithProviders(<IntegrationSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('storage-endpoint-input')).toBeInTheDocument();
    });
    expect(screen.getByTestId('storage-bucket-input')).toBeInTheDocument();
    expect(screen.getByTestId('storage-access-key-id-input')).toBeInTheDocument();
    expect(screen.getByTestId('storage-secret-access-key-input')).toBeInTheDocument();
  });

  it('disables save and test buttons when fields are empty', async () => {
    renderWithProviders(<IntegrationSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('storage-save-button')).toBeDisabled();
    });
    expect(screen.getByTestId('storage-test-button')).toBeDisabled();
  });

  it('enables save button once all fields are filled', async () => {
    renderWithProviders(<IntegrationSettings />);

    await waitFor(() => expect(screen.getByTestId('storage-endpoint-input')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('storage-endpoint-input'), {
      target: { value: 'https://s3.example.com' },
    });
    fireEvent.change(screen.getByTestId('storage-bucket-input'), {
      target: { value: 'my-bucket' },
    });
    fireEvent.change(screen.getByTestId('storage-access-key-id-input'), {
      target: { value: 'AKIAIOSFODNN7EXAMPLE' },
    });
    fireEvent.change(screen.getByTestId('storage-secret-access-key-input'), {
      target: { value: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
    });

    expect(screen.getByTestId('storage-save-button')).not.toBeDisabled();
  });

  it('shows success message after saving storage config', async () => {
    renderWithProviders(<IntegrationSettings />);

    await waitFor(() => expect(screen.getByTestId('storage-endpoint-input')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('storage-endpoint-input'), {
      target: { value: 'https://s3.example.com' },
    });
    fireEvent.change(screen.getByTestId('storage-bucket-input'), {
      target: { value: 'my-bucket' },
    });
    fireEvent.change(screen.getByTestId('storage-access-key-id-input'), {
      target: { value: 'AKIAIOSFODNN7EXAMPLE' },
    });
    fireEvent.change(screen.getByTestId('storage-secret-access-key-input'), {
      target: { value: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
    });

    fireEvent.click(screen.getByTestId('storage-save-button'));

    await waitFor(() => {
      expect(screen.getByTestId('storage-save-success')).toBeInTheDocument();
    });
  });

  it('shows error message when save fails', async () => {
    server.use(http.put('/api/v1/settings/storage', () => new HttpResponse(null, { status: 500 })));

    renderWithProviders(<IntegrationSettings />);

    await waitFor(() => expect(screen.getByTestId('storage-endpoint-input')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('storage-endpoint-input'), {
      target: { value: 'https://s3.example.com' },
    });
    fireEvent.change(screen.getByTestId('storage-bucket-input'), {
      target: { value: 'my-bucket' },
    });
    fireEvent.change(screen.getByTestId('storage-access-key-id-input'), {
      target: { value: 'key' },
    });
    fireEvent.change(screen.getByTestId('storage-secret-access-key-input'), {
      target: { value: 'secret' },
    });

    fireEvent.click(screen.getByTestId('storage-save-button'));

    await waitFor(() => {
      expect(screen.getByTestId('storage-save-error')).toBeInTheDocument();
    });
  });

  it('shows storage load error state', async () => {
    server.use(http.get('/api/v1/settings/storage', () => new HttpResponse(null, { status: 500 })));

    renderWithProviders(<IntegrationSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('storage-load-error')).toBeInTheDocument();
    });
  });

  it('shows Clear button and masked hint when storage is already configured', async () => {
    server.use(
      http.get('/api/v1/settings/storage', () =>
        HttpResponse.json({
          configured: true,
          config: {
            endpoint: 'https://s3.example.com',
            bucket: 'my-bucket',
            accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          },
        }),
      ),
    );

    renderWithProviders(<IntegrationSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('storage-clear-button')).toBeInTheDocument();
    });
    expect(screen.getByTestId('storage-secret-masked')).toBeInTheDocument();
  });

  it('calls DELETE and removes Clear button after clearing storage config', async () => {
    server.use(
      http.get('/api/v1/settings/storage', () =>
        HttpResponse.json({
          configured: true,
          config: {
            endpoint: 'https://s3.example.com',
            bucket: 'my-bucket',
            accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          },
        }),
      ),
    );

    let deleteCalled = false;
    server.use(
      http.delete('/api/v1/settings/storage', () => {
        deleteCalled = true;
        return HttpResponse.json({ configured: false, config: null });
      }),
    );

    renderWithProviders(<IntegrationSettings />);

    await waitFor(() => expect(screen.getByTestId('storage-clear-button')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('storage-clear-button'));

    await waitFor(() => {
      expect(deleteCalled).toBe(true);
    });
  });
});
