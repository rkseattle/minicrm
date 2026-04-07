/**
 * ProtectedRoute component.
 * Redirects unauthenticated users to the login page.
 * Shows a loading state while the auth check is in progress.
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth.js';

/**
 * Renders child routes only when the user is authenticated.
 * Redirects to /login otherwise.
 */
export default function ProtectedRoute() {
  const { t } = useTranslation();
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <div aria-busy="true">{t('common.loading')}</div>;
  }

  if (!isAuthenticated) {
    // MINCRM-147: preserve the intended destination so LoginPage can redirect
    // back after successful authentication.
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (user?.must_change_password) {
    return <Navigate to="/change-password" replace />;
  }

  return <Outlet />;
}
