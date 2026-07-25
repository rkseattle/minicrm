import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import OverviewPage from './OverviewPage.js';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';
import { MOCK_COVERAGE_SUMMARY } from '@/test/msw/handlers.js';

describe('OverviewPage', () => {
  it('shows the empty state before a commit SHA is submitted', () => {
    renderWithProviders(<OverviewPage />);
    expect(screen.getByTestId('summary-empty')).toBeInTheDocument();
  });

  it('shows a loading state while the summary request is in flight', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/reporting/summary', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({ summary: MOCK_COVERAGE_SUMMARY });
      }),
    );
    renderWithProviders(<OverviewPage />);

    await userEvent.type(screen.getByTestId('commit-sha-input'), 'abc123');
    await userEvent.click(screen.getByTestId('commit-sha-submit-button'));

    expect(screen.getByTestId('summary-loading')).toBeInTheDocument();
  });

  it('renders stat tiles on a successful summary lookup', async () => {
    renderWithProviders(<OverviewPage />);

    await userEvent.type(screen.getByTestId('commit-sha-input'), 'abc123');
    await userEvent.click(screen.getByTestId('commit-sha-submit-button'));

    await waitFor(() => expect(screen.getByTestId('summary-stat-tiles')).toBeInTheDocument());
    expect(screen.getByTestId('stat-tile-overall')).toHaveTextContent('80.0%');
    expect(screen.getByTestId('stat-tile-api')).toHaveTextContent('83.3%');
    expect(screen.getByTestId('stat-tile-frontend')).toHaveTextContent('75.0%');
  });

  it('shows a not-found message on a 404 (commit never ingested)', async () => {
    server.use(
      http.get(
        '*/api/v1/admin/coverage/reporting/summary',
        () =>
          new HttpResponse(JSON.stringify({ error: { code: 'COVERAGE_BUILD_NOT_FOUND' } }), {
            status: 404,
          }),
      ),
    );
    renderWithProviders(<OverviewPage />);

    await userEvent.type(screen.getByTestId('commit-sha-input'), 'never-ingested');
    await userEvent.click(screen.getByTestId('commit-sha-submit-button'));

    await waitFor(() =>
      expect(screen.getByTestId('summary-error')).toHaveTextContent(
        /no coverage has been ingested/i,
      ),
    );
  });

  it('shows a generic error message on a 500', async () => {
    server.use(
      http.get(
        '*/api/v1/admin/coverage/reporting/summary',
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    renderWithProviders(<OverviewPage />);

    await userEvent.type(screen.getByTestId('commit-sha-input'), 'abc123');
    await userEvent.click(screen.getByTestId('commit-sha-submit-button'));

    await waitFor(() =>
      expect(screen.getByTestId('summary-error')).toHaveTextContent(/could not load/i),
    );
  });

  it('switches the test-type stat tile when the filter changes', async () => {
    renderWithProviders(<OverviewPage />);

    await userEvent.type(screen.getByTestId('commit-sha-input'), 'abc123');
    await userEvent.click(screen.getByTestId('commit-sha-submit-button'));
    await waitFor(() => expect(screen.getByTestId('summary-stat-tiles')).toBeInTheDocument());

    expect(screen.getByTestId('stat-tile-test-type')).toHaveTextContent('80');

    await userEvent.selectOptions(screen.getByTestId('test-type-filter-select'), 'automated');
    expect(screen.getByTestId('stat-tile-test-type')).toHaveTextContent('70');

    await userEvent.selectOptions(screen.getByTestId('test-type-filter-select'), 'manual');
    expect(screen.getByTestId('stat-tile-test-type')).toHaveTextContent('10');
  });
});
