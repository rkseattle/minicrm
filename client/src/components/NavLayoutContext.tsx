/**
 * NavLayoutContext — provides the active navigation layout to the whole app.
 * The layout is fetched from the server once and cached via React Query.
 * Any component can read the layout; only the admin settings page updates it.
 * (MINCRM-133)
 */

import { createContext, useContext } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getNavLayout, setNavLayout, NAV_LAYOUT_QUERY_KEY } from '@/api/settings.js';
import type { NavLayout } from '@shared/schemas/settingsSchema.js';

interface NavLayoutContextValue {
  /** The currently active navigation layout */
  layout: NavLayout;
  /**
   * Persists a new layout to the server and updates the cache immediately.
   * Returns a promise that resolves once the mutation settles.
   *
   * @param layout - The new nav layout to apply.
   */
  saveLayout: (layout: NavLayout) => Promise<void>;
}

const NavLayoutContext = createContext<NavLayoutContextValue | null>(null);

/**
 * Provides the active navigation layout to all descendant components.
 * Must be rendered inside QueryClientProvider.
 *
 * @param children - Child component tree.
 */
export function NavLayoutProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  // Nav layout is admin-only and changes rarely — override the global staleTime: 0
  // to avoid refetching on every window-focus event. (MINCRM-133, MINCRM-348)
  const { data } = useQuery({
    queryKey: NAV_LAYOUT_QUERY_KEY,
    queryFn: getNavLayout,
    staleTime: 5 * 60 * 1000,
  });

  const layout: NavLayout = data?.layout ?? 'top';

  /**
   * Saves the selected layout to the server and optimistically updates the cache.
   *
   * @param newLayout - The layout to persist.
   */
  async function saveLayout(newLayout: NavLayout): Promise<void> {
    const response = await setNavLayout(newLayout);
    queryClient.setQueryData(NAV_LAYOUT_QUERY_KEY, response);
  }

  return (
    <NavLayoutContext.Provider value={{ layout, saveLayout }}>{children}</NavLayoutContext.Provider>
  );
}

/**
 * Returns the active nav layout and a function to update it.
 * Must be called from within a NavLayoutProvider.
 */
export function useNavLayout(): NavLayoutContextValue {
  const context = useContext(NavLayoutContext);
  if (!context) {
    throw new Error('useNavLayout must be used within a NavLayoutProvider');
  }
  return context;
}
