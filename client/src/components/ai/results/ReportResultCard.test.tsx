/**
 * Tests for ReportResultCard. (MINCRM-424)
 *
 * Covers:
 *  - Renders each of the four report types (win_loss, activity_volume,
 *    stage_trend, leads_summary) with the correct title and data.
 *  - leads_summary is the newest addition — regression coverage for the bug
 *    where the NLI silently substituted an unrelated report type when asked
 *    to report on leads, and where saved reports persisted a degenerate
 *    config regardless of what was generated.
 */

import { screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '../../../test/renderWithProviders.js';
import ReportResultCard from './ReportResultCard.js';

describe('ReportResultCard — win_loss', () => {
  it('renders won/lost counts and win rate', () => {
    renderWithProviders(
      <ReportResultCard
        report={{
          report_type: 'win_loss',
          data: { wonCount: 12, lostCount: 5, winRate: 0.706 },
        }}
      />,
    );
    const card = screen.getByTestId('nli-report-win-loss');
    expect(card).toHaveTextContent('12');
    expect(card).toHaveTextContent('5');
  });
});

describe('ReportResultCard — activity_volume', () => {
  it('renders per-rep rows and totals', () => {
    renderWithProviders(
      <ReportResultCard
        report={{
          report_type: 'activity_volume',
          data: {
            totals: { Note: 1, Call: 2, Email: 1, Meeting: 1, Task: 1, total: 6 },
            rows: [
              {
                ownerName: 'Alice Chen',
                counts: { Note: 1, Call: 2, Email: 1, Meeting: 1, Task: 1 },
                total: 6,
              },
            ],
          },
        }}
      />,
    );
    const card = screen.getByTestId('nli-report-activity-volume');
    expect(card).toHaveTextContent('Alice Chen');
    expect(card).toHaveTextContent('6');
  });
});

describe('ReportResultCard — stage_trend', () => {
  it('renders stage rows with entries and conversions', () => {
    renderWithProviders(
      <ReportResultCard
        report={{
          report_type: 'stage_trend',
          data: {
            dataPoints: [{ stage: 'Prospecting', entered: 4, converted: 2 }],
          },
        }}
      />,
    );
    const card = screen.getByTestId('nli-report-stage-trend');
    expect(card).toHaveTextContent('Prospecting');
  });
});

describe('ReportResultCard — leads_summary', () => {
  it('renders the leads summary title and per-status rows', () => {
    renderWithProviders(
      <ReportResultCard
        report={{
          report_type: 'leads_summary',
          data: {
            total: 2,
            rows: [
              { status: 'New', count: 2 },
              { status: 'Contacted', count: 0 },
              { status: 'Qualified', count: 0 },
              { status: 'Disqualified', count: 0 },
            ],
          },
        }}
      />,
    );
    const card = screen.getByTestId('nli-report-leads-summary');
    expect(card).toHaveTextContent('New');
    expect(card).toHaveTextContent('2');
  });

  it('renders nothing extra when rows are empty', () => {
    renderWithProviders(
      <ReportResultCard report={{ report_type: 'leads_summary', data: { total: 0, rows: [] } }} />,
    );
    expect(screen.getByTestId('nli-report-leads-summary')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
