/**
 * Tests for the Badge shared UI component.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Badge } from './Badge.js';

describe('Badge', () => {
  it('renders children text', () => {
    render(<Badge variant="success">Active</Badge>);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('applies emerald classes for success variant', () => {
    render(<Badge variant="success">Active</Badge>);
    expect(screen.getByText('Active')).toHaveClass('bg-emerald-50');
  });

  it('applies amber classes for warning variant', () => {
    render(<Badge variant="warning">Invited</Badge>);
    expect(screen.getByText('Invited')).toHaveClass('bg-amber-50');
  });

  it('applies red classes for error variant', () => {
    render(<Badge variant="error">Error</Badge>);
    expect(screen.getByText('Error')).toHaveClass('bg-red-50');
  });

  it('applies gray classes for neutral variant', () => {
    render(<Badge variant="neutral">Inactive</Badge>);
    expect(screen.getByText('Inactive')).toHaveClass('bg-gray-100');
  });
});
