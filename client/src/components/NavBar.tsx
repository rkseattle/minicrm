/**
 * NavBar component.
 * Sticky top navigation displayed on all authenticated pages.
 * Shows the app brand, navigation links with active state, and user controls.
 */

import { NavLink, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth, AUTH_QUERY_KEY } from '@/hooks/useAuth.js';
import { logout } from '@/api/auth.js';
import { Button } from '@/components/ui/Button.js';

/**
 * Returns Tailwind classes for a navigation link based on its active state.
 *
 * @param isActive - Whether the link matches the current route
 */
function navLinkClass({ isActive }: { isActive: boolean }): string {
  return [
    'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
    isActive
      ? 'bg-indigo-50 text-indigo-700'
      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50',
  ].join(' ');
}

/**
 * Top-level navigation bar.
 */
export default function NavBar() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      navigate('/login', { replace: true });
    },
  });

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-14">
        <div className="flex items-center gap-6">
          <span className="text-indigo-600 font-bold text-lg tracking-tight select-none">
            MiniCRM
          </span>
          <div className="flex items-center gap-1">
            <NavLink to="/" end className={navLinkClass} data-testid="nav-dashboard">
              {t('nav.dashboard')}
            </NavLink>
            <NavLink to="/contacts" className={navLinkClass} data-testid="nav-contacts">
              {t('nav.contacts')}
            </NavLink>
            {user?.role === 'admin' && (
              <NavLink to="/users" className={navLinkClass} data-testid="nav-users">
                {t('nav.users')}
              </NavLink>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {user && <span className="text-sm text-gray-500 hidden sm:block">{user.name}</span>}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="nav-logout"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
          >
            {t('nav.logout')}
          </Button>
        </div>
      </div>
    </nav>
  );
}
