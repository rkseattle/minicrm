import { NavLink, Outlet } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { logout, AUTH_ME_QUERY_KEY } from '@/api/auth.js';

const NAV_LINK_CLASS = ({ isActive }: { isActive: boolean }): string =>
  `rounded-md px-3 py-2 text-sm font-medium ${
    isActive ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'
  }`;

export default function NavLayout() {
  const queryClient = useQueryClient();

  async function handleLogout(): Promise<void> {
    await logout();
    queryClient.setQueryData(AUTH_ME_QUERY_KEY, null);
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
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-gray-700"
            data-testid="nav-logout-button"
          >
            Sign out
          </button>
        </div>
      </nav>
      <Outlet />
    </div>
  );
}
