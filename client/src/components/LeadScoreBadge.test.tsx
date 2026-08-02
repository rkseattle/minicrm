/**
 * Tests for the LeadScoreBadge component. (MINCRM-441 prerequisite)
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import LeadScoreBadge from './LeadScoreBadge.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { allFlagsEnabled } from '../test/msw/handlers.js';
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

  // MINCRM-441: AI lead score narrative explanation
  describe('score narrative', () => {
    it('fetches and shows the narrative when "Why this score?" is clicked', async () => {
      server.use(
        http.get('/api/v1/leads/:id/score', () =>
          HttpResponse.json({ score: 62, factors: [], insufficient_data: false }),
        ),
        http.post('/api/v1/leads/:id/score-narrative', () =>
          HttpResponse.json({
            narrative: 'This lead scores well because of a strong referral source.',
            insufficient_data: false,
            generated_at: '2026-07-05T00:00:00.000Z',
          }),
        ),
      );

      const user = userEvent.setup();
      renderWithProviders(<LeadScoreBadge leadId="lead-1" />);

      await waitFor(() => {
        expect(screen.getByTestId('lead-score-why-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('lead-score-why-button'));

      await waitFor(() => {
        expect(screen.getByTestId('lead-score-narrative')).toHaveTextContent(
          'strong referral source',
        );
      });
      expect(screen.queryByTestId('lead-score-why-button')).not.toBeInTheDocument();
    });

    it('shows the insufficient-data message when the AI reports it', async () => {
      server.use(
        http.get('/api/v1/leads/:id/score', () =>
          HttpResponse.json({ score: 5, factors: [], insufficient_data: true }),
        ),
        http.post('/api/v1/leads/:id/score-narrative', () =>
          HttpResponse.json({
            narrative: '',
            insufficient_data: true,
            generated_at: '2026-07-05T00:00:00.000Z',
          }),
        ),
      );

      const user = userEvent.setup();
      renderWithProviders(<LeadScoreBadge leadId="lead-1" />);

      await waitFor(() => {
        expect(screen.getByTestId('lead-score-why-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('lead-score-why-button'));

      await waitFor(() => {
        expect(screen.getByTestId('lead-score-narrative')).toHaveTextContent(
          'Not enough activity data',
        );
      });
    });

    it('shows an error when narrative generation fails', async () => {
      server.use(
        http.get('/api/v1/leads/:id/score', () =>
          HttpResponse.json({ score: 62, factors: [], insufficient_data: false }),
        ),
        http.post('/api/v1/leads/:id/score-narrative', () =>
          HttpResponse.json(
            { error: { code: 'AI_PROVIDER_ERROR', message: 'AI provider error' } },
            { status: 502 },
          ),
        ),
      );

      const user = userEvent.setup();
      renderWithProviders(<LeadScoreBadge leadId="lead-1" />);

      await waitFor(() => {
        expect(screen.getByTestId('lead-score-why-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('lead-score-why-button'));

      await waitFor(() => {
        expect(screen.getByTestId('lead-score-narrative-error')).toBeInTheDocument();
      });
    });

    it('hides the "Why this score?" button when the narrative flag is disabled', async () => {
      server.use(
        // Full map with ONE flag overridden, not a single-key map. Flags now
        // default OFF when absent, so a partial map would also switch off
        // ai_lead_scoring and the badge this test needs in order to assert the
        // narrative button's absence. (MINCRM-701)
        http.get('/api/v1/feature-flags/me', () =>
          HttpResponse.json({ flags: { ...allFlagsEnabled(), ai_lead_score_narrative: false } }),
        ),
        http.get('/api/v1/leads/:id/score', () =>
          HttpResponse.json({ score: 62, factors: [], insufficient_data: false }),
        ),
      );

      renderWithProviders(<LeadScoreBadge leadId="lead-1" />);

      await waitFor(() => {
        expect(screen.getByTestId('lead-score-badge')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('lead-score-why-button')).not.toBeInTheDocument();
    });
  });
});
