/**
 * Tests for SecuritySettings — MFA enforcement, SSO, and SCIM provisioning
 * composite tab.
 *
 * Smoke tests verify key sections from each absorbed component are present.
 * Full interaction coverage lives in MfaSettings.test.tsx,
 * SsoSettings.test.tsx, and ScimSettings.test.tsx.
 */

import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import SecuritySettings from './SecuritySettings.js';

describe('SecuritySettings', () => {
  it('renders the MFA required section from MfaSettings', async () => {
    renderWithProviders(<SecuritySettings />);
    await waitFor(() => {
      expect(screen.getByTestId('mfa-required-section')).toBeInTheDocument();
    });
  });

  it('renders the SSO section from SsoSettings', async () => {
    renderWithProviders(<SecuritySettings />);
    await waitFor(() => {
      expect(screen.getByTestId('sso-section')).toBeInTheDocument();
    });
  });

  it('renders the SCIM section from ScimSettings', async () => {
    renderWithProviders(<SecuritySettings />);
    await waitFor(() => {
      expect(screen.getByTestId('scim-section')).toBeInTheDocument();
    });
  });
});
