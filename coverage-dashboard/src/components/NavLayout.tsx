import { NavLink, Outlet } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { logout } from '@/api/auth.js';
import { isNoAuthMode } from '@/hooks/useAuth.js';

const NAV_LINK_CLASS = ({ isActive }: { isActive: boolean }): string =>
  `rounded-md px-3 py-2 text-sm font-medium ${
    isActive ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'
  }`;

export default function NavLayout() {
  const queryClient = useQueryClient();

  async function handleLogout(): Promise<void> {
    // Errors are swallowed deliberately: the server may already have dropped the
    // session, so clearing and leaving is the safer of the two guesses, and an
    // unhandled rejection here would escape the onClick handler.
    await logout().catch(() => undefined);
    // Clear, not setQueryData(null): nulling the auth entry leaves every other
    // key resident and readable on the next mount, so the next account on this
    // tab sees the previous one's data.
    // Document load, not a router navigation: a route change leaves root-level
    // observers mounted to refetch after the clear and 401.
    queryClient.clear();
    window.location.href = '/login';
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
      </nav>
      <Outlet />
    </div>
  );
}
