/**
 * Tests for ActivityBriefPage component.
 * Covers loading, not-found, and populated states for the shareable brief link.
 */

import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

// Resolve feature flags synchronously so the page's own loading/error states are testable.
vi.mock('@/hooks/useFeatureFlag.js', () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
  useFeatureFlags: () => ({ flags: {}, isLoading: false }),
}));
import ActivityBriefPage from './ActivityBriefPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';

const ACTIVITY_ID = '00000000-0000-0000-0000-000000000401';
const BRIEF_ROUTE = '/activities/:id/brief';
const BRIEF_URL = `/activities/${ACTIVITY_ID}/brief`;

describe('ActivityBriefPage', () => {
  it('shows a loading indicator while the brief is fetching', () => {
    server.use(
      http.get(`/api/v1/activities/${ACTIVITY_ID}/brief`, async () => {
        await new Promise(() => {}); // never resolves
        return HttpResponse.json({});
      }),
    );
    renderWithProviders(<ActivityBriefPage />, { initialEntries: [BRIEF_URL], path: BRIEF_ROUTE });
    expect(screen.getByTestId('activity-brief-loading')).toBeInTheDocument();
  });

  it('shows a not-found message when no brief has been generated', async () => {
    renderWithProviders(<ActivityBriefPage />, { initialEntries: [BRIEF_URL], path: BRIEF_ROUTE });
    await waitFor(() => {
      expect(screen.getByTestId('activity-brief-error')).toBeInTheDocument();
    });
  });

  it('renders the brief content once loaded', async () => {
    server.use(
      http.get(`/api/v1/activities/${ACTIVITY_ID}/brief`, () =>
        HttpResponse.json({
          activity_id: ACTIVITY_ID,
          brief: {
            contact_snapshot: {
              name: 'Jane Doe',
              title: 'VP Sales',
              company: 'Acme',
              contact_since: '2025-01-01T00:00:00.000Z',
              last_interaction_at: null,
            },
            account_summary: 'Growing account, strong engagement.',
            open_opportunities: [],
            recent_activity_summary: [],
            suggested_talking_points: ['Confirm budget owner.'],
            known_objections: [],
          },
          generated_by: '00000000-0000-0000-0000-000000000001',
          generated_at: '2026-07-01T00:00:00.000Z',
        }),
      ),
    );

    renderWithProviders(<ActivityBriefPage />, { initialEntries: [BRIEF_URL], path: BRIEF_ROUTE });

    await waitFor(() => {
      expect(screen.getByTestId('activity-brief-page')).toBeInTheDocument();
    });
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('Growing account, strong engagement.')).toBeInTheDocument();
    expect(screen.getByText('Confirm budget owner.')).toBeInTheDocument();
  });
});
