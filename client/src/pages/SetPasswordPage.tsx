/**
 * SetPasswordPage component. (MINCRM-262)
 *
 * Renders the account-activation form for newly invited users. Reads the
 * invite token from the `?token=` query param and lets the user choose a
 * password. On success the user is redirected to /login with a confirmation
 * message. If the token is missing or the account is already activated, a
 * clear error is shown in place of the form.
 */

import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AxiosError } from 'axios';
import { setPassword } from '@/api/users.js';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { PASSWORD_MIN_LENGTH } from '@shared/schemas/userSchema.js';

interface ApiError {
  error: { code: string; message: string };
}

/** Inline password requirements hint shown below the password field. */
function PasswordHint({ t }: { t: ReturnType<typeof useTranslation>['t'] }) {
  return (
    <p className="text-xs text-gray-500 mt-1" data-testid="set-password-hint">
      {t('setPassword.passwordHint', { min: PASSWORD_MIN_LENGTH })}
    </p>
  );
}

/**
 * Set-password page — lets an invited user activate their account by choosing
 * a password. Uses the invite JWT from the `?token=` query param.
 */
export default function SetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const token = searchParams.get('token') ?? '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => setPassword(token, newPassword),
    onSuccess: () => {
      navigate('/login', {
        replace: true,
        state: { successMessage: t('setPassword.successRedirect') },
      });
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setLocalError(null);

    if (newPassword !== confirmPassword) {
      setLocalError(t('setPassword.passwordMismatch'));
      return;
    }

    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setLocalError(t('setPassword.passwordTooShort', { min: PASSWORD_MIN_LENGTH }));
      return;
    }

    if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setLocalError(t('setPassword.passwordComplexity'));
      return;
    }

    if (!/[^a-zA-Z0-9]/.test(newPassword)) {
      setLocalError(t('setPassword.passwordSpecial'));
      return;
    }

    mutation.mutate();
  };

  const serverErrorCode = (mutation.error as AxiosError<ApiError> | null)?.response?.data?.error
    ?.code;
  const isAlreadyActivated = serverErrorCode === 'USER_ALREADY_ACTIVATED';

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
            <h1 className="text-3xl font-bold text-primary-600 tracking-tight">MiniCRM</h1>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
            <div
              role="alert"
              data-testid="set-password-invalid-token"
              className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-4"
            >
              {t('setPassword.tokenMissing')}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Already-activated account — show error without a form.
  if (isAlreadyActivated) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-primary-600 tracking-tight">MiniCRM</h1>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
            <div
              role="alert"
              data-testid="set-password-already-activated"
              className="rounded-md bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-800 mb-4"
            >
              {t('setPassword.tokenAlreadyUsed')}
            </div>
            <Link
              to="/login"
              data-testid="set-password-login-link"
              className="text-primary-600 hover:underline text-sm"
            >
              {t('setPassword.loginLink')}
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
          <h1 className="text-3xl font-bold text-primary-600 tracking-tight">MiniCRM</h1>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-base font-semibold text-gray-900 mb-6">{t('setPassword.title')}</h2>

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
            <div>
              <Input
                id="new-password"
                data-testid="set-password-new"
                type="password"
                autoComplete="new-password"
                required
                label={t('setPassword.newPasswordLabel')}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('setPassword.newPasswordPlaceholder')}
              />
              <PasswordHint t={t} />
            </div>

            <Input
              id="confirm-password"
              data-testid="set-password-confirm"
              type="password"
              autoComplete="new-password"
              required
              label={t('setPassword.confirmPasswordLabel')}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t('setPassword.confirmPasswordPlaceholder')}
            />

            {displayError && (
              <div
                role="alert"
                data-testid="set-password-error"
                className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
              >
                {displayError}
              </div>
            )}

            <Button
              type="submit"
              data-testid="set-password-submit"
              disabled={mutation.isPending}
              fullWidth
            >
              {mutation.isPending ? t('setPassword.submitting') : t('setPassword.submitButton')}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
