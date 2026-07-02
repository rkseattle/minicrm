/**
 * Tests for the ObjectionInsights component. (MINCRM-471)
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import ObjectionInsights from './ObjectionInsights.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';

describe('ObjectionInsights', () => {
  it('renders nothing when the activity has no notes', async () => {
    const { container } = renderWithProviders(
      <ObjectionInsights activityId="a1" hasNotes={false} />,
    );
    await waitFor(() => {
      expect(
        container.querySelector('[data-testid^="objection-category-badge"]'),
      ).not.toBeInTheDocument();
    });
  });

  it('renders nothing when no objection is detected', async () => {
    const { container } = renderWithProviders(
      <ObjectionInsights activityId="a1" hasNotes={true} />,
    );
    await waitFor(() => {
      expect(
        container.querySelector('[data-testid^="objection-category-badge"]'),
      ).not.toBeInTheDocument();
    });
  });

  it('renders the category badge when an objection is classified', async () => {
    server.use(
      http.post('/api/v1/activities/:id/classify-objection', () =>
        HttpResponse.json({ activity_id: 'a1', category: 'Price' }),
      ),
    );
    renderWithProviders(<ObjectionInsights activityId="a1" hasNotes={true} />);
    await waitFor(() => {
      expect(screen.getByTestId('objection-category-badge-a1')).toHaveTextContent('Price');
    });
  });

  it('shows insufficient-data messaging when the precedent panel is opened without enough history', async () => {
    server.use(
      http.post('/api/v1/activities/:id/classify-objection', () =>
        HttpResponse.json({ activity_id: 'a1', category: 'Price' }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<ObjectionInsights activityId="a1" hasNotes={true} />);
    await waitFor(() => {
      expect(screen.getByTestId('objection-category-badge-a1')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('objection-precedents-toggle-a1'));

    await waitFor(() => {
      expect(screen.getByTestId('objection-precedents-insufficient-a1')).toBeInTheDocument();
    });
  });

  it('shows precedents when sufficient data exists', async () => {
    server.use(
      http.post('/api/v1/activities/:id/classify-objection', () =>
        HttpResponse.json({ activity_id: 'a1', category: 'Price' }),
      ),
      http.get('/api/v1/activities/:id/objection-precedents', () =>
        HttpResponse.json({
          category: 'Price',
          precedents: [
            {
              deal_id: 'd1',
              deal_name: 'Acme Deal',
              objection_quote: 'Too expensive for our budget',
              response_summary: 'Offered a phased rollout to fit the budget',
              time_to_close_days: 14,
            },
          ],
          has_sufficient_data: true,
          min_closed_won_deals_required: 10,
          closed_won_deals_count: 15,
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<ObjectionInsights activityId="a1" hasNotes={true} />);
    await waitFor(() => {
      expect(screen.getByTestId('objection-category-badge-a1')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('objection-precedents-toggle-a1'));

    await waitFor(() => {
      expect(screen.getByTestId('objection-precedents-list-a1')).toBeInTheDocument();
    });
    expect(screen.getByText('Acme Deal')).toBeInTheDocument();
    expect(screen.getByText(/Too expensive for our budget/)).toBeInTheDocument();
  });

  it('shows an empty-precedents message when the category has sufficient data but no matches', async () => {
    server.use(
      http.post('/api/v1/activities/:id/classify-objection', () =>
        HttpResponse.json({ activity_id: 'a1', category: 'Risk' }),
      ),
      http.get('/api/v1/activities/:id/objection-precedents', () =>
        HttpResponse.json({
          category: 'Risk',
          precedents: [],
          has_sufficient_data: true,
          min_closed_won_deals_required: 10,
          closed_won_deals_count: 15,
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<ObjectionInsights activityId="a1" hasNotes={true} />);
    await waitFor(() => {
      expect(screen.getByTestId('objection-category-badge-a1')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('objection-precedents-toggle-a1'));

    await waitFor(() => {
      expect(screen.getByTestId('objection-precedents-empty-a1')).toBeInTheDocument();
    });
  });

  it('renders nothing when the feature flag is disabled', async () => {
    server.use(
      http.get('/api/v1/feature-flags/me', () =>
        HttpResponse.json({ flags: { ai_objection_pattern_matching: false } }),
      ),
      http.post('/api/v1/activities/:id/classify-objection', () =>
        HttpResponse.json({ activity_id: 'a1', category: 'Price' }),
      ),
    );
    const { container } = renderWithProviders(
      <ObjectionInsights activityId="a1" hasNotes={true} />,
    );
    await waitFor(() => {
      expect(
        container.querySelector('[data-testid^="objection-category-badge"]'),
      ).not.toBeInTheDocument();
    });
  });
});
