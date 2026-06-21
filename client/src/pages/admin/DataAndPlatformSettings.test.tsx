/**
 * Tests for DataAndPlatformSettings — demo data management and setup
 * checklist reset composite tab (MINCRM-563).
 *
 * Smoke tests verify key sections from each absorbed component are present.
 * Full interaction coverage lives in DataSettings.test.tsx and
 * SetupChecklistSettings.test.tsx.
 */

import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import DataAndPlatformSettings from './DataAndPlatformSettings.js';

describe('DataAndPlatformSettings', () => {
  it('renders the import section from DataSettings', async () => {
    renderWithProviders(<DataAndPlatformSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('import-section')).toBeInTheDocument();
    });
  });

  it('renders the setup checklist reset section from SetupChecklistSettings', async () => {
    renderWithProviders(<DataAndPlatformSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('reset-onboarding-section')).toBeInTheDocument();
    });
  });
});
