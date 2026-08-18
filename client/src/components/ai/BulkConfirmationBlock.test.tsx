/**
 * Tests for BulkConfirmationBlock.
 *
 * Covers:
 *  - Renders Delete badge, summary, and affected count
 *  - Shows bulk sample chips
 *  - Confirm button is disabled until user types count or "DELETE"
 *  - Confirm button enables when user types exact count string
 *  - Confirm button enables when user types "DELETE" (case-insensitive)
 *  - Confirm button remains disabled for partial match
 *  - isDisabled: all interactive elements disabled, spinner visible
 *  - onConfirm fires when confirm is allowed and button clicked
 *  - onCancel fires on cancel click
 */

import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import BulkConfirmationBlock from './BulkConfirmationBlock.js';
import type { AiPendingAction } from '@shared/schemas/aiSessionSchema.js';

const BULK_DELETE: AiPendingAction = {
  operation: 'delete',
  entityType: 'contact',
  fields: {},
  isBulk: true,
  isBulkDelete: true,
  bulkCount: 5,
  bulkSample: ['Alice', 'Bob', 'Carol'],
  summary: 'Delete 5 contacts tagged test-data',
};

describe('BulkConfirmationBlock — rendering', () => {
  it('renders the bulk confirmation block with Delete badge', () => {
    renderWithProviders(
      <BulkConfirmationBlock
        pendingAction={BULK_DELETE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        confirmText=""
        onConfirmTextChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('nli-bulk-confirmation-block')).toBeInTheDocument();
    expect(screen.getByTestId('nli-operation-badge')).toBeInTheDocument();
  });

  it('shows warning callout', () => {
    renderWithProviders(
      <BulkConfirmationBlock
        pendingAction={BULK_DELETE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        confirmText=""
        onConfirmTextChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('nli-bulk-delete-warning')).toBeInTheDocument();
  });

  it('shows bulk sample chips', () => {
    renderWithProviders(
      <BulkConfirmationBlock
        pendingAction={BULK_DELETE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        confirmText=""
        onConfirmTextChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('nli-bulk-sample')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });
});

describe('BulkConfirmationBlock — double-confirm gate', () => {
  it('confirm button is disabled when confirmText is empty', () => {
    renderWithProviders(
      <BulkConfirmationBlock
        pendingAction={BULK_DELETE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        confirmText=""
        onConfirmTextChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('nli-confirm-button')).toBeDisabled();
  });

  it('confirm button enables when confirmText matches bulk count', () => {
    renderWithProviders(
      <BulkConfirmationBlock
        pendingAction={BULK_DELETE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        confirmText="5"
        onConfirmTextChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('nli-confirm-button')).not.toBeDisabled();
  });

  it('confirm button enables when confirmText is "DELETE" (uppercase)', () => {
    renderWithProviders(
      <BulkConfirmationBlock
        pendingAction={BULK_DELETE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        confirmText="DELETE"
        onConfirmTextChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('nli-confirm-button')).not.toBeDisabled();
  });

  it('confirm button enables when confirmText is "delete" (lowercase)', () => {
    renderWithProviders(
      <BulkConfirmationBlock
        pendingAction={BULK_DELETE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        confirmText="delete"
        onConfirmTextChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('nli-confirm-button')).not.toBeDisabled();
  });

  it('confirm button remains disabled for partial count match', () => {
    renderWithProviders(
      <BulkConfirmationBlock
        pendingAction={BULK_DELETE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        confirmText="55"
        onConfirmTextChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('nli-confirm-button')).toBeDisabled();
  });

  it('confirm button remains disabled for partial DELETE match', () => {
    renderWithProviders(
      <BulkConfirmationBlock
        pendingAction={BULK_DELETE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        confirmText="DELET"
        onConfirmTextChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('nli-confirm-button')).toBeDisabled();
  });

  it('calls onConfirmTextChange when user types in the input', () => {
    const onConfirmTextChange = vi.fn();
    renderWithProviders(
      <BulkConfirmationBlock
        pendingAction={BULK_DELETE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        confirmText=""
        onConfirmTextChange={onConfirmTextChange}
      />,
    );
    fireEvent.change(screen.getByTestId('nli-bulk-delete-confirm-input'), {
      target: { value: '5' },
    });
    expect(onConfirmTextChange).toHaveBeenCalledWith('5');
  });

  it('calls onConfirm when confirm is allowed and button clicked', () => {
    const onConfirm = vi.fn();
    renderWithProviders(
      <BulkConfirmationBlock
        pendingAction={BULK_DELETE}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        confirmText="5"
        onConfirmTextChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('nli-confirm-button'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <BulkConfirmationBlock
        pendingAction={BULK_DELETE}
        onConfirm={vi.fn()}
        onCancel={onCancel}
        confirmText=""
        onConfirmTextChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('nli-cancel-button'));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe('BulkConfirmationBlock — isDisabled', () => {
  it('disables input and buttons when isDisabled=true', () => {
    renderWithProviders(
      <BulkConfirmationBlock
        pendingAction={BULK_DELETE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        confirmText="5"
        onConfirmTextChange={vi.fn()}
        isDisabled
      />,
    );
    expect(screen.getByTestId('nli-bulk-delete-confirm-input')).toBeDisabled();
    expect(screen.getByTestId('nli-confirm-button')).toBeDisabled();
    expect(screen.getByTestId('nli-cancel-button')).toBeDisabled();
  });

  it('does not call onConfirm when disabled and button is clicked', () => {
    const onConfirm = vi.fn();
    renderWithProviders(
      <BulkConfirmationBlock
        pendingAction={BULK_DELETE}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        confirmText="5"
        onConfirmTextChange={vi.fn()}
        isDisabled
      />,
    );
    fireEvent.click(screen.getByTestId('nli-confirm-button'));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
