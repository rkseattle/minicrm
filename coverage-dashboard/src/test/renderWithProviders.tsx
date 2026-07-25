/**
 * Test utility: renders a component wrapped in the providers this app's
 * pages need (React Query + React Router). Adapted from minicrm-client's
 * own renderWithProviders.tsx (no shared code; this app has no
 * NavLayoutContext/BreakpointContext/BrandingContext equivalents).
 */

import { render, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

interface RenderOptions {
  initialEntries?: string[];
  path?: string;
  queryClient?: QueryClient;
}

export function renderWithProviders(
  ui: React.ReactElement,
  { initialEntries = ['/'], path, queryClient: providedQueryClient }: RenderOptions = {},
): RenderResult {
  const queryClient =
    providedQueryClient ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });

  const content = path ? (
    <Routes>
      <Route path={path} element={ui} />
    </Routes>
  ) : (
    ui
  );

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>{content}</MemoryRouter>
    </QueryClientProvider>,
  );
}
