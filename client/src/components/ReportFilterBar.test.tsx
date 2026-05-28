import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import ReportFilterBar from './ReportFilterBar.js';
import type { ReportFilters } from '@/hooks/useReportFilters.js';

function makeFilters(overrides: Partial<ReportFilters> = {}): ReportFilters {
  return {
    preset: 'currentMonth',
    setPreset: vi.fn(),
    customStart: '2025-01-01',
    setCustomStart: vi.fn(),
    customEnd: '2025-01-31',
    setCustomEnd: vi.fn(),
    resolvedStart: '2025-01-01',
    resolvedEnd: '2025-01-31',
    viewMode: 'team',
    setViewMode: vi.fn(),
    selectedOwnerId: '',
    setSelectedOwnerId: vi.fn(),
    activeUsers: [{ id: 'rep-1', name: 'Rep One' }],
    effectiveOwnerId: undefined,
    isAdmin: false,
    ...overrides,
  };
}

describe('ReportFilterBar', () => {
  it('renders date preset selector with provided presets', () => {
    renderWithProviders(
      <ReportFilterBar
        filters={makeFilters()}
        i18nPrefix="reports.winLoss"
        availablePresets={['currentMonth', 'currentQuarter', 'custom']}
      />,
    );
    const select = screen.getByTestId('date-preset-select');
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue('currentMonth');
  });

  it('does not render view-mode toggle or owner filter for non-admin users', () => {
    renderWithProviders(
      <ReportFilterBar filters={makeFilters({ isAdmin: false })} i18nPrefix="reports.winLoss" />,
    );
    expect(screen.queryByTestId('view-mode-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('owner-filter-select')).not.toBeInTheDocument();
  });

  it('renders view-mode toggle and owner filter for admin users', () => {
    renderWithProviders(
      <ReportFilterBar filters={makeFilters({ isAdmin: true })} i18nPrefix="reports.winLoss" />,
    );
    expect(screen.getByTestId('view-mode-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('owner-filter-select')).toBeInTheDocument();
  });

  it('does not render custom date inputs when preset is not custom', () => {
    renderWithProviders(
      <ReportFilterBar
        filters={makeFilters({ preset: 'currentMonth' })}
        i18nPrefix="reports.winLoss"
      />,
    );
    expect(screen.queryByTestId('custom-start-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('custom-end-input')).not.toBeInTheDocument();
  });

  it('renders custom date inputs when preset is custom', () => {
    renderWithProviders(
      <ReportFilterBar filters={makeFilters({ preset: 'custom' })} i18nPrefix="reports.winLoss" />,
    );
    expect(screen.getByTestId('custom-start-input')).toBeInTheDocument();
    expect(screen.getByTestId('custom-end-input')).toBeInTheDocument();
  });

  it('shows date range error when custom start > end', () => {
    renderWithProviders(
      <ReportFilterBar
        filters={makeFilters({
          preset: 'custom',
          resolvedStart: '2025-02-01',
          resolvedEnd: '2025-01-01',
        })}
        i18nPrefix="reports.winLoss"
      />,
    );
    expect(screen.getByTestId('date-range-error')).toBeInTheDocument();
  });

  it('calls setPreset when preset selector changes', () => {
    const setPreset = vi.fn();
    renderWithProviders(
      <ReportFilterBar
        filters={makeFilters({ setPreset })}
        i18nPrefix="reports.winLoss"
        availablePresets={['currentMonth', 'currentQuarter', 'custom']}
      />,
    );
    fireEvent.change(screen.getByTestId('date-preset-select'), {
      target: { value: 'currentQuarter' },
    });
    expect(setPreset).toHaveBeenCalledWith('currentQuarter');
  });

  it('calls setViewMode when toggle buttons are clicked (admin)', () => {
    const setViewMode = vi.fn();
    renderWithProviders(
      <ReportFilterBar
        filters={makeFilters({ isAdmin: true, setViewMode })}
        i18nPrefix="reports.winLoss"
      />,
    );
    fireEvent.click(screen.getByTestId('view-mode-my'));
    expect(setViewMode).toHaveBeenCalledWith('my');
  });
});
