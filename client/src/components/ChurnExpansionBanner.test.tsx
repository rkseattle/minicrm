/**
 * Tests for the ChurnExpansionBanner component. (MINCRM-469)
 */

import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import ChurnExpansionBanner from './ChurnExpansionBanner.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';

describe('ChurnExpansionBanner', () => {
  it('renders nothing when there is no active signal', async () => {
    const { container } = renderWithProviders(<ChurnExpansionBanner accountId="a1" />);
    await waitFor(() => {
      expect(container.querySelector('[role="alert"]')).not.toBeInTheDocument();
    });
  });

  it('renders the churn-risk banner with contributing factors', async () => {
    server.use(
      http.get('/api/v1/accounts/:id/churn-expansion-signal', () =>
        HttpResponse.json({
          signal: {
            id: 's1',
            signal_type: 'churn_risk',
            confidence: 0.9,
            contributing_factors: [{ description: 'No activity logged in 45 days' }],
            detected_at: '2026-07-01T04:00:00.000Z',
          },
        }),
      ),
    );
    renderWithProviders(<ChurnExpansionBanner accountId="a1" />);
    await waitFor(() => {
      expect(screen.getByTestId('churn-risk-banner')).toBeInTheDocument();
    });
    expect(screen.getByText('No activity logged in 45 days')).toBeInTheDocument();
  });

  it('renders the expansion banner variant', async () => {
    server.use(
      http.get('/api/v1/accounts/:id/churn-expansion-signal', () =>
        HttpResponse.json({
          signal: {
            id: 's2',
            signal_type: 'expansion',
            confidence: 0.8,
            contributing_factors: [{ description: 'New team mentioned in notes' }],
            detected_at: '2026-07-01T04:00:00.000Z',
          },
        }),
      ),
    );
    renderWithProviders(<ChurnExpansionBanner accountId="a1" />);
    await waitFor(() => {
      expect(screen.getByTestId('expansion-signal-banner')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('churn-risk-banner')).not.toBeInTheDocument();
  });

  it('renders nothing when the feature flag is disabled', async () => {
    server.use(
      http.get('/api/v1/feature-flags/me', () =>
        HttpResponse.json({ flags: { ai_churn_expansion_detection: false } }),
      ),
      http.get('/api/v1/accounts/:id/churn-expansion-signal', () =>
        HttpResponse.json({
          signal: {
            id: 's1',
            signal_type: 'churn_risk',
            confidence: 0.9,
            contributing_factors: [{ description: 'Should not render' }],
            detected_at: '2026-07-01T04:00:00.000Z',
          },
        }),
      ),
    );
    const { container } = renderWithProviders(<ChurnExpansionBanner accountId="a1" />);
    await waitFor(() => {
      expect(container.querySelector('[role="alert"]')).not.toBeInTheDocument();
    });
  });
});
