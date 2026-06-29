/**
 * Tests for MutationConfirmationBlock. (MINCRM-425)
 *
 * Covers:
 *  - Renders operation badge and summary for create / update / delete
 *  - Shows field table for create and update; hides it for delete
 *  - Shows entity name/id prominently on single-record delete
 *  - Shows bulk count and sample chips for bulk operations
 *  - Confirm and Cancel buttons trigger callbacks
 *  - isDisabled: buttons are disabled and spinner is visible
 */

import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '../../test/renderWithProviders.js';
import MutationConfirmationBlock from './MutationConfirmationBlock.js';
import type { AiPendingAction } from '@shared/schemas/aiSessionSchema.js';

const BASE_CREATE: AiPendingAction = {
  operation: 'create',
  entityType: 'contact',
  fields: { first_name: 'Jane', email: 'jane@example.com' },
  isBulk: false,
  summary: 'Create a new contact Jane',
};

const BASE_UPDATE: AiPendingAction = {
  operation: 'update',
  entityType: 'deal',
  entityId: 'd1',
  entityName: 'Acme Contract',
  fields: { close_date: '2026-12-31' },
  isBulk: false,
  summary: 'Update the close date',
};

const BASE_DELETE: AiPendingAction = {
  operation: 'delete',
  entityType: 'contact',
  entityId: 'c1',
  entityName: 'Bob Smith',
  fields: {},
  isBulk: false,
  summary: 'Delete contact Bob Smith',
};

describe('MutationConfirmationBlock — create operation', () => {
  it('renders Create badge and summary', () => {
    renderWithProviders(
      <MutationConfirmationBlock
        pendingAction={BASE_CREATE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId('nli-operation-badge')).toBeInTheDocument();
    expect(screen.getByText('Create a new contact Jane')).toBeInTheDocument();
  });

  it('shows field table with field names', () => {
    renderWithProviders(
      <MutationConfirmationBlock
        pendingAction={BASE_CREATE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId('nli-confirmation-fields')).toBeInTheDocument();
    expect(screen.getByText('first_name')).toBeInTheDocument();
    expect(screen.getByText('Jane')).toBeInTheDocument();
  });

  it('calls onConfirm when Confirm button clicked', () => {
    const onConfirm = vi.fn();
    renderWithProviders(
      <MutationConfirmationBlock
        pendingAction={BASE_CREATE}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('nli-confirm-button'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when Cancel button clicked', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <MutationConfirmationBlock
        pendingAction={BASE_CREATE}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('nli-cancel-button'));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe('MutationConfirmationBlock — update operation', () => {
  it('renders Update badge', () => {
    renderWithProviders(
      <MutationConfirmationBlock
        pendingAction={BASE_UPDATE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId('nli-operation-badge')).toBeInTheDocument();
  });

  it('shows field table with new-value header for update', () => {
    renderWithProviders(
      <MutationConfirmationBlock
        pendingAction={BASE_UPDATE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId('nli-confirmation-fields')).toBeInTheDocument();
    expect(screen.getByText('close_date')).toBeInTheDocument();
  });
});

describe('MutationConfirmationBlock — delete operation', () => {
  it('renders Delete badge', () => {
    renderWithProviders(
      <MutationConfirmationBlock
        pendingAction={BASE_DELETE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId('nli-operation-badge')).toBeInTheDocument();
  });

  it('hides field table on single-record delete', () => {
    renderWithProviders(
      <MutationConfirmationBlock
        pendingAction={BASE_DELETE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('nli-confirmation-fields')).not.toBeInTheDocument();
  });

  it('shows entity name prominently', () => {
    renderWithProviders(
      <MutationConfirmationBlock
        pendingAction={BASE_DELETE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('Bob Smith')).toBeInTheDocument();
  });
});

describe('MutationConfirmationBlock — bulk operation', () => {
  const BULK: AiPendingAction = {
    operation: 'update',
    entityType: 'contact',
    fields: { status: 'inactive' },
    isBulk: true,
    bulkCount: 5,
    bulkSample: ['Alice', 'Bob', 'Carol'],
    summary: 'Mark 5 contacts inactive',
  };

  it('shows bulk count and sample chips', () => {
    renderWithProviders(
      <MutationConfirmationBlock pendingAction={BULK} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByTestId('nli-bulk-sample')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });
});

describe('MutationConfirmationBlock — isDisabled', () => {
  it('disables both buttons and shows spinner when isDisabled=true', () => {
    renderWithProviders(
      <MutationConfirmationBlock
        pendingAction={BASE_CREATE}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        isDisabled
      />,
    );
    expect(screen.getByTestId('nli-confirm-button')).toBeDisabled();
    expect(screen.getByTestId('nli-cancel-button')).toBeDisabled();
  });

  it('does not call onConfirm when disabled and button is clicked', () => {
    const onConfirm = vi.fn();
    renderWithProviders(
      <MutationConfirmationBlock
        pendingAction={BASE_CREATE}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        isDisabled
      />,
    );
    fireEvent.click(screen.getByTestId('nli-confirm-button'));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
