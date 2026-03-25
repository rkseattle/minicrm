/**
 * AdminRoute component.
 * Renders child routes only when the authenticated user has the 'admin' role.
 * Redirects to the dashboard if the user is authenticated but not an admin.
 * Redirects to login if the user is not authenticated.
 */

import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth.js';

/**
 * Guards routes that require the admin role.
 *
 * @returns {JSX.Element}
 */
export default function AdminRoute() {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <div aria-busy="true">Loading…</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
