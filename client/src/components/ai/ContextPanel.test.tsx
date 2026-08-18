/**
 * Unit tests for ContextPanel.
 *
 * Covers:
 *  - Empty state when no entries are returned
 *  - Renders entry list
 *  - Add form: open, fill, submit, cancel
 *  - Edit form: open, update, cancel
 *  - Delete: confirm, dismiss confirm
 *  - Limit-reached error from API
 */

import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import { server } from '../../test/setup.js';
import ContextPanel from './ContextPanel.js';
import type { AiContextEntryResponse } from '@shared/schemas/aiContextSchema.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ENTRY_1: AiContextEntryResponse = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  user_id: 'user-1',
  key: 'a while',
  value: '30+ days without activity',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const ENTRY_2: AiContextEntryResponse = {
  id: 'aaaaaaaa-0000-0000-0000-000000000002',
  user_id: 'user-1',
  key: 'high-value',
  value: 'deals over $50k',
  created_at: '2026-01-02T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ContextPanel', () => {
  it('renders the panel container', async () => {
    renderWithProviders(<ContextPanel />);
    expect(screen.getByTestId('ai-context-panel')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('ai-add-context-button')).toBeInTheDocument());
  });

  it('shows empty state when there are no entries', async () => {
    // Default handler returns [] (see msw/handlers.ts)
    renderWithProviders(<ContextPanel />);
    await waitFor(() => expect(screen.getByTestId('ai-context-empty')).toBeInTheDocument());
  });

  it('renders a list of entries', async () => {
    server.use(
      http.get('/api/v1/ai/context', () => HttpResponse.json({ entries: [ENTRY_1, ENTRY_2] })),
    );
    renderWithProviders(<ContextPanel />);
    await waitFor(() => expect(screen.getByTestId('ai-context-list')).toBeInTheDocument());
    expect(screen.getByTestId(`ai-context-entry-${ENTRY_1.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`ai-context-entry-${ENTRY_2.id}`)).toBeInTheDocument();
    expect(screen.getByText('a while')).toBeInTheDocument();
    expect(screen.getByText('30+ days without activity')).toBeInTheDocument();
  });

  it('opens add form and cancels', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContextPanel />);
    await waitFor(() => expect(screen.getByTestId('ai-add-context-button')).toBeInTheDocument());

    await user.click(screen.getByTestId('ai-add-context-button'));
    expect(screen.getByTestId('ai-context-add-form')).toBeInTheDocument();

    await user.click(screen.getByTestId('ai-context-add-cancel'));
    expect(screen.queryByTestId('ai-context-add-form')).not.toBeInTheDocument();
  });

  it('adds a new entry via the form', async () => {
    let created = false;
    server.use(
      http.post('/api/v1/ai/context', async ({ request }) => {
        const body = (await request.json()) as { key: string; value: string };
        created = true;
        return HttpResponse.json(
          {
            id: 'new-id',
            user_id: 'user-1',
            key: body.key,
            value: body.value,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { status: 201 },
        );
      }),
      http.get('/api/v1/ai/context', () => {
        return HttpResponse.json({
          entries: created
            ? [
                {
                  id: 'new-id',
                  user_id: 'user-1',
                  key: 'new-key',
                  value: 'new-value',
                  created_at: '',
                  updated_at: '',
                },
              ]
            : [],
        });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<ContextPanel />);
    await waitFor(() => expect(screen.getByTestId('ai-add-context-button')).toBeInTheDocument());

    await user.click(screen.getByTestId('ai-add-context-button'));
    await user.type(screen.getByTestId('ai-context-add-key'), 'new-key');
    await user.type(screen.getByTestId('ai-context-add-value'), 'new-value');
    await user.click(screen.getByTestId('ai-context-add-save'));

    await waitFor(() =>
      expect(screen.queryByTestId('ai-context-add-form')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('new-key')).toBeInTheDocument();
  });

  it('opens edit form for an existing entry and cancels', async () => {
    server.use(http.get('/api/v1/ai/context', () => HttpResponse.json({ entries: [ENTRY_1] })));
    const user = userEvent.setup();
    renderWithProviders(<ContextPanel />);
    await waitFor(() =>
      expect(screen.getByTestId(`ai-context-entry-${ENTRY_1.id}`)).toBeInTheDocument(),
    );

    await user.click(screen.getByTestId(`ai-context-edit-button-${ENTRY_1.id}`));
    expect(screen.getByTestId(`ai-context-edit-form-${ENTRY_1.id}`)).toBeInTheDocument();

    await user.click(screen.getByTestId(`ai-context-edit-cancel-${ENTRY_1.id}`));
    expect(screen.queryByTestId(`ai-context-edit-form-${ENTRY_1.id}`)).not.toBeInTheDocument();
  });

  it('saves an updated entry', async () => {
    server.use(
      http.get('/api/v1/ai/context', () => HttpResponse.json({ entries: [ENTRY_1] })),
      http.patch('/api/v1/ai/context/:id', async ({ request }) => {
        const body = (await request.json()) as { key?: string; value?: string };
        return HttpResponse.json({ ...ENTRY_1, ...body });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<ContextPanel />);
    await waitFor(() =>
      expect(screen.getByTestId(`ai-context-entry-${ENTRY_1.id}`)).toBeInTheDocument(),
    );

    await user.click(screen.getByTestId(`ai-context-edit-button-${ENTRY_1.id}`));
    const valueInput = screen.getByTestId(`ai-context-edit-value-${ENTRY_1.id}`);
    await user.clear(valueInput);
    await user.type(valueInput, 'updated-value');
    await user.click(screen.getByTestId(`ai-context-edit-save-${ENTRY_1.id}`));

    await waitFor(() =>
      expect(screen.queryByTestId(`ai-context-edit-form-${ENTRY_1.id}`)).not.toBeInTheDocument(),
    );
  });

  it('deletes an entry after window.confirm returns true', async () => {
    let deleted = false;
    server.use(
      http.get('/api/v1/ai/context', () =>
        HttpResponse.json({ entries: deleted ? [] : [ENTRY_1] }),
      ),
      http.delete('/api/v1/ai/context/:id', () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderWithProviders(<ContextPanel />);
    await waitFor(() =>
      expect(screen.getByTestId(`ai-context-entry-${ENTRY_1.id}`)).toBeInTheDocument(),
    );

    await user.click(screen.getByTestId(`ai-context-delete-button-${ENTRY_1.id}`));
    await waitFor(() =>
      expect(screen.queryByTestId(`ai-context-entry-${ENTRY_1.id}`)).not.toBeInTheDocument(),
    );
    vi.restoreAllMocks();
  });

  it('does not delete when window.confirm returns false', async () => {
    server.use(http.get('/api/v1/ai/context', () => HttpResponse.json({ entries: [ENTRY_1] })));
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderWithProviders(<ContextPanel />);
    await waitFor(() =>
      expect(screen.getByTestId(`ai-context-entry-${ENTRY_1.id}`)).toBeInTheDocument(),
    );

    await user.click(screen.getByTestId(`ai-context-delete-button-${ENTRY_1.id}`));
    expect(screen.getByTestId(`ai-context-entry-${ENTRY_1.id}`)).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('shows limit-reached error when API returns 409', async () => {
    server.use(
      http.post('/api/v1/ai/context', () =>
        HttpResponse.json(
          { error: { code: 'CONTEXT_ENTRY_LIMIT_REACHED', message: 'Limit reached' } },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<ContextPanel />);
    await waitFor(() => expect(screen.getByTestId('ai-add-context-button')).toBeInTheDocument());

    await user.click(screen.getByTestId('ai-add-context-button'));
    await user.type(screen.getByTestId('ai-context-add-key'), 'overflow-key');
    await user.type(screen.getByTestId('ai-context-add-value'), 'overflow-value');
    await user.click(screen.getByTestId('ai-context-add-save'));

    await waitFor(() => expect(screen.getByTestId('ai-context-add-error')).toBeInTheDocument());
  });
});
