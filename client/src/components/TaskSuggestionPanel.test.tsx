/**
 * Tests for the TaskSuggestionPanel component.
 */

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import TaskSuggestionPanel from './TaskSuggestionPanel.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import type { SuggestedTask } from '@shared/schemas/taskSuggestionSchema.js';

const SUGGESTIONS: SuggestedTask[] = [
  {
    description: 'Send revised proposal',
    suggested_due_date: '2026-07-11',
    linked_entity: 'contact',
  },
  { description: 'Schedule demo', suggested_due_date: '2026-07-12', linked_entity: 'opportunity' },
];

describe('TaskSuggestionPanel', () => {
  it('renders all suggestions with descriptions and due dates', () => {
    renderWithProviders(
      <TaskSuggestionPanel suggestions={SUGGESTIONS} onAccept={vi.fn()} onDismissAll={vi.fn()} />,
    );

    expect(screen.getByTestId('task-suggestion-0')).toHaveTextContent('Send revised proposal');
    expect(screen.getByTestId('task-suggestion-0')).toHaveTextContent('2026-07-11');
    expect(screen.getByTestId('task-suggestion-1')).toHaveTextContent('Schedule demo');
  });

  it('calls onAccept with the task and removes it from the list', async () => {
    const handleAccept = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <TaskSuggestionPanel
        suggestions={SUGGESTIONS}
        onAccept={handleAccept}
        onDismissAll={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId('task-suggestion-accept-0'));

    expect(handleAccept).toHaveBeenCalledWith(SUGGESTIONS[0], 0);
    expect(screen.queryByTestId('task-suggestion-0')).not.toBeInTheDocument();
    expect(screen.getByTestId('task-suggestion-1')).toBeInTheDocument();
  });

  it('dismisses a single suggestion without calling onAccept', async () => {
    const handleAccept = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <TaskSuggestionPanel
        suggestions={SUGGESTIONS}
        onAccept={handleAccept}
        onDismissAll={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId('task-suggestion-dismiss-0'));

    expect(handleAccept).not.toHaveBeenCalled();
    expect(screen.queryByTestId('task-suggestion-0')).not.toBeInTheDocument();
  });

  it('shows the resolved-empty state once all suggestions are handled', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <TaskSuggestionPanel suggestions={SUGGESTIONS} onAccept={vi.fn()} onDismissAll={vi.fn()} />,
    );

    await user.click(screen.getByTestId('task-suggestion-dismiss-0'));
    await user.click(screen.getByTestId('task-suggestion-dismiss-1'));

    expect(screen.getByTestId('task-suggestion-empty')).toBeInTheDocument();
  });

  it('calls onDismissAll when the panel dismiss button is clicked', async () => {
    const handleDismissAll = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <TaskSuggestionPanel
        suggestions={SUGGESTIONS}
        onAccept={vi.fn()}
        onDismissAll={handleDismissAll}
      />,
    );

    await user.click(screen.getByTestId('task-suggestion-panel-dismiss'));
    expect(handleDismissAll).toHaveBeenCalledOnce();
  });
});
