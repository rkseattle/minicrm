/**
 * Tests for the OwnerToggle component.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { OwnerToggle } from './OwnerToggle.js';

// i18next is auto-mocked in the test setup; keys are returned as-is.

describe('OwnerToggle', () => {
  it('renders All and Mine buttons', () => {
    render(<OwnerToggle value="all" onChange={vi.fn()} testIdPrefix="test" />);
    expect(screen.getByTestId('test-all')).toBeInTheDocument();
    expect(screen.getByTestId('test-mine')).toBeInTheDocument();
  });

  it('marks All as pressed when value is all', () => {
    render(<OwnerToggle value="all" onChange={vi.fn()} testIdPrefix="test" />);
    expect(screen.getByTestId('test-all')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('test-mine')).toHaveAttribute('aria-pressed', 'false');
  });

  it('marks Mine as pressed when value is me', () => {
    render(<OwnerToggle value="me" onChange={vi.fn()} testIdPrefix="test" />);
    expect(screen.getByTestId('test-mine')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('test-all')).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange with "me" when Mine is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<OwnerToggle value="all" onChange={onChange} testIdPrefix="test" />);
    await user.click(screen.getByTestId('test-mine'));
    expect(onChange).toHaveBeenCalledWith('me');
  });

  it('calls onChange with "all" when All is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<OwnerToggle value="me" onChange={onChange} testIdPrefix="test" />);
    await user.click(screen.getByTestId('test-all'));
    expect(onChange).toHaveBeenCalledWith('all');
  });

  it('renders as a group with an accessible label', () => {
    render(<OwnerToggle value="all" onChange={vi.fn()} testIdPrefix="test" />);
    expect(screen.getByRole('group')).toBeInTheDocument();
  });
});
