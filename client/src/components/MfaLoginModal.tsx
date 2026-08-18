/**
 * MfaLoginModal — prompts for TOTP or recovery code after password verification.
 * Shown when /auth/login returns { mfaRequired: true, mfaToken }.
 * On success, calls onSuccess with the user data so the LoginPage can complete the flow.
 */

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button.js';
import { verifyMfaLogin, verifyMfaRecoveryLogin } from '@/api/mfa.js';
import type { MfaLoginResponse } from '@/api/mfa.js';

interface MfaLoginModalProps {
  isOpen: boolean;
  mfaToken: string;
  onSuccess: (data: MfaLoginResponse) => void;
  onCancel: () => void;
}

type LoginMode = 'totp' | 'recovery';

/**
 * Full-screen modal that collects TOTP code or recovery code to complete login.
 * Switching between modes clears the input and resets error state.
 */
export default function MfaLoginModal({
  isOpen,
  mfaToken,
  onSuccess,
  onCancel,
}: MfaLoginModalProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<LoginMode>('totp');
  const [code, setCode] = useState('');
  const [invalidCode, setInvalidCode] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const totpMutation = useMutation({
    mutationFn: (c: string) => verifyMfaLogin(mfaToken, c),
    onSuccess: (data) => onSuccess(data),
    onError: () => {
      setInvalidCode(true);
      setCode('');
      requestAnimationFrame(() => inputRef.current?.focus());
    },
  });

  const recoveryMutation = useMutation({
    mutationFn: (c: string) => verifyMfaRecoveryLogin(mfaToken, c),
    onSuccess: (data) => onSuccess(data),
    onError: () => {
      setInvalidCode(true);
      setCode('');
      requestAnimationFrame(() => inputRef.current?.focus());
    },
  });

  const isPending = totpMutation.isPending || recoveryMutation.isPending;

  // Focus the input when the modal opens. State resets are not needed here
  // because the modal unmounts (`if (!isOpen) return null`) so state is fresh on each open.
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  function switchMode(next: LoginMode): void {
    setMode(next);
    setCode('');
    setInvalidCode(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') onCancel();
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setInvalidCode(false);
    if (mode === 'totp') {
      totpMutation.mutate(code);
    } else {
      recoveryMutation.mutate(code);
    }
  }

  if (!isOpen) return null;

  const isTotpMode = mode === 'totp';
  const titleKey = isTotpMode ? 'mfa.loginModal.title' : 'mfa.recoveryLoginModal.title';
  const hintKey = isTotpMode ? 'mfa.loginModal.hint' : 'mfa.recoveryLoginModal.hint';
  const placeholderKey = isTotpMode
    ? 'mfa.loginModal.codePlaceholder'
    : 'mfa.recoveryLoginModal.codePlaceholder';
  const submitKey = isTotpMode
    ? 'mfa.loginModal.verifyButton'
    : 'mfa.recoveryLoginModal.verifyButton';
  const submittingKey = isTotpMode
    ? 'mfa.loginModal.verifying'
    : 'mfa.recoveryLoginModal.verifying';
  const switchKey = isTotpMode
    ? 'mfa.loginModal.useRecoveryCode'
    : 'mfa.recoveryLoginModal.useTotp';
  const invalidKey = isTotpMode
    ? 'mfa.loginModal.invalidCode'
    : 'mfa.recoveryLoginModal.invalidCode';

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onKeyDown={handleKeyDown}
      data-testid="mfa-login-modal"
    >
      <dialog
        open
        aria-modal="true"
        aria-labelledby="mfa-login-title"
        className="relative w-full max-w-sm mx-4 p-0"
      >
        <div
          role="presentation"
          className="bg-white rounded-lg shadow-xl p-6 space-y-4"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="mfa-login-title" className="text-lg font-semibold text-gray-900">
            {t(titleKey)}
          </h2>

          <p className="text-sm text-gray-600">{t(hintKey)}</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <input
                ref={inputRef}
                type={isTotpMode ? 'text' : 'text'}
                inputMode={isTotpMode ? 'numeric' : 'text'}
                autoComplete={isTotpMode ? 'one-time-code' : 'off'}
                maxLength={isTotpMode ? 6 : undefined}
                value={code}
                onChange={(e) => {
                  const val = isTotpMode ? e.target.value.replace(/\D/g, '') : e.target.value;
                  setCode(val);
                  setInvalidCode(false);
                }}
                placeholder={t(placeholderKey)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                data-testid="mfa-login-code-input"
              />
              {invalidCode && (
                <p
                  role="alert"
                  className="mt-1 text-xs text-red-600"
                  data-testid="mfa-login-invalid-code"
                >
                  {t(invalidKey)}
                </p>
              )}
            </div>

            <Button
              type="submit"
              variant="primary"
              size="md"
              className="w-full"
              disabled={!code || isPending}
              data-testid="mfa-login-submit"
            >
              {isPending ? t(submittingKey) : t(submitKey)}
            </Button>
          </form>

          <div className="text-center">
            <button
              type="button"
              className="text-sm text-primary-600 hover:underline"
              onClick={() => switchMode(isTotpMode ? 'recovery' : 'totp')}
              data-testid="mfa-login-switch-mode"
            >
              {t(switchKey)}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
