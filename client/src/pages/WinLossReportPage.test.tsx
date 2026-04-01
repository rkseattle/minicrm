/**
 * Tests for the WinLossReportPage component.
 * Covers stat cards, loss reason breakdown, date presets, owner filter, and edge cases.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import WinLossReportPage from './WinLossReportPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { ADMIN_USER, REP_USER, WIN_LOSS_REPORT } from '../test/msw/handlers.js';
import { server } from '../test/setup.js';

describe('WinLossReportPage', () => {
  describe('page structure', () => {
    it('renders the page heading', async () => {
      renderWithProviders(<WinLossReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('win-loss-report-heading')).toBeInTheDocument();
      });
    });

    it('renders the NavBar', async () => {
      renderWithProviders(<WinLossReportPage />);
      await waitFor(() => {
        expect(screen.getByText('MiniCRM')).toBeInTheDocument();
      });
    });
  });

  describe('loading state', () => {
    it('shows a loading message while fetching', () => {
      server.use(http.get('/api/reports/win-loss', () => new Promise(() => {})));
      renderWithProviders(<WinLossReportPage />);
      expect(screen.getByTestId('report-loading')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows an error message when the request fails', async () => {
      server.use(
        http.get('/api/reports/win-loss', () =>
          HttpResponse.json(
            { error: { code: 'INTERNAL_ERROR', message: 'Server error' } },
            { status: 500 },
          ),
        ),
      );
      renderWithProviders(<WinLossReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('report-error')).toBeInTheDocument();
      });
    });
  });

  describe('stat cards', () => {
    it('renders all five stat cards after data loads', async () => {
      renderWithProviders(<WinLossReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('stat-won-count')).toBeInTheDocument();
        expect(screen.getByTestId('stat-won-value')).toBeInTheDocument();
        expect(screen.getByTestId('stat-lost-count')).toBeInTheDocument();
        expect(screen.getByTestId('stat-lost-value')).toBeInTheDocument();
        expect(screen.getByTestId('stat-win-rate')).toBeInTheDocument();
      });
    });

    it('displays correct won count', async () => {
      renderWithProviders(<WinLossReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('stat-won-count-value')).toHaveTextContent(
          String(WIN_LOSS_REPORT.wonCount),
        );
      });
    });

    it('displays formatted won value', async () => {
      renderWithProviders(<WinLossReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('stat-won-value-value')).toHaveTextContent('$87,000.00');
      });
    });

    it('displays correct lost count', async () => {
      renderWithProviders(<WinLossReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('stat-lost-count-value')).toHaveTextContent(
          String(WIN_LOSS_REPORT.lostCount),
        );
      });
    });

    it('displays formatted lost value', async () => {
      renderWithProviders(<WinLossReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('stat-lost-value-value')).toHaveTextContent('$30,000.00');
      });
    });

    it('displays win rate as a percentage', async () => {
      renderWithProviders(<WinLossReportPage />);
      await waitFor(() => {
        // winRate = 5/7 ≈ 0.714 → 71%
        expect(screen.getByTestId('stat-win-rate-value')).toHaveTextContent('71%');
      });
    });

    it('displays "—" for win rate when there are no closed deals', async () => {
      server.use(
        http.get('/api/reports/win-loss', () =>
          HttpResponse.json({ ...WIN_LOSS_REPORT, wonCount: 0, lostCount: 0, winRate: null }),
        ),
      );
      renderWithProviders(<WinLossReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('stat-win-rate-value')).toHaveTextContent('—');
      });
    });
  });

  describe('loss reason breakdown', () => {
    it('renders the breakdown table when loss reasons exist', async () => {
      renderWithProviders(<WinLossReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('loss-reason-table')).toBeInTheDocument();
      });
    });

    it('renders a row for each loss reason', async () => {
      renderWithProviders(<WinLossReportPage />);
      await waitFor(() => {
        for (const row of WIN_LOSS_REPORT.lossReasonBreakdown) {
          expect(screen.getByTestId(`loss-reason-row-${row.reason}`)).toBeInTheDocument();
        }
      });
    });

    it('shows counts per reason', async () => {
      renderWithProviders(<WinLossReportPage />);
      await waitFor(() => {
        expect(
          screen.getByTestId(`loss-reason-count-${WIN_LOSS_REPORT.lossReasonBreakdown[0].reason}`),
        ).toHaveTextContent(String(WIN_LOSS_REPORT.lossReasonBreakdown[0].count));
      });
    });

    it('shows the empty state when there are no loss reasons', async () => {
      server.use(
        http.get('/api/reports/win-loss', () =>
          HttpResponse.json({ ...WIN_LOSS_REPORT, lossReasonBreakdown: [] }),
        ),
      );
      renderWithProviders(<WinLossReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('loss-reason-empty')).toBeInTheDocument();
      });
    });
  });

  describe('date range controls', () => {
    it('shows the preset selector', async () => {
      renderWithProviders(<WinLossReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('date-preset-select')).toBeInTheDocument();
      });
    });

    it('does not show custom date inputs when preset is not "custom"', async () => {
      renderWithProviders(<WinLossReportPage />);
      await waitFor(() => {
        expect(screen.queryByTestId('custom-start-input')).not.toBeInTheDocument();
        expect(screen.queryByTestId('custom-end-input')).not.toBeInTheDocument();
      });
    });

    it('shows custom date inputs when "custom" preset is selected', async () => {
      renderWithProviders(<WinLossReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('date-preset-select')).toBeInTheDocument();
      });
      await userEvent.selectOptions(screen.getByTestId('date-preset-select'), 'custom');
      expect(screen.getByTestId('custom-start-input')).toBeInTheDocument();
      expect(screen.getByTestId('custom-end-input')).toBeInTheDocument();
    });

    it('shows a validation error when start date is after end date', async () => {
      renderWithProviders(<WinLossReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('date-preset-select')).toBeInTheDocument();
      });
      await userEvent.selectOptions(screen.getByTestId('date-preset-select'), 'custom');

      const startInput = screen.getByTestId('custom-start-input');
      const endInput = screen.getByTestId('custom-end-input');

      await userEvent.clear(startInput);
      await userEvent.type(startInput, '2025-12-31');
      await userEvent.clear(endInput);
      await userEvent.type(endInput, '2025-01-01');

      await waitFor(() => {
        expect(screen.getByTestId('date-range-error')).toBeInTheDocument();
      });
    });
  });

  describe('owner filter (admin)', () => {
    it('shows the owner filter for admins', async () => {
      renderWithProviders(<WinLossReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('owner-filter-select')).toBeInTheDocument();
      });
    });

    it('does not show the owner filter for reps', async () => {
      server.use(http.get('/api/auth/me', () => HttpResponse.json({ user: REP_USER })));
      renderWithProviders(<WinLossReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('win-loss-report-heading')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('owner-filter-select')).not.toBeInTheDocument();
    });

    it('populates the owner dropdown with active users', async () => {
      renderWithProviders(<WinLossReportPage />);
      await waitFor(() => {
        const select = screen.getByTestId('owner-filter-select');
        expect(select).toHaveTextContent(ADMIN_USER.name);
        expect(select).toHaveTextContent(REP_USER.name);
      });
    });
  });
});
