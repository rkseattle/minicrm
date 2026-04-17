/**
 * Tests for the BulkActionBar component.
 * (MINCRM-188)
 */

import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import BulkActionBar, { type BulkAction } from './BulkActionBar.js';
import { renderWithProviders } from '../test/renderWithProviders.js';

const ACTIONS: BulkAction[] = [
  {
    key: 'reassign',
    labelKey: 'bulk.reassignButton',
    testId: 'bulk-reassign-button',
    variant: 'secondary',
  },
  { key: 'delete', labelKey: 'bulk.deleteButton', testId: 'bulk-delete-button', variant: 'danger' },
];

describe('BulkActionBar', () => {
  it('renders nothing when selectedCount is 0', () => {
    const { container } = renderWithProviders(
      <BulkActionBar
        selectedCount={0}
        actions={ACTIONS}
        onAction={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the bar when selectedCount is greater than 0', () => {
    renderWithProviders(
      <BulkActionBar
        selectedCount={2}
        actions={ACTIONS}
        onAction={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();
  });

  it('displays the selected count', () => {
    renderWithProviders(
      <BulkActionBar
        selectedCount={3}
        actions={ACTIONS}
        onAction={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    expect(screen.getByTestId('bulk-action-count')).toHaveTextContent('3');
  });

  it('renders all provided action buttons', () => {
    renderWithProviders(
      <BulkActionBar
        selectedCount={1}
        actions={ACTIONS}
        onAction={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    expect(screen.getByTestId('bulk-reassign-button')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-delete-button')).toBeInTheDocument();
  });

  it('calls onAction with the correct key when an action button is clicked', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <BulkActionBar
        selectedCount={2}
        actions={ACTIONS}
        onAction={onAction}
        onClearSelection={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId('bulk-reassign-button'));
    expect(onAction).toHaveBeenCalledWith('reassign');

    await user.click(screen.getByTestId('bulk-delete-button'));
    expect(onAction).toHaveBeenCalledWith('delete');
  });

  it('calls onClearSelection when clear button is clicked', () => {
    const onClearSelection = vi.fn();
    renderWithProviders(
      <BulkActionBar
        selectedCount={2}
        actions={ACTIONS}
        onAction={vi.fn()}
        onClearSelection={onClearSelection}
      />,
    );
    fireEvent.click(screen.getByTestId('bulk-clear-selection'));
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('hides the bar when selectedCount drops back to 0', () => {
    const { rerender } = renderWithProviders(
      <BulkActionBar
        selectedCount={2}
        actions={ACTIONS}
        onAction={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument();

    rerender(
      <BulkActionBar
        selectedCount={0}
        actions={ACTIONS}
        onAction={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
  });
});
