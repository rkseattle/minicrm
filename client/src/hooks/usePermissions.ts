/**
 * usePermissions hook.
 *
 * Centralises role-based UI permission checks so that individual pages
 * do not need to inline role comparisons. Currently determines write
 * capability: viewers and service accounts are read-only in the UI.
 */

import { useAuth } from '@/hooks/useAuth.js';

interface UsePermissionsResult {
  /** True when the current user may create, update, or delete CRM records. */
  canWrite: boolean;
}

/**
 * Returns coarse-grained UI permissions derived from the authenticated user's role.
 * The server enforces these same rules — this hook exists purely to suppress
 * action buttons and forms that a viewer or service account cannot use.
 */
export function usePermissions(): UsePermissionsResult {
  const { user } = useAuth();
  const canWrite = user?.role !== 'viewer' && user?.role !== 'service_account';
  return { canWrite };
}
