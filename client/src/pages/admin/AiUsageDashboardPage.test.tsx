/**
 * Tests for AiUsageDashboardPage. (MINCRM-459)
 *
 * Covers:
 *  - Loading state
 *  - Error state
 *  - Summary cards, per-user table, per-feature table, daily chart render
 *  - Date range preset switching (including custom range inputs)
 *  - CSV export button
 *  - Descope disclaimer rendering
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import AiUsageDashboardPage from './AiUsageDashboardPage.js';
import * as aiApi from '@/api/ai.js';

describe('AiUsageDashboardPage — loading and error states', () => {
  it('shows loading skeleton while summary is fetching', () => {
    server.use(
      http.get(
        '/api/v1/admin/ai/usage/summary',
        () =>
          new Promise(() => {
            /* never resolves */
          }),
      ),
    );
    renderWithProviders(<AiUsageDashboardPage />);
    expect(screen.getByTestId('ai-usage-summary-loading')).toBeInTheDocument();
  });

  it('shows error message when summary fetch fails', async () => {
    server.use(
      http.get('/api/v1/admin/ai/usage/summary', () => new HttpResponse(null, { status: 500 })),
    );
    renderWithProviders(<AiUsageDashboardPage />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-usage-summary-error')).toBeInTheDocument();
    });
  });

  it('shows error message when daily series fetch fails', async () => {
    server.use(
      http.get('/api/v1/admin/ai/usage/daily', () => new HttpResponse(null, { status: 500 })),
    );
    renderWithProviders(<AiUsageDashboardPage />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-usage-daily-error')).toBeInTheDocument();
    });
  });
});

describe('AiUsageDashboardPage — default state', () => {
  it('renders summary cards with totals and cost', async () => {
    renderWithProviders(<AiUsageDashboardPage />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-usage-total-tokens-card')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ai-usage-total-tokens-card')).toHaveTextContent('15,000');
    expect(screen.getByTestId('ai-usage-cost-card')).toBeInTheDocument();
    expect(screen.getByTestId('ai-usage-trend-card')).toBeInTheDocument();
  });

  it('renders the per-user table with a row', async () => {
    renderWithProviders(<AiUsageDashboardPage />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-usage-per-user-table')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ai-usage-user-row-uid-1')).toHaveTextContent('Alice Admin');
  });

  it('renders the per-feature table with a row', async () => {
    renderWithProviders(<AiUsageDashboardPage />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-usage-per-feature-table')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ai-usage-feature-row-nli_chat')).toBeInTheDocument();
  });

  it('renders the daily consumption chart bars', async () => {
    renderWithProviders(<AiUsageDashboardPage />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-usage-daily-bars')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ai-usage-daily-bar-2026-06-15')).toBeInTheDocument();
  });

  it('fills in zero-usage days for a range with no recorded usage rather than showing empty state', async () => {
    // A month-long range with zero points from the server should still render
    // one bar per calendar day (all at minimum height), not the "no data" message —
    // the calendar days occurred, they just had no usage.
    server.use(
      http.get('/api/v1/admin/ai/usage/daily', () =>
        HttpResponse.json({
          range_start: '2026-06-01T00:00:00.000Z',
          range_end: '2026-06-03T00:00:00.000Z',
          points: [],
        }),
      ),
    );
    renderWithProviders(<AiUsageDashboardPage />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-usage-daily-bars')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('ai-usage-daily-empty')).not.toBeInTheDocument();
    expect(screen.getByTestId('ai-usage-daily-bar-2026-06-01')).toBeInTheDocument();
    expect(screen.getByTestId('ai-usage-daily-bar-2026-06-02')).toBeInTheDocument();
  });

  it('shows the empty state only for a genuinely empty (zero-day) range', async () => {
    server.use(
      http.get('/api/v1/admin/ai/usage/daily', () =>
        HttpResponse.json({
          range_start: '2026-06-01T00:00:00.000Z',
          range_end: '2026-06-01T00:00:00.000Z',
          points: [],
        }),
      ),
    );
    renderWithProviders(<AiUsageDashboardPage />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-usage-daily-empty')).toBeInTheDocument();
    });
  });

  it('fills gaps between sparse active days so the chart shows one bar per calendar day', async () => {
    server.use(
      http.get('/api/v1/admin/ai/usage/daily', () =>
        HttpResponse.json({
          range_start: '2026-06-01T00:00:00.000Z',
          range_end: '2026-06-04T00:00:00.000Z',
          points: [{ date: '2026-06-01', input_tokens: 100, output_tokens: 50 }],
        }),
      ),
    );
    renderWithProviders(<AiUsageDashboardPage />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-usage-daily-bars')).toBeInTheDocument();
    });
    // 2026-06-01, -02, -03 should all render, even though only -01 has usage.
    expect(screen.getByTestId('ai-usage-daily-bar-2026-06-01')).toBeInTheDocument();
    expect(screen.getByTestId('ai-usage-daily-bar-2026-06-02')).toBeInTheDocument();
    expect(screen.getByTestId('ai-usage-daily-bar-2026-06-03')).toBeInTheDocument();
  });

  it('shows the empty state when there is no per-user usage data', async () => {
    server.use(
      http.get('/api/v1/admin/ai/usage/summary', () =>
        HttpResponse.json({
          range_start: '2026-06-01T00:00:00.000Z',
          range_end: '2026-07-01T00:00:00.000Z',
          input_tokens: 0,
          output_tokens: 0,
          estimated_cost_cents: 0,
          prior_period_estimated_cost_cents: 0,
          per_user: [],
          per_feature: [],
          ai_input_cost_per_million_cents: 300,
          ai_output_cost_per_million_cents: 1500,
        }),
      ),
    );
    renderWithProviders(<AiUsageDashboardPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/No usage data for this range\./i).length).toBeGreaterThan(0);
    });
  });

  it('renders the descope disclaimer', async () => {
    renderWithProviders(<AiUsageDashboardPage />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-usage-disclaimer')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ai-usage-disclaimer')).toHaveTextContent(
      /not reconciled against provider billing/i,
    );
  });
});

