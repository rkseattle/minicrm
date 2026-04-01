/**
 * Test utility: renders a component wrapped in all required React providers.
 * Use this instead of bare render() for components that use React Query or React Router.
 */

import { render, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

interface RenderOptions {
  /** Initial URL entries for MemoryRouter (default: ['/']) */
  initialEntries?: string[];
  /**
   * Route path pattern (e.g. '/contacts/:id').
   * When provided, wraps the component in <Routes><Route path={path} .../></Routes>
   * so that useParams() resolves correctly.
   */
  path?: string;
  /**
   * Optional pre-configured QueryClient to use instead of creating a new one.
   * Useful for tests that need to spy on queryClient methods or inspect the cache.
   */
  queryClient?: QueryClient;
}

/**
 * Renders a React element inside QueryClientProvider + MemoryRouter.
 * Creates a fresh QueryClient per call with retries disabled to keep tests fast.
 *
 * @param ui - The React element to render
 * @param options - Optional router configuration
 * @returns RTL render result
 */
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
