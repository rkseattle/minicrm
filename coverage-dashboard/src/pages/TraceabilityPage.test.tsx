import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import TraceabilityPage from './TraceabilityPage.js';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';
import { MOCK_MAPPING_RESULT } from '@/test/msw/handlers.js';

describe('TraceabilityPage — issue coverage', () => {
  it('shows the empty state before submitting', () => {
    renderWithProviders(<TraceabilityPage />);
    expect(screen.getByTestId('issue-coverage-empty')).toBeInTheDocument();
  });

  it('shows a loading state while the request is in flight', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/reporting/issues/:issueKey/coverage', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({
          coverage: { issueKey: 'MINCRM-1', sessionCount: 1, coveredUnitCount: 2, testIds: ['t1'] },
        });
      }),
    );
    renderWithProviders(<TraceabilityPage />);
    await userEvent.type(screen.getByTestId('issue-key-input'), 'MINCRM-1');
    await userEvent.type(screen.getByTestId('issue-commit-sha-input'), 'abc123');
    await userEvent.click(screen.getByTestId('issue-coverage-submit-button'));
    expect(screen.getByTestId('issue-coverage-loading')).toBeInTheDocument();
  });

  it('shows an error message on a failed request', async () => {
    server.use(
      http.get(
        '*/api/v1/admin/coverage/reporting/issues/:issueKey/coverage',
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    renderWithProviders(<TraceabilityPage />);
    await userEvent.type(screen.getByTestId('issue-key-input'), 'MINCRM-1');
    await userEvent.type(screen.getByTestId('issue-commit-sha-input'), 'abc123');
    await userEvent.click(screen.getByTestId('issue-coverage-submit-button'));
    await waitFor(() => expect(screen.getByTestId('issue-coverage-error')).toBeInTheDocument());
  });

  it('renders stat tiles on a successful lookup', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/reporting/issues/:issueKey/coverage', () =>
        HttpResponse.json({
          coverage: {
            issueKey: 'MINCRM-1',
            sessionCount: 2,
            coveredUnitCount: 5,
            testIds: ['t1', 't2'],
          },
        }),
      ),
    );
    renderWithProviders(<TraceabilityPage />);
    await userEvent.type(screen.getByTestId('issue-key-input'), 'MINCRM-1');
    await userEvent.type(screen.getByTestId('issue-commit-sha-input'), 'abc123');
    await userEvent.click(screen.getByTestId('issue-coverage-submit-button'));

    await waitFor(() =>
      expect(screen.getByTestId('issue-coverage-stat-tiles')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('stat-tile-issue-sessions')).toHaveTextContent('2');
    expect(screen.getByTestId('stat-tile-issue-covered-units')).toHaveTextContent('5');
  });
});

describe('TraceabilityPage — TIA value metrics', () => {
  it('shows the empty state before submitting', () => {
    renderWithProviders(<TraceabilityPage />);
    expect(screen.getByTestId('tia-metrics-empty')).toBeInTheDocument();
  });

  it('shows an error message on a failed request', async () => {
    server.use(
      http.get(
        '*/api/v1/admin/coverage/reporting/tia-metrics',
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    renderWithProviders(<TraceabilityPage />);
    await userEvent.type(screen.getByTestId('tia-from-sha-input'), 'sha-a');
    await userEvent.type(screen.getByTestId('tia-to-sha-input'), 'sha-b');
    await userEvent.click(screen.getByTestId('tia-metrics-submit-button'));
    await waitFor(() => expect(screen.getByTestId('tia-metrics-error')).toBeInTheDocument());
  });

  it('renders stat tiles on a successful lookup', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/reporting/tia-metrics', () =>
        HttpResponse.json({
          metrics: {
            fromSha: 'sha-a',
            toSha: 'sha-b',
            totalBuilds: 4,
            averageApiCoveragePercent: 82.5,
            averageFrontendCoveragePercent: 71.25,
          },
        }),
      ),
    );
    renderWithProviders(<TraceabilityPage />);
    await userEvent.type(screen.getByTestId('tia-from-sha-input'), 'sha-a');
    await userEvent.type(screen.getByTestId('tia-to-sha-input'), 'sha-b');
    await userEvent.click(screen.getByTestId('tia-metrics-submit-button'));

    await waitFor(() => expect(screen.getByTestId('tia-metrics-stat-tiles')).toBeInTheDocument());
    expect(screen.getByTestId('stat-tile-tia-total-builds')).toHaveTextContent('4');
    expect(screen.getByTestId('stat-tile-tia-avg-api')).toHaveTextContent('82.5%');
  });
});

