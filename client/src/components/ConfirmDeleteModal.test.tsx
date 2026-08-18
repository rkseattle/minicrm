/**
 * Tests for the ConfirmDeleteModal component.
 */

import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import ConfirmDeleteModal from './ConfirmDeleteModal.js';

const noop = () => {};
const MESSAGE = 'Are you sure you want to delete this item? This cannot be undone.';

describe('ConfirmDeleteModal', () => {
  it('does not render when isOpen is false', () => {
    renderWithProviders(
      <ConfirmDeleteModal
        isOpen={false}
        message={MESSAGE}
        isDeleting={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(screen.queryByTestId('confirm-delete-modal')).not.toBeInTheDocument();
  });

  it('renders the modal with title and message when isOpen is true', () => {
    renderWithProviders(
      <ConfirmDeleteModal
        isOpen={true}
        message={MESSAGE}
        isDeleting={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByTestId('confirm-delete-modal')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-delete-message')).toHaveTextContent(MESSAGE);
    expect(screen.getByTestId('confirm-delete-title')).toBeInTheDocument();
  });

  it('is a dialog element with aria-modal and aria-labelledby', () => {
    renderWithProviders(
      <ConfirmDeleteModal
        isOpen={true}
        message={MESSAGE}
        isDeleting={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    const dialog = screen.getByTestId('confirm-delete-modal');
    expect(dialog.tagName.toLowerCase()).toBe('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'confirm-delete-title');
  });

  it('calls onConfirm when the delete button is clicked', () => {
    const onConfirm = vi.fn();
    renderWithProviders(
      <ConfirmDeleteModal
        isOpen={true}
        message={MESSAGE}
        isDeleting={false}
        onConfirm={onConfirm}
        onCancel={noop}
      />,
    );
    fireEvent.click(screen.getByTestId('confirm-delete-confirm'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when the cancel button is clicked', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <ConfirmDeleteModal
        isOpen={true}
        message={MESSAGE}
        isDeleting={false}
        onConfirm={noop}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('confirm-delete-cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel when the backdrop is clicked', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <ConfirmDeleteModal
        isOpen={true}
        message={MESSAGE}
        isDeleting={false}
        onConfirm={noop}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('confirm-delete-modal-overlay'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel when Escape key is pressed', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <ConfirmDeleteModal
        isOpen={true}
        message={MESSAGE}
        isDeleting={false}
        onConfirm={noop}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('confirm-delete-modal-overlay'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('disables confirm and cancel buttons when isDeleting is true', () => {
    renderWithProviders(
      <ConfirmDeleteModal
        isOpen={true}
        message={MESSAGE}
        isDeleting={true}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByTestId('confirm-delete-confirm')).toBeDisabled();
    expect(screen.getByTestId('confirm-delete-cancel')).toBeDisabled();
  });

  it('does not call onCancel when backdrop is clicked while isDeleting', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <ConfirmDeleteModal
        isOpen={true}
        message={MESSAGE}
        isDeleting={true}
        onConfirm={noop}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('confirm-delete-modal-overlay'));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('does not call onCancel when Escape pressed while isDeleting', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <ConfirmDeleteModal
        isOpen={true}
        message={MESSAGE}
        isDeleting={true}
        onConfirm={noop}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('confirm-delete-modal-overlay'), { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
