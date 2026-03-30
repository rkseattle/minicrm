/**
 * Tests for the DashboardPage component.
 * Covers stat cards, stage breakdown, overdue link navigation, and admin vs rep data scoping.
 */

import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import DashboardPage from './DashboardPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { ADMIN_USER, REP_USER, DASHBOARD_SUMMARY } from '../test/msw/handlers.js';
import { server } from '../test/setup.js';

describe('DashboardPage', () => {
  describe('header', () => {
    it('renders the welcome heading with the user name', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: `Welcome, ${ADMIN_USER.name}` }),
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

  describe('loading state', () => {
    it('shows a loading message while fetching', () => {
      // Override handler to hang so loading state is visible
      server.use(http.get('/api/dashboard/summary', () => new Promise(() => {})));
      renderWithProviders(<DashboardPage />);
      expect(screen.getByTestId('dashboard-loading')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows an error message when the request fails', async () => {
      server.use(
        http.get('/api/dashboard/summary', () =>
          HttpResponse.json(
            { error: { code: 'INTERNAL_ERROR', message: 'Server error' } },
            { status: 500 },
          ),
        ),
      );
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('dashboard-error')).toBeInTheDocument();
      });
    });
  });

  describe('stat cards', () => {
    it('renders all four stat cards', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('stat-overdue-tasks')).toBeInTheDocument();
        expect(screen.getByTestId('stat-tasks-due-today')).toBeInTheDocument();
        expect(screen.getByTestId('stat-open-deals')).toBeInTheDocument();
        expect(screen.getByTestId('stat-pipeline-value')).toBeInTheDocument();
      });
    });

    it('displays correct overdue task count', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('stat-overdue-tasks')).toHaveTextContent(
          String(DASHBOARD_SUMMARY.overdueTasks),
        );
      });
    });

    it('displays correct tasks due today count', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('stat-tasks-due-today-value')).toHaveTextContent(
          String(DASHBOARD_SUMMARY.tasksDueToday),
        );
      });
    });

    it('displays correct open deal count', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('stat-open-deals-value')).toHaveTextContent(
          String(DASHBOARD_SUMMARY.openDealCount),
        );
      });
    });

    it('displays formatted pipeline value', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        // $150,000.00 formatted
        expect(screen.getByTestId('stat-pipeline-value-value')).toHaveTextContent('$150,000.00');
      });
    });

    it('overdue task card links to My Tasks filtered to overdue', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        const link = screen.getByTestId('stat-overdue-tasks-link');
        expect(link).toHaveAttribute('href', '/my-tasks?filter=overdue');
      });
    });
  });

  describe('stage breakdown', () => {
    it('renders the stage breakdown table', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('stage-breakdown-table')).toBeInTheDocument();
      });
    });

    it('renders a row for each stage in the breakdown', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        for (const row of DASHBOARD_SUMMARY.stageBreakdown) {
          expect(screen.getByTestId(`stage-row-${row.stage}`)).toBeInTheDocument();
        }
      });
    });

    it('displays deal counts and formatted values per stage', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('stage-count-Prospecting')).toHaveTextContent('1');
        expect(screen.getByTestId('stage-value-Prospecting')).toHaveTextContent('$50,000.00');
        expect(screen.getByTestId('stage-count-Qualification')).toHaveTextContent('2');
        expect(screen.getByTestId('stage-value-Qualification')).toHaveTextContent('$100,000.00');
      });
    });

    it('shows the empty state when there are no open deals', async () => {
      server.use(
        http.get('/api/dashboard/summary', () =>
          HttpResponse.json({
            ...DASHBOARD_SUMMARY,
            openDealCount: 0,
            openPipelineValue: '0',
            stageBreakdown: [],
          }),
        ),
      );
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('stage-breakdown-empty')).toBeInTheDocument();
      });
    });
  });

  describe('admin vs rep scope labels', () => {
    it('shows "Team" scope label for admins', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        // Default handler returns ADMIN_USER, so scope label should be "Team"
        const card = screen.getByTestId('stat-overdue-tasks');
        expect(card).toHaveTextContent('Team');
      });
    });

    it('shows "Your" scope label for reps', async () => {
      server.use(http.get('/api/auth/me', () => HttpResponse.json({ user: REP_USER })));
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        const card = screen.getByTestId('stat-overdue-tasks');
        expect(card).toHaveTextContent('Your');
      });
    });
  });
});
