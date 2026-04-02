/**
 * ChangePasswordPage component.
 * Shown when the user's must_change_password flag is true.
 * Forces the user to set a new password before accessing the app.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AxiosError } from 'axios';
import apiClient from '@/api/axiosInstance.js';
import { AUTH_QUERY_KEY } from '@/hooks/useAuth.js';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { PASSWORD_MIN_LENGTH } from '@shared/schemas/userSchema.js';

interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}

interface ApiError {
  error: { code: string; message: string };
}

/**
 * Sends the current and new passwords to the change-password endpoint.
 *
 * @param body - The current and new plaintext passwords.
 */
async function changePassword(body: ChangePasswordBody): Promise<void> {
  await apiClient.post('/auth/change-password', body);
}

/** Inline password requirement hint */
function PasswordHint({ t }: { t: ReturnType<typeof useTranslation>['t'] }) {
  return (
    <p className="text-xs text-gray-500 mt-1" data-testid="change-password-hint">
      {t('changePassword.passwordHint', {
        min: PASSWORD_MIN_LENGTH,
      })}
    </p>
  );
}

/**
 * Force-change-password page. Presented after login when must_change_password is true.
 */
export default function ChangePasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      navigate('/', { replace: true });
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setLocalError(null);

    if (newPassword !== confirmPassword) {
      setLocalError(t('changePassword.passwordMismatch'));
      return;
    }

    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setLocalError(t('changePassword.passwordTooShort', { min: PASSWORD_MIN_LENGTH }));
      return;
    }

    if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setLocalError(t('changePassword.passwordComplexity'));
      return;
    }

    mutation.mutate();
  };

  const serverError =
    (mutation.error as AxiosError<ApiError> | null)?.response?.data?.error?.message ??
    (mutation.isError ? t('errors.generic') : null);

  const displayError = localError ?? serverError;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-indigo-600 tracking-tight">MiniCRM</h1>
        </div>

        <div
          role="status"
          aria-live="polite"
          className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 mb-4 text-sm text-blue-800"
          data-testid="change-password-context-banner"
        >
          {t('changePassword.contextBanner')}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-base font-semibold text-gray-900 mb-6">
            {t('changePassword.title')}
          </h2>

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
            <Input
              id="current-password"
              data-testid="change-password-current"
              type="password"
              autoComplete="current-password"
              required
              label={t('changePassword.currentPasswordLabel')}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder={t('changePassword.currentPasswordPlaceholder')}
            />

            <div>
              <Input
                id="new-password"
                data-testid="change-password-new"
                type="password"
                autoComplete="new-password"
                required
                label={t('changePassword.newPasswordLabel')}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('changePassword.newPasswordPlaceholder')}
              />
              <PasswordHint t={t} />
            </div>

            <Input
              id="confirm-password"
              data-testid="change-password-confirm"
              type="password"
              autoComplete="new-password"
              required
              label={t('changePassword.confirmPasswordLabel')}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t('changePassword.confirmPasswordPlaceholder')}
            />

            {displayError && (
              <div
                role="alert"
                className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
              >
                {displayError}
              </div>
            )}

            <Button
              type="submit"
              data-testid="change-password-submit"
              disabled={mutation.isPending}
              fullWidth
            >
              {mutation.isPending
                ? t('changePassword.submitting')
                : t('changePassword.submitButton')}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
