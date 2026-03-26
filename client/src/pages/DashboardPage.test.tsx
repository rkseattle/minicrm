/**
 * Tests for the DashboardPage component.
 */

import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import DashboardPage from './DashboardPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { ADMIN_USER } from '../test/msw/handlers.js';

describe('DashboardPage', () => {
  it('renders the welcome heading with the user name', async () => {
    renderWithProviders(<DashboardPage />);
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: `Welcome, ${ADMIN_USER.name}` }),
      ).toBeInTheDocument();
    });
  });

  it('renders the pipeline empty state message', async () => {
    renderWithProviders(<DashboardPage />);
    await waitFor(() => {
      expect(
        screen.getByText('Your pipeline will appear here once contacts and deals are created.'),
      ).toBeInTheDocument();
    });
  });

  it('renders the NavBar', async () => {
    renderWithProviders(<DashboardPage />);
    await waitFor(() => {
      expect(screen.getByText('MiniCRM')).toBeInTheDocument();
    });
  });
});
