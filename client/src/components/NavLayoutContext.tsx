/**
 * NavLayoutContext — provides the active navigation layout to the whole app.
 *
 * Two values back it: the user's own preference and the workspace default. The
 * personal value wins; null means follow the workspace. Both are fetched here, so
 * no consuming component learns about the two-level lookup.
 *
 * Mounted inside LayoutShell rather than at the app root, because the personal read
 * is authenticated and would 401 on the login page.
 */

import { createContext, useContext } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getNavLayout, setNavLayout, NAV_LAYOUT_QUERY_KEY } from '@/api/settings.js';
import { getMyNavLayout, MY_NAV_LAYOUT_QUERY_KEY } from '@/api/users.js';
import type { NavLayout } from '@shared/schemas/settingsSchema.js';

interface NavLayoutContextValue {
  /** The layout to render: the user's own preference, else the workspace default. */
  layout: NavLayout;
  /** The workspace default, ignoring any personal value — the admin control edits this row. */
  workspaceLayout: NavLayout;
  /**
   * Persists a new workspace-wide layout and updates the cache immediately.
   *
   * @param layout - The new nav layout to apply.
   */
  saveLayout: (layout: NavLayout) => Promise<void>;
}

const NavLayoutContext = createContext<NavLayoutContextValue | null>(null);

/** The layout used when neither a personal nor a workspace value has been stored. */
const FALLBACK_LAYOUT: NavLayout = 'top';

/**
 * Provides the active navigation layout to all descendant components.
 * Must be rendered inside QueryClientProvider, below the authentication boundary.
 *
 * @param children - Child component tree.
 */
export function NavLayoutProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  // Workspace-scoped and rarely changed, so override the global staleTime: 0 to
  // avoid refetching on every window-focus event.
  const { data: workspaceData } = useQuery({
    queryKey: NAV_LAYOUT_QUERY_KEY,
    queryFn: getNavLayout,
    staleTime: 5 * 60 * 1000,
  });

  // Inherits the global staleTime: 0, as the language preference does. The key
  // carries no user id and logout does not clear the cache, so a cached value
  // would otherwise render for whoever logs in next in the same tab.
  const { data: personalData } = useQuery({
    queryKey: MY_NAV_LAYOUT_QUERY_KEY,
    queryFn: getMyNavLayout,
  });

  const workspaceLayout: NavLayout = workspaceData?.layout ?? FALLBACK_LAYOUT;
  const layout: NavLayout = personalData?.layout ?? workspaceLayout;

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
    <NavLayoutContext.Provider value={{ layout, workspaceLayout, saveLayout }}>
      {children}
    </NavLayoutContext.Provider>
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
