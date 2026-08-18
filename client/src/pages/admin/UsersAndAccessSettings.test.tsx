/**
 * Tests for UsersAndAccessSettings — teams, roles, and visibility policy
 * composite tab.
 *
 * Smoke tests verify key sections from each absorbed component are present.
 * Full interaction coverage lives in TeamsSettings.test.tsx,
 * RolesSettings.test.tsx, and VisibilitySettings.test.tsx.
 */

import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import UsersAndAccessSettings from './UsersAndAccessSettings.js';

describe('UsersAndAccessSettings', () => {
  it('renders the teams section from TeamsSettings', async () => {
    renderWithProviders(<UsersAndAccessSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('teams-settings-panel')).toBeInTheDocument();
    });
  });

  it('renders the roles section from RolesSettings', async () => {
    renderWithProviders(<UsersAndAccessSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('roles-settings-panel')).toBeInTheDocument();
    });
  });

  it('renders the visibility section from VisibilitySettings', async () => {
    renderWithProviders(<UsersAndAccessSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('visibility-settings-panel')).toBeInTheDocument();
    });
  });
});
