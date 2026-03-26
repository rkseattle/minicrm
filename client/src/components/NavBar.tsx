/**
 * NavBar component.
 * Displayed on all authenticated pages. Shows the logged-in user's name,
 * navigation links, and a logout button.
 */

import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth, AUTH_QUERY_KEY } from '@/hooks/useAuth.js';
import { logout } from '@/api/auth.js';

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
      // Invalidate the auth query so ProtectedRoute redirects to /login
      queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      navigate('/login', { replace: true });
    },
  });

  return (
    <nav
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.75rem 1.5rem',
        borderBottom: '1px solid #e5e7eb',
        backgroundColor: '#ffffff',
      }}
    >
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
        <strong>MiniCRM</strong>
        <Link to="/">{t('nav.dashboard')}</Link>
        {user?.role === 'admin' && <Link to="/users">{t('nav.users')}</Link>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        {user && <span>{user.name}</span>}
        <button
          type="button"
          onClick={() => logoutMutation.mutate()}
          disabled={logoutMutation.isPending}
        >
          {t('nav.logout')}
        </button>
      </div>
    </nav>
  );
}
