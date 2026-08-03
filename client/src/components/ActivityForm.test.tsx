/**
 * Tests for ActivityForm component.
 */

import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';
import ActivityForm from './ActivityForm.js';

const noop = () => {};

describe('ActivityForm', () => {
  it('renders type, subject, notes, and due date fields', () => {
    renderWithProviders(
      <ActivityForm onSubmit={noop} onCancel={noop} isSubmitting={false} submitLabel="Save" />,
    );

    expect(screen.getByTestId('activity-type-select')).toBeInTheDocument();
    expect(screen.getByTestId('activity-subject')).toBeInTheDocument();
    expect(screen.getByTestId('activity-notes')).toBeInTheDocument();
    expect(screen.getByTestId('activity-due-date')).toBeInTheDocument();
  });

  it('defaults type to "Note" with no due date', () => {
    renderWithProviders(
      <ActivityForm onSubmit={noop} onCancel={noop} isSubmitting={false} submitLabel="Save" />,
    );

    const typeSelect = screen.getByTestId('activity-type-select') as HTMLSelectElement;
    expect(typeSelect.value).toBe('Note');
  });

  it('auto-sets type to "Task" when a due date is entered', () => {
    renderWithProviders(
      <ActivityForm onSubmit={noop} onCancel={noop} isSubmitting={false} submitLabel="Save" />,
    );

    const dueDateInput = screen.getByTestId('activity-due-date');
    fireEvent.change(dueDateInput, { target: { value: '2026-06-30' } });

    const typeSelect = screen.getByTestId('activity-type-select') as HTMLSelectElement;
    expect(typeSelect.value).toBe('Task');
  });

  it('does not override a manually set type when due date changes', () => {
    renderWithProviders(
      <ActivityForm onSubmit={noop} onCancel={noop} isSubmitting={false} submitLabel="Save" />,
    );

    const typeSelect = screen.getByTestId('activity-type-select');
    fireEvent.change(typeSelect, { target: { value: 'Call' } });

    const dueDateInput = screen.getByTestId('activity-due-date');
    fireEvent.change(dueDateInput, { target: { value: '2026-06-30' } });

    expect((typeSelect as HTMLSelectElement).value).toBe('Call');
  });

  it('calls onSubmit with the correct values', () => {
    const handleSubmit = vi.fn();

    renderWithProviders(
      <ActivityForm
        onSubmit={handleSubmit}
        onCancel={noop}
        isSubmitting={false}
        submitLabel="Save"
      />,
    );

    fireEvent.change(screen.getByTestId('activity-subject'), {
      target: { value: 'Test subject' },
    });
    fireEvent.change(screen.getByTestId('activity-notes'), {
      target: { value: 'Some notes' },
    });

    fireEvent.submit(screen.getByTestId('activity-form'));

    expect(handleSubmit).toHaveBeenCalledWith({
      type: 'Note',
      subject: 'Test subject',
      notes: 'Some notes',
      due_date: '',
      direction: '',
      outcome: '',
      acceptedSuggestedTasks: [],
    });
  });

  it('calls onCancel when the cancel button is clicked', () => {
    const handleCancel = vi.fn();

    renderWithProviders(
      <ActivityForm
        onSubmit={noop}
        onCancel={handleCancel}
        isSubmitting={false}
        submitLabel="Save"
      />,
    );

    fireEvent.click(screen.getByTestId('activity-form-cancel'));
    expect(handleCancel).toHaveBeenCalledOnce();
  });

  it('disables the submit button when subject is empty', () => {
    renderWithProviders(
      <ActivityForm onSubmit={noop} onCancel={noop} isSubmitting={false} submitLabel="Save" />,
    );

    expect(screen.getByTestId('activity-form-submit')).toBeDisabled();
  });

  it('disables submit and cancel while submitting', () => {
    renderWithProviders(
      <ActivityForm onSubmit={noop} onCancel={noop} isSubmitting={true} submitLabel="Save" />,
    );

    expect(screen.getByTestId('activity-form-submit')).toBeDisabled();
    expect(screen.getByTestId('activity-form-cancel')).toBeDisabled();
  });

  it('populates fields from initialValues in edit mode', () => {
    renderWithProviders(
      <ActivityForm
        initialValues={{
          type: 'Meeting',
          subject: 'Existing subject',
          notes: 'Existing notes',
          due_date: '2026-03-15',
        }}
        onSubmit={noop}
        onCancel={noop}
        isSubmitting={false}
        submitLabel="Save changes"
      />,
    );

    expect((screen.getByTestId('activity-type-select') as HTMLSelectElement).value).toBe('Meeting');
    expect((screen.getByTestId('activity-subject') as HTMLInputElement).value).toBe(
      'Existing subject',
    );
    expect((screen.getByTestId('activity-notes') as HTMLTextAreaElement).value).toBe(
      'Existing notes',
    );
    expect((screen.getByTestId('activity-due-date') as HTMLInputElement).value).toBe('2026-03-15');
  });

  // MINCRM-82: direction field conditional rendering tests
  it('shows direction and outcome fields when type is Call', () => {
    renderWithProviders(
      <ActivityForm onSubmit={noop} onCancel={noop} isSubmitting={false} submitLabel="Save" />,
    );

    fireEvent.change(screen.getByTestId('activity-type-select'), { target: { value: 'Call' } });

    expect(screen.getByTestId('activity-direction-select')).toBeInTheDocument();
    expect(screen.getByTestId('activity-outcome')).toBeInTheDocument();
  });

  it('shows direction and outcome fields when type is Email', () => {
    renderWithProviders(
      <ActivityForm onSubmit={noop} onCancel={noop} isSubmitting={false} submitLabel="Save" />,
    );

    fireEvent.change(screen.getByTestId('activity-type-select'), { target: { value: 'Email' } });

    expect(screen.getByTestId('activity-direction-select')).toBeInTheDocument();
    expect(screen.getByTestId('activity-outcome')).toBeInTheDocument();
  });

  it('hides direction and outcome fields when type is Note', () => {
    renderWithProviders(
      <ActivityForm onSubmit={noop} onCancel={noop} isSubmitting={false} submitLabel="Save" />,
    );

    // Default is Note — direction and outcome should not be in the DOM
    expect(screen.queryByTestId('activity-direction-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('activity-outcome')).not.toBeInTheDocument();
  });

  // MINCRM-119: remaining absent-field branches for Task and Meeting
  it('hides direction and outcome fields when type is Task', () => {
    renderWithProviders(
      <ActivityForm onSubmit={noop} onCancel={noop} isSubmitting={false} submitLabel="Save" />,
    );

    fireEvent.change(screen.getByTestId('activity-type-select'), { target: { value: 'Task' } });

    expect(screen.queryByTestId('activity-direction-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('activity-outcome')).not.toBeInTheDocument();
  });

  it('hides direction and outcome fields when type is Meeting', () => {
    renderWithProviders(
      <ActivityForm onSubmit={noop} onCancel={noop} isSubmitting={false} submitLabel="Save" />,
    );

    fireEvent.change(screen.getByTestId('activity-type-select'), { target: { value: 'Meeting' } });

    expect(screen.queryByTestId('activity-direction-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('activity-outcome')).not.toBeInTheDocument();
  });

  it('disables submit when type is Call and direction is not selected', () => {
    renderWithProviders(
      <ActivityForm onSubmit={noop} onCancel={noop} isSubmitting={false} submitLabel="Save" />,
    );

    fireEvent.change(screen.getByTestId('activity-type-select'), { target: { value: 'Call' } });
    fireEvent.change(screen.getByTestId('activity-subject'), { target: { value: 'Follow up' } });

    // Direction is still empty — submit must be disabled
    expect(screen.getByTestId('activity-form-submit')).toBeDisabled();
  });

  it('displays a server-side error message', () => {
    renderWithProviders(
      <ActivityForm
        onSubmit={noop}
        onCancel={noop}
        isSubmitting={false}
        submitLabel="Save"
        error="Something went wrong"
      />,
    );

    expect(screen.getByTestId('activity-form-error')).toHaveTextContent('Something went wrong');
  });

  // MINCRM-436: AI call/note summarizer
  describe('AI summarizer', () => {
    // async: the Summarize button is feature-flag gated, and flag-gated UI now
    // appears once the flag query confirms it rather than rendering optimistically
    // on first paint, so its presence must be awaited. (MINCRM-695, MINCRM-696)
    it('shows the Summarize button for Note, Call, and Meeting types but not Email or Task', async () => {
      renderWithProviders(
        <ActivityForm onSubmit={noop} onCancel={noop} isSubmitting={false} submitLabel="Save" />,
      );

      // Default type is Note
      expect(await screen.findByTestId('activity-summarize-button')).toBeInTheDocument();

      fireEvent.change(screen.getByTestId('activity-type-select'), { target: { value: 'Email' } });
      expect(screen.queryByTestId('activity-summarize-button')).not.toBeInTheDocument();

      fireEvent.change(screen.getByTestId('activity-type-select'), { target: { value: 'Task' } });
      expect(screen.queryByTestId('activity-summarize-button')).not.toBeInTheDocument();

      fireEvent.change(screen.getByTestId('activity-type-select'), { target: { value: 'Call' } });
      expect(await screen.findByTestId('activity-summarize-button')).toBeInTheDocument();

      fireEvent.change(screen.getByTestId('activity-type-select'), {
        target: { value: 'Meeting' },
      });
      expect(await screen.findByTestId('activity-summarize-button')).toBeInTheDocument();
    });

    it('summarizes pasted text, populates notes, and reports accepted tasks on apply', async () => {
      server.use(
        http.post('/api/v1/activities/summarize', () =>
          HttpResponse.json({
            summary: 'Customer requested a revised proposal with updated pricing.',
            action_items: ['Send revised proposal.'],
            suggested_follow_up_tasks: [
              { description: 'Follow up on proposal', suggested_due_date: '2026-07-11' },
            ],
            generated_at: '2026-07-04T00:00:00.000Z',
          }),
        ),
      );

      const handleSubmit = vi.fn();
      const user = userEvent.setup();

      renderWithProviders(
        <ActivityForm
          onSubmit={handleSubmit}
          onCancel={noop}
          isSubmitting={false}
          submitLabel="Save"
        />,
      );

      await user.click(await screen.findByTestId('activity-summarize-button'));
      await user.type(screen.getByTestId('activity-summary-input'), 'Raw call transcript text');
      await user.click(screen.getByTestId('activity-summary-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('activity-summary-preview')).toBeInTheDocument();
      });
      expect(screen.getByTestId('activity-summary-preview')).toHaveValue(
        'Customer requested a revised proposal with updated pricing.',
      );
      expect(screen.getByTestId('activity-summary-action-items')).toHaveTextContent(
        'Send revised proposal.',
      );
      expect(screen.getByTestId('activity-summary-task-0')).toHaveTextContent(
        'Follow up on proposal',
      );

      await user.click(screen.getByTestId('activity-summary-apply'));

      await waitFor(() => {
        expect(screen.queryByTestId('activity-summary-modal')).not.toBeInTheDocument();
      });
      expect((screen.getByTestId('activity-notes') as HTMLTextAreaElement).value).toContain(
        'Customer requested a revised proposal',
      );
      expect((screen.getByTestId('activity-notes') as HTMLTextAreaElement).value).toContain(
        'Send revised proposal.',
      );

      // Accepted tasks are not created until the form is actually submitted (MINCRM-436).
      expect(handleSubmit).not.toHaveBeenCalled();
      await user.type(screen.getByTestId('activity-subject'), 'Renewal call');
      await user.click(screen.getByTestId('activity-form-submit'));

      expect(handleSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          acceptedSuggestedTasks: [
            { description: 'Follow up on proposal', suggested_due_date: '2026-07-11' },
          ],
        }),
      );
    });

    it('does not report a dismissed task when applying the summary', async () => {
      server.use(
        http.post('/api/v1/activities/summarize', () =>
          HttpResponse.json({
            summary: 'Summary text.',
            action_items: [],
            suggested_follow_up_tasks: [
              { description: 'Task A', suggested_due_date: '2026-07-11' },
              { description: 'Task B', suggested_due_date: '2026-07-12' },
            ],
            generated_at: '2026-07-04T00:00:00.000Z',
          }),
        ),
      );

      const handleSubmit = vi.fn();
      const user = userEvent.setup();

      renderWithProviders(
        <ActivityForm
          onSubmit={handleSubmit}
          onCancel={noop}
          isSubmitting={false}
          submitLabel="Save"
        />,
      );

      await user.click(await screen.findByTestId('activity-summarize-button'));
      await user.type(screen.getByTestId('activity-summary-input'), 'Raw call transcript text');
      await user.click(screen.getByTestId('activity-summary-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('activity-summary-task-0')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('activity-summary-task-dismiss-0'));
      await user.click(screen.getByTestId('activity-summary-apply'));
      await user.type(screen.getByTestId('activity-subject'), 'Renewal call');
      await user.click(screen.getByTestId('activity-form-submit'));

      expect(handleSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          acceptedSuggestedTasks: [{ description: 'Task B', suggested_due_date: '2026-07-12' }],
        }),
      );
    });

    it('shows an error when summarization fails', async () => {
      server.use(
        http.post('/api/v1/activities/summarize', () =>
          HttpResponse.json(
            { error: { code: 'AI_PROVIDER_ERROR', message: 'AI provider error' } },
            { status: 502 },
          ),
        ),
      );

      const user = userEvent.setup();
      renderWithProviders(
        <ActivityForm onSubmit={noop} onCancel={noop} isSubmitting={false} submitLabel="Save" />,
      );

      await user.click(await screen.findByTestId('activity-summarize-button'));
      await user.type(screen.getByTestId('activity-summary-input'), 'Raw call transcript text');
      await user.click(screen.getByTestId('activity-summary-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('activity-summary-error')).toBeInTheDocument();
      });
    });

    it('closes the modal without applying when cancel is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <ActivityForm onSubmit={noop} onCancel={noop} isSubmitting={false} submitLabel="Save" />,
      );

      await user.click(await screen.findByTestId('activity-summarize-button'));
      expect(screen.getByTestId('activity-summary-modal')).toBeInTheDocument();

      await user.click(screen.getByTestId('activity-summary-cancel'));
      expect(screen.queryByTestId('activity-summary-modal')).not.toBeInTheDocument();
      expect((screen.getByTestId('activity-notes') as HTMLTextAreaElement).value).toBe('');
    });
  });
});
