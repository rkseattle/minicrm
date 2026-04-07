/**
 * LoginPage component.
 * Renders the email/password login form.
 * On success, invalidates the auth query and redirects to the dashboard.
 */

import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { Location } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { AxiosError } from 'axios';
import { login } from '@/api/auth.js';
import { AUTH_QUERY_KEY } from '@/hooks/useAuth.js';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';

interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

/**
 * Extracts a translated error message from an axios error response.
 *
 * @param error - The caught error object.
 * @param t - The i18next translate function.
 */
function resolveErrorMessage(error: unknown, t: TFunction): string {
  const axiosError = error as AxiosError<ApiError>;
  const code = axiosError?.response?.data?.error?.code;
  if (code && t(`errors.${code}`, { defaultValue: '' })) {
    return t(`errors.${code}`);
  }
  return t('errors.generic');
}

/**
 * Login page with email and password form.
 */
export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  // MINCRM-147: ProtectedRoute/AdminRoute pass the blocked location as state
  // so we can return the user there after a successful login.
  const fromLocation = (location.state as { from?: Location } | null)?.from;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const loginMutation = useMutation({
    mutationFn: () => login(email, password),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      if (data.mustChangePassword) {
        navigate('/change-password', { replace: true });
      } else {
        // Return to the originally requested location when present; default to dashboard.
        // Pass the full location object so search params and hash are preserved.
        // Never redirect back to /change-password — that path is reserved for the
        // forced-change flow and would create a confusing loop. (MINCRM-147)
        const destination =
          fromLocation?.pathname && fromLocation.pathname !== '/change-password'
            ? fromLocation
            : '/';
        navigate(destination, { replace: true });
      }
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    loginMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-indigo-600 tracking-tight">MiniCRM</h1>
          <p className="text-gray-500 mt-1 text-sm">{t('login.tagline')}</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-base font-semibold text-gray-900 mb-6">{t('login.title')}</h2>

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
            <Input
              id="email"
              data-testid="login-email"
              type="email"
              autoComplete="email"
              required
              label={t('login.emailLabel')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('login.emailPlaceholder')}
            />

            <Input
              id="password"
              data-testid="login-password"
              type="password"
              autoComplete="current-password"
              required
              label={t('login.passwordLabel')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('login.passwordPlaceholder')}
            />

            {loginMutation.isError && (
              <div
                role="alert"
                className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
              >
                {resolveErrorMessage(loginMutation.error, t)}
              </div>
            )}

            <Button
              type="submit"
              data-testid="login-submit"
              disabled={loginMutation.isPending}
              fullWidth
            >
              {loginMutation.isPending ? t('login.submitting') : t('login.submitButton')}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
