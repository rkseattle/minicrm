/**
 * Tests for the Pagination component.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Pagination } from './Pagination.js';

// i18next is auto-mocked in the test setup; keys are returned as-is.

describe('Pagination', () => {
  it('renders pagination container with testid', () => {
    render(<Pagination page={1} limit={10} total={30} onPageChange={vi.fn()} />);
    expect(screen.getByTestId('pagination')).toBeInTheDocument();
  });

  it('renders summary testid', () => {
    render(<Pagination page={1} limit={10} total={30} onPageChange={vi.fn()} />);
    expect(screen.getByTestId('pagination-summary')).toBeInTheDocument();
  });

  it('renders previous and next buttons', () => {
    render(<Pagination page={2} limit={10} total={30} onPageChange={vi.fn()} />);
    expect(screen.getByTestId('pagination-prev')).toBeInTheDocument();
    expect(screen.getByTestId('pagination-next')).toBeInTheDocument();
  });

  it('disables Previous button on page 1', () => {
    render(<Pagination page={1} limit={10} total={30} onPageChange={vi.fn()} />);
    expect(screen.getByTestId('pagination-prev')).toBeDisabled();
  });

  it('enables Previous button when page > 1', () => {
    render(<Pagination page={2} limit={10} total={30} onPageChange={vi.fn()} />);
    expect(screen.getByTestId('pagination-prev')).not.toBeDisabled();
  });

  it('disables Next button on last page', () => {
    render(<Pagination page={3} limit={10} total={30} onPageChange={vi.fn()} />);
    expect(screen.getByTestId('pagination-next')).toBeDisabled();
  });

  it('enables Next button when not on last page', () => {
    render(<Pagination page={1} limit={10} total={30} onPageChange={vi.fn()} />);
    expect(screen.getByTestId('pagination-next')).not.toBeDisabled();
  });

  it('calls onPageChange with page - 1 when Previous clicked', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination page={3} limit={10} total={30} onPageChange={onPageChange} />);
    await user.click(screen.getByTestId('pagination-prev'));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('calls onPageChange with page + 1 when Next clicked', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination page={1} limit={10} total={30} onPageChange={onPageChange} />);
    await user.click(screen.getByTestId('pagination-next'));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('renders page indicator testid', () => {
    render(<Pagination page={2} limit={10} total={30} onPageChange={vi.fn()} />);
    expect(screen.getByTestId('pagination-page-indicator')).toBeInTheDocument();
  });

  it('handles empty results (total 0) without errors', () => {
    render(<Pagination page={1} limit={10} total={0} onPageChange={vi.fn()} />);
    expect(screen.getByTestId('pagination')).toBeInTheDocument();
    expect(screen.getByTestId('pagination-prev')).toBeDisabled();
    expect(screen.getByTestId('pagination-next')).toBeDisabled();
  });

  describe('page-size selector (onLimitChange)', () => {
    it('renders pagination-limit-select when onLimitChange is provided', () => {
      render(
        <Pagination
          page={1}
          limit={25}
          total={100}
          onPageChange={vi.fn()}
          onLimitChange={vi.fn()}
        />,
      );
      expect(screen.getByTestId('pagination-limit-select')).toBeInTheDocument();
    });

    it('does not render pagination-limit-select when onLimitChange is omitted', () => {
      render(<Pagination page={1} limit={25} total={100} onPageChange={vi.fn()} />);
      expect(screen.queryByTestId('pagination-limit-select')).not.toBeInTheDocument();
    });

    it('renders all four page-size options (10, 25, 50, 100)', () => {
      render(
        <Pagination
          page={1}
          limit={25}
          total={100}
          onPageChange={vi.fn()}
          onLimitChange={vi.fn()}
        />,
      );
      const select = screen.getByTestId('pagination-limit-select');
      const options = Array.from(select.querySelectorAll('option')).map((o) =>
        Number((o as HTMLOptionElement).value),
      );
      expect(options).toEqual([10, 25, 50, 100]);
    });

    it('calls onLimitChange with the selected number when a new value is chosen', async () => {
      const user = userEvent.setup();
      const onLimitChange = vi.fn();
      render(
        <Pagination
          page={1}
          limit={25}
          total={100}
          onPageChange={vi.fn()}
          onLimitChange={onLimitChange}
        />,
      );
      await user.selectOptions(screen.getByTestId('pagination-limit-select'), '50');
      expect(onLimitChange).toHaveBeenCalledWith(50);
    });

    it('reflects the current limit as the selected option', () => {
      render(
        <Pagination
          page={1}
          limit={50}
          total={200}
          onPageChange={vi.fn()}
          onLimitChange={vi.fn()}
        />,
      );
      const select = screen.getByTestId('pagination-limit-select') as HTMLSelectElement;
      expect(select.value).toBe('50');
    });
  });
});
