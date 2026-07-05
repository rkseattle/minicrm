/**
 * Tests for the LeadScoreBadge component. (MINCRM-441 prerequisite)
 */

import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import LeadScoreBadge from './LeadScoreBadge.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';

describe('LeadScoreBadge', () => {
  it('renders the computed score', async () => {
    server.use(
      http.get('/api/v1/leads/:id/score', () =>
        HttpResponse.json({
          score: 62,
          factors: [],
          insufficient_data: false,
        }),
      ),
    );

    renderWithProviders(<LeadScoreBadge leadId="lead-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('lead-score-badge')).toHaveTextContent('62');
    });
  });

  it('hides the badge when the flag is disabled', async () => {
    let scoreRequested = false;
    server.use(
      http.get('/api/v1/feature-flags/me', () =>
        HttpResponse.json({ flags: { ai_lead_scoring: false } }),
      ),
      http.get('/api/v1/leads/:id/score', () => {
        scoreRequested = true;
        return HttpResponse.json({ score: 62, factors: [], insufficient_data: false });
      }),
    );

    renderWithProviders(<LeadScoreBadge leadId="lead-1" />);

    // The query is disabled by the flag, so no request should ever be made —
    // wait on the flags fetch settling, then assert the badge never rendered.
    await waitFor(() => {
      expect(scoreRequested).toBe(false);
    });
    expect(screen.queryByTestId('lead-score-badge')).not.toBeInTheDocument();
  });
});
