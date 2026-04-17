/**
 * Tests for BulkChangeStageModal (MINCRM-188).
 */

import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import BulkChangeStageModal from './BulkChangeStageModal.js';
import type { PipelineStageResponse } from '@shared/schemas/pipelineStageSchema.js';

const noop = () => {};

const STAGES: PipelineStageResponse[] = [
  {
    id: 's1',
    name: 'Prospecting',
    sort_order: 1,
    probability: 10,
    is_terminal: false,
    is_fixed: true,
  },
  {
    id: 's2',
    name: 'Qualification',
    sort_order: 2,
    probability: 25,
    is_terminal: false,
    is_fixed: true,
  },
];

describe('BulkChangeStageModal', () => {
  it('does not render when isOpen is false', () => {
    renderWithProviders(
      <BulkChangeStageModal
        isOpen={false}
        selectedCount={3}
        stages={STAGES}
        isPending={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(screen.queryByTestId('bulk-change-stage-modal')).not.toBeInTheDocument();
  });

  it('renders the modal with stage select when isOpen is true', () => {
    renderWithProviders(
      <BulkChangeStageModal
        isOpen={true}
        selectedCount={3}
        stages={STAGES}
        isPending={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByTestId('bulk-change-stage-modal')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-change-stage-select')).toBeInTheDocument();
  });

  it('confirm button is disabled when no stage is selected', () => {
    renderWithProviders(
      <BulkChangeStageModal
        isOpen={true}
        selectedCount={3}
        stages={STAGES}
        isPending={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByTestId('bulk-change-stage-confirm')).toBeDisabled();
  });

  it('calls onConfirm with the selected stage name when confirmed', () => {
    const onConfirm = vi.fn();
    renderWithProviders(
      <BulkChangeStageModal
        isOpen={true}
        selectedCount={3}
        stages={STAGES}
        isPending={false}
        onConfirm={onConfirm}
        onCancel={noop}
      />,
    );
    fireEvent.change(screen.getByTestId('bulk-change-stage-select'), {
      target: { value: 'Prospecting' },
    });
    fireEvent.click(screen.getByTestId('bulk-change-stage-confirm'));
    expect(onConfirm).toHaveBeenCalledWith('Prospecting');
  });

  it('calls onCancel when the cancel button is clicked', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <BulkChangeStageModal
        isOpen={true}
        selectedCount={3}
        stages={STAGES}
        isPending={false}
        onConfirm={noop}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('bulk-change-stage-cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel when the backdrop is clicked', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <BulkChangeStageModal
        isOpen={true}
        selectedCount={3}
        stages={STAGES}
        isPending={false}
        onConfirm={noop}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('bulk-change-stage-modal'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel when Escape key is pressed', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <BulkChangeStageModal
        isOpen={true}
        selectedCount={3}
        stages={STAGES}
        isPending={false}
        onConfirm={noop}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('bulk-change-stage-modal'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('disables buttons and select when isPending is true', () => {
    renderWithProviders(
      <BulkChangeStageModal
        isOpen={true}
        selectedCount={3}
        stages={STAGES}
        isPending={true}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByTestId('bulk-change-stage-confirm')).toBeDisabled();
    expect(screen.getByTestId('bulk-change-stage-cancel')).toBeDisabled();
    expect(screen.getByTestId('bulk-change-stage-select')).toBeDisabled();
  });

  it('does not call onCancel when Escape pressed while isPending', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <BulkChangeStageModal
        isOpen={true}
        selectedCount={3}
        stages={STAGES}
        isPending={true}
        onConfirm={noop}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('bulk-change-stage-modal'), { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('does not call onCancel when backdrop clicked while isPending', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <BulkChangeStageModal
        isOpen={true}
        selectedCount={3}
        stages={STAGES}
        isPending={true}
        onConfirm={noop}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('bulk-change-stage-modal'));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
