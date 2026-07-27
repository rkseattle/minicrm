import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import RecentBuildSelect from './RecentBuildSelect.js';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';
import { MOCK_COVERAGE_SUMMARY } from '@/test/msw/handlers.js';

describe('RecentBuildSelect', () => {
  it('renders nothing while the trend has not resolved yet', () => {
    server.use(
      http.get(
        '*/api/v1/admin/coverage/reporting/trend',
        () => new Promise(() => {}), // never resolves
      ),
    );
    renderWithProviders(
      <RecentBuildSelect id="x" label="Recent builds" testId="recent-select" onSelect={vi.fn()} />,
    );
    expect(screen.queryByTestId('recent-select')).not.toBeInTheDocument();
  });

  it('renders nothing when the trend has no builds', async () => {
    let resolveTrend: (() => void) | undefined;
    const trendResolved = new Promise<void>((resolve) => {
      resolveTrend = resolve;
    });
    server.use(
      http.get('*/api/v1/admin/coverage/reporting/trend', () => {
        resolveTrend?.();
        return HttpResponse.json({ results: [] });
      }),
    );
    renderWithProviders(
      <RecentBuildSelect id="x" label="Recent builds" testId="recent-select" onSelect={vi.fn()} />,
    );
    // Waits for the actual network handler to have run (not a fixed delay)
    // before asserting the "no builds" steady state, so this can't pass
    // vacuously before the query even settles.
    await trendResolved;
    await waitFor(() => expect(screen.queryByTestId('recent-select')).not.toBeInTheDocument());
  });

  it('calls onSelect with the chosen build’s commit SHA', async () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <RecentBuildSelect id="x" label="Recent builds" testId="recent-select" onSelect={onSelect} />,
    );
    await waitFor(() => expect(screen.getByTestId('recent-select')).toBeInTheDocument());

    await userEvent.selectOptions(
      screen.getByTestId('recent-select'),
      MOCK_COVERAGE_SUMMARY.commitSha,
    );

    expect(onSelect).toHaveBeenCalledWith(MOCK_COVERAGE_SUMMARY.commitSha);
  });

  it('resets back to the placeholder option after a selection — it is not meant to display the current field value', async () => {
    renderWithProviders(
      <RecentBuildSelect id="x" label="Recent builds" testId="recent-select" onSelect={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByTestId('recent-select')).toBeInTheDocument());

    await userEvent.selectOptions(
      screen.getByTestId('recent-select'),
      MOCK_COVERAGE_SUMMARY.commitSha,
    );

    expect(screen.getByTestId('recent-select')).toHaveValue('');
  });
});
