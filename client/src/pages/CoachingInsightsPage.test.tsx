/**
 * Tests for the CoachingInsightsPage component.
 */

import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import CoachingInsightsPage from './CoachingInsightsPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { REP_USER } from '../test/msw/handlers.js';

function renderPage() {
  return renderWithProviders(<CoachingInsightsPage />, {
    initialEntries: ['/insights/coaching'],
    path: '/insights/coaching',
  });
}

const TEAM_OVERVIEW_RESPONSE = {
  reps: [
    {
      rep_id: 'rep-1',
      rep_name: 'Rep One',
      has_sufficient_data: true,
      closed_deal_count: 12,
      outlier_metric_count: 1,
    },
  ],
  min_closed_deals_required: 10,
};

describe('CoachingInsightsPage', () => {
  it('shows insufficient-data message when the selected rep has too few closed deals', async () => {
    server.use(
      http.get('/api/v1/insights/coaching/team', () => HttpResponse.json(TEAM_OVERVIEW_RESPONSE)),
      http.get('/api/v1/insights/coaching/:repId', () =>
        HttpResponse.json({
          rep_id: 'rep-1',
          rep_name: 'Rep One',
          insights: [],
          has_sufficient_data: false,
          min_closed_deals_required: 10,
          closed_deal_count: 3,
        }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('coaching-insights-insufficient-data')).toBeInTheDocument();
    });
  });

  it('renders insights for the selected rep, with outliers badged', async () => {
    server.use(
      http.get('/api/v1/insights/coaching/team', () => HttpResponse.json(TEAM_OVERVIEW_RESPONSE)),
      http.get('/api/v1/insights/coaching/:repId', () =>
        HttpResponse.json({
          rep_id: 'rep-1',
          rep_name: 'Rep One',
          insights: [
            {
              id: 'i1',
              metric_type: 'avg_stage_days',
              segment: null,
              observation: 'Rep One spends 22 days in Proposal vs. 11 team average.',
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
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('coaching-insight-avg_stage_days-all')).toBeInTheDocument();
    });
    expect(screen.getByText(/spends 22 days in Proposal/)).toBeInTheDocument();
    expect(
      screen.getByTestId('coaching-insight-outlier-badge-avg_stage_days-all'),
    ).toBeInTheDocument();
  });

  it('shows an error message when the request fails', async () => {
    server.use(
      http.get('/api/v1/insights/coaching/team', () => HttpResponse.json(TEAM_OVERVIEW_RESPONSE)),
      http.get('/api/v1/insights/coaching/:repId', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Failed' } },
          { status: 500 },
        ),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('coaching-insights-error')).toBeInTheDocument();
    });
  });

  it('shows the empty state when no reps are available', async () => {
    server.use(
      http.get('/api/v1/insights/coaching/team', () =>
        HttpResponse.json({ reps: [], min_closed_deals_required: 10 }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('coaching-insights-no-reps')).toBeInTheDocument();
    });
  });

  it('hides the page content when the feature flag is disabled', async () => {
    server.use(
      http.get('/api/v1/feature-flags/me', () =>
        HttpResponse.json({ flags: { ai_rep_coaching_insights: false } }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.queryByTestId('coaching-insights-heading')).not.toBeInTheDocument();
    });
  });

  it('redirects reps away from the page (manager/admin only)', async () => {
    server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ user: REP_USER })));
    renderPage();
    await waitFor(() => {
      expect(screen.queryByTestId('coaching-insights-heading')).not.toBeInTheDocument();
    });
  });
});
