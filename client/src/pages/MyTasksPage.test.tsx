/**
 * Tests for MyTasksPage component.
 *
 * The mobile card view (<ul class="md:hidden">) and desktop table (<table class="hidden md:block">)
 * share data-testid values so E2E tests work at any viewport. In JSDOM both are in the DOM
 * simultaneously (no CSS applied), so we use getAllByTestId()[0] instead of getByTestId()
 * for row-scoped ids, and queryAllByTestId() for "not present" assertions.
 */

import { screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';
import MyTasksPage from './MyTasksPage.js';
import { MY_TASK_1, MY_TASK_OVERDUE, MY_TASK_COMPLETE } from '@/test/msw/handlers.js';

describe('MyTasksPage', () => {
  it('shows the loading state while fetching', () => {
    renderWithProviders(<MyTasksPage />);
    expect(screen.getByTestId('my-tasks-loading')).toBeInTheDocument();
  });

  it('renders the page heading', async () => {
    renderWithProviders(<MyTasksPage />);
    await waitFor(() => {
      expect(screen.getByTestId('my-tasks-heading')).toHaveTextContent('My Tasks');
    });
  });

  it('shows the empty state when there are no open tasks', async () => {
    server.use(http.get('/api/activities/my-tasks', () => HttpResponse.json({ tasks: [] })));

    renderWithProviders(<MyTasksPage />);

    await waitFor(() => {
      expect(screen.getByTestId('my-tasks-empty')).toBeInTheDocument();
    });
  });

  it('renders task rows for open tasks', async () => {
    renderWithProviders(<MyTasksPage />);

    await waitFor(() => {
      expect(screen.getAllByTestId(`task-row-${MY_TASK_1.id}`)[0]).toBeInTheDocument();
    });

    expect(screen.getAllByTestId(`task-subject-${MY_TASK_1.id}`)[0]).toHaveTextContent(
      MY_TASK_1.subject,
    );
    expect(screen.getAllByTestId(`task-due-date-${MY_TASK_1.id}`)[0]).toHaveTextContent(
      'Jun 15, 2026',
    );
  });

  it('shows the linked record name as a link', async () => {
    renderWithProviders(<MyTasksPage />);

    await waitFor(() => {
      expect(screen.getAllByTestId(`task-record-link-${MY_TASK_1.id}`)[0]).toBeInTheDocument();
    });

    const link = screen.getAllByTestId(`task-record-link-${MY_TASK_1.id}`)[0];
    expect(link).toHaveTextContent('Acme Enterprise Deal');
    expect(link).toHaveAttribute('href', `/deals/${MY_TASK_1.deal_id}`);
  });

  it('highlights overdue tasks with a red due date and overdue badge', async () => {
    renderWithProviders(<MyTasksPage />);

    await waitFor(() => {
      expect(screen.getAllByTestId(`task-row-${MY_TASK_OVERDUE.id}`)[0]).toBeInTheDocument();
    });

    const dueDateCell = screen.getAllByTestId(`task-due-date-${MY_TASK_OVERDUE.id}`)[0];
    expect(dueDateCell.className).toContain('text-red-600');
    expect(
      screen.getAllByTestId(`task-overdue-badge-${MY_TASK_OVERDUE.id}`)[0],
    ).toBeInTheDocument();
  });

  it('does not highlight a future due date as overdue', async () => {
    renderWithProviders(<MyTasksPage />);

    await waitFor(() => {
      expect(screen.getAllByTestId(`task-row-${MY_TASK_1.id}`)[0]).toBeInTheDocument();
    });

    const dueDateCell = screen.getAllByTestId(`task-due-date-${MY_TASK_1.id}`)[0];
    expect(dueDateCell.className).not.toContain('text-red-600');
    expect(screen.queryAllByTestId(`task-overdue-badge-${MY_TASK_1.id}`)).toHaveLength(0);
  });

  it('shows a "Mark complete" button for open tasks', async () => {
    renderWithProviders(<MyTasksPage />);

    await waitFor(() => {
      expect(screen.getAllByTestId(`mark-complete-${MY_TASK_1.id}`)[0]).toBeInTheDocument();
    });
  });

  it('hides completed tasks by default', async () => {
    server.use(
      http.get('/api/activities/my-tasks', () =>
        HttpResponse.json({ tasks: [MY_TASK_1, MY_TASK_COMPLETE] }),
      ),
    );

    renderWithProviders(<MyTasksPage />);

    await waitFor(() => {
      expect(screen.getAllByTestId(`task-row-${MY_TASK_1.id}`)[0]).toBeInTheDocument();
    });

    expect(screen.queryAllByTestId(`task-row-${MY_TASK_COMPLETE.id}`)).toHaveLength(0);
  });

  it('shows completed tasks when the "Show completed" toggle is clicked', async () => {
    server.use(
      http.get('/api/activities/my-tasks', () =>
        HttpResponse.json({ tasks: [MY_TASK_1, MY_TASK_COMPLETE] }),
      ),
    );

    renderWithProviders(<MyTasksPage />);

    await waitFor(() => {
      expect(screen.getByTestId('toggle-completed-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('toggle-completed-button'));

    await waitFor(() => {
      expect(screen.getAllByTestId(`task-row-${MY_TASK_COMPLETE.id}`)[0]).toBeInTheDocument();
    });
  });

  it('applies line-through styling to completed task subjects', async () => {
    server.use(
      http.get('/api/activities/my-tasks', () => HttpResponse.json({ tasks: [MY_TASK_COMPLETE] })),
    );

    renderWithProviders(<MyTasksPage />);

    // Toggle completed visible
    await waitFor(() => {
      expect(screen.getByTestId('toggle-completed-button')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('toggle-completed-button'));

    await waitFor(() => {
      const subject = screen.getAllByTestId(`task-subject-${MY_TASK_COMPLETE.id}`)[0];
      expect(subject.className).toContain('line-through');
    });
  });

  it('does not show "Mark complete" for already completed tasks', async () => {
    server.use(
      http.get('/api/activities/my-tasks', () => HttpResponse.json({ tasks: [MY_TASK_COMPLETE] })),
    );

    renderWithProviders(<MyTasksPage />);

    await waitFor(() => {
      expect(screen.getByTestId('toggle-completed-button')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('toggle-completed-button'));

    await waitFor(() => {
      expect(screen.getAllByTestId(`task-row-${MY_TASK_COMPLETE.id}`)[0]).toBeInTheDocument();
    });

    expect(screen.queryAllByTestId(`mark-complete-${MY_TASK_COMPLETE.id}`)).toHaveLength(0);
  });

  it('calls the PATCH endpoint and invalidates query when marking a task complete', async () => {
    let patchCalled = false;
    server.use(
      http.patch('/api/activities/:id', async ({ params }) => {
        if (params.id === MY_TASK_1.id) patchCalled = true;
        return HttpResponse.json({ activity: { ...MY_TASK_1, status: 'complete' } });
      }),
    );

    renderWithProviders(<MyTasksPage />);

    await waitFor(() => {
      expect(screen.getAllByTestId(`mark-complete-${MY_TASK_1.id}`)[0]).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByTestId(`mark-complete-${MY_TASK_1.id}`)[0]);

    await waitFor(() => {
      expect(patchCalled).toBe(true);
    });
  });

  it('shows the "Show completed" / "Hide completed" toggle label correctly', async () => {
    renderWithProviders(<MyTasksPage />);

    await waitFor(() => {
      expect(screen.getByTestId('toggle-completed-button')).toHaveTextContent('Show completed');
    });

    fireEvent.click(screen.getByTestId('toggle-completed-button'));

    expect(screen.getByTestId('toggle-completed-button')).toHaveTextContent('Hide completed');
  });

  describe('?filter=overdue query param', () => {
    it('shows only overdue tasks when filter=overdue is in the URL', async () => {
      // MY_TASK_1 has a future due date (not overdue); MY_TASK_OVERDUE is overdue
      renderWithProviders(<MyTasksPage />, { initialEntries: ['/my-tasks?filter=overdue'] });

      await waitFor(() => {
        expect(screen.getAllByTestId(`task-row-${MY_TASK_OVERDUE.id}`)[0]).toBeInTheDocument();
      });

      expect(screen.queryAllByTestId(`task-row-${MY_TASK_1.id}`)).toHaveLength(0);
    });

    it('shows the empty state when filter=overdue but no tasks are overdue', async () => {
      server.use(
        http.get('/api/activities/my-tasks', () => HttpResponse.json({ tasks: [MY_TASK_1] })),
      );

      renderWithProviders(<MyTasksPage />, { initialEntries: ['/my-tasks?filter=overdue'] });

      await waitFor(() => {
        expect(screen.getByTestId('my-tasks-empty')).toBeInTheDocument();
      });

      expect(screen.queryAllByTestId(`task-row-${MY_TASK_1.id}`)).toHaveLength(0);
      // Chip must still be visible so the user knows why the list is empty
      expect(screen.getByTestId('filter-chip-overdue')).toBeInTheDocument();
    });

    it('shows all open tasks when no filter param is present', async () => {
      renderWithProviders(<MyTasksPage />);

      await waitFor(() => {
        expect(screen.getAllByTestId(`task-row-${MY_TASK_1.id}`)[0]).toBeInTheDocument();
        expect(screen.getAllByTestId(`task-row-${MY_TASK_OVERDUE.id}`)[0]).toBeInTheDocument();
      });
    });

    it('hides the "Show completed" toggle when the overdue filter is active', async () => {
      renderWithProviders(<MyTasksPage />, { initialEntries: ['/my-tasks?filter=overdue'] });

      await waitFor(() => {
        expect(screen.getAllByTestId(`task-row-${MY_TASK_OVERDUE.id}`)[0]).toBeInTheDocument();
      });

      expect(screen.queryByTestId('toggle-completed-button')).not.toBeInTheDocument();
    });

    it('shows the overdue filter chip when filter=overdue is active', async () => {
      renderWithProviders(<MyTasksPage />, { initialEntries: ['/my-tasks?filter=overdue'] });

      await waitFor(() => {
        expect(screen.getByTestId('filter-chip-overdue')).toBeInTheDocument();
      });

      expect(screen.getByTestId('filter-chip-overdue')).toHaveTextContent('Filtering: Overdue');
    });

    it('does not show the overdue filter chip when no filter param is present', async () => {
      renderWithProviders(<MyTasksPage />);

      await waitFor(() => {
        expect(screen.getByTestId('my-tasks-heading')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('filter-chip-overdue')).not.toBeInTheDocument();
    });

    it('shows the "Show completed" toggle when no overdue filter is active', async () => {
      renderWithProviders(<MyTasksPage />);

      await waitFor(() => {
        expect(screen.getByTestId('toggle-completed-button')).toBeInTheDocument();
      });
    });
  });
});
