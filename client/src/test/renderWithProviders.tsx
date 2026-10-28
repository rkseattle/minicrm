/**
 * Test utility: renders a component wrapped in all required React providers.
 * Use this instead of bare render() for components that use React Query or React Router.
 */

import { render, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { NavLayoutProvider } from '@/components/NavLayoutContext.js';
import { BreakpointProvider } from '@/context/BreakpointContext.js';
import { BrandingProvider } from '@/context/BrandingContext.js';

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
 * Creates a fresh QueryClient per call with retries disabled to keep tests fast,
 * unless a pre-configured QueryClient is provided via options.queryClient.
 *
 * @param ui - The React element to render
 * @param options - Optional router and query client configuration
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
      <MemoryRouter initialEntries={initialEntries}>
        <BreakpointProvider>
          <BrandingProvider>
            <NavLayoutProvider>{content}</NavLayoutProvider>
          </BrandingProvider>
        </BreakpointProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * A QueryClient already holding the given queries, as when a page is opened again with its
 * data cached. Nothing refetches, so a component sees only what was cached.
 */
export function createCachedQueryClient(
  entries: ReadonlyArray<readonly [readonly unknown[], unknown]>,
): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  for (const [key, data] of entries) queryClient.setQueryData(key, data);
  return queryClient;
}
