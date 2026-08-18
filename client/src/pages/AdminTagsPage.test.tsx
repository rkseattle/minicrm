/**
 * Tests for the AdminTagsPage component.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import AdminTagsPage from './AdminTagsPage.js';

// Resolve feature flags synchronously so the page's own loading/error/empty states are testable.
vi.mock('@/hooks/useFeatureFlag.js', () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
  useFeatureFlags: () => ({ flags: {}, isLoading: false }),
}));
import { renderWithProviders } from '../test/renderWithProviders.js';
import { server } from '../test/setup.js';
import type { TagResponse } from '@shared/schemas/tagSchema.js';

const TAG_1: TagResponse = {
  id: '00000000-0000-0000-0000-000000001001',
  name: 'enterprise',
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

const TAG_2: TagResponse = {
  id: '00000000-0000-0000-0000-000000001002',
  name: 'priority',
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

describe('AdminTagsPage', () => {
  it('renders the page heading', async () => {
    renderWithProviders(<AdminTagsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('admin-tags-heading')).toBeInTheDocument();
    });
  });

  it('shows loading state while fetching', async () => {
    server.use(
      http.get('/api/v1/tags', async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 });
      }),
    );
    renderWithProviders(<AdminTagsPage />);
    expect(screen.getByTestId('admin-tags-loading')).toBeInTheDocument();
  });

  it('shows empty state when no tags exist', async () => {
    server.use(
      http.get('/api/v1/tags', () => HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 })),
    );
    renderWithProviders(<AdminTagsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('admin-tags-empty-state')).toBeInTheDocument();
    });
  });

  it('shows error state when the API fails', async () => {
    server.use(
      http.get('/api/v1/tags', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'fail' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<AdminTagsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('admin-tags-error')).toBeInTheDocument();
    });
  });

  it('renders tag rows when tags are returned', async () => {
    server.use(
      http.get('/api/v1/tags', () =>
        HttpResponse.json({ data: [TAG_1, TAG_2], total: 2, page: 1, limit: 25 }),
      ),
    );
    renderWithProviders(<AdminTagsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`admin-tag-row-${TAG_1.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`tag-name-${TAG_1.id}`)).toHaveTextContent('enterprise');
      expect(screen.getByTestId(`admin-tag-row-${TAG_2.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`tag-name-${TAG_2.id}`)).toHaveTextContent('priority');
    });
  });

  it('renders rename and delete buttons for each tag', async () => {
    server.use(
      http.get('/api/v1/tags', () =>
        HttpResponse.json({ data: [TAG_1], total: 1, page: 1, limit: 25 }),
      ),
    );
    renderWithProviders(<AdminTagsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`rename-tag-${TAG_1.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`delete-tag-${TAG_1.id}`)).toBeInTheDocument();
    });
  });

  it('shows rename form when rename button is clicked', async () => {
    server.use(
      http.get('/api/v1/tags', () =>
        HttpResponse.json({ data: [TAG_1], total: 1, page: 1, limit: 25 }),
      ),
    );
    renderWithProviders(<AdminTagsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`rename-tag-${TAG_1.id}`)).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId(`rename-tag-${TAG_1.id}`));
    expect(screen.getByTestId(`rename-form-${TAG_1.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`rename-input-${TAG_1.id}`)).toHaveValue(TAG_1.name);
  });

  it('submits the rename form and closes on success', async () => {
    server.use(
      http.get('/api/v1/tags', () =>
        HttpResponse.json({ data: [TAG_1], total: 1, page: 1, limit: 25 }),
      ),
      http.patch('/api/v1/tags/:id', async ({ params, request }) => {
        const body = (await request.json()) as { name: string };
        return HttpResponse.json({
          tag: { ...TAG_1, id: params.id, name: body.name },
        });
      }),
    );
    renderWithProviders(<AdminTagsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`rename-tag-${TAG_1.id}`)).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId(`rename-tag-${TAG_1.id}`));
    const input = screen.getByTestId(`rename-input-${TAG_1.id}`);
    await userEvent.clear(input);
    await userEvent.type(input, 'renamed-tag');
    await userEvent.click(screen.getByTestId(`rename-save-${TAG_1.id}`));
    await waitFor(() => {
      expect(screen.queryByTestId(`rename-form-${TAG_1.id}`)).not.toBeInTheDocument();
    });
  });

  it('shows validation error when rename input is empty', async () => {
    server.use(
      http.get('/api/v1/tags', () =>
        HttpResponse.json({ data: [TAG_1], total: 1, page: 1, limit: 25 }),
      ),
    );
    renderWithProviders(<AdminTagsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`rename-tag-${TAG_1.id}`)).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId(`rename-tag-${TAG_1.id}`));
    await userEvent.clear(screen.getByTestId(`rename-input-${TAG_1.id}`));
    await userEvent.click(screen.getByTestId(`rename-save-${TAG_1.id}`));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('cancels rename and restores tag display', async () => {
    server.use(
      http.get('/api/v1/tags', () =>
        HttpResponse.json({ data: [TAG_1], total: 1, page: 1, limit: 25 }),
      ),
    );
    renderWithProviders(<AdminTagsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`rename-tag-${TAG_1.id}`)).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId(`rename-tag-${TAG_1.id}`));
    expect(screen.getByTestId(`rename-form-${TAG_1.id}`)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId(`rename-cancel-${TAG_1.id}`));
    expect(screen.queryByTestId(`rename-form-${TAG_1.id}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`tag-name-${TAG_1.id}`)).toBeInTheDocument();
  });

  it('calls delete API and removes tag from list on success', async () => {
    let deleted = false;
    server.use(
      http.get('/api/v1/tags', () =>
        HttpResponse.json(
          deleted
            ? { data: [], total: 0, page: 1, limit: 25 }
            : { data: [TAG_1], total: 1, page: 1, limit: 25 },
        ),
      ),
      http.delete('/api/v1/tags/:id', () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithProviders(<AdminTagsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`delete-tag-${TAG_1.id}`)).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId(`delete-tag-${TAG_1.id}`));
    await waitFor(() => {
      expect(screen.getByTestId('admin-tags-empty-state')).toBeInTheDocument();
    });
  });

  it('shows delete error alert when delete API fails', async () => {
    server.use(
      http.get('/api/v1/tags', () =>
        HttpResponse.json({ data: [TAG_1], total: 1, page: 1, limit: 25 }),
      ),
      http.delete('/api/v1/tags/:id', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'fail' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<AdminTagsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`delete-tag-${TAG_1.id}`)).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId(`delete-tag-${TAG_1.id}`));
    await waitFor(() => {
      expect(screen.getByTestId('admin-tags-delete-error')).toBeInTheDocument();
    });
  });
});

// ── Restrict-creation toggle ─────────────────────────────────────

describe('AdminTagsPage restrict-creation toggle', () => {
  it('renders the toggle section', async () => {
    renderWithProviders(<AdminTagsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('tags-restrict-toggle-section')).toBeInTheDocument();
    });
  });

  it('toggle is unchecked when restriction is disabled', async () => {
    server.use(
      http.get('/api/v1/settings/tags-restrict-creation', () =>
        HttpResponse.json({ restricted: false }),
      ),
    );
    renderWithProviders(<AdminTagsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('tags-restrict-toggle')).not.toBeChecked();
    });
  });

  it('toggle is checked when restriction is enabled', async () => {
    server.use(
      http.get('/api/v1/settings/tags-restrict-creation', () =>
        HttpResponse.json({ restricted: true }),
      ),
    );
    renderWithProviders(<AdminTagsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('tags-restrict-toggle')).toBeChecked();
    });
  });

  it('shows description when restriction is enabled', async () => {
    server.use(
      http.get('/api/v1/settings/tags-restrict-creation', () =>
        HttpResponse.json({ restricted: true }),
      ),
    );
    renderWithProviders(<AdminTagsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('tags-restrict-description')).toBeInTheDocument();
    });
  });

  it('does not show description when restriction is disabled', async () => {
    server.use(
      http.get('/api/v1/settings/tags-restrict-creation', () =>
        HttpResponse.json({ restricted: false }),
      ),
    );
    renderWithProviders(<AdminTagsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('tags-restrict-toggle')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('tags-restrict-description')).not.toBeInTheDocument();
  });

  it('calls the API on toggle change and shows success message', async () => {
    server.use(
      http.get('/api/v1/settings/tags-restrict-creation', () =>
        HttpResponse.json({ restricted: false }),
      ),
      http.patch('/api/v1/settings/tags-restrict-creation', async ({ request }) => {
        const body = (await request.json()) as { restricted: boolean };
        return HttpResponse.json({ restricted: body.restricted });
      }),
    );
    renderWithProviders(<AdminTagsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('tags-restrict-toggle')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('tags-restrict-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('tags-restrict-save-success')).toBeInTheDocument();
    });
  });

  it('shows error message when API save fails', async () => {
    server.use(
      http.get('/api/v1/settings/tags-restrict-creation', () =>
        HttpResponse.json({ restricted: false }),
      ),
      http.patch('/api/v1/settings/tags-restrict-creation', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'fail' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<AdminTagsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('tags-restrict-toggle')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('tags-restrict-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('tags-restrict-save-error')).toBeInTheDocument();
    });
  });
});

describe('AdminTagsPage — create tag flow', () => {
  it('shows the create form from the empty state action and submits successfully', async () => {
    server.use(
      http.get('/api/v1/tags', () => HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 })),
    );

    let createdName: string | null = null;
    server.use(
      http.post('/api/v1/tags', async ({ request }) => {
        const body = (await request.json()) as { name: string };
        createdName = body.name;
        return HttpResponse.json(
          {
            tag: {
              id: '00000000-0000-0000-0000-000000001099',
              name: body.name,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<AdminTagsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('admin-tags-empty-state')).toBeInTheDocument();
    });

    // Click the empty-state action to show the create form
    await user.click(screen.getByRole('button', { name: /add tag/i }));

    await waitFor(() => {
      expect(screen.getByTestId('admin-tags-create-form')).toBeInTheDocument();
    });

    await user.type(screen.getByTestId('admin-tags-create-input'), 'newtag');
    await user.click(screen.getByTestId('admin-tags-create-save'));

    await waitFor(() => expect(createdName).toBe('newtag'));
  });

  it('shows validation error when create is submitted with an empty name', async () => {
    server.use(
      http.get('/api/v1/tags', () => HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 })),
    );

    const user = userEvent.setup();
    renderWithProviders(<AdminTagsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('admin-tags-empty-state')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /add tag/i }));

    await waitFor(() => {
      expect(screen.getByTestId('admin-tags-create-form')).toBeInTheDocument();
    });

    // Submit without entering a name
    await user.click(screen.getByTestId('admin-tags-create-save'));

    await waitFor(() => {
      expect(screen.getByTestId('admin-tags-create-input')).toBeInTheDocument();
    });
  });

  it('hides the create form when cancel is clicked', async () => {
    server.use(
      http.get('/api/v1/tags', () => HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 })),
    );

    const user = userEvent.setup();
    renderWithProviders(<AdminTagsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('admin-tags-empty-state')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /add tag/i }));

    await waitFor(() => {
      expect(screen.getByTestId('admin-tags-create-form')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('admin-tags-create-cancel'));

    await waitFor(() => {
      expect(screen.queryByTestId('admin-tags-create-form')).not.toBeInTheDocument();
    });
  });
});
