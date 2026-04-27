/**
 * Tests for the ActivityVolumeReportPage component.
 * Covers heading, filters, table rendering, totals row, empty state, CSV export,
 * admin vs rep scoping, and My View / Team View toggle (MINCRM-264).
 * Implements MINCRM-181, MINCRM-264.
 */

import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import ActivityVolumeReportPage from './ActivityVolumeReportPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { REP_USER, ACTIVITY_VOLUME_REPORT } from '../test/msw/handlers.js';
import { server } from '../test/setup.js';

describe('ActivityVolumeReportPage', () => {
  describe('header', () => {
    it('admin sees Team Activity Report heading by default', async () => {
      renderWithProviders(<ActivityVolumeReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('activity-volume-report-heading')).toHaveTextContent(
          'Team Activity Report',
        );
      });
    });

    it('renders the NavBar', async () => {
      renderWithProviders(<ActivityVolumeReportPage />);
      await waitFor(() => {
        expect(screen.getByText('MiniCRM')).toBeInTheDocument();
      });
    });
  });

  describe('view mode toggle (MINCRM-264)', () => {
    it('admin sees toggle buttons', async () => {
      renderWithProviders(<ActivityVolumeReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('view-mode-toggle')).toBeInTheDocument();
        expect(screen.getByTestId('view-mode-team')).toBeInTheDocument();
        expect(screen.getByTestId('view-mode-my')).toBeInTheDocument();
      });
    });

    it('heading changes to My Activity Report when admin switches to My View', async () => {
      renderWithProviders(<ActivityVolumeReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('view-mode-my')).toBeInTheDocument();
      });
      await userEvent.click(screen.getByTestId('view-mode-my'));
      expect(screen.getByTestId('activity-volume-report-heading')).toHaveTextContent(
        'My Activity Report',
      );
    });

    it('rep sees My Activity Report heading — no toggle', async () => {
      server.use(http.get('/api/auth/me', () => HttpResponse.json({ user: REP_USER })));
      renderWithProviders(<ActivityVolumeReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('activity-volume-report-heading')).toHaveTextContent(
          'My Activity Report',
        );
      });
      expect(screen.queryByTestId('view-mode-toggle')).not.toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows a loading message while fetching', () => {
      server.use(http.get('/api/reports/activity-volume', () => new Promise(() => {})));
      renderWithProviders(<ActivityVolumeReportPage />);
      expect(screen.getByTestId('report-loading')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows an error message when the request fails', async () => {
      server.use(
        http.get('/api/reports/activity-volume', () =>
          HttpResponse.json(
            { error: { code: 'INTERNAL_ERROR', message: 'Server error' } },
            { status: 500 },
          ),
        ),
      );
      renderWithProviders(<ActivityVolumeReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('report-error')).toBeInTheDocument();
      });
    });
  });

  describe('table rendering', () => {
    it('renders the activity volume table when data is loaded', async () => {
      renderWithProviders(<ActivityVolumeReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('activity-volume-table')).toBeInTheDocument();
      });
    });

    it('renders one row per rep in the fixture', async () => {
      renderWithProviders(<ActivityVolumeReportPage />);
      await waitFor(() => {
        for (const row of ACTIVITY_VOLUME_REPORT.rows) {
          expect(screen.getByTestId(`rep-row-${row.ownerId}`)).toBeInTheDocument();
        }
      });
    });

    it('renders the correct count in a cell', async () => {
      renderWithProviders(<ActivityVolumeReportPage />);
      await waitFor(() => {
        const adminRow = ACTIVITY_VOLUME_REPORT.rows[0];
        const callCell = screen.getByTestId(`cell-${adminRow.ownerId}-Call`);
        expect(callCell).toHaveTextContent(String(adminRow.counts.Call));
      });
    });

    it('renders the totals row', async () => {
      renderWithProviders(<ActivityVolumeReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('totals-row')).toBeInTheDocument();
      });
    });

    it('displays the correct total in the totals row', async () => {
      renderWithProviders(<ActivityVolumeReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('totals-total')).toHaveTextContent(
          String(ACTIVITY_VOLUME_REPORT.totals.total),
        );
      });
    });

    it('displays column total for Note type', async () => {
      renderWithProviders(<ActivityVolumeReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('totals-Note')).toHaveTextContent(
          String(ACTIVITY_VOLUME_REPORT.totals.Note),
        );
      });
    });

    it('shows zero cells as "0" (not linked)', async () => {
      renderWithProviders(<ActivityVolumeReportPage />);
      await waitFor(() => {
        // Rep user (row index 1) has 0 Email count
        const repRow = ACTIVITY_VOLUME_REPORT.rows[1];
        const emailCell = screen.getByTestId(`cell-${repRow.ownerId}-Email`);
        expect(emailCell).toHaveTextContent('0');
      });
    });

    it('shows non-zero counts as links', async () => {
      renderWithProviders(<ActivityVolumeReportPage />);
      await waitFor(() => {
        const adminRow = ACTIVITY_VOLUME_REPORT.rows[0];
        const callCell = screen.getByTestId(`cell-${adminRow.ownerId}-Call`);
        // Should contain a link (count > 0)
        const link = callCell.querySelector('a');
        expect(link).not.toBeNull();
      });
    });
  });

  describe('empty state', () => {
    it('shows the empty state when there are no activity rows', async () => {
      server.use(
        http.get('/api/reports/activity-volume', () =>
          HttpResponse.json({
            rows: [],
            totals: { Note: 0, Call: 0, Email: 0, Meeting: 0, Task: 0, total: 0 },
          }),
        ),
      );
      renderWithProviders(<ActivityVolumeReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('activity-volume-empty')).toBeInTheDocument();
      });
    });
  });

  describe('filters', () => {
    it('renders the date preset filter', async () => {
      renderWithProviders(<ActivityVolumeReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('date-preset-select')).toBeInTheDocument();
      });
    });

    it('defaults to "This month" preset on mount and hides custom date inputs', async () => {
      renderWithProviders(<ActivityVolumeReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('date-preset-select')).toHaveValue('currentMonth');
        expect(screen.queryByTestId('custom-start-input')).not.toBeInTheDocument();
        expect(screen.queryByTestId('custom-end-input')).not.toBeInTheDocument();
      });
    });

    it('shows custom date inputs when "Custom range" is selected', async () => {
      renderWithProviders(<ActivityVolumeReportPage />);
      await waitFor(() => screen.getByTestId('date-preset-select'));
      fireEvent.change(screen.getByTestId('date-preset-select'), {
        target: { value: 'custom' },
      });
      await waitFor(() => {
        expect(screen.getByTestId('custom-start-input')).toBeInTheDocument();
        expect(screen.getByTestId('custom-end-input')).toBeInTheDocument();
      });
    });

    it('shows date range error when start is after end in custom mode', async () => {
      renderWithProviders(<ActivityVolumeReportPage />);
      await waitFor(() => screen.getByTestId('date-preset-select'));
      fireEvent.change(screen.getByTestId('date-preset-select'), {
        target: { value: 'custom' },
      });
      await waitFor(() => screen.getByTestId('custom-start-input'));
      fireEvent.change(screen.getByTestId('custom-start-input'), {
        target: { value: '2025-12-31' },
      });
      fireEvent.change(screen.getByTestId('custom-end-input'), {
        target: { value: '2025-01-01' },
      });
      await waitFor(() => {
        expect(screen.getByTestId('date-range-error')).toBeInTheDocument();
      });
    });

    it('shows the owner filter dropdown for admins', async () => {
      renderWithProviders(<ActivityVolumeReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('owner-filter-select')).toBeInTheDocument();
      });
    });

    it('does not show the owner filter dropdown for reps', async () => {
      server.use(http.get('/api/auth/me', () => HttpResponse.json({ user: REP_USER })));
      renderWithProviders(<ActivityVolumeReportPage />);
      await waitFor(() => expect(screen.queryByTestId('report-loading')).not.toBeInTheDocument());
      expect(screen.queryByTestId('owner-filter-select')).not.toBeInTheDocument();
    });
  });

  describe('CSV export', () => {
    it('renders the export CSV button when data is present', async () => {
      renderWithProviders(<ActivityVolumeReportPage />);
      await waitFor(() => {
        expect(screen.getByTestId('export-csv-button')).toBeInTheDocument();
      });
    });

    it('does not render the export button when rows are empty', async () => {
      server.use(
        http.get('/api/reports/activity-volume', () =>
          HttpResponse.json({
            rows: [],
            totals: { Note: 0, Call: 0, Email: 0, Meeting: 0, Task: 0, total: 0 },
          }),
        ),
      );
      renderWithProviders(<ActivityVolumeReportPage />);
      await waitFor(() => screen.getByTestId('activity-volume-empty'));
      expect(screen.queryByTestId('export-csv-button')).not.toBeInTheDocument();
    });
  });
});
