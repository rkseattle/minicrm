/**
 * Tests for WorkspaceSettings — language, nav layout, currency, and exchange
 * rates composite tab.
 *
 * Smoke tests verify key sections from each absorbed component are present.
 * Full interaction coverage lives in GeneralSettings.test.tsx and
 * CurrencySettings.test.tsx.
 */

import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import WorkspaceSettings from './WorkspaceSettings.js';

describe('WorkspaceSettings', () => {
  it('renders the default language select from GeneralSettings', async () => {
    renderWithProviders(<WorkspaceSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('default-language-select')).toBeInTheDocument();
    });
  });

  it('renders the currency section from CurrencySettings', async () => {
    renderWithProviders(<WorkspaceSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('currency-section')).toBeInTheDocument();
    });
  });

  it('renders the exchange rates section for admin users', async () => {
    renderWithProviders(<WorkspaceSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('exchange-rates-section')).toBeInTheDocument();
    });
  });
});
