/**
 * Tests for the Textarea shared UI component.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Textarea } from './Textarea.js';

describe('Textarea', () => {
  it('links its label, with or without a caller-supplied id', () => {
    render(
      <>
        <Textarea id="notes" label="Notes" />
        <Textarea label="Body" />
      </>,
    );
    expect(screen.getByLabelText('Notes')).toHaveAttribute('id', 'notes');
    expect(screen.getByLabelText('Body').tagName).toBe('TEXTAREA');
  });

  it('ties the error message to the field and marks the field invalid', () => {
    render(<Textarea label="Body" error="Required" aria-describedby="hint" />);
    const field = screen.getByLabelText('Body');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field.getAttribute('aria-describedby')?.split(' ')).toEqual([
      'hint',
      `${field.id}-error`,
    ]);
    expect(field).toHaveAccessibleDescription('Required');
    expect(field).toHaveClass('border-red-300');
  });

  it('is neither invalid nor described by an error without one', () => {
    render(<Textarea label="Body" />);
    const field = screen.getByLabelText('Body');
    expect(field).not.toHaveAttribute('aria-invalid');
    expect(field).not.toHaveAttribute('aria-describedby');
    expect(field).toHaveClass('focus:ring-primary-500');
  });

  it('styles its disabled state', () => {
    render(<Textarea label="Body" disabled />);
    expect(screen.getByLabelText('Body')).toHaveClass('disabled:bg-gray-50');
  });
});
