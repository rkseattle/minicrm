/**
 * MfaDisableModal — confirms current password before disabling TOTP MFA.
 */

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button.js';
import { disableMfa } from '@/api/mfa.js';

interface MfaDisableModalProps {
  isOpen: boolean;
  onSuccess: () => void;
  onCancel: () => void;
}

/**
 * Password-confirmation modal for disabling MFA.
 * Focus is moved to the password input on open and restored to the trigger on close.
 */
export default function MfaDisableModal({ isOpen, onSuccess, onCancel }: MfaDisableModalProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [invalidPassword, setInvalidPassword] = useState(false);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const disableMutation = useMutation({
    mutationFn: (currentPassword: string) => disableMfa(currentPassword),
    onSuccess: () => {
      setPassword('');
      onSuccess();
    },
    onError: () => {
      setInvalidPassword(true);
      setPassword('');
      requestAnimationFrame(() => passwordInputRef.current?.focus());
    },
  });

  useEffect(() => {
    // Capture focus trigger and move focus into the modal.
    // State resets are not needed here — the modal returns null when !isOpen,
    // so state is always fresh when this effect runs with isOpen=true.
    previousFocusRef.current = document.activeElement as HTMLElement;
    requestAnimationFrame(() => passwordInputRef.current?.focus());
    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') onCancel();
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setInvalidPassword(false);
    disableMutation.mutate(password);
  }

  if (!isOpen) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onKeyDown={handleKeyDown}
      data-testid="mfa-disable-modal"
    >
      <dialog
        open
        aria-modal="true"
        aria-labelledby="mfa-disable-title"
        className="relative w-full max-w-sm mx-4 p-0"
      >
        <div
          role="presentation"
          className="bg-white rounded-lg shadow-xl p-6 space-y-4"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="mfa-disable-title" className="text-lg font-semibold text-gray-900">
            {t('mfa.disableModal.title')}
          </h2>

          <p className="text-sm text-gray-600">{t('mfa.disableModal.hint')}</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="mfa-disable-password"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('mfa.disableModal.passwordLabel')}
              </label>
              <input
                ref={passwordInputRef}
                id="mfa-disable-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setInvalidPassword(false);
                }}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                data-testid="mfa-disable-password-input"
              />
              {invalidPassword && (
                <p
                  role="alert"
                  className="mt-1 text-xs text-red-600"
                  data-testid="mfa-disable-invalid-password"
                >
                  {t('mfa.disableModal.invalidPassword')}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="md"
                onClick={onCancel}
                disabled={disableMutation.isPending}
                data-testid="mfa-disable-cancel"
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                variant="danger"
                size="md"
                disabled={!password || disableMutation.isPending}
                data-testid="mfa-disable-confirm"
              >
                {disableMutation.isPending
                  ? t('mfa.disableModal.confirming')
                  : t('mfa.disableModal.confirmButton')}
              </Button>
            </div>
          </form>
        </div>
      </dialog>
    </div>
  );
}
