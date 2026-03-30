/**
 * Tests for ActivityForm component.
 */

import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders.js';
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
});
