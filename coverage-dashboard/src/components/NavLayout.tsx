import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { logout } from '@/api/auth.js';
import { isNoAuthMode } from '@/hooks/useAuth.js';

const NAV_LINK_CLASS = ({ isActive }: { isActive: boolean }): string =>
  `rounded-md px-3 py-2 text-sm font-medium ${
    isActive ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'
  }`;

export default function NavLayout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [logoutError, setLogoutError] = useState<string | null>(null);

  async function handleLogout(): Promise<void> {
    // A failed logout must not proceed as though it succeeded. The cookie may
    // still be valid, and LoginPage redirects an authenticated visitor straight
    // back to '/' — so clearing and navigating would land the user on the
    // dashboard still signed in, having been told they signed out.
    try {
      await logout();
    } catch {
      setLogoutError('Sign out failed. Please try again.');
      return;
    }
    // Clear, not setQueryData(null): nulling the auth entry leaves every other
    // key resident and readable on the next mount, so the next account on this
    // tab sees the previous one's data.
    queryClient.clear();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="border-b border-gray-200 bg-white px-6 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold text-gray-900">Coverage/TIA</span>
            <NavLink to="/" end className={NAV_LINK_CLASS} data-testid="nav-link-overview">
              Overview
            </NavLink>
            <NavLink to="/gaps" className={NAV_LINK_CLASS} data-testid="nav-link-gaps">
              Gaps
            </NavLink>
            <NavLink
              to="/traceability"
              className={NAV_LINK_CLASS}
              data-testid="nav-link-traceability"
            >
              Traceability
            </NavLink>
            <NavLink to="/sessions" className={NAV_LINK_CLASS} data-testid="nav-link-sessions">
              Sessions
            </NavLink>
          </div>
          {!isNoAuthMode() && (
            <button
              type="button"
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-700"
              data-testid="nav-logout-button"
            >
              Sign out
            </button>
          )}
        </div>
        {logoutError && (
          <p role="alert" data-testid="nav-logout-error" className="mt-2 text-sm text-red-600">
            {logoutError}
          </p>
        )}
      </nav>
      <Outlet />
    </div>
  );
}
