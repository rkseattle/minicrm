/**
 * ProtectedRoute component.
 * Redirects unauthenticated users to the login page.
 * Shows a loading state while the auth check is in progress.
 */

import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth.js';

/**
 * Renders child routes only when the user is authenticated.
 * Redirects to /login otherwise.
 */
export default function ProtectedRoute() {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <div aria-busy="true">Loading…</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.must_change_password) {
    return <Navigate to="/change-password" replace />;
  }

  return <Outlet />;
}
