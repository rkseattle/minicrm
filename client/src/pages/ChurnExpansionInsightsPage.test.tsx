/**
 * Tests for the ChurnExpansionInsightsPage component. (MINCRM-469)
 */

import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import ChurnExpansionInsightsPage from './ChurnExpansionInsightsPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';

function renderPage() {
  return renderWithProviders(<ChurnExpansionInsightsPage />, {
    initialEntries: ['/insights/churn-expansion'],
    path: '/insights/churn-expansion',
  });
}

describe('ChurnExpansionInsightsPage', () => {
  it('shows empty states when there are no active signals', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('at-risk-accounts-empty')).toBeInTheDocument();
    });
    expect(screen.getByTestId('expansion-accounts-empty')).toBeInTheDocument();
  });

  it('renders at-risk accounts', async () => {
    server.use(
      http.get('/api/v1/insights/churn-expansion', () =>
        HttpResponse.json({
          at_risk: [
            {
              account_id: 'acc-1',
              account_name: 'Acme Corp',
              owner_id: 'u1',
              signal: {
                id: 's1',
                signal_type: 'churn_risk',
                confidence: 0.9,
                contributing_factors: [{ description: 'No activity in 45 days' }],
                detected_at: '2026-07-01T04:00:00.000Z',
              },
            },
          ],
          expansion: [],
        }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('churn-expansion-account-acc-1')).toBeInTheDocument();
    });
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('No activity in 45 days')).toBeInTheDocument();
  });

  it('renders expansion accounts', async () => {
    server.use(
      http.get('/api/v1/insights/churn-expansion', () =>
        HttpResponse.json({
          at_risk: [],
          expansion: [
            {
              account_id: 'acc-2',
              account_name: 'Beta Inc',
              owner_id: 'u1',
              signal: {
                id: 's2',
                signal_type: 'expansion',
                confidence: 0.8,
                contributing_factors: [{ description: 'New team mentioned' }],
                detected_at: '2026-07-01T04:00:00.000Z',
              },
            },
          ],
        }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('churn-expansion-account-acc-2')).toBeInTheDocument();
    });
    expect(screen.getByText('Beta Inc')).toBeInTheDocument();
  });

  it('shows an error message when the request fails', async () => {
    server.use(
      http.get('/api/v1/insights/churn-expansion', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Failed' } },
          { status: 500 },
        ),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('churn-expansion-insights-error')).toBeInTheDocument();
    });
  });

  it('hides the page content when the flag is disabled', async () => {
    server.use(
      http.get('/api/v1/feature-flags/me', () =>
        HttpResponse.json({ flags: { ai_churn_expansion_detection: false } }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.queryByTestId('churn-expansion-insights-heading')).not.toBeInTheDocument();
    });
  });
});
