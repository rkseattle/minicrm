/**
 * Tests for TokenBudgetWarningBanner component. (MINCRM-458)
 *
 * Covers:
 *  - Loading state: renders nothing
 *  - Error state: renders nothing
 *  - status='ok': renders nothing
 *  - status='warning': renders amber warning banner
 *  - status='exceeded': renders red exceeded banner with prescribed message
 */

import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup.js';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import TokenBudgetWarningBanner from './TokenBudgetWarningBanner.js';

describe('TokenBudgetWarningBanner — loading state', () => {
  it('renders nothing while the budget status is loading', () => {
    server.use(
      http.get(
        '/api/v1/ai/token-budget/me',
        () =>
          new Promise(() => {
            /* never resolves */
          }),
      ),
    );
    const { container } = renderWithProviders(<TokenBudgetWarningBanner />);
    expect(container.firstChild).toBeNull();
  });
});

describe('TokenBudgetWarningBanner — error state', () => {
  it('renders nothing on fetch error', async () => {
    server.use(
      http.get('/api/v1/ai/token-budget/me', () => new HttpResponse(null, { status: 500 })),
    );
    const { container } = renderWithProviders(<TokenBudgetWarningBanner />);
    // Give the query time to fail and re-render.
    await new Promise((r) => setTimeout(r, 50));
    expect(container.firstChild).toBeNull();
  });
});

describe('TokenBudgetWarningBanner — ok status', () => {
  it('renders nothing when status is ok', async () => {
    server.use(
      http.get('/api/v1/ai/token-budget/me', () =>
        HttpResponse.json({ limit: 100_000, used: 40_000, percentage: 40, status: 'ok' }),
      ),
    );
    const { container } = renderWithProviders(<TokenBudgetWarningBanner />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.firstChild).toBeNull();
  });
});

describe('TokenBudgetWarningBanner — warning status', () => {
  it('renders amber warning banner at 80%', async () => {
    server.use(
      http.get('/api/v1/ai/token-budget/me', () =>
        HttpResponse.json({ limit: 100_000, used: 85_000, percentage: 85, status: 'warning' }),
      ),
    );
    renderWithProviders(<TokenBudgetWarningBanner />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-budget-warning-banner')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('ai-budget-exceeded-banner')).not.toBeInTheDocument();
  });

  it('warning banner contains the percentage', async () => {
    server.use(
      http.get('/api/v1/ai/token-budget/me', () =>
        HttpResponse.json({ limit: 100_000, used: 90_000, percentage: 90, status: 'warning' }),
      ),
    );
    renderWithProviders(<TokenBudgetWarningBanner />);
    await waitFor(() => {
      const banner = screen.getByTestId('ai-budget-warning-banner');
      expect(banner.textContent).toContain('90');
    });
  });
});

describe('TokenBudgetWarningBanner — exceeded status', () => {
  it('renders red exceeded banner at 100%', async () => {
    server.use(
      http.get('/api/v1/ai/token-budget/me', () =>
        HttpResponse.json({ limit: 100_000, used: 100_000, percentage: 100, status: 'exceeded' }),
      ),
    );
    renderWithProviders(<TokenBudgetWarningBanner />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-budget-exceeded-banner')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('ai-budget-warning-banner')).not.toBeInTheDocument();
  });

  it('exceeded banner contains the prescribed message text', async () => {
    server.use(
      http.get('/api/v1/ai/token-budget/me', () =>
        HttpResponse.json({ limit: 100_000, used: 100_000, percentage: 100, status: 'exceeded' }),
      ),
    );
    renderWithProviders(<TokenBudgetWarningBanner />);
    await waitFor(() => {
      const banner = screen.getByTestId('ai-budget-exceeded-banner');
      expect(banner.textContent).toContain("You've reached your monthly AI limit");
    });
  });
});
