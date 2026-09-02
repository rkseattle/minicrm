/**
 * LoginPage component.
 * Renders the email/password login form.
 * On success, clears the query cache and redirects to the dashboard.
 * When the server returns mfaRequired:true, shows the MFA challenge modal.
 */

import { useState } from 'react';
import { useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import type { Location } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { login } from '@/api/auth.js';
import { getSsoStatus, SSO_STATUS_QUERY_KEY } from '@/api/sso.js';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { resolveApiError } from '@/utils/apiError.js';
import MfaLoginModal from '@/components/MfaLoginModal.js';
import type { MfaLoginResponse } from '@/api/mfa.js';

/**
 * Login page with email and password form.
 * Handles both direct login and MFA challenge flow.
 */
export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  // ProtectedRoute/AdminRoute pass the blocked location as state
  // so we can return the user there after a successful login.
  const fromLocation = (location.state as { from?: Location } | null)?.from;

  // the Axios 401 interceptor appends ?reason=session_expired and
  // ?next=<encoded-path> when redirecting here after a session expiry.
  const sessionExpired = searchParams.get('reason') === 'session_expired';
  const nextPath = searchParams.get('next');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // SSO status — determines whether to show the SSO login button
  const { data: ssoStatus } = useQuery({
    queryKey: SSO_STATUS_QUERY_KEY,
    queryFn: getSsoStatus,
    // staleTime: long — this rarely changes and we don't want a spinner on login
    staleTime: 5 * 60 * 1000,
  });

  // SSO error from callback redirect
  const ssoError = searchParams.get('sso_error');

  // MFA challenge state — set when login returns mfaRequired:true
  const [pendingMfaToken, setPendingMfaToken] = useState<string | null>(null);

  function completeLogin(mustChangePassword: boolean): void {
    // Clear rather than invalidate: a cached ['users','me',...] entry from a
    // previous account on this tab stays readable on the next mount. Safe in
    // place rather than behind a document load, unlike logout: a refetch here
    // carries the new session's cookie, so it cannot 401 into the expiry redirect.
    queryClient.clear();
    if (mustChangePassword) {
      navigate('/change-password', { replace: true });
    } else {
      // Priority order for redirect destination after login:
      // 1. ?next= param (set by 401 interceptor after session expiry)
      // 2. location.state.from (set by ProtectedRoute on unauthenticated access)
      // 3. Dashboard (default)
      // Never redirect back to /change-password — that path is reserved for the forced-change
      // flow and would create a confusing loop.
      const decodedNext = nextPath ? decodeURIComponent(nextPath) : null;
      const destination =
        decodedNext && decodedNext !== '/change-password'
          ? decodedNext
          : fromLocation?.pathname && fromLocation.pathname !== '/change-password'
            ? fromLocation
            : '/';
      navigate(destination, { replace: true });
    }
  }

  const loginMutation = useMutation({
    mutationFn: () => login(email, password),
    onSuccess: (data) => {
      if ('mfaRequired' in data && data.mfaRequired && 'mfaToken' in data) {
        // MFA challenge: server hasn't issued a session cookie yet
        setPendingMfaToken(data.mfaToken as string);
        return;
      }
      // Org-wide MFA is required but this user hasn't set it up. Session cookie
      // is issued so the user can reach the profile page to complete setup.
      if (data.mfaSetupRequired) {
        // A session cookie is issued here, so this is a session entry like any
        // other and clears the previous account's cache for the same reason.
        queryClient.clear();
        navigate('/profile?mfa_setup_required=1', { replace: true });
        return;
      }
      completeLogin(data.mustChangePassword ?? false);
    },
  });

  function handleMfaSuccess(data: MfaLoginResponse): void {
    setPendingMfaToken(null);
    completeLogin(data.mustChangePassword);
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    loginMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary-600 tracking-tight">MiniCRM</h1>
          <p className="text-gray-500 mt-1 text-sm">{t('login.tagline')}</p>
        </div>

        {/* Session-expired notice */}
        {sessionExpired && (
          <div
            role="status"
            data-testid="session-expired-banner"
            className="mb-4 rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800"
          >
            {t('login.sessionExpiredBanner')}
          </div>
        )}

        {/* SSO error notice — shown when the IdP callback redirects back with an error */}
        {ssoError && (
          <div
            role="alert"
            data-testid="sso-error-banner"
            className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
          >
            {t('login.ssoError')}
          </div>
        )}

        {/* Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-base font-semibold text-gray-900 mb-6">{t('login.title')}</h2>

          {/* SSO login button — shown when SSO is enabled */}
          {ssoStatus?.enabled && (
            <>
              <a
                href="/api/v1/auth/sso/login"
                data-testid="sso-login-button"
                className="flex w-full items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
              >
                {t('login.ssoButton', {
                  protocol: ssoStatus.protocol === 'saml' ? 'SAML 2.0' : 'Single Sign-On',
                })}
              </a>
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-xs text-gray-400 uppercase tracking-wide">
                  <span className="bg-white px-2">{t('login.orDivider')}</span>
                </div>
              </div>
            </>
          )}

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
                {resolveApiError(loginMutation.error, t)}
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

          <p className="mt-4 text-center text-sm text-gray-500">
            <Link
              to="/forgot-password"
              data-testid="login-forgot-password"
              className="text-primary-600 hover:underline"
            >
              {t('login.forgotPassword')}
            </Link>
          </p>
        </div>
      </div>

      {/* MFA challenge modal */}
      <MfaLoginModal
        isOpen={pendingMfaToken !== null}
        mfaToken={pendingMfaToken ?? ''}
        onSuccess={handleMfaSuccess}
        onCancel={() => setPendingMfaToken(null)}
      />
    </div>
  );
}
