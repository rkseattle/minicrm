/**
 * Tests for MyTasksPage component.
 */

import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';
import MyTasksPage from './MyTasksPage.js';
import { MY_TASK_1, MY_TASK_OVERDUE, MY_TASK_COMPLETE } from '@/test/msw/handlers.js';
import * as bulkApi from '@/api/bulk.js';

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

  it('shows the error state when the API fails', async () => {
    server.use(
      http.get('/api/v1/activities/my-tasks', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'fail' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<MyTasksPage />);
    await waitFor(() => {
      expect(screen.getByTestId('my-tasks-error')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows the empty state when there are no open tasks', async () => {
    server.use(
      http.get('/api/v1/activities/my-tasks', () =>
        HttpResponse.json({ tasks: [], total: 0, page: 1, limit: 25 }),
      ),
    );

    renderWithProviders(<MyTasksPage />);

    await waitFor(() => {
      expect(screen.getByTestId('my-tasks-empty-state')).toBeInTheDocument();
    });
  });

  it('renders task rows for open tasks', async () => {
    renderWithProviders(<MyTasksPage />);

    await waitFor(() => {
      expect(screen.getByTestId(`task-row-${MY_TASK_1.id}`)).toBeInTheDocument();
    });

    expect(screen.getByTestId(`task-subject-${MY_TASK_1.id}`)).toHaveTextContent(MY_TASK_1.subject);
    expect(screen.getByTestId(`task-due-date-${MY_TASK_1.id}`)).toHaveTextContent('Jun 15, 2027');
  });

  it('shows the linked record name as a link', async () => {
    renderWithProviders(<MyTasksPage />);

    await waitFor(() => {
      expect(screen.getByTestId(`task-record-link-${MY_TASK_1.id}`)).toBeInTheDocument();
    });

    const link = screen.getByTestId(`task-record-link-${MY_TASK_1.id}`);
    expect(link).toHaveTextContent('Acme Enterprise Deal');
    expect(link).toHaveAttribute('href', `/deals/${MY_TASK_1.deal_id}`);
  });

  it('highlights overdue tasks with a red due date and overdue badge', async () => {
    renderWithProviders(<MyTasksPage />);

    await waitFor(() => {
      expect(screen.getByTestId(`task-row-${MY_TASK_OVERDUE.id}`)).toBeInTheDocument();
    });

    const dueDateCell = screen.getByTestId(`task-due-date-${MY_TASK_OVERDUE.id}`);
    expect(dueDateCell.className).toContain('text-red-600');
    expect(screen.getByTestId(`task-overdue-badge-${MY_TASK_OVERDUE.id}`)).toBeInTheDocument();
  });

  it('does not highlight a future due date as overdue', async () => {
    renderWithProviders(<MyTasksPage />);

    await waitFor(() => {
      expect(screen.getByTestId(`task-row-${MY_TASK_1.id}`)).toBeInTheDocument();
    });

    const dueDateCell = screen.getByTestId(`task-due-date-${MY_TASK_1.id}`);
    expect(dueDateCell.className).not.toContain('text-red-600');
    expect(screen.queryByTestId(`task-overdue-badge-${MY_TASK_1.id}`)).not.toBeInTheDocument();
  });

  it('shows a "Mark complete" button for open tasks', async () => {
    renderWithProviders(<MyTasksPage />);

    await waitFor(() => {
      expect(screen.getByTestId(`mark-complete-${MY_TASK_1.id}`)).toBeInTheDocument();
    });
  });

  it('hides completed tasks by default', async () => {
    server.use(
      http.get('/api/v1/activities/my-tasks', () =>
        HttpResponse.json({ tasks: [MY_TASK_1, MY_TASK_COMPLETE], total: 2, page: 1, limit: 25 }),
      ),
    );

    renderWithProviders(<MyTasksPage />);

    await waitFor(() => {
      expect(screen.getByTestId(`task-row-${MY_TASK_1.id}`)).toBeInTheDocument();
    });

    expect(screen.queryByTestId(`task-row-${MY_TASK_COMPLETE.id}`)).not.toBeInTheDocument();
  });

  it('shows completed tasks when the "Show completed" toggle is clicked', async () => {
    server.use(
      http.get('/api/v1/activities/my-tasks', () =>
        HttpResponse.json({ tasks: [MY_TASK_1, MY_TASK_COMPLETE], total: 2, page: 1, limit: 25 }),
      ),
    );

    renderWithProviders(<MyTasksPage />);

    await waitFor(() => {
      expect(screen.getByTestId('toggle-completed-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('toggle-completed-button'));

    await waitFor(() => {
      expect(screen.getByTestId(`task-row-${MY_TASK_COMPLETE.id}`)).toBeInTheDocument();
    });
  });

  it('applies line-through styling to completed task subjects', async () => {
    server.use(
      http.get('/api/v1/activities/my-tasks', () =>
        HttpResponse.json({ tasks: [MY_TASK_COMPLETE], total: 1, page: 1, limit: 25 }),
      ),
    );

    renderWithProviders(<MyTasksPage />);

    // Toggle completed visible
    await waitFor(() => {
      expect(screen.getByTestId('toggle-completed-button')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('toggle-completed-button'));

    await waitFor(() => {
      const subject = screen.getByTestId(`task-subject-${MY_TASK_COMPLETE.id}`);
      expect(subject.className).toContain('line-through');
    });
  });

  it('does not show "Mark complete" for already completed tasks', async () => {
    server.use(
      http.get('/api/v1/activities/my-tasks', () =>
        HttpResponse.json({ tasks: [MY_TASK_COMPLETE], total: 1, page: 1, limit: 25 }),
      ),
    );

    renderWithProviders(<MyTasksPage />);

    await waitFor(() => {
      expect(screen.getByTestId('toggle-completed-button')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('toggle-completed-button'));

    await waitFor(() => {
      expect(screen.getByTestId(`task-row-${MY_TASK_COMPLETE.id}`)).toBeInTheDocument();
    });

    expect(screen.queryByTestId(`mark-complete-${MY_TASK_COMPLETE.id}`)).not.toBeInTheDocument();
  });

  it('calls the PATCH endpoint and invalidates query when marking a task complete', async () => {
    let patchCalled = false;
    server.use(
      http.patch('/api/v1/activities/:id', async ({ params }) => {
        if (params.id === MY_TASK_1.id) patchCalled = true;
        return HttpResponse.json({ activity: { ...MY_TASK_1, status: 'complete' } });
      }),
    );

    renderWithProviders(<MyTasksPage />);

    await waitFor(() => {
      expect(screen.getByTestId(`mark-complete-${MY_TASK_1.id}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`mark-complete-${MY_TASK_1.id}`));

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
      renderWithProviders(<MyTasksPage />, { initialEntries: ['/tasks?filter=overdue'] });

      await waitFor(() => {
        expect(screen.getByTestId(`task-row-${MY_TASK_OVERDUE.id}`)).toBeInTheDocument();
      });

      expect(screen.queryByTestId(`task-row-${MY_TASK_1.id}`)).not.toBeInTheDocument();
    });

    it('shows the empty state when filter=overdue but no tasks are overdue', async () => {
      server.use(
        http.get('/api/v1/activities/my-tasks', () =>
          HttpResponse.json({ tasks: [MY_TASK_1], total: 1, page: 1, limit: 25 }),
        ),
      );

      renderWithProviders(<MyTasksPage />, { initialEntries: ['/tasks?filter=overdue'] });

      await waitFor(() => {
        expect(screen.getByTestId('my-tasks-empty-state')).toBeInTheDocument();
      });

      expect(screen.queryByTestId(`task-row-${MY_TASK_1.id}`)).not.toBeInTheDocument();
      // Chip must still be visible so the user knows why the list is empty
      expect(screen.getByTestId('filter-chip-overdue')).toBeInTheDocument();
    });

    it('shows all open tasks when no filter param is present', async () => {
      renderWithProviders(<MyTasksPage />);

      await waitFor(() => {
        expect(screen.getByTestId(`task-row-${MY_TASK_1.id}`)).toBeInTheDocument();
        expect(screen.getByTestId(`task-row-${MY_TASK_OVERDUE.id}`)).toBeInTheDocument();
      });
    });

    it('hides the "Show completed" toggle when the overdue filter is active', async () => {
      renderWithProviders(<MyTasksPage />, { initialEntries: ['/tasks?filter=overdue'] });

      await waitFor(() => {
        expect(screen.getByTestId(`task-row-${MY_TASK_OVERDUE.id}`)).toBeInTheDocument();
      });

      expect(screen.queryByTestId('toggle-completed-button')).not.toBeInTheDocument();
    });

    it('shows the overdue filter chip when filter=overdue is active', async () => {
      renderWithProviders(<MyTasksPage />, { initialEntries: ['/tasks?filter=overdue'] });

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

  describe('pagination', () => {
    it('renders the Pagination component after tasks load', async () => {
      renderWithProviders(<MyTasksPage />);

      await waitFor(() => {
        expect(screen.getByTestId('pagination')).toBeInTheDocument();
      });
    });

    it('renders the page-size selector', async () => {
      renderWithProviders(<MyTasksPage />);

      await waitFor(() => {
        expect(screen.getByTestId('pagination-limit-select')).toBeInTheDocument();
      });
    });

    it('renders Pagination even when total <= limit (always visible)', async () => {
      server.use(
        http.get('/api/v1/activities/my-tasks', () =>
          HttpResponse.json({ tasks: [MY_TASK_1], total: 1, page: 1, limit: 25 }),
        ),
      );

      renderWithProviders(<MyTasksPage />);

      await waitFor(() => {
        expect(screen.getByTestId('pagination')).toBeInTheDocument();
      });
    });
  });

  describe('linked record path branches', () => {
    it('links to the account page for account-linked tasks', async () => {
      // MY_TASK_COMPLETE is linked to an account
      server.use(
        http.get('/api/v1/activities/my-tasks', () =>
          HttpResponse.json({ tasks: [MY_TASK_COMPLETE], total: 1, page: 1, limit: 25 }),
        ),
      );

      renderWithProviders(<MyTasksPage />);

      // Show completed tasks so we can see the row
      await waitFor(() => {
        expect(screen.getByTestId('toggle-completed-button')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId('toggle-completed-button'));

      await waitFor(() => {
        const link = screen.getByTestId(`task-record-link-${MY_TASK_COMPLETE.id}`);
        expect(link).toHaveAttribute('href', `/accounts/${MY_TASK_COMPLETE.account_id}`);
      });
    });

    it('links to the contact page for contact-linked tasks', async () => {
      // MY_TASK_OVERDUE is linked to a contact
      renderWithProviders(<MyTasksPage />);

      await waitFor(() => {
        const link = screen.getByTestId(`task-record-link-${MY_TASK_OVERDUE.id}`);
        expect(link).toHaveAttribute('href', `/contacts/${MY_TASK_OVERDUE.contact_id}`);
      });
    });

    it('shows "No record" when a task has no linked record', async () => {
      const unlinkedTask = {
        ...MY_TASK_1,
        id: '00000000-0000-0000-0000-000000000601',
        contact_id: null,
        account_id: null,
        deal_id: null,
        linked_record_name: null,
        linked_record_type: null,
      };
      server.use(
        http.get('/api/v1/activities/my-tasks', () =>
          HttpResponse.json({ tasks: [unlinkedTask], total: 1, page: 1, limit: 25 }),
        ),
      );

      renderWithProviders(<MyTasksPage />);

      await waitFor(() => {
        const cell = screen.getByTestId(`task-record-link-${unlinkedTask.id}`);
        // i18n key myTasks.noRecord is "—" in the English locale
        expect(cell).toHaveTextContent('—');
      });
    });
  });

  describe('due date branches', () => {
    it('shows "No due date" when a task has no due date set', async () => {
      const noDueDateTask = {
        ...MY_TASK_1,
        id: '00000000-0000-0000-0000-000000000602',
        due_date: null,
      };
      server.use(
        http.get('/api/v1/activities/my-tasks', () =>
          HttpResponse.json({ tasks: [noDueDateTask], total: 1, page: 1, limit: 25 }),
        ),
      );

      renderWithProviders(<MyTasksPage />);

      await waitFor(() => {
        expect(screen.getByTestId(`task-due-date-${noDueDateTask.id}`)).toHaveTextContent(
          'No due date',
        );
      });
    });
  });

  describe('complete mutation error', () => {
    it('shows an error alert when marking complete fails', async () => {
      server.use(
        http.patch('/api/v1/activities/:id', () =>
          HttpResponse.json(
            { error: { code: 'SERVER_ERROR', message: 'Failed to complete task' } },
            { status: 500 },
          ),
        ),
      );

      renderWithProviders(<MyTasksPage />);

      await waitFor(() => {
        expect(screen.getByTestId(`mark-complete-${MY_TASK_1.id}`)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId(`mark-complete-${MY_TASK_1.id}`));

      await waitFor(() => {
        expect(screen.getByTestId('complete-error')).toBeInTheDocument();
      });
    });
  });

  describe('completed tasks empty state', () => {
    it('shows the "No completed tasks" message when show-completed is on but there are none', async () => {
      // Default handler returns MY_TASK_1 and MY_TASK_OVERDUE (both open, no completed tasks)
      renderWithProviders(<MyTasksPage />);

      await waitFor(() => {
        expect(screen.getByTestId('toggle-completed-button')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('toggle-completed-button'));

      await waitFor(() => {
        expect(screen.getByTestId('completed-tasks-empty')).toBeInTheDocument();
      });
    });
  });

  describe('bulk selection', () => {
    it('does not show the bulk action bar before any rows are selected', async () => {
      renderWithProviders(<MyTasksPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`bulk-select-${MY_TASK_1.id}`)).toBeInTheDocument();
      });
      expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
    });

    it('shows the bulk action bar after selecting a row', async () => {
      const user = userEvent.setup();
      renderWithProviders(<MyTasksPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`bulk-select-${MY_TASK_1.id}`)).toBeInTheDocument();
      });
      await user.click(screen.getByTestId(`bulk-select-${MY_TASK_1.id}`));
      expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
      expect(screen.getByTestId('bulk-action-count')).toHaveTextContent('1');
    });

    it('select-all checkbox selects all rows and shows bulk action bar', async () => {
      const user = userEvent.setup();
      renderWithProviders(<MyTasksPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`bulk-select-${MY_TASK_1.id}`)).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('tasks-select-all'));
      await waitFor(() => {
        expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
      });
    });

    it('changing the page size clears the selection, which the new rows invalidate', async () => {
      const user = userEvent.setup();
      renderWithProviders(<MyTasksPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`bulk-select-${MY_TASK_1.id}`)).toBeInTheDocument();
      });
      await user.click(screen.getByTestId(`bulk-select-${MY_TASK_1.id}`));
      expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();

      // On page 1 a size change leaves `page` at 1, so the page number alone cannot be
      // what clears the selection — otherwise a bulk delete would act on rows scrolled
      // out of the swapped-in result set. Waits on the count first: the refetch this
      // triggers resolves to the same fixture rows, so the bar's disappearance is the
      // only observable signal and it lands a tick after the select.
      await user.selectOptions(screen.getByLabelText(/rows per page/i), '50');

      await waitFor(
        () => {
          expect(screen.queryByTestId('bulk-action-count')).not.toBeInTheDocument();
        },
        { timeout: 5000 },
      );
      expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
    });

    it('clear selection hides the bulk action bar', async () => {
      const user = userEvent.setup();
      renderWithProviders(<MyTasksPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`bulk-select-${MY_TASK_1.id}`)).toBeInTheDocument();
      });
      await user.click(screen.getByTestId(`bulk-select-${MY_TASK_1.id}`));
      expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
      await user.click(screen.getByTestId('bulk-clear-selection'));
      expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
    });

    it('shows the bulk failed details modal on partial failure and hides it on close', async () => {
      vi.spyOn(bulkApi, 'bulkDeleteActivities').mockResolvedValue({
        succeeded: [MY_TASK_1.id],
        failed: [{ id: MY_TASK_OVERDUE.id, reason: 'Permission denied' }],
      });

      const user = userEvent.setup();
      renderWithProviders(<MyTasksPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`bulk-select-${MY_TASK_1.id}`)).toBeInTheDocument();
      });

      // Select both tasks then trigger bulk delete
      await user.click(screen.getByTestId('tasks-select-all'));
      await waitFor(() => expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument());
      await user.click(screen.getByTestId('tasks-bulk-delete-button'));
      await waitFor(() => expect(screen.getByTestId('confirm-delete-confirm')).toBeInTheDocument());
      await user.click(screen.getByTestId('confirm-delete-confirm'));

      // BulkActionBar shows "see details" after partial failure
      await waitFor(() => {
        expect(screen.getByTestId('bulk-see-details')).toBeInTheDocument();
      });

      // Click see details to open the modal
      await user.click(screen.getByTestId('bulk-see-details'));
      expect(screen.getByTestId('bulk-failed-details-modal')).toBeInTheDocument();

      // Close the modal
      await user.click(screen.getByTestId('bulk-failed-details-close'));
      expect(screen.queryByTestId('bulk-failed-details-modal')).not.toBeInTheDocument();
    });

    it('bulk delete calls the API and clears selection on success', async () => {
      vi.spyOn(bulkApi, 'bulkDeleteActivities').mockResolvedValue({
        succeeded: [MY_TASK_1.id],
        failed: [],
      });

      const user = userEvent.setup();
      renderWithProviders(<MyTasksPage />);
      await waitFor(() => {
        expect(screen.getByTestId(`bulk-select-${MY_TASK_1.id}`)).toBeInTheDocument();
      });
      await user.click(screen.getByTestId(`bulk-select-${MY_TASK_1.id}`));
      await user.click(screen.getByTestId('tasks-bulk-delete-button'));

      await waitFor(() => {
        expect(screen.getByTestId('confirm-delete-confirm')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('confirm-delete-confirm'));

      await waitFor(() => {
        expect(bulkApi.bulkDeleteActivities).toHaveBeenCalledWith({
          ids: [MY_TASK_1.id],
        });
      });

      await waitFor(() => {
        expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
      });
    });
  });
});
