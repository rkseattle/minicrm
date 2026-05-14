/**
 * ForgotPasswordPage component. (MINCRM-156)
 *
 * Renders a single-field form where the user enters their email address to
 * request a password reset link. Always shows a success message after submit
 * (no user enumeration). The "Send Reset Link" button is disabled while the
 * request is in flight.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AxiosError } from 'axios';
import { forgotPassword } from '@/api/auth.js';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';

interface ApiError {
  error: { code: string; message: string };
}

/**
 * Forgot-password page — lets a user request a reset link by email.
 */
export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: () => forgotPassword(email),
    onSuccess: () => {
      setSubmitted(true);
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    mutation.mutate();
  };

  const serverError =
    (mutation.error as AxiosError<ApiError> | null)?.response?.data?.error?.message ??
    (mutation.isError ? t('errors.generic') : null);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary-600 tracking-tight">MiniCRM</h1>
          <p className="text-gray-500 mt-1 text-sm">{t('login.tagline')}</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-base font-semibold text-gray-900 mb-2">
            {t('forgotPassword.title')}
          </h2>
          <p className="text-sm text-gray-500 mb-6">{t('forgotPassword.subtitle')}</p>

          {submitted ? (
            <div
              role="status"
              data-testid="forgot-password-success"
              className="rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700"
            >
              {t('forgotPassword.successMessage')}
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
              <Input
                id="email"
                data-testid="forgot-password-email"
                type="email"
                autoComplete="email"
                required
                label={t('forgotPassword.emailLabel')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('forgotPassword.emailPlaceholder')}
              />

              {serverError && (
                <div
                  role="alert"
                  className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
                >
                  {serverError}
                </div>
              )}

              <Button
                type="submit"
                data-testid="forgot-password-submit"
                disabled={mutation.isPending}
                fullWidth
              >
                {mutation.isPending
                  ? t('forgotPassword.submitting')
                  : t('forgotPassword.submitButton')}
              </Button>
            </form>
          )}

          <p className="mt-4 text-center text-sm text-gray-500">
            <Link
              to="/login"
              data-testid="forgot-password-back-to-login"
              className="text-primary-600 hover:underline"
            >
              {t('forgotPassword.backToLogin')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
