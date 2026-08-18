/**
 * Tests for the Select shared UI component.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Select } from './Select.js';

describe('Select', () => {
  it('renders a select element', () => {
    render(<Select />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders a label linked to the select when label prop is provided', () => {
    render(<Select id="role" label="Role" />);
    expect(screen.getByLabelText('Role')).toBeInTheDocument();
  });

  it('does not render a label when label prop is omitted', () => {
    const { container } = render(<Select />);
    expect(container.querySelector('label')).not.toBeInTheDocument();
  });

  it('renders children options', () => {
    render(
      <Select>
        <option value="admin">Admin</option>
        <option value="rep">Rep</option>
      </Select>,
    );
    expect(screen.getByRole('option', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Rep' })).toBeInTheDocument();
  });

  it('renders an error message when error prop is provided', () => {
    render(<Select error="Please select a role" />);
    expect(screen.getByText('Please select a role')).toBeInTheDocument();
  });

  it('does not render an error message when error prop is omitted', () => {
    render(<Select />);
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
  });

  it('applies red-border class when error prop is provided', () => {
    render(<Select error="Required" />);
    expect(screen.getByRole('combobox')).toHaveClass('border-red-500');
  });

  it('applies indigo-ring class when no error', () => {
    render(<Select />);
    expect(screen.getByRole('combobox')).toHaveClass('focus:ring-primary-500');
  });

  it('applies min-h touch-target class', () => {
    render(<Select />);
    expect(screen.getByRole('combobox')).toHaveClass('min-h-[44px]');
    expect(screen.getByRole('combobox')).toHaveClass('sm:min-h-0');
  });
});
