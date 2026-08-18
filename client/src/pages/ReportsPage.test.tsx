/**
 * Tests for ReportsPage — the adaptive sub-navigation shell.
 *
 * Covers:
 * - Default view (win-loss) when no URL param or localStorage
 * - URL param takes precedence over localStorage
 * - localStorage restores last-viewed report when no URL param
 * - Invalid URL param falls back to win-loss
 * - Tab selection updates rendered content
 * - Page heading is always visible
 * - SubPageNav tab list is rendered
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ReportsPage from './ReportsPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';

const LOCALSTORAGE_KEY = 'minicrm_reports_last_view';

/** In-memory localStorage substitute for tests. */
function makeLocalStorageMock() {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach((key) => delete store[key]);
    }),
  };
}

function renderReportsPage(search = '') {
  return renderWithProviders(<ReportsPage />, {
    initialEntries: [`/reports${search}`],
    path: '/reports',
  });
}

describe('ReportsPage', () => {
  let localStorageMock: ReturnType<typeof makeLocalStorageMock>;

  beforeEach(() => {
    localStorageMock = makeLocalStorageMock();
    vi.stubGlobal('localStorage', localStorageMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the page heading', async () => {
    renderReportsPage();
    await waitFor(() => {
      expect(screen.getByTestId('reports-page-heading')).toBeInTheDocument();
    });
  });

  it('renders the SubPageNav tab list', async () => {
    renderReportsPage();
    await waitFor(() => {
      expect(screen.getByTestId('reports-tab-list')).toBeInTheDocument();
    });
  });

  it('renders three nav items', async () => {
    renderReportsPage();
    await waitFor(() => {
      expect(screen.getByTestId('reports-tab-win-loss')).toBeInTheDocument();
      expect(screen.getByTestId('reports-tab-activity')).toBeInTheDocument();
      expect(screen.getByTestId('reports-tab-pipeline-stage')).toBeInTheDocument();
    });
  });

  it('defaults to win-loss content when no URL param or localStorage', async () => {
    renderReportsPage();
    await waitFor(() => {
      expect(screen.getByTestId('win-loss-report-heading')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('activity-volume-report-heading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stage-trend-report-heading')).not.toBeInTheDocument();
  });

  it('shows activity content when ?view=activity is in the URL', async () => {
    renderReportsPage('?view=activity');
    await waitFor(() => {
      expect(screen.getByTestId('activity-volume-report-heading')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('win-loss-report-heading')).not.toBeInTheDocument();
  });

  it('shows pipeline-stage content when ?view=pipeline-stage is in the URL', async () => {
    renderReportsPage('?view=pipeline-stage');
    await waitFor(() => {
      expect(screen.getByTestId('stage-trend-report-heading')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('win-loss-report-heading')).not.toBeInTheDocument();
  });

  it('URL param takes priority over localStorage', async () => {
    localStorageMock.setItem(LOCALSTORAGE_KEY, 'activity');
    renderReportsPage('?view=pipeline-stage');
    await waitFor(() => {
      expect(screen.getByTestId('stage-trend-report-heading')).toBeInTheDocument();
    });
  });

  it('restores last-viewed report from localStorage when no URL param', async () => {
    localStorageMock.setItem(LOCALSTORAGE_KEY, 'activity');
    renderReportsPage();
    await waitFor(() => {
      expect(screen.getByTestId('activity-volume-report-heading')).toBeInTheDocument();
    });
  });

  it('falls back to win-loss when URL param is unrecognised', async () => {
    renderReportsPage('?view=unknown-report');
    await waitFor(() => {
      expect(screen.getByTestId('win-loss-report-heading')).toBeInTheDocument();
    });
  });

  it('falls back to win-loss when localStorage contains an invalid value', async () => {
    localStorageMock.setItem(LOCALSTORAGE_KEY, 'not-a-valid-view');
    renderReportsPage();
    await waitFor(() => {
      expect(screen.getByTestId('win-loss-report-heading')).toBeInTheDocument();
    });
  });

  it('clicking the activity tab switches to activity content', async () => {
    const user = userEvent.setup();
    renderReportsPage('?view=win-loss');

    await waitFor(() => {
      expect(screen.getByTestId('reports-tab-activity')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('reports-tab-activity'));

    await waitFor(() => {
      expect(screen.getByTestId('activity-volume-report-heading')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('win-loss-report-heading')).not.toBeInTheDocument();
  });

  it('clicking the pipeline-stage tab switches to stage trend content', async () => {
    const user = userEvent.setup();
    renderReportsPage('?view=win-loss');

    await waitFor(() => {
      expect(screen.getByTestId('reports-tab-pipeline-stage')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('reports-tab-pipeline-stage'));

    await waitFor(() => {
      expect(screen.getByTestId('stage-trend-report-heading')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('win-loss-report-heading')).not.toBeInTheDocument();
  });

  it('clicking a tab persists to localStorage', async () => {
    const user = userEvent.setup();
    renderReportsPage('?view=win-loss');

    await waitFor(() => {
      expect(screen.getByTestId('reports-tab-activity')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('reports-tab-activity'));

    await waitFor(() => {
      expect(screen.getByTestId('activity-volume-report-heading')).toBeInTheDocument();
    });

    expect(localStorageMock.getItem(LOCALSTORAGE_KEY)).toBe('activity');
  });
});
