/**
 * AdminRoute component.
 * Renders child routes only when the authenticated user has the 'admin' role.
 * Redirects to the dashboard if the user is authenticated but not an admin.
 * Redirects to login if the user is not authenticated.
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth.js';

/**
 * Guards routes that require the admin role.
 */
export default function AdminRoute() {
  const { t } = useTranslation();
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <div aria-busy="true">{t('common.loading')}</div>;
  }

  if (!isAuthenticated) {
    // Preserve the intended destination so LoginPage can redirect
    // back after successful authentication.
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (user!.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
