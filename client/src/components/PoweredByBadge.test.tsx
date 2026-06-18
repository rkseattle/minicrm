/**
 * Tests for PoweredByBadge component. (MINCRM-356)
 */

import { screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import PoweredByBadge from './PoweredByBadge.js';

describe('PoweredByBadge', () => {
  it('renders the badge link', () => {
    renderWithProviders(<PoweredByBadge />);
    const badge = screen.getByTestId('powered-by-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute('href', 'https://minicrm.app');
    expect(badge).toHaveAttribute('target', '_blank');
  });
});
