/**
 * Redirects unauthenticated users to /login, and non-admin users to an
 * access-denied page — every reporting endpoint this app calls is admin-only
 * (requireRole('admin') on the server), so a non-admin session can never
 * successfully use this dashboard regardless of what UI it renders.
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth.js';

export default function ProtectedRoute() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div aria-busy="true" data-testid="protected-route-loading">
        Loading…
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (user?.role !== 'admin') {
    return <Navigate to="/access-denied" replace />;
  }

  return <Outlet />;
}
