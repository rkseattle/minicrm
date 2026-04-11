/**
 * ResetPasswordPage component. (MINCRM-157)
 *
 * Reads the reset token from the `?token=` query param and shows a form with
 * two fields: new password and confirm password. On success the server sets a
 * new session cookie and the user is redirected to the dashboard. If the token
 * is missing, expired, or already used, a clear error is shown with a link to
 * request a new reset email.
 */

import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AxiosError } from 'axios';
import { resetPassword } from '@/api/auth.js';
import { AUTH_QUERY_KEY } from '@/hooks/useAuth.js';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { PASSWORD_MIN_LENGTH } from '@shared/schemas/userSchema.js';

interface ApiError {
  error: { code: string; message: string };
}

/** Inline password requirements hint shown below the new-password field. */
function PasswordHint({ t }: { t: ReturnType<typeof useTranslation>['t'] }) {
  return (
    <p className="text-xs text-gray-500 mt-1" data-testid="reset-password-hint">
      {t('resetPassword.passwordHint', { min: PASSWORD_MIN_LENGTH })}
    </p>
  );
}

/**
 * Reset-password page — lets a user set a new password from a reset link.
 */
export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const token = searchParams.get('token') ?? '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => resetPassword(token, newPassword),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      navigate('/', { replace: true });
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setLocalError(null);

    if (newPassword !== confirmPassword) {
      setLocalError(t('resetPassword.passwordMismatch'));
      return;
    }

    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setLocalError(t('resetPassword.passwordTooShort', { min: PASSWORD_MIN_LENGTH }));
      return;
    }

    if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setLocalError(t('resetPassword.passwordComplexity'));
      return;
    }

    mutation.mutate();
  };

  const serverErrorCode = (mutation.error as AxiosError<ApiError> | null)?.response?.data?.error
    ?.code;
  const isTokenInvalid = serverErrorCode === 'RESET_TOKEN_INVALID';

  const serverError =
    (mutation.error as AxiosError<ApiError> | null)?.response?.data?.error?.message ??
    (mutation.isError ? t('errors.generic') : null);

  const displayError = localError ?? serverError;

  // Missing token — show error immediately without a form.
  if (!token) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-indigo-600 tracking-tight">MiniCRM</h1>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
            <div
              role="alert"
              data-testid="reset-password-invalid-token"
              className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-4"
            >
              {t('resetPassword.tokenMissing')}
            </div>
            <Link
              to="/forgot-password"
              data-testid="reset-password-request-new-link"
              className="text-indigo-600 hover:underline text-sm"
            >
              {t('resetPassword.requestNewLink')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-indigo-600 tracking-tight">MiniCRM</h1>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-base font-semibold text-gray-900 mb-6">{t('resetPassword.title')}</h2>

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
            <div>
              <Input
                id="new-password"
                data-testid="reset-password-new"
                type="password"
                autoComplete="new-password"
                required
                label={t('resetPassword.newPasswordLabel')}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('resetPassword.newPasswordPlaceholder')}
              />
              <PasswordHint t={t} />
            </div>

            <Input
              id="confirm-password"
              data-testid="reset-password-confirm"
              type="password"
              autoComplete="new-password"
              required
              label={t('resetPassword.confirmPasswordLabel')}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t('resetPassword.confirmPasswordPlaceholder')}
            />

            {displayError && (
              <div
                role="alert"
                data-testid="reset-password-error"
                className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
              >
                {displayError}
                {isTokenInvalid && (
                  <span className="block mt-1">
                    <Link
                      to="/forgot-password"
                      data-testid="reset-password-request-new-link"
                      className="underline"
                    >
                      {t('resetPassword.requestNewLink')}
                    </Link>
                  </span>
                )}
              </div>
            )}

            <Button
              type="submit"
              data-testid="reset-password-submit"
              disabled={mutation.isPending}
              fullWidth
            >
              {mutation.isPending ? t('resetPassword.submitting') : t('resetPassword.submitButton')}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
