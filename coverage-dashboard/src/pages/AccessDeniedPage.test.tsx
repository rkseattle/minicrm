import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AccessDeniedPage from './AccessDeniedPage.js';

describe('AccessDeniedPage', () => {
  it('renders the access-denied message', () => {
    render(<AccessDeniedPage />);
    expect(screen.getByTestId('access-denied-page')).toBeInTheDocument();
    expect(screen.getByText(/admins only/i)).toBeInTheDocument();
  });
});
