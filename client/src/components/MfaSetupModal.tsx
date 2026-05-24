/**
 * MfaSetupModal — two-step modal for enabling TOTP MFA. (MINCRM-392)
 * Step 1: display QR code for the user to scan.
 * Step 2: user enters the 6-digit code to confirm, which enables MFA.
 * On success, calls onSuccess with the 8 plaintext recovery codes.
 */

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button.js';
import { setupMfa, verifyMfaSetup } from '@/api/mfa.js';

interface MfaSetupModalProps {
  isOpen: boolean;
  onSuccess: (recoveryCodes: string[]) => void;
  onCancel: () => void;
}

type SetupStep = 'qr' | 'verify';

/**
 * Two-step MFA setup modal: QR code scan → TOTP verification → recovery codes returned.
 */
export default function MfaSetupModal({ isOpen, onSuccess, onCancel }: MfaSetupModalProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<SetupStep>('qr');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [invalidCode, setInvalidCode] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const setupMutation = useMutation({
    mutationFn: setupMfa,
    onSuccess: (data) => {
      setQrDataUrl(data.qrDataUrl);
      setStep('qr');
    },
  });

  const verifyMutation = useMutation({
    mutationFn: (c: string) => verifyMfaSetup(c),
    onSuccess: (data) => {
      onSuccess(data.recoveryCodes);
    },
    onError: () => {
      setInvalidCode(true);
      setCode('');
      requestAnimationFrame(() => codeInputRef.current?.focus());
    },
  });

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      setStep('qr');
      setCode('');
      setInvalidCode(false);
      setQrDataUrl(null);
      setupMutation.mutate();
    } else {
      previousFocusRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (step === 'verify') {
      requestAnimationFrame(() => codeInputRef.current?.focus());
    }
  }, [step]);

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') onCancel();
  }

  function handleVerifySubmit(e: React.FormEvent): void {
    e.preventDefault();
    setInvalidCode(false);
    verifyMutation.mutate(code);
  }

  if (!isOpen) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onKeyDown={handleKeyDown}
      data-testid="mfa-setup-modal"
    >
      <dialog
        open
        aria-modal="true"
        aria-labelledby="mfa-setup-title"
        className="relative w-full max-w-md mx-4 p-0"
      >
        <div
          role="presentation"
          className="bg-white rounded-lg shadow-xl p-6 space-y-4"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="mfa-setup-title" className="text-lg font-semibold text-gray-900">
            {t('mfa.setupModal.title')}
          </h2>

          {step === 'qr' && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-gray-700">
                  {t('mfa.setupModal.step1Title')}
                </p>
                <p className="text-xs text-gray-500 mt-1">{t('mfa.setupModal.step1Hint')}</p>
              </div>

              {setupMutation.isPending && (
                <div className="h-48 flex items-center justify-center" data-testid="mfa-qr-loading">
                  <span className="text-sm text-gray-500">{t('common.loading')}</span>
                </div>
              )}

              {setupMutation.isError && (
                <p role="alert" className="text-sm text-red-600" data-testid="mfa-setup-load-error">
                  {t('errors.generic')}
                </p>
              )}

              {qrDataUrl && (
                <div className="flex justify-center" data-testid="mfa-qr-code">
                  <img src={qrDataUrl} alt={t('mfa.setupModal.step1Title')} className="w-48 h-48" />
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={onCancel}
                  data-testid="mfa-setup-cancel"
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={() => setStep('verify')}
                  disabled={!qrDataUrl}
                  data-testid="mfa-setup-next"
                >
                  {t('common.next')}
                </Button>
              </div>
            </div>
          )}

          {step === 'verify' && (
            <form onSubmit={handleVerifySubmit} className="space-y-4">
              <div>
                <p className="text-sm font-medium text-gray-700">
                  {t('mfa.setupModal.step2Title')}
                </p>
                <p className="text-xs text-gray-500 mt-1">{t('mfa.setupModal.step2Hint')}</p>
              </div>

              <div>
                <label
                  htmlFor="mfa-setup-code"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {t('mfa.setupModal.step2Title')}
                </label>
                <input
                  ref={codeInputRef}
                  id="mfa-setup-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, ''));
                    setInvalidCode(false);
                  }}
                  placeholder={t('mfa.setupModal.codePlaceholder')}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  data-testid="mfa-setup-code-input"
                />
                {invalidCode && (
                  <p
                    role="alert"
                    className="mt-1 text-xs text-red-600"
                    data-testid="mfa-setup-invalid-code"
                  >
                    {t('mfa.setupModal.invalidCode')}
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={() => setStep('qr')}
                  disabled={verifyMutation.isPending}
                  data-testid="mfa-setup-back"
                >
                  {t('common.back')}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  disabled={code.length !== 6 || verifyMutation.isPending}
                  data-testid="mfa-setup-verify"
                >
                  {verifyMutation.isPending
                    ? t('mfa.setupModal.verifying')
                    : t('mfa.setupModal.verifyButton')}
                </Button>
              </div>
            </form>
          )}
        </div>
      </dialog>
    </div>
  );
}
