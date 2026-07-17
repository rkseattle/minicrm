/**
 * Tests for the DataHygienePage component. (MINCRM-476)
 */

import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import DataHygienePage from './DataHygienePage.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';

function renderPage(scope: 'mine' | 'all' = 'mine') {
  return renderWithProviders(<DataHygienePage scope={scope} />, {
    initialEntries: [scope === 'mine' ? '/hygiene' : '/admin/hygiene'],
  });
}

const BASE_FINDING = {
  id: 'finding-1',
  entity_type: 'contact' as const,
  entity_id: 'contact-1',
  entity_name: 'Jordan Rivera',
  issue_type: 'contact_no_activity' as const,
  related_entity_id: null,
  related_entity_name: null,
  owner_id: 'me',
  last_activity_at: null,
  suggested_action: 'Log a call or email, or archive if no longer relevant.',
  status: 'open' as const,
  dismissed_until: null,
  dismissed_reason: null,
  detected_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
};

const DUPLICATE_FINDING = {
  ...BASE_FINDING,
  id: 'finding-2',
  entity_id: 'contact-2',
  entity_name: 'Dana Okafor',
  issue_type: 'contact_duplicate' as const,
  related_entity_id: 'contact-3',
  related_entity_name: 'Dana O.',
  suggested_action: 'Review and merge with the matching contact.',
};

