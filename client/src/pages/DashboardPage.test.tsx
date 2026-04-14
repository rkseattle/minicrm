/**
 * Tests for the DashboardPage component.
 * Covers stat cards, stage breakdown, overdue link navigation, and admin vs rep data scoping.
 */

import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import DashboardPage from './DashboardPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import {
  ADMIN_USER,
  REP_USER,
  DASHBOARD_SUMMARY,
  RECENT_ACTIVITY_1,
} from '../test/msw/handlers.js';
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

    it('overdue task card links to My Tasks filtered to overdue for reps', async () => {
      server.use(http.get('/api/auth/me', () => HttpResponse.json({ user: REP_USER })));
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        const link = screen.getByTestId('stat-overdue-tasks-link');
        expect(link).toHaveAttribute('href', '/my-tasks?filter=overdue');
      });
    });

    it('overdue task card is not a link for admins (team count vs personal destination mismatch)', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        // Admin sees a non-navigable value element, not a link
        expect(screen.getByTestId('stat-overdue-tasks-value')).toBeInTheDocument();
        expect(screen.queryByTestId('stat-overdue-tasks-link')).not.toBeInTheDocument();
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

  describe('weighted pipeline value (MINCRM-179)', () => {
    it('renders the weighted pipeline stat card', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('stat-weighted-pipeline-value')).toBeInTheDocument();
      });
    });

    it('displays the formatted weighted pipeline value from the API', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        // DASHBOARD_SUMMARY fixture has weightedPipelineValue: '52500.00'
        const card = screen.getByTestId('stat-weighted-pipeline-value');
        expect(card).toHaveTextContent('$52,500.00');
      });
    });

    it('renders a weighted value column in the stage breakdown table', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('stage-breakdown-table')).toBeInTheDocument();
        // Prospecting row weighted value: $5,000.00
        expect(screen.getByTestId('stage-weighted-value-Prospecting')).toBeInTheDocument();
      });
    });
  });

  describe('recent activity feed (MINCRM-185)', () => {
    it('renders the recent activity feed section', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('recent-activity-feed')).toBeInTheDocument();
      });
    });

    it('renders an activity entry for each recent activity', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`recent-activity-${RECENT_ACTIVITY_1.id}`)).toBeInTheDocument();
      });
    });

    it('shows the activity subject', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(
          screen.getByTestId(`recent-activity-subject-${RECENT_ACTIVITY_1.id}`),
        ).toHaveTextContent(RECENT_ACTIVITY_1.subject);
      });
    });

    it('shows the activity type badge', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(
          screen.getByTestId(`recent-activity-type-${RECENT_ACTIVITY_1.id}`),
        ).toHaveTextContent(RECENT_ACTIVITY_1.type);
      });
    });

    it('renders the linked record as a link when a path is available', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        const link = screen.getByTestId(`recent-activity-record-${RECENT_ACTIVITY_1.id}`);
        expect(link).toHaveAttribute('href', RECENT_ACTIVITY_1.linkedRecordPath);
        expect(link).toHaveTextContent(RECENT_ACTIVITY_1.linkedRecordName!);
      });
    });

    it('shows a relative timestamp on each entry', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        const timeEl = screen.getByTestId(`recent-activity-time-${RECENT_ACTIVITY_1.id}`);
        expect(timeEl).toBeInTheDocument();
        // Should contain "ago" since the fixture is 2 hours in the past
        expect(timeEl.textContent).toMatch(/ago/);
      });
    });

    it('shows the "View all" link pointing to activities', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        const viewAll = screen.getByTestId('recent-activity-view-all');
        expect(viewAll).toHaveAttribute('href', '/activities');
      });
    });

    it('shows the empty state when there are no recent activities', async () => {
      server.use(
        http.get('/api/dashboard/summary', () =>
          HttpResponse.json({ ...DASHBOARD_SUMMARY, recentActivities: [] }),
        ),
      );
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('recent-activity-empty')).toBeInTheDocument();
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
