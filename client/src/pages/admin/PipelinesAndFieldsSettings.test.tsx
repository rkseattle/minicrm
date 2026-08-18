/**
 * Tests for PipelinesAndFieldsSettings — pipelines, custom fields, and tag
 * management composite tab.
 *
 * Smoke tests verify key sections from each absorbed component are present.
 * Full interaction coverage lives in CustomisationSettings.test.tsx.
 * Tag management section is verified: restrict toggle, list, empty state.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import PipelinesAndFieldsSettings from './PipelinesAndFieldsSettings.js';

vi.mock('@/hooks/useFeatureFlag.js', () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
  useFeatureFlags: () => ({ flags: {}, isLoading: false }),
}));

describe('PipelinesAndFieldsSettings', () => {
  it('renders the pipeline stages table from CustomisationSettings', async () => {
    renderWithProviders(<PipelinesAndFieldsSettings />);
    await waitFor(() => {
      expect(screen.getByText('Prospecting')).toBeInTheDocument();
    });
  });

  it('renders the tags section', async () => {
    renderWithProviders(<PipelinesAndFieldsSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('tags-section')).toBeInTheDocument();
    });
  });

  it('renders the tags restrict-creation toggle', async () => {
    renderWithProviders(<PipelinesAndFieldsSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('tags-restrict-toggle-section')).toBeInTheDocument();
    });
  });

  it('renders the tag list when tags exist', async () => {
    server.use(
      http.get('/api/v1/tags', () =>
        HttpResponse.json({
          data: [{ id: 'tag-1', name: 'enterprise', created_at: new Date().toISOString() }],
          page: 1,
          limit: 25,
          total: 1,
        }),
      ),
    );
    renderWithProviders(<PipelinesAndFieldsSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('admin-tags-list')).toBeInTheDocument();
    });
    expect(screen.getByTestId('tag-name-tag-1')).toHaveTextContent('enterprise');
  });

  it('renders the tags empty state when no tags exist', async () => {
    renderWithProviders(<PipelinesAndFieldsSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('admin-tags-empty-state')).toBeInTheDocument();
    });
  });

  it('shows tags restrict-creation success message after toggle', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PipelinesAndFieldsSettings />);
    await waitFor(() => {
      expect(screen.getByTestId('tags-restrict-toggle')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('tags-restrict-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('tags-restrict-save-success')).toBeInTheDocument();
    });
  });
});
