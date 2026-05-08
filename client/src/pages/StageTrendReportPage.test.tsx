/**
 * Tests for the StageTrendReportPage component.
 * Covers heading, filters, table rendering, empty state, loading and error states.
 * Implements MINCRM-284.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import StageTrendReportPage from './StageTrendReportPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { STAGE_TREND_REPORT } from '../test/msw/handlers.js';
import { server } from '../test/setup.js';

describe('StageTrendReportPage', () => {
  describe('header', () => {
    it('renders the page heading', async () => {
      renderWithProviders(<StageTrendReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('stage-trend-report-heading')).toHaveTextContent(
          'Pipeline Stage Trend',
        );
      });
    });

    it('renders the NavBar', async () => {
      renderWithProviders(<StageTrendReportPage />);
      await waitFor(() => {
        expect(screen.getByText('MiniCRM')).toBeInTheDocument();
      });
    });
  });

  describe('date range filter', () => {
    it('renders the days select with default value 30', async () => {
      renderWithProviders(<StageTrendReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('days-select')).toBeInTheDocument();
      });
      expect(screen.getByTestId('days-select')).toHaveValue('30');
    });

    it('renders preset options for 30, 60, 90 days', async () => {
      renderWithProviders(<StageTrendReportPage />);
      await waitFor(() => {
        const select = screen.getByTestId('days-select') as HTMLSelectElement;
        const options = Array.from(select.options).map((o) => o.value);
        expect(options).toEqual(['30', '60', '90']);
      });
    });

    it('changing days to 60 updates the select value', async () => {
      renderWithProviders(<StageTrendReportPage />);
      await waitFor(() => expect(screen.getByTestId('days-select')).toBeInTheDocument());
      await userEvent.selectOptions(screen.getByTestId('days-select'), '60');
      expect(screen.getByTestId('days-select')).toHaveValue('60');
    });
  });

  describe('loading state', () => {
    it('shows a loading message while fetching', () => {
      server.use(http.get('/api/v1/reports/stage-trend', () => new Promise(() => {})));
      renderWithProviders(<StageTrendReportPage />);
      expect(screen.getByTestId('report-loading')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows an error message when the request fails', async () => {
      server.use(
        http.get('/api/v1/reports/stage-trend', () =>
          HttpResponse.json({ error: { code: 'SERVER_ERROR', message: 'oops' } }, { status: 500 }),
        ),
      );
      renderWithProviders(<StageTrendReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('report-error')).toBeInTheDocument();
      });
    });
  });

  describe('empty state', () => {
    it('shows empty message when no data points returned', async () => {
      server.use(
        http.get('/api/v1/reports/stage-trend', () =>
          HttpResponse.json({
            stages: [],
            dataPoints: [],
            windowStart: '2026-04-01',
            windowEnd: '2026-04-30',
          }),
        ),
      );
      renderWithProviders(<StageTrendReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('stage-trend-empty')).toBeInTheDocument();
      });
    });
  });

  describe('report results', () => {
    it('renders the chart container', async () => {
      renderWithProviders(<StageTrendReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('stage-trend-chart-container')).toBeInTheDocument();
      });
    });

    it('renders the summary table', async () => {
      renderWithProviders(<StageTrendReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('stage-trend-table')).toBeInTheDocument();
      });
    });

    it('renders a row for each stage in the fixture', async () => {
      renderWithProviders(<StageTrendReportPage />);
      await waitFor(() => {
        for (const stage of STAGE_TREND_REPORT.stages) {
          const slug = stage.toLowerCase().replace(/\s+/g, '-');
          expect(screen.getByTestId(`stage-trend-row-${slug}`)).toBeInTheDocument();
        }
      });
    });

    it('shows correct total entered count for Prospecting', async () => {
      renderWithProviders(<StageTrendReportPage />);
      await waitFor(() => {
        // Prospecting: 5 + 4 = 9 entered across two periods
        expect(screen.getByTestId('stage-trend-entered-prospecting')).toHaveTextContent('9');
      });
    });

    it('shows correct total converted count for Qualification', async () => {
      renderWithProviders(<StageTrendReportPage />);
      await waitFor(() => {
        // Qualification: 2 + 1 = 3 converted across two periods
        expect(screen.getByTestId('stage-trend-converted-qualification')).toHaveTextContent('3');
      });
    });

    it('shows "—" advance rate for stages with zero entries', async () => {
      server.use(
        http.get('/api/v1/reports/stage-trend', () =>
          HttpResponse.json({
            stages: ['Prospecting'],
            dataPoints: [{ stage: 'Prospecting', period: '2026-04-01', entered: 0, converted: 0 }],
            windowStart: '2026-04-01',
            windowEnd: '2026-04-30',
          }),
        ),
      );
      renderWithProviders(<StageTrendReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('stage-trend-rate-prospecting')).toHaveTextContent('—');
      });
    });

    it('shows correct advance rate percentage', async () => {
      server.use(
        http.get('/api/v1/reports/stage-trend', () =>
          HttpResponse.json({
            stages: ['Prospecting'],
            dataPoints: [{ stage: 'Prospecting', period: '2026-04-01', entered: 4, converted: 3 }],
            windowStart: '2026-04-01',
            windowEnd: '2026-04-30',
          }),
        ),
      );
      renderWithProviders(<StageTrendReportPage />);
      await waitFor(() => {
        // 3/4 = 75%
        expect(screen.getByTestId('stage-trend-rate-prospecting')).toHaveTextContent('75%');
      });
    });

    it('sums totals correctly across multiple periods for a stage', async () => {
      server.use(
        http.get('/api/v1/reports/stage-trend', () =>
          HttpResponse.json({
            stages: ['Prospecting'],
            dataPoints: [
              { stage: 'Prospecting', period: '2026-03-01', entered: 3, converted: 1 },
              { stage: 'Prospecting', period: '2026-04-01', entered: 7, converted: 2 },
            ],
            windowStart: '2026-03-01',
            windowEnd: '2026-04-30',
          }),
        ),
      );
      renderWithProviders(<StageTrendReportPage />);
      await waitFor(() => {
        // 3 + 7 = 10 entered
        expect(screen.getByTestId('stage-trend-entered-prospecting')).toHaveTextContent('10');
        // 1 + 2 = 3 converted
        expect(screen.getByTestId('stage-trend-converted-prospecting')).toHaveTextContent('3');
        // 3/10 = 30%
        expect(screen.getByTestId('stage-trend-rate-prospecting')).toHaveTextContent('30%');
      });
    });

    it('renders rows for multiple stages', async () => {
      server.use(
        http.get('/api/v1/reports/stage-trend', () =>
          HttpResponse.json({
            stages: ['Prospecting', 'Qualification'],
            dataPoints: [
              { stage: 'Prospecting', period: '2026-04-01', entered: 2, converted: 1 },
              { stage: 'Qualification', period: '2026-04-01', entered: 4, converted: 3 },
            ],
            windowStart: '2026-04-01',
            windowEnd: '2026-04-30',
          }),
        ),
      );
      renderWithProviders(<StageTrendReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('stage-trend-row-prospecting')).toBeInTheDocument();
        expect(screen.getByTestId('stage-trend-row-qualification')).toBeInTheDocument();
      });
    });
  });

  describe('days filter options', () => {
    it('changing days to 90 triggers a re-fetch for 90 days', async () => {
      let capturedDays: string | null = null;
      server.use(
        http.get('/api/v1/reports/stage-trend', ({ request }) => {
          const url = new URL(request.url);
          capturedDays = url.searchParams.get('days');
          return HttpResponse.json(STAGE_TREND_REPORT);
        }),
      );

      renderWithProviders(<StageTrendReportPage />);
      await waitFor(() => expect(screen.getByTestId('days-select')).toBeInTheDocument());

      await userEvent.selectOptions(screen.getByTestId('days-select'), '90');

      await waitFor(() => {
        expect(capturedDays).toBe('90');
      });
    });
  });
});
