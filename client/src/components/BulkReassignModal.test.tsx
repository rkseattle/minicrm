/**
 * Tests for BulkReassignModal.
 */

import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import BulkReassignModal from './BulkReassignModal.js';
import type { ActiveUser } from '@/api/users.js';

const noop = () => {};

const USERS: ActiveUser[] = [
  { id: 'u1', name: 'Alice' },
  { id: 'u2', name: 'Bob' },
];

describe('BulkReassignModal', () => {
  it('does not render when isOpen is false', () => {
    renderWithProviders(
      <BulkReassignModal
        isOpen={false}
        selectedCount={2}
        users={USERS}
        isPending={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(screen.queryByTestId('bulk-reassign-modal')).not.toBeInTheDocument();
  });

  it('renders the modal with owner select when isOpen is true', () => {
    renderWithProviders(
      <BulkReassignModal
        isOpen={true}
        selectedCount={2}
        users={USERS}
        isPending={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByTestId('bulk-reassign-modal')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-reassign-owner-select')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('is a dialog element with aria-modal and aria-labelledby', () => {
    renderWithProviders(
      <BulkReassignModal
        isOpen={true}
        selectedCount={2}
        users={USERS}
        isPending={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    const dialog = screen.getByTestId('bulk-reassign-modal');
    expect(dialog.tagName.toLowerCase()).toBe('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'bulk-reassign-title');
  });

  it('confirm button is disabled when no owner is selected', () => {
    renderWithProviders(
      <BulkReassignModal
        isOpen={true}
        selectedCount={2}
        users={USERS}
        isPending={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByTestId('bulk-reassign-confirm')).toBeDisabled();
  });

  it('calls onConfirm with the selected owner_id when confirmed', () => {
    const onConfirm = vi.fn();
    renderWithProviders(
      <BulkReassignModal
        isOpen={true}
        selectedCount={2}
        users={USERS}
        isPending={false}
        onConfirm={onConfirm}
        onCancel={noop}
      />,
    );
    fireEvent.change(screen.getByTestId('bulk-reassign-owner-select'), {
      target: { value: 'u1' },
    });
    fireEvent.click(screen.getByTestId('bulk-reassign-confirm'));
    expect(onConfirm).toHaveBeenCalledWith('u1');
  });

  it('calls onCancel when the cancel button is clicked', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <BulkReassignModal
        isOpen={true}
        selectedCount={2}
        users={USERS}
        isPending={false}
        onConfirm={noop}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('bulk-reassign-cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel when the backdrop is clicked', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <BulkReassignModal
        isOpen={true}
        selectedCount={2}
        users={USERS}
        isPending={false}
        onConfirm={noop}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('bulk-reassign-modal-overlay'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel when Escape key is pressed', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <BulkReassignModal
        isOpen={true}
        selectedCount={2}
        users={USERS}
        isPending={false}
        onConfirm={noop}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('bulk-reassign-modal-overlay'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('disables buttons and select when isPending is true', () => {
    renderWithProviders(
      <BulkReassignModal
        isOpen={true}
        selectedCount={2}
        users={USERS}
        isPending={true}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByTestId('bulk-reassign-confirm')).toBeDisabled();
    expect(screen.getByTestId('bulk-reassign-cancel')).toBeDisabled();
    expect(screen.getByTestId('bulk-reassign-owner-select')).toBeDisabled();
  });

  it('does not call onCancel when Escape pressed while isPending', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <BulkReassignModal
        isOpen={true}
        selectedCount={2}
        users={USERS}
        isPending={true}
        onConfirm={noop}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('bulk-reassign-modal-overlay'), { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('does not call onCancel when backdrop clicked while isPending', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <BulkReassignModal
        isOpen={true}
        selectedCount={2}
        users={USERS}
        isPending={true}
        onConfirm={noop}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('bulk-reassign-modal-overlay'));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
