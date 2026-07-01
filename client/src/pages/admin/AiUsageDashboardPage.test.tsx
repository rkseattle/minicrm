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

  it('shows the empty state when there is no daily data', async () => {
    server.use(
      http.get('/api/v1/admin/ai/usage/daily', () =>
        HttpResponse.json({
          range_start: '2026-06-01T00:00:00.000Z',
          range_end: '2026-07-01T00:00:00.000Z',
          points: [],
        }),
      ),
    );
    renderWithProviders(<AiUsageDashboardPage />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-usage-daily-empty')).toBeInTheDocument();
    });
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
});

describe('AiUsageDashboardPage — CSV export', () => {
  it('calls exportAiUsageCsv with the current date range when clicked', async () => {
    const exportSpy = vi.spyOn(aiApi, 'exportAiUsageCsv').mockResolvedValue(undefined);

    renderWithProviders(<AiUsageDashboardPage />);
    await waitFor(() => screen.getByTestId('ai-usage-export-csv-button'));

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
    await waitFor(() => screen.getByTestId('ai-usage-export-csv-button'));

    fireEvent.click(screen.getByTestId('ai-usage-export-csv-button'));

    await waitFor(() => {
      expect(screen.getByTestId('ai-usage-export-error')).toBeInTheDocument();
    });

    exportSpy.mockRestore();
  });
});
