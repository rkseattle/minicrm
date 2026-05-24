/**
 * MfaRecoveryCodesModal — shown once after MFA is enabled. (MINCRM-392)
 * Displays the 8 single-use recovery codes with a copy-all button.
 * User must acknowledge before the modal closes.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button.js';

interface MfaRecoveryCodesModalProps {
  isOpen: boolean;
  recoveryCodes: string[];
  onDone: () => void;
}

/**
 * Displays recovery codes after MFA setup. Includes a copy-all button.
 * Requires explicit acknowledgement before the modal can be closed.
 */
export default function MfaRecoveryCodesModal({
  isOpen,
  recoveryCodes,
  onDone,
}: MfaRecoveryCodesModalProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const doneButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      requestAnimationFrame(() => doneButtonRef.current?.focus());
    } else {
      previousFocusRef.current?.focus();
    }
  }, [isOpen]);

  async function handleCopy(): Promise<void> {
    await navigator.clipboard.writeText(recoveryCodes.join('\n'));
    setCopied(true);
  }

  if (!isOpen) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      data-testid="mfa-recovery-codes-modal"
    >
      <dialog
        open
        aria-modal="true"
        aria-labelledby="mfa-recovery-title"
        className="relative w-full max-w-md mx-4 p-0"
      >
        <div
          role="presentation"
          className="bg-white rounded-lg shadow-xl p-6 space-y-4"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="mfa-recovery-title" className="text-lg font-semibold text-gray-900">
            {t('mfa.recoveryCodesModal.title')}
          </h2>

          <p className="text-sm text-gray-600">{t('mfa.recoveryCodesModal.hint')}</p>

          <ul
            className="grid grid-cols-2 gap-2 bg-gray-50 rounded-md p-4 font-mono text-sm"
            data-testid="mfa-recovery-codes-list"
          >
            {recoveryCodes.map((code) => (
              <li key={code} className="text-gray-800">
                {code}
              </li>
            ))}
          </ul>

          <div className="flex justify-between items-center pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleCopy()}
              data-testid="mfa-recovery-copy"
            >
              {copied ? t('mfa.recoveryCodesModal.copied') : t('mfa.recoveryCodesModal.copyButton')}
            </Button>

            <Button
              ref={doneButtonRef}
              type="button"
              variant="primary"
              size="md"
              onClick={onDone}
              data-testid="mfa-recovery-done"
            >
              {t('mfa.recoveryCodesModal.doneButton')}
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
