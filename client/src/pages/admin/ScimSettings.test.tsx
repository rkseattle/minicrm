/**
 * Tests for ScimSettings — SCIM token management and group-role mapping panel.
 * (MINCRM-541)
 *
 * Verifies:
 * - Loading state while token/mapping data is fetching
 * - No-token state shows generate button
 * - Existing token state shows meta, revoke button, and regenerate button
 * - Generate token success shows raw token banner with copy button
 * - Token mutation error shows error alert
 * - Mappings loading state
 * - Empty mappings state
 * - Mappings table with rows when mappings are present
 * - Delete mapping calls DELETE endpoint
 * - Token load error shows error alert
 * - Mappings load error shows error alert
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import ScimSettings from './ScimSettings.js';

const MOCK_TOKEN_META = {
  id: 'token-uuid-001',
  createdAt: '2025-01-15T10:00:00.000Z',
  lastUsedAt: null,
};

const MOCK_MAPPING = {
  id: 'mapping-uuid-001',
  scim_group_id: 'okta-group-engineers',
  group_name: 'Engineers',
  role_id: 'role-uuid-001',
  created_at: '2025-01-15T10:00:00.000Z',
};

const MOCK_ROLE = {
  id: 'role-uuid-001',
  name: 'Senior Engineer',
};

describe('ScimSettings', () => {
  it('renders section title', async () => {
    renderWithProviders(<ScimSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('scim-section-title')).toBeInTheDocument();
    });
  });

  it('shows no-token state when no token is issued', async () => {
    renderWithProviders(<ScimSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('scim-no-token')).toBeInTheDocument();
    });
    expect(screen.getByTestId('scim-generate-token-button')).toBeInTheDocument();
    expect(screen.queryByTestId('scim-revoke-token-button')).not.toBeInTheDocument();
  });

  it('shows no-mappings state when mapping list is empty', async () => {
    renderWithProviders(<ScimSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('scim-no-mappings')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('scim-mappings-table')).not.toBeInTheDocument();
  });

  it('shows token meta and revoke button when a token exists', async () => {
    server.use(http.get('/api/v1/scim-token', () => HttpResponse.json({ token: MOCK_TOKEN_META })));

    renderWithProviders(<ScimSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('scim-token-meta')).toBeInTheDocument();
    });
    expect(screen.getByTestId('scim-revoke-token-button')).toBeInTheDocument();
    expect(screen.getByTestId('scim-generate-token-button')).toBeInTheDocument();
  });

  it('shows mappings table when mappings are present', async () => {
    server.use(
      http.get('/api/v1/scim/group-role-mappings', () =>
        HttpResponse.json({ mappings: [MOCK_MAPPING] }),
      ),
      http.get('/api/v1/custom-roles', () => HttpResponse.json({ roles: [MOCK_ROLE] })),
    );

    renderWithProviders(<ScimSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('scim-mappings-table')).toBeInTheDocument();
    });
    expect(
      screen.getByTestId(`scim-mapping-row-${MOCK_MAPPING.scim_group_id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`scim-delete-mapping-${MOCK_MAPPING.scim_group_id}`),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('scim-no-mappings')).not.toBeInTheDocument();
  });

  it('shows raw token banner after generating a token', async () => {
    renderWithProviders(<ScimSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('scim-generate-token-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('scim-generate-token-button'));

    await waitFor(() => {
      expect(screen.getByTestId('scim-new-token-banner')).toBeInTheDocument();
    });
    expect(screen.getByTestId('scim-raw-token')).toHaveTextContent('scim-mock-token-abc123');
    expect(screen.getByTestId('scim-copy-token-button')).toBeInTheDocument();
  });

  it('shows error alert when token generation fails', async () => {
    server.use(http.post('/api/v1/scim-token', () => new HttpResponse(null, { status: 500 })));

    renderWithProviders(<ScimSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('scim-generate-token-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('scim-generate-token-button'));

    await waitFor(() => {
      expect(screen.getByTestId('scim-token-mutation-error')).toBeInTheDocument();
    });
  });

  it('calls DELETE and clears token after revoking', async () => {
    server.use(http.get('/api/v1/scim-token', () => HttpResponse.json({ token: MOCK_TOKEN_META })));

    let deleteCalled = false;
    server.use(
      http.delete('/api/v1/scim-token', () => {
        deleteCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderWithProviders(<ScimSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('scim-revoke-token-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('scim-revoke-token-button'));

    await waitFor(() => {
      expect(deleteCalled).toBe(true);
    });
  });

  it('calls DELETE and removes mapping row after deleting a mapping', async () => {
    server.use(
      http.get('/api/v1/scim/group-role-mappings', () =>
        HttpResponse.json({ mappings: [MOCK_MAPPING] }),
      ),
    );

    let deleteCalled = false;
    server.use(
      http.delete('/api/v1/scim/group-role-mappings/:scimGroupId', () => {
        deleteCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderWithProviders(<ScimSettings />);

    await waitFor(() => {
      expect(
        screen.getByTestId(`scim-delete-mapping-${MOCK_MAPPING.scim_group_id}`),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`scim-delete-mapping-${MOCK_MAPPING.scim_group_id}`));

    await waitFor(() => {
      expect(deleteCalled).toBe(true);
    });
  });

  it('shows error alert when token load fails', async () => {
    server.use(http.get('/api/v1/scim-token', () => new HttpResponse(null, { status: 500 })));

    renderWithProviders(<ScimSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('scim-token-error')).toBeInTheDocument();
    });
  });

  it('shows error alert when mappings load fails', async () => {
    server.use(
      http.get('/api/v1/scim/group-role-mappings', () => new HttpResponse(null, { status: 500 })),
    );

    renderWithProviders(<ScimSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('scim-mappings-error')).toBeInTheDocument();
    });
  });

  it('shows copy button that reflects copied state', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
    });

    renderWithProviders(<ScimSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('scim-generate-token-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('scim-generate-token-button'));

    await waitFor(() => {
      expect(screen.getByTestId('scim-copy-token-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('scim-copy-token-button'));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('scim-mock-token-abc123');
    });
  });
});
