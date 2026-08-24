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
      server.use(http.get('/api/v1/dashboard/summary', () => new Promise(() => {})));
      renderWithProviders(<DashboardPage />);
      expect(screen.getByTestId('dashboard-loading')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows an error message when the request fails', async () => {
      server.use(
        http.get('/api/v1/dashboard/summary', () =>
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
    it('renders all five stat cards', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('stat-overdue-tasks')).toBeInTheDocument();
        expect(screen.getByTestId('stat-tasks-due-today')).toBeInTheDocument();
        expect(screen.getByTestId('stat-open-deals')).toBeInTheDocument();
        expect(screen.getByTestId('stat-pipeline-value')).toBeInTheDocument();
        expect(screen.getByTestId('stat-weighted-pipeline-value')).toBeInTheDocument();
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
      server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ user: REP_USER })));
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        const link = screen.getByTestId('stat-overdue-tasks-link');
        expect(link).toHaveAttribute('href', '/tasks?filter=overdue');
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
        http.get('/api/v1/dashboard/summary', () =>
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

  describe('weighted pipeline value', () => {
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

  describe('recent activity feed', () => {
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
        http.get('/api/v1/dashboard/summary', () =>
          HttpResponse.json({ ...DASHBOARD_SUMMARY, recentActivities: [] }),
        ),
      );
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('recent-activity-empty')).toBeInTheDocument();
      });
    });

    it('renders linked record name as plain text when linkedRecordPath is null', async () => {
      const noPathActivity = {
        ...RECENT_ACTIVITY_1,
        id: 'no-path-activity-id',
        linkedRecordPath: null,
        linkedRecordName: 'Unlinked Record',
      };
      server.use(
        http.get('/api/v1/dashboard/summary', () =>
          HttpResponse.json({ ...DASHBOARD_SUMMARY, recentActivities: [noPathActivity] }),
        ),
      );
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        const cell = screen.getByTestId(`recent-activity-record-${noPathActivity.id}`);
        expect(cell.tagName).not.toBe('A');
        expect(cell).toHaveTextContent('Unlinked Record');
      });
    });

    it('renders nothing for the record cell when both linkedRecordPath and linkedRecordName are null', async () => {
      const noLinkActivity = {
        ...RECENT_ACTIVITY_1,
        id: 'no-link-activity-id',
        linkedRecordPath: null,
        linkedRecordName: null,
      };
      server.use(
        http.get('/api/v1/dashboard/summary', () =>
          HttpResponse.json({ ...DASHBOARD_SUMMARY, recentActivities: [noLinkActivity] }),
        ),
      );
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`recent-activity-${noLinkActivity.id}`)).toBeInTheDocument();
        expect(
          screen.queryByTestId(`recent-activity-record-${noLinkActivity.id}`),
        ).not.toBeInTheDocument();
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
      server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ user: REP_USER })));
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        const card = screen.getByTestId('stat-overdue-tasks');
        expect(card).toHaveTextContent('Your');
      });
    });
  });

  describe('recent activity type badges', () => {
    function makeActivity(type: string) {
      return {
        ...RECENT_ACTIVITY_1,
        id: `recent-${type.toLowerCase()}`,
        type,
        linkedRecordPath: null,
        linkedRecordName: null,
      };
    }

    it('renders a Call badge for Call activities', async () => {
      server.use(
        http.get('/api/v1/dashboard/summary', () =>
          HttpResponse.json({ ...DASHBOARD_SUMMARY, recentActivities: [makeActivity('Call')] }),
        ),
      );
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('recent-activity-type-recent-call')).toHaveTextContent('Call');
      });
    });

    it('renders an Email badge for Email activities', async () => {
      server.use(
        http.get('/api/v1/dashboard/summary', () =>
          HttpResponse.json({ ...DASHBOARD_SUMMARY, recentActivities: [makeActivity('Email')] }),
        ),
      );
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('recent-activity-type-recent-email')).toHaveTextContent('Email');
      });
    });

    it('renders a Meeting badge for Meeting activities', async () => {
      server.use(
        http.get('/api/v1/dashboard/summary', () =>
          HttpResponse.json({ ...DASHBOARD_SUMMARY, recentActivities: [makeActivity('Meeting')] }),
        ),
      );
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('recent-activity-type-recent-meeting')).toHaveTextContent(
          'Meeting',
        );
      });
    });

    it('renders a Task badge for Task activities', async () => {
      server.use(
        http.get('/api/v1/dashboard/summary', () =>
          HttpResponse.json({ ...DASHBOARD_SUMMARY, recentActivities: [makeActivity('Task')] }),
        ),
      );
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('recent-activity-type-recent-task')).toHaveTextContent('Task');
      });
    });

    it('renders a Note badge for Note (default) activities', async () => {
      server.use(
        http.get('/api/v1/dashboard/summary', () =>
          HttpResponse.json({ ...DASHBOARD_SUMMARY, recentActivities: [makeActivity('Note')] }),
        ),
      );
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('recent-activity-type-recent-note')).toHaveTextContent('Note');
      });
    });
  });

  describe('relative time label variants', () => {
    // DashboardPage uses entry.updatedAt (not created_at) for relativeTime()
    function makeTimedActivity(id: string, msAgo: number) {
      return {
        ...RECENT_ACTIVITY_1,
        id,
        updatedAt: new Date(Date.now() - msAgo).toISOString(),
        linkedRecordPath: null,
        linkedRecordName: null,
      };
    }

    it('shows a minutes-ago label for activities updated ~3 minutes ago', async () => {
      const activity = makeTimedActivity('recent-3min', 3 * 60_000);
      server.use(
        http.get('/api/v1/dashboard/summary', () =>
          HttpResponse.json({ ...DASHBOARD_SUMMARY, recentActivities: [activity] }),
        ),
      );
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`recent-activity-time-${activity.id}`).textContent).toMatch(
          /minute/,
        );
      });
    });

    it('shows a singular minute label for exactly 1 minute ago', async () => {
      const activity = makeTimedActivity('recent-1min', 65_000);
      server.use(
        http.get('/api/v1/dashboard/summary', () =>
          HttpResponse.json({ ...DASHBOARD_SUMMARY, recentActivities: [activity] }),
        ),
      );
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`recent-activity-time-${activity.id}`).textContent).toMatch(
          /1 minute ago/,
        );
      });
    });

    it('shows an hours-ago label for activities updated ~3 hours ago', async () => {
      const activity = makeTimedActivity('recent-3hr', 3 * 60 * 60_000);
      server.use(
        http.get('/api/v1/dashboard/summary', () =>
          HttpResponse.json({ ...DASHBOARD_SUMMARY, recentActivities: [activity] }),
        ),
      );
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`recent-activity-time-${activity.id}`).textContent).toMatch(
          /hour/,
        );
      });
    });

    it('shows a singular hour label for exactly 1 hour ago', async () => {
      const activity = makeTimedActivity('recent-1hr', 61 * 60_000);
      server.use(
        http.get('/api/v1/dashboard/summary', () =>
          HttpResponse.json({ ...DASHBOARD_SUMMARY, recentActivities: [activity] }),
        ),
      );
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`recent-activity-time-${activity.id}`).textContent).toMatch(
          /1 hour ago/,
        );
      });
    });

    it('shows a days-ago label for activities updated ~2 days ago', async () => {
      const activity = makeTimedActivity('recent-2day', 2 * 24 * 60 * 60_000);
      server.use(
        http.get('/api/v1/dashboard/summary', () =>
          HttpResponse.json({ ...DASHBOARD_SUMMARY, recentActivities: [activity] }),
        ),
      );
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`recent-activity-time-${activity.id}`).textContent).toMatch(
          /day/,
        );
      });
    });

    it('shows a singular day label for exactly 1 day ago', async () => {
      const activity = makeTimedActivity('recent-1day', 25 * 60 * 60_000);
      server.use(
        http.get('/api/v1/dashboard/summary', () =>
          HttpResponse.json({ ...DASHBOARD_SUMMARY, recentActivities: [activity] }),
        ),
      );
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`recent-activity-time-${activity.id}`).textContent).toMatch(
          /1 day ago/,
        );
      });
    });

    it('shows "just now" for very recent activities (< 60 seconds)', async () => {
      const activity = makeTimedActivity('recent-justnow', 5_000);
      server.use(
        http.get('/api/v1/dashboard/summary', () =>
          HttpResponse.json({ ...DASHBOARD_SUMMARY, recentActivities: [activity] }),
        ),
      );
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`recent-activity-time-${activity.id}`).textContent).toMatch(
          /just now/,
        );
      });
    });
  });

  describe('My Performance', () => {
    it('renders nothing when there is insufficient coaching data', async () => {
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('dashboard-heading')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('my-performance-section')).not.toBeInTheDocument();
    });

    it('renders nothing when there are no outlier insights', async () => {
      server.use(
        http.get('/api/v1/insights/coaching/me', () =>
          HttpResponse.json({
            rep_id: ADMIN_USER.id,
            rep_name: ADMIN_USER.name,
            insights: [
              {
                id: 'i1',
                metric_type: 'activity_frequency',
                segment: null,
                observation: 'On par with the team.',
                recommended_action: 'Keep it up.',
                rep_value: 2,
                team_average_value: 2,
                is_outlier: false,
                closed_deal_count: 12,
                computed_at: '2026-07-01T04:00:00.000Z',
              },
            ],
            has_sufficient_data: true,
            min_closed_deals_required: 10,
            closed_deal_count: 12,
          }),
        ),
      );
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('dashboard-heading')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('my-performance-section')).not.toBeInTheDocument();
    });

    it('renders outlier insights with a link to the full coaching page', async () => {
      server.use(
        http.get('/api/v1/insights/coaching/me', () =>
          HttpResponse.json({
            rep_id: ADMIN_USER.id,
            rep_name: ADMIN_USER.name,
            insights: [
              {
                id: 'i1',
                metric_type: 'avg_stage_days',
                segment: null,
                observation: 'You spend 22 days in Proposal vs. 11 team average.',
                recommended_action: 'Consider a follow-up task at day 7.',
                rep_value: 22,
                team_average_value: 11,
                is_outlier: true,
                closed_deal_count: 12,
                computed_at: '2026-07-01T04:00:00.000Z',
              },
            ],
            has_sufficient_data: true,
            min_closed_deals_required: 10,
            closed_deal_count: 12,
          }),
        ),
      );
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('my-performance-section')).toBeInTheDocument();
      });
      expect(screen.getByText(/You spend 22 days in Proposal/)).toBeInTheDocument();
      expect(screen.getByTestId('my-performance-view-all')).toHaveAttribute(
        'href',
        '/insights/coaching',
      );
    });

    it('renders nothing when the feature flag is disabled', async () => {
      server.use(
        http.get('/api/v1/feature-flags/me', () =>
          HttpResponse.json({ flags: { ai_rep_coaching_insights: false } }),
        ),
      );
      renderWithProviders(<DashboardPage />);
      await waitFor(() => {
        expect(screen.getByTestId('dashboard-heading')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('my-performance-section')).not.toBeInTheDocument();
    });
  });
});
