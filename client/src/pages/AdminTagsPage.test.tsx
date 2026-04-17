/**
 * Tests for the AdminTagsPage component (MINCRM-186).
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import AdminTagsPage from './AdminTagsPage.js';
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
      http.get('/api/tags', async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return HttpResponse.json({ tags: [] });
      }),
    );
    renderWithProviders(<AdminTagsPage />);
    expect(screen.getByTestId('admin-tags-loading')).toBeInTheDocument();
  });

  it('shows empty state when no tags exist', async () => {
    server.use(http.get('/api/tags', () => HttpResponse.json({ tags: [] })));
    renderWithProviders(<AdminTagsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('admin-tags-empty')).toBeInTheDocument();
    });
  });

  it('shows error state when the API fails', async () => {
    server.use(
      http.get('/api/tags', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'fail' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<AdminTagsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('admin-tags-error')).toBeInTheDocument();
    });
  });

  it('renders tag rows when tags are returned', async () => {
    server.use(http.get('/api/tags', () => HttpResponse.json({ tags: [TAG_1, TAG_2] })));
    renderWithProviders(<AdminTagsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`admin-tag-row-${TAG_1.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`tag-name-${TAG_1.id}`)).toHaveTextContent('enterprise');
      expect(screen.getByTestId(`admin-tag-row-${TAG_2.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`tag-name-${TAG_2.id}`)).toHaveTextContent('priority');
    });
  });

  it('renders rename and delete buttons for each tag', async () => {
    server.use(http.get('/api/tags', () => HttpResponse.json({ tags: [TAG_1] })));
    renderWithProviders(<AdminTagsPage />);
    await waitFor(() => {
      expect(screen.getByTestId(`rename-tag-${TAG_1.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`delete-tag-${TAG_1.id}`)).toBeInTheDocument();
    });
  });

  it('shows rename form when rename button is clicked', async () => {
    server.use(http.get('/api/tags', () => HttpResponse.json({ tags: [TAG_1] })));
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
      http.get('/api/tags', () => HttpResponse.json({ tags: [TAG_1] })),
      http.patch('/api/tags/:id', async ({ params, request }) => {
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
    server.use(http.get('/api/tags', () => HttpResponse.json({ tags: [TAG_1] })));
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
    server.use(http.get('/api/tags', () => HttpResponse.json({ tags: [TAG_1] })));
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
      http.get('/api/tags', () => HttpResponse.json({ tags: deleted ? [] : [TAG_1] })),
      http.delete('/api/tags/:id', () => {
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
      expect(screen.getByTestId('admin-tags-empty')).toBeInTheDocument();
    });
  });

  it('shows delete error alert when delete API fails', async () => {
    server.use(
      http.get('/api/tags', () => HttpResponse.json({ tags: [TAG_1] })),
      http.delete('/api/tags/:id', () =>
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