describe('TraceabilityPage — drill-down', () => {
  it('shows the empty state before submitting', () => {
    renderWithProviders(<TraceabilityPage />);
    expect(screen.getByTestId('drilldown-empty')).toBeInTheDocument();
  });

  it('looks up tests for a unit by default (unit-to-tests direction)', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/mapping/tests-for-unit', () =>
        HttpResponse.json({ results: [MOCK_MAPPING_RESULT] }),
      ),
    );
    renderWithProviders(<TraceabilityPage />);
    await userEvent.type(screen.getByTestId('drilldown-commit-sha-input'), 'abc123');
    await userEvent.type(screen.getByTestId('drilldown-unit-key-input'), 'render#abc123');
    await userEvent.click(screen.getByTestId('drilldown-submit-button'));

    await waitFor(() => expect(screen.getByTestId('drilldown-table')).toBeInTheDocument());
    expect(screen.getByText(MOCK_MAPPING_RESULT.testName!)).toBeInTheDocument();
  });

  it('switches to test-to-units direction and shows the unit-key field instead', async () => {
    server.use(
      http.get('*/api/v1/admin/coverage/mapping/units-for-test', () =>
        HttpResponse.json({ results: [MOCK_MAPPING_RESULT] }),
      ),
    );
    renderWithProviders(<TraceabilityPage />);
    await userEvent.selectOptions(
      screen.getByTestId('drilldown-direction-select'),
      'test-to-units',
    );
    expect(screen.getByTestId('drilldown-test-id-input')).toBeInTheDocument();

    await userEvent.type(screen.getByTestId('drilldown-commit-sha-input'), 'abc123');
    await userEvent.type(screen.getByTestId('drilldown-test-id-input'), 'spec:deals.spec.ts::test');
    await userEvent.click(screen.getByTestId('drilldown-submit-button'));

    await waitFor(() => expect(screen.getByTestId('drilldown-table')).toBeInTheDocument());
    expect(screen.getByText(MOCK_MAPPING_RESULT.unitKey)).toBeInTheDocument();
  });

  it('shows a results-empty message when the lookup returns no results', async () => {
    renderWithProviders(<TraceabilityPage />);
    await userEvent.type(screen.getByTestId('drilldown-commit-sha-input'), 'abc123');
    await userEvent.type(screen.getByTestId('drilldown-unit-key-input'), 'nonexistent#000');
    await userEvent.click(screen.getByTestId('drilldown-submit-button'));

    await waitFor(() => expect(screen.getByTestId('drilldown-results-empty')).toBeInTheDocument());
  });

  it('shows an error message on a failed request', async () => {
    server.use(
      http.get(
        '*/api/v1/admin/coverage/mapping/tests-for-unit',
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    renderWithProviders(<TraceabilityPage />);
    await userEvent.type(screen.getByTestId('drilldown-commit-sha-input'), 'abc123');
    await userEvent.type(screen.getByTestId('drilldown-unit-key-input'), 'render#abc123');
    await userEvent.click(screen.getByTestId('drilldown-submit-button'));

    await waitFor(() => expect(screen.getByTestId('drilldown-error')).toBeInTheDocument());
  });
});
