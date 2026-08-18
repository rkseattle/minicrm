/**
 * Tests for BulkFailedDetailsModal.
 */

import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import BulkFailedDetailsModal from './BulkFailedDetailsModal.js';

const FAILURES = [
  { id: '00000000-0000-0000-0000-000000000001', reason: 'Record not found' },
  { id: '00000000-0000-0000-0000-000000000002', reason: 'Permission denied' },
];

describe('BulkFailedDetailsModal', () => {
  it('renders nothing when isOpen is false', () => {
    renderWithProviders(
      <BulkFailedDetailsModal isOpen={false} failures={FAILURES} onClose={vi.fn()} />,
    );
    expect(screen.queryByTestId('bulk-failed-details-modal')).not.toBeInTheDocument();
  });

  it('renders the modal and failure rows when isOpen is true', () => {
    renderWithProviders(
      <BulkFailedDetailsModal isOpen={true} failures={FAILURES} onClose={vi.fn()} />,
    );
    expect(screen.getByTestId('bulk-failed-details-modal')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-failed-details-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-failed-details-row-1')).toBeInTheDocument();
    expect(screen.getByText('Record not found')).toBeInTheDocument();
    expect(screen.getByText('Permission denied')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <BulkFailedDetailsModal isOpen={true} failures={FAILURES} onClose={onClose} />,
    );
    fireEvent.click(screen.getByTestId('bulk-failed-details-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <BulkFailedDetailsModal isOpen={true} failures={FAILURES} onClose={onClose} />,
    );
    fireEvent.click(screen.getByTestId('bulk-failed-details-modal'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not propagate clicks from the inner content panel to the backdrop', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <BulkFailedDetailsModal isOpen={true} failures={FAILURES} onClose={onClose} />,
    );
    // Click the close button (inside the inner panel) — stopPropagation on the
    // inner div prevents the click from reaching the backdrop handler a second time
    fireEvent.click(screen.getByTestId('bulk-failed-details-close'));
    // onClose is called exactly once (by the button), not twice (button + backdrop)
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders an empty table body when failures is an empty array', () => {
    renderWithProviders(<BulkFailedDetailsModal isOpen={true} failures={[]} onClose={vi.fn()} />);
    expect(screen.getByTestId('bulk-failed-details-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('bulk-failed-details-row-0')).not.toBeInTheDocument();
  });
});
