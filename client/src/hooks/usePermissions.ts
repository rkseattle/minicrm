/**
 * usePermissions hook.
 *
 * Centralises UI permission checks so pages do not inline their own. `can()` reads the
 * effective capability set the server resolved, which is the only correct source for a
 * user holding a custom role — inferring from the role name disagrees with the server
 * wherever a custom role's grants differ from its name's built-in defaults.
 */

import { useAuth } from '@/hooks/useAuth.js';

interface UsePermissionsResult {
  /** True when the current user may create, update, or delete CRM records. */
  canWrite: boolean;
  /** True when the user's effective capability set contains `capability`. */
  can: (capability: string) => boolean;
}

/**
 * Returns coarse-grained UI permissions derived from the authenticated user's role.
 * The server enforces these same rules — this hook exists purely to suppress
 * action buttons and forms that a viewer or service account cannot use.
 */
/** Built-in role grants for the capabilities the UI gates on, mirroring migration 106. */
const BUILTIN_ROLE_CAPABILITIES: Record<string, readonly string[]> = {
  admin: [
    'reports:view',
    'reports:create',
    'reports:edit',
    'reports:delete',
    'reports:export',
    'sequences:view',
    'sequences:enroll',
    'dashboards:view',
    'connected_accounts:manage',
  ],
  manager: [
    'reports:view',
    'reports:create',
    'reports:edit',
    'reports:export',
    'sequences:view',
    'sequences:enroll',
    'dashboards:view',
    'connected_accounts:manage',
  ],
  rep: [
    'reports:view',
    'sequences:view',
    'sequences:enroll',
    'dashboards:view',
    'connected_accounts:manage',
  ],
  viewer: ['reports:view', 'dashboards:view'],
  service_account: [],
};

export function usePermissions(): UsePermissionsResult {
  const { user, capabilities } = useAuth();
  const canWrite = user?.role !== 'viewer' && user?.role !== 'service_account';

  // An older session's cached /auth/me predates the capabilities field. Falling back to the
  // built-in grants keeps the UI usable until it refreshes, rather than hiding every gated
  // control; the server is the authority either way.
  const effective =
    capabilities && capabilities.length > 0
      ? capabilities
      : (BUILTIN_ROLE_CAPABILITIES[user?.role ?? ''] ?? []);
  const can = (capability: string): boolean => effective.includes(capability);

  return { canWrite, can };
}