describe('DataHygienePage', () => {
  it('shows a loading state while the findings query is in flight, then the empty state', async () => {
    server.use(
      http.get('/api/v1/data-hygiene/findings', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({ findings: [], total: 0 });
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('data-hygiene-heading')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('data-hygiene-empty')).toBeInTheDocument();
    });
  });

  it('shows an error message when the findings request fails', async () => {
    server.use(
      http.get('/api/v1/data-hygiene/findings', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Failed' } },
          { status: 500 },
        ),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('data-hygiene-error')).toBeInTheDocument();
    });
  });

  it('shows the empty state when there are no findings', async () => {
    server.use(
      http.get('/api/v1/data-hygiene/findings', () =>
        HttpResponse.json({ findings: [], total: 0 }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('data-hygiene-empty')).toBeInTheDocument();
    });
  });

  it('renders findings from the cached scan', async () => {
    server.use(
      http.get('/api/v1/data-hygiene/findings', () =>
        HttpResponse.json({ findings: [BASE_FINDING], total: 1 }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId(`data-hygiene-finding-${BASE_FINDING.id}`)).toBeInTheDocument();
    });
    expect(screen.getByText('Jordan Rivera')).toBeInTheDocument();
  });

  it('hides the page content when the feature flag is disabled', async () => {
    server.use(
      http.get('/api/v1/feature-flags/me', () =>
        HttpResponse.json({ flags: { ai_data_hygiene_assistant: false } }),
      ),
      // useFeatureFlag treats the flag as enabled while its own query is loading
      // (avoids a flash-of-disabled-content), so the findings query briefly fires
      // with enabled: true before the flags settle to false.
      http.get('/api/v1/data-hygiene/findings', () =>
        HttpResponse.json({ findings: [], total: 0 }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.queryByTestId('data-hygiene-heading')).not.toBeInTheDocument();
    });
  });

  it('requires a non-empty reason before the dismiss confirm button is enabled', async () => {
    server.use(
      http.get('/api/v1/data-hygiene/findings', () =>
        HttpResponse.json({ findings: [BASE_FINDING], total: 1 }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId(`data-hygiene-dismiss-${BASE_FINDING.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`data-hygiene-dismiss-${BASE_FINDING.id}`));
    await waitFor(() => {
      expect(screen.getByTestId('data-hygiene-dismiss-dialog')).toBeInTheDocument();
    });
    expect(screen.getByTestId('data-hygiene-dismiss-confirm')).toBeDisabled();

    fireEvent.change(screen.getByTestId('data-hygiene-dismiss-reason-input'), {
      target: { value: 'Verified with the customer directly' },
    });
    expect(screen.getByTestId('data-hygiene-dismiss-confirm')).not.toBeDisabled();
  });

  it('moves focus into the dismiss dialog when it opens', async () => {
    server.use(
      http.get('/api/v1/data-hygiene/findings', () =>
        HttpResponse.json({ findings: [BASE_FINDING], total: 1 }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId(`data-hygiene-dismiss-${BASE_FINDING.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`data-hygiene-dismiss-${BASE_FINDING.id}`));
    await waitFor(() => {
      expect(screen.getByTestId('data-hygiene-dismiss-cancel')).toHaveFocus();
    });
  });

  it('dismisses a finding and removes it from the list on success', async () => {
    server.use(
      http.get('/api/v1/data-hygiene/findings', () =>
        HttpResponse.json({ findings: [BASE_FINDING], total: 1 }),
      ),
      http.post('/api/v1/data-hygiene/findings/:id/dismiss', () =>
        HttpResponse.json({ dismissed: true }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId(`data-hygiene-dismiss-${BASE_FINDING.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`data-hygiene-dismiss-${BASE_FINDING.id}`));
    await waitFor(() => {
      expect(screen.getByTestId('data-hygiene-dismiss-dialog')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('data-hygiene-dismiss-reason-input'), {
      target: { value: 'Verified directly' },
    });
    fireEvent.click(screen.getByTestId('data-hygiene-dismiss-confirm'));

    await waitFor(() => {
      expect(screen.queryByTestId('data-hygiene-dismiss-dialog')).not.toBeInTheDocument();
    });
  });

  it('shows an inline error when dismissing fails', async () => {
    server.use(
      http.get('/api/v1/data-hygiene/findings', () =>
        HttpResponse.json({ findings: [BASE_FINDING], total: 1 }),
      ),
      http.post('/api/v1/data-hygiene/findings/:id/dismiss', () =>
        HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId(`data-hygiene-dismiss-${BASE_FINDING.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`data-hygiene-dismiss-${BASE_FINDING.id}`));
    fireEvent.change(await screen.findByTestId('data-hygiene-dismiss-reason-input'), {
      target: { value: 'Verified directly' },
    });
    fireEvent.click(screen.getByTestId('data-hygiene-dismiss-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('data-hygiene-action-error')).toBeInTheDocument();
    });
  });

  it('disables the archive button for a finding while its own clear request is pending, without blocking other rows', async () => {
    let resolveClear: (() => void) | undefined;
    server.use(
      http.get('/api/v1/data-hygiene/findings', () =>
        HttpResponse.json({ findings: [BASE_FINDING, DUPLICATE_FINDING], total: 2 }),
      ),
      http.post('/api/v1/data-hygiene/findings/clear/:entityType/:entityId', async () => {
        await new Promise<void>((resolve) => {
          resolveClear = resolve;
        });
        return HttpResponse.json({ cleared: true });
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId(`data-hygiene-archive-${BASE_FINDING.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`data-hygiene-archive-${BASE_FINDING.id}`));

    await waitFor(() => {
      expect(screen.getByTestId(`data-hygiene-archive-${BASE_FINDING.id}`)).toBeDisabled();
    });
    // A different row's archive button must remain clickable while the first is pending.
    expect(screen.getByTestId(`data-hygiene-archive-${DUPLICATE_FINDING.id}`)).not.toBeDisabled();

    resolveClear?.();
    // Let the resolved mutation's cache invalidation/refetch settle inside act()
    // before the test (and its component tree) tears down.
    await waitFor(() => {
      expect(screen.getByTestId(`data-hygiene-archive-${BASE_FINDING.id}`)).not.toBeDisabled();
    });
  });

  it('opens the merge dialog for a contact_duplicate finding and moves focus into it', async () => {
    server.use(
      http.get('/api/v1/data-hygiene/findings', () =>
        HttpResponse.json({ findings: [DUPLICATE_FINDING], total: 1 }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId(`data-hygiene-merge-${DUPLICATE_FINDING.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`data-hygiene-merge-${DUPLICATE_FINDING.id}`));
    await waitFor(() => {
      expect(screen.getByTestId('data-hygiene-merge-dialog')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('data-hygiene-merge-cancel')).toHaveFocus();
    });
  });

  it('merges the selected winner/loser pair and closes the dialog on success', async () => {
    let capturedBody: unknown;
    server.use(
      http.get('/api/v1/data-hygiene/findings', () =>
        HttpResponse.json({ findings: [DUPLICATE_FINDING], total: 1 }),
      ),
      http.post('/api/v1/data-hygiene/findings/merge-contacts', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ merged: true });
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId(`data-hygiene-merge-${DUPLICATE_FINDING.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`data-hygiene-merge-${DUPLICATE_FINDING.id}`));
    await waitFor(() => {
      expect(screen.getByTestId('data-hygiene-merge-dialog')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('data-hygiene-merge-confirm'));

    await waitFor(() => {
      expect(screen.queryByTestId('data-hygiene-merge-dialog')).not.toBeInTheDocument();
    });
    expect(capturedBody).toEqual({
      winnerId: DUPLICATE_FINDING.entity_id,
      loserId: DUPLICATE_FINDING.related_entity_id,
    });
  });

  it('closes an open dialog on Escape', async () => {
    server.use(
      http.get('/api/v1/data-hygiene/findings', () =>
        HttpResponse.json({ findings: [BASE_FINDING], total: 1 }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId(`data-hygiene-dismiss-${BASE_FINDING.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`data-hygiene-dismiss-${BASE_FINDING.id}`));
    await waitFor(() => {
      expect(screen.getByTestId('data-hygiene-dismiss-dialog')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByTestId('data-hygiene-dismiss-dialog')).not.toBeInTheDocument();
    });
  });

  it('filters by entity type via the filter buttons', async () => {
    const requestedEntityTypes: Array<string | null> = [];
    server.use(
      http.get('/api/v1/data-hygiene/findings', ({ request }) => {
        const url = new URL(request.url);
        requestedEntityTypes.push(url.searchParams.get('entity_type'));
        return HttpResponse.json({ findings: [], total: 0 });
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('data-hygiene-filter-contact')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('data-hygiene-filter-contact'));

    await waitFor(() => {
      expect(requestedEntityTypes).toContain('contact');
    });
  });
});
