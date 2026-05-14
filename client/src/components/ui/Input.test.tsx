/**
 * Tests for the Input shared UI component.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Input } from './Input.js';

describe('Input', () => {
  it('renders an input element', () => {
    render(<Input />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders a label linked to the input when label prop is provided', () => {
    render(<Input id="email" label="Email address" />);
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
  });

  it('does not render a label element when label prop is omitted', () => {
    render(<Input />);
    expect(screen.queryByText(/label/i)).not.toBeInTheDocument();
  });

  it('renders an error message when error prop is provided', () => {
    render(<Input error="This field is required" />);
    expect(screen.getByText('This field is required')).toBeInTheDocument();
  });

  it('does not render an error message when error prop is omitted', () => {
    render(<Input />);
    expect(screen.queryByRole('paragraph')).not.toBeInTheDocument();
  });

  it('applies red-border class when error prop is provided', () => {
    render(<Input error="Invalid" />);
    expect(screen.getByRole('textbox')).toHaveClass('border-red-300');
  });

  it('applies indigo-ring class when no error', () => {
    render(<Input />);
    expect(screen.getByRole('textbox')).toHaveClass('focus:ring-primary-500');
  });

  it('applies yellow-border class when warning prop is true', () => {
    render(<Input warning />);
    expect(screen.getByRole('textbox')).toHaveClass('border-yellow-400');
    expect(screen.getByRole('textbox')).toHaveClass('focus:ring-yellow-400');
  });

  it('error takes precedence over warning when both are set', () => {
    render(<Input error="Invalid" warning />);
    expect(screen.getByRole('textbox')).toHaveClass('border-red-300');
    expect(screen.getByRole('textbox')).not.toHaveClass('border-yellow-400');
  });

  it('forwards native input props', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<Input placeholder="Enter text" onChange={handleChange} />);
    const input = screen.getByPlaceholderText('Enter text');
    await user.type(input, 'hello');
    expect(handleChange).toHaveBeenCalled();
  });

  it('renders as password type when type="password"', () => {
    render(<Input type="password" />);
    // password inputs are not role=textbox
    expect(document.querySelector('input[type="password"]')).toBeInTheDocument();
  });

  it('applies min-h touch-target class (MINCRM-98)', () => {
    render(<Input />);
    expect(screen.getByRole('textbox')).toHaveClass('min-h-[44px]');
    expect(screen.getByRole('textbox')).toHaveClass('sm:min-h-0');
  });
});
