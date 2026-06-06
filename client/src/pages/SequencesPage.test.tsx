/**
 * Tests for SequencesPage component.
 * Covers loading, error, empty, and populated states plus create/delete interactions.
 * (MINCRM-403)
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import SequencesPage from './SequencesPage.js';

// Resolve feature flags synchronously so the page's own loading/error/empty states are testable.
vi.mock('@/hooks/useFeatureFlag.js', () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
  useFeatureFlags: () => ({ flags: {}, isLoading: false }),
}));
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import { SEQUENCE_1 } from '../test/msw/handlers.js';

describe('SequencesPage', () => {
  // ── Loading state ────────────────────────────────────────────────────────────

  it('shows a loading indicator while the sequences are fetching', () => {
    server.use(
      http.get('/api/v1/sequences', async () => {
        await new Promise(() => {}); // never resolves
        return HttpResponse.json({});
      }),
    );
    renderWithProviders(<SequencesPage />);
    expect(screen.getByTestId('sequences-loading')).toBeInTheDocument();
  });

  // ── Error state ──────────────────────────────────────────────────────────────

  it('shows an error alert when the API call fails', async () => {
    server.use(
      http.get('/api/v1/sequences', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Server error' } },
          { status: 500 },
        ),
      ),
    );
    renderWithProviders(<SequencesPage />);
    await waitFor(() => {
      expect(screen.getByTestId('sequences-error')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  // ── Empty state ──────────────────────────────────────────────────────────────

  it('shows an empty state when no sequences are returned', async () => {
    server.use(
      http.get('/api/v1/sequences', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 }),
      ),
    );
    renderWithProviders(<SequencesPage />);
    await waitFor(() => {
      // EmptyState rendered (no table rows present)
      expect(screen.queryByRole('row')).not.toBeInTheDocument();
    });
  });

  // ── Populated state ──────────────────────────────────────────────────────────

  it('renders the page heading', async () => {
    renderWithProviders(<SequencesPage />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });
  });

  it('renders a row for each returned sequence', async () => {
    renderWithProviders(<SequencesPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`sequence-row-${SEQUENCE_1.id}`)).toBeInTheDocument();
      expect(screen.getByText(SEQUENCE_1.name)).toBeInTheDocument();
    });
  });

  it('renders the New Sequence button', async () => {
    renderWithProviders(<SequencesPage />);
    await waitFor(() => {
      expect(screen.getByTestId('new-sequence-button')).toBeInTheDocument();
    });
  });

  it('renders the enable/disable toggle for each sequence', async () => {
    renderWithProviders(<SequencesPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`sequence-toggle-${SEQUENCE_1.id}`)).toBeInTheDocument();
    });
  });

  it('renders the delete button for each sequence', async () => {
    renderWithProviders(<SequencesPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`sequence-delete-${SEQUENCE_1.id}`)).toBeInTheDocument();
    });
  });

  // ── Create form interactions ──────────────────────────────────────────────────

  it('shows the create form when New Sequence is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SequencesPage />);
    await waitFor(() => {
      expect(screen.getByTestId('new-sequence-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('new-sequence-button'));
    expect(screen.getByTestId('create-sequence-form')).toBeInTheDocument();
  });

  it('hides the create form when Cancel is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SequencesPage />);
    await waitFor(() => {
      expect(screen.getByTestId('new-sequence-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('new-sequence-button'));
    expect(screen.getByTestId('create-sequence-form')).toBeInTheDocument();

    // Find and click Cancel button within the form
    const form = screen.getByTestId('create-sequence-form');
    const cancelButton = form.querySelector('button[type="button"]') as HTMLButtonElement;
    await user.click(cancelButton);

    expect(screen.queryByTestId('create-sequence-form')).not.toBeInTheDocument();
  });

  it('submits the create form and hides it on success', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SequencesPage />);
    await waitFor(() => {
      expect(screen.getByTestId('new-sequence-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('new-sequence-button'));

    await user.type(screen.getByTestId('sequence-name-input'), 'My New Sequence');
    await user.click(screen.getByTestId('create-sequence-submit'));

    await waitFor(() => {
      expect(screen.queryByTestId('create-sequence-form')).not.toBeInTheDocument();
    });
  });

  it('shows an error message when sequence creation fails', async () => {
    server.use(
      http.post('/api/v1/sequences', () =>
        HttpResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Name is already taken' } },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<SequencesPage />);
    await waitFor(() => {
      expect(screen.getByTestId('new-sequence-button')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('new-sequence-button'));
    await user.type(screen.getByTestId('sequence-name-input'), 'Duplicate');
    await user.click(screen.getByTestId('create-sequence-submit'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Name is already taken');
    });
  });
});
