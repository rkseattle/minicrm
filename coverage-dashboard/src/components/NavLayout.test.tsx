import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Routes, Route } from 'react-router-dom';
import NavLayout from './NavLayout.js';
import { renderWithProviders } from '@/test/renderWithProviders.js';
import { server } from '@/test/setup.js';

function TestApp() {
  return (
    <Routes>
      <Route element={<NavLayout />}>
        <Route path="/" element={<div>Page content</div>} />
      </Route>
    </Routes>
  );
}

describe('NavLayout', () => {
  it('renders the nav bar and child route content', () => {
    renderWithProviders(<TestApp />);
    expect(screen.getByTestId('nav-link-overview')).toBeInTheDocument();
    expect(screen.getByTestId('nav-link-gaps')).toBeInTheDocument();
    expect(screen.getByTestId('nav-link-traceability')).toBeInTheDocument();
    expect(screen.getByTestId('nav-link-sessions')).toBeInTheDocument();
    expect(screen.getByText('Page content')).toBeInTheDocument();
  });

  it('calls the logout endpoint when Sign out is clicked', async () => {
    let logoutCalled = false;
    server.use(
      http.post('*/api/v1/auth/logout', () => {
        logoutCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithProviders(<TestApp />);

    await userEvent.click(screen.getByTestId('nav-logout-button'));

    await waitFor(() => expect(logoutCalled).toBe(true));
  });
});
