/**
 * Tests for CloseDealModal component.
 */

import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import CloseDealModal from './CloseDealModal.js';

const TODAY = '2026-03-31';
const noop = () => {};

describe('CloseDealModal', () => {
  it('does not render when isOpen is false', () => {
    renderWithProviders(
      <CloseDealModal
        isOpen={false}
        targetStage="Closed Won"
        initialCloseDate={TODAY}
        isSubmitting={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(screen.queryByTestId('close-deal-modal')).not.toBeInTheDocument();
  });

  it('renders the modal for Closed Won without a loss reason field', () => {
    renderWithProviders(
      <CloseDealModal
        isOpen={true}
        targetStage="Closed Won"
        initialCloseDate={TODAY}
        isSubmitting={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByTestId('close-deal-modal')).toBeInTheDocument();
    expect(screen.getByTestId('close-deal-date-input')).toBeInTheDocument();
    expect(screen.queryByTestId('close-deal-loss-reason-input')).not.toBeInTheDocument();
  });

  it('renders the modal for Closed Lost with a loss reason field', () => {
    renderWithProviders(
      <CloseDealModal
        isOpen={true}
        targetStage="Closed Lost"
        initialCloseDate={TODAY}
        isSubmitting={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByTestId('close-deal-modal')).toBeInTheDocument();
    expect(screen.getByTestId('close-deal-loss-reason-input')).toBeInTheDocument();
  });

  it('pre-fills the close date with initialCloseDate', () => {
    renderWithProviders(
      <CloseDealModal
        isOpen={true}
        targetStage="Closed Won"
        initialCloseDate={TODAY}
        isSubmitting={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    const dateInput = screen.getByTestId('close-deal-date-input') as HTMLInputElement;
    expect(dateInput.value).toBe(TODAY);
  });

  it('calls onConfirm with date and empty reason for Closed Won', () => {
    const onConfirm = vi.fn();
    renderWithProviders(
      <CloseDealModal
        isOpen={true}
        targetStage="Closed Won"
        initialCloseDate={TODAY}
        isSubmitting={false}
        onConfirm={onConfirm}
        onCancel={noop}
      />,
    );
    fireEvent.click(screen.getByTestId('close-deal-confirm'));
    expect(onConfirm).toHaveBeenCalledWith(TODAY, '');
  });

  it('calls onConfirm with date and loss reason for Closed Lost', () => {
    const onConfirm = vi.fn();
    renderWithProviders(
      <CloseDealModal
        isOpen={true}
        targetStage="Closed Lost"
        initialCloseDate={TODAY}
        isSubmitting={false}
        onConfirm={onConfirm}
        onCancel={noop}
      />,
    );
    fireEvent.change(screen.getByTestId('close-deal-loss-reason-input'), {
      target: { value: 'Budget cut' },
    });
    fireEvent.click(screen.getByTestId('close-deal-confirm'));
    expect(onConfirm).toHaveBeenCalledWith(TODAY, 'Budget cut');
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <CloseDealModal
        isOpen={true}
        targetStage="Closed Lost"
        initialCloseDate={TODAY}
        isSubmitting={false}
        onConfirm={noop}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('close-deal-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('disables confirm and cancel buttons when isSubmitting is true', () => {
    renderWithProviders(
      <CloseDealModal
        isOpen={true}
        targetStage="Closed Won"
        initialCloseDate={TODAY}
        isSubmitting={true}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByTestId('close-deal-confirm')).toBeDisabled();
    expect(screen.getByTestId('close-deal-cancel')).toBeDisabled();
  });

  it('shows an error message when error prop is set', () => {
    renderWithProviders(
      <CloseDealModal
        isOpen={true}
        targetStage="Closed Won"
        initialCloseDate={TODAY}
        isSubmitting={false}
        error="Something went wrong"
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByTestId('close-deal-error')).toHaveTextContent('Something went wrong');
  });

  it('date input has max attribute set to today to prevent future date selection', () => {
    renderWithProviders(
      <CloseDealModal
        isOpen={true}
        targetStage="Closed Won"
        initialCloseDate={TODAY}
        isSubmitting={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    const dateInput = screen.getByTestId('close-deal-date-input') as HTMLInputElement;
    expect(dateInput.max).toBe(TODAY);
  });

  it('calls onCancel when Escape key is pressed on the backdrop', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <CloseDealModal
        isOpen={true}
        targetStage="Closed Won"
        initialCloseDate={TODAY}
        isSubmitting={false}
        onConfirm={noop}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('close-deal-modal-overlay'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('updates the close date when the date input is changed', () => {
    const onConfirm = vi.fn();
    renderWithProviders(
      <CloseDealModal
        isOpen={true}
        targetStage="Closed Won"
        initialCloseDate={TODAY}
        isSubmitting={false}
        onConfirm={onConfirm}
        onCancel={noop}
      />,
    );
    fireEvent.change(screen.getByTestId('close-deal-date-input'), {
      target: { value: '2026-03-15' },
    });
    fireEvent.click(screen.getByTestId('close-deal-confirm'));
    expect(onConfirm).toHaveBeenCalledWith('2026-03-15', '');
  });
});
