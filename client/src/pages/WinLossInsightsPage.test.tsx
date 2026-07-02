/**
 * Tests for the WinLossInsightsPage component. (MINCRM-464)
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import WinLossInsightsPage from './WinLossInsightsPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import * as winLossApi from '@/api/winLossInsights.js';

function renderPage() {
  return renderWithProviders(<WinLossInsightsPage />, {
    initialEntries: ['/insights/win-loss'],
    path: '/insights/win-loss',
  });
}

describe('WinLossInsightsPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the win pattern from the default MSW fixture', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('win-patterns-list')).toBeInTheDocument();
    });
    expect(screen.getByText(/live demo in week 1/)).toBeInTheDocument();
  });

  it('shows an empty state for loss patterns when none are cached', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('loss-patterns-empty')).toBeInTheDocument();
    });
  });

  it('shows an empty state for loss reason trends when none are cached', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('loss-reason-trends-empty')).toBeInTheDocument();
    });
  });

  it('shows the insufficient-data message when has_sufficient_data is false', async () => {
    server.use(
      http.get('/api/v1/insights/win-loss', () =>
        HttpResponse.json({
          insights: [],
          loss_reason_trends: [],
          has_sufficient_data: false,
          min_closed_deals_required: 20,
          closed_deals_count: 6,
        }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('win-loss-insufficient-data')).toBeInTheDocument();
    });
    expect(screen.getByTestId('win-loss-insufficient-data')).toHaveTextContent('20');
    expect(screen.queryByTestId('win-patterns-heading')).not.toBeInTheDocument();
  });

  it('disables export buttons when there is insufficient data', async () => {
    server.use(
      http.get('/api/v1/insights/win-loss', () =>
        HttpResponse.json({
          insights: [],
          loss_reason_trends: [],
          has_sufficient_data: false,
          min_closed_deals_required: 20,
          closed_deals_count: 6,
        }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('win-loss-export-csv-button')).toBeDisabled();
    });
    expect(screen.getByTestId('win-loss-export-pdf-button')).toBeDisabled();
  });

  it('shows an error message when the insights request fails', async () => {
    server.use(
      http.get('/api/v1/insights/win-loss', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Failed' } },
          { status: 500 },
        ),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('win-loss-insights-error')).toBeInTheDocument();
    });
  });

  it('shows a loading state while fetching, then renders the heading', async () => {
    server.use(
      http.get('/api/v1/insights/win-loss', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({
          insights: [],
          loss_reason_trends: [],
          has_sufficient_data: true,
          min_closed_deals_required: 20,
          closed_deals_count: 25,
        });
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('win-loss-insights-heading')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('win-patterns-empty')).toBeInTheDocument();
    });
  });

  it('hides the page content when the ai_win_loss_insights flag is disabled', async () => {
    server.use(
      http.get('/api/v1/feature-flags/me', () =>
        HttpResponse.json({ flags: { ai_win_loss_insights: false } }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.queryByTestId('win-loss-insights-heading')).not.toBeInTheDocument();
    });
  });

  describe('export buttons', () => {
    it('calls exportWinLossInsightsCsv when Export CSV is clicked', async () => {
      vi.spyOn(winLossApi, 'exportWinLossInsightsCsv').mockResolvedValue(undefined);
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId('win-loss-export-csv-button')).not.toBeDisabled();
      });
      await user.click(screen.getByTestId('win-loss-export-csv-button'));
      expect(winLossApi.exportWinLossInsightsCsv).toHaveBeenCalled();
    });

    it('calls exportWinLossInsightsPdf when Export PDF is clicked', async () => {
      vi.spyOn(winLossApi, 'exportWinLossInsightsPdf').mockResolvedValue(undefined);
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId('win-loss-export-pdf-button')).not.toBeDisabled();
      });
      await user.click(screen.getByTestId('win-loss-export-pdf-button'));
      expect(winLossApi.exportWinLossInsightsPdf).toHaveBeenCalled();
    });

    it('shows an export error message when the CSV export rejects', async () => {
      vi.spyOn(winLossApi, 'exportWinLossInsightsCsv').mockRejectedValue(new Error('failed'));
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId('win-loss-export-csv-button')).not.toBeDisabled();
      });
      await user.click(screen.getByTestId('win-loss-export-csv-button'));
      await waitFor(() => {
        expect(screen.getByTestId('win-loss-export-error')).toBeInTheDocument();
      });
    });
  });
});
