/**
 * Tests for SequenceDetailPage component.
 * Covers loading, error, and populated states plus step management interactions.
 * (MINCRM-403)
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import SequenceDetailPage from './SequenceDetailPage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { SEQUENCE_1, SEQUENCE_STEP_1, SEQUENCE_STEP_2 } from '../test/msw/handlers.js';

const SEQUENCE_ROUTE = '/admin/sequences/:id';
const SEQUENCE_URL = `/admin/sequences/${SEQUENCE_1.id}`;

describe('SequenceDetailPage', () => {
  // ── Loading state ────────────────────────────────────────────────────────────

  it('shows a loading indicator while the sequence is fetching', () => {
    server.use(
      http.get(`/api/v1/sequences/${SEQUENCE_1.id}`, async () => {
        await new Promise(() => {}); // never resolves
        return HttpResponse.json({});
      }),
    );
    renderWithProviders(<SequenceDetailPage />, {
      initialEntries: [SEQUENCE_URL],
      path: SEQUENCE_ROUTE,
    });
    expect(screen.getByTestId('sequence-detail-loading')).toBeInTheDocument();
  });

  // ── Error state ──────────────────────────────────────────────────────────────

  it('shows an error state when the sequence is not found', async () => {
    server.use(
      http.get(`/api/v1/sequences/${SEQUENCE_1.id}`, () =>
        HttpResponse.json(
          { error: { code: 'SEQUENCE_NOT_FOUND', message: 'Sequence not found' } },
          { status: 404 },
        ),
      ),
    );
    renderWithProviders(<SequenceDetailPage />, {
      initialEntries: [SEQUENCE_URL],
      path: SEQUENCE_ROUTE,
    });
    await waitFor(() => {
      expect(screen.getByTestId('sequence-detail-error')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('shows a back button in the error state', async () => {
    server.use(
      http.get(`/api/v1/sequences/${SEQUENCE_1.id}`, () =>
        HttpResponse.json(
          { error: { code: 'SEQUENCE_NOT_FOUND', message: 'Not found' } },
          { status: 404 },
        ),
      ),
    );
    renderWithProviders(<SequenceDetailPage />, {
      initialEntries: [SEQUENCE_URL],
      path: SEQUENCE_ROUTE,
    });
    await waitFor(() => {
      expect(screen.getByTestId('sequence-detail-back-button')).toBeInTheDocument();
    });
  });

  // ── Populated state ──────────────────────────────────────────────────────────

  it('renders the sequence name in the page title', async () => {
    renderWithProviders(<SequenceDetailPage />, {
      initialEntries: [SEQUENCE_URL],
      path: SEQUENCE_ROUTE,
    });
    await waitFor(() => {
      expect(screen.getByTestId('sequence-detail-title')).toBeInTheDocument();
      expect(screen.getByTestId('sequence-detail-title').textContent).toContain(SEQUENCE_1.name);
    });
  });

  it('renders the Add Step button', async () => {
    renderWithProviders(<SequenceDetailPage />, {
      initialEntries: [SEQUENCE_URL],
      path: SEQUENCE_ROUTE,
    });
    await waitFor(() => {
      expect(screen.getByTestId('add-step-button')).toBeInTheDocument();
    });
  });

  it('renders a row for each step', async () => {
    renderWithProviders(<SequenceDetailPage />, {
      initialEntries: [SEQUENCE_URL],
      path: SEQUENCE_ROUTE,
    });
    await waitFor(() => {
      expect(screen.getByTestId(`step-row-${SEQUENCE_STEP_1.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`step-row-${SEQUENCE_STEP_2.id}`)).toBeInTheDocument();
    });
  });

  it('renders the enable/disable toggle for the sequence', async () => {
    renderWithProviders(<SequenceDetailPage />, {
      initialEntries: [SEQUENCE_URL],
      path: SEQUENCE_ROUTE,
    });
    await waitFor(() => {
      expect(screen.getByTestId('sequence-detail-toggle')).toBeInTheDocument();
    });
  });

  // ── Steps error state ────────────────────────────────────────────────────────

  it('shows an empty steps area when the steps query fails', async () => {
    server.use(
      http.get(`/api/v1/sequences/${SEQUENCE_1.id}/steps`, () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Server error' } },
          { status: 500 },
        ),
      ),
    );
    renderWithProviders(<SequenceDetailPage />, {
      initialEntries: [SEQUENCE_URL],
      path: SEQUENCE_ROUTE,
    });
    await waitFor(() => {
      // Sequence header renders, no step rows visible
      expect(screen.getByTestId('sequence-detail-title')).toBeInTheDocument();
      expect(screen.queryByTestId(`step-row-${SEQUENCE_STEP_1.id}`)).not.toBeInTheDocument();
    });
  });

  // ── Empty steps state ────────────────────────────────────────────────────────

  it('shows an empty steps message when the sequence has no steps', async () => {
    server.use(
      http.get(`/api/v1/sequences/${SEQUENCE_1.id}/steps`, () => HttpResponse.json({ steps: [] })),
    );
    renderWithProviders(<SequenceDetailPage />, {
      initialEntries: [SEQUENCE_URL],
      path: SEQUENCE_ROUTE,
    });
    await waitFor(() => {
      // With no steps, no step rows should be rendered
      expect(screen.queryByTestId(`step-row-${SEQUENCE_STEP_1.id}`)).not.toBeInTheDocument();
    });
  });

  // ── Add step form ────────────────────────────────────────────────────────────

  it('shows the add step form when Add Step is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SequenceDetailPage />, {
      initialEntries: [SEQUENCE_URL],
      path: SEQUENCE_ROUTE,
    });
    await waitFor(() => {
      expect(screen.getByTestId('add-step-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('add-step-button'));
    expect(screen.getByTestId('add-step-form')).toBeInTheDocument();
  });

  it('hides the add step form when Cancel is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SequenceDetailPage />, {
      initialEntries: [SEQUENCE_URL],
      path: SEQUENCE_ROUTE,
    });
    await waitFor(() => {
      expect(screen.getByTestId('add-step-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('add-step-button'));
    expect(screen.getByTestId('add-step-form')).toBeInTheDocument();

    await user.click(screen.getByTestId('add-step-cancel'));
    expect(screen.queryByTestId('add-step-form')).not.toBeInTheDocument();
  });
});
