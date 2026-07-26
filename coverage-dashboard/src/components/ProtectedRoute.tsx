/**
 * Redirects unauthenticated users to /login, and non-admin users to an
 * access-denied page. This is a UX nicety, not the real security boundary —
 * every reporting endpoint this app calls independently enforces its own
 * server-side gate (coverageAccessGate: coverage:admin capability when
 * COVERAGE_CAPABILITY_GATING=true, requireRole('admin') otherwise — see
 * docs/dev/coverage.md's Access Control section, MINCRM-637).
 *
 * KNOWN GAP (accepted, not fixed here): this check stays role-based
 * (`user?.role !== 'admin'`) even under capability mode. A non-admin-role
 * user granted coverage:admin via a custom role would pass every server-side
 * gate but still be redirected here, since no endpoint exposes a user's
 * resolved capability set to this client today. Making this check
 * capability-aware is unscoped follow-up work, not a security regression —
 * every reporting endpoint's own server-side gate is unaffected by what this
 * component does.
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