describe('AiUsageDashboardPage — date range selector', () => {
  it('switches between presets', async () => {
    renderWithProviders(<AiUsageDashboardPage />);
    await waitFor(() => screen.getByTestId('ai-usage-range-last_month'));

    fireEvent.click(screen.getByTestId('ai-usage-range-last_month'));
    expect(screen.getByTestId('ai-usage-range-last_month')).toHaveClass('bg-primary-600');
  });

  it('shows custom date inputs when custom range is selected', async () => {
    renderWithProviders(<AiUsageDashboardPage />);
    await waitFor(() => screen.getByTestId('ai-usage-range-custom'));

    fireEvent.click(screen.getByTestId('ai-usage-range-custom'));

    expect(screen.getByTestId('ai-usage-custom-start-input')).toBeInTheDocument();
    expect(screen.getByTestId('ai-usage-custom-end-input')).toBeInTheDocument();
  });

  it('seeds the custom range from the clock at selection time, not at mount', async () => {
    // Two properties in one test, because start <= end alone is worthless here:
    // it holds for ANY pair of stale values and would pass with the clock frozen
    // a year ago.
    //
    // 1. The seeds are UTC-derived. Mixing a local month start with a UTC
    //    "today" inverts the range near month end for a UTC-ahead viewer, and
    //    the API rejects an inverted range with a 400 on first open.
    // 2. They are read when the user selects "custom", NOT at mount. `range` is
    //    derived synchronously and the queries carry no `enabled` gate, so the
    //    render that first shows these inputs also fires the request — a
    //    mount-time capture on a dashboard left open for days would silently
    //    fetch and export the wrong period. (MINCRM-700)
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-31T23:30:00.000Z'));
      renderWithProviders(<AiUsageDashboardPage />);
      await vi.waitFor(() => screen.getByTestId('ai-usage-range-custom'));

      // Days pass with the page still open, then the user drills in.
      vi.setSystemTime(new Date('2026-09-03T09:00:00.000Z'));
      fireEvent.click(screen.getByTestId('ai-usage-range-custom'));

      const start = screen.getByTestId('ai-usage-custom-start-input') as HTMLInputElement;
      const end = screen.getByTestId('ai-usage-custom-end-input') as HTMLInputElement;

      // September, not the August the page mounted in.
      expect(start.value).toBe('2026-09-01');
      expect(end.value).toBe('2026-09-03');
      expect(start.value <= end.value).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AiUsageDashboardPage — CSV export', () => {
  it('calls exportAiUsageCsv with the current date range when clicked', async () => {
    const exportSpy = vi.spyOn(aiApi, 'exportAiUsageCsv').mockResolvedValue(undefined);

    renderWithProviders(<AiUsageDashboardPage />);
    await waitFor(() => screen.getByTestId('ai-usage-export-menu-button'));

    fireEvent.click(screen.getByTestId('ai-usage-export-menu-button'));
    fireEvent.click(screen.getByTestId('ai-usage-export-csv-button'));

    await waitFor(() => {
      expect(exportSpy).toHaveBeenCalledWith({ preset: 'current_month' });
    });

    exportSpy.mockRestore();
  });

  it('shows an error message when export fails', async () => {
    const exportSpy = vi
      .spyOn(aiApi, 'exportAiUsageCsv')
      .mockRejectedValue(new Error('export failed'));

    renderWithProviders(<AiUsageDashboardPage />);
    await waitFor(() => screen.getByTestId('ai-usage-export-menu-button'));

    fireEvent.click(screen.getByTestId('ai-usage-export-menu-button'));
    fireEvent.click(screen.getByTestId('ai-usage-export-csv-button'));

    await waitFor(() => {
      expect(screen.getByTestId('ai-usage-export-error')).toBeInTheDocument();
    });

    exportSpy.mockRestore();
  });
});
